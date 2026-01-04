const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ======================
   CONFIG
====================== */

const SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) throw new Error('BOT_TOKEN missing');
if (typeof fetch !== 'function') throw new Error('Node 18+ required');

/* ======================
   BOT + SERVER
====================== */

const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

/* ======================
   MEMORY
====================== */

const users = {};
const adminReplyMap = {}; // admin → student mapping

/* ======================
   START
====================== */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 *Wisdom Exam Works – Payment Verification*

Your details are secure 🔐  
Visible only to admin.

Enter *Registered Name* 👇`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   MESSAGE HANDLER
====================== */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  /* 🔴 ADMIN REPLY → STUDENT (TEXT / PHOTO / PDF) */
  if (
    chatId.toString() === ADMIN_CHAT_ID &&
    msg.reply_to_message &&
    adminReplyMap[msg.reply_to_message.message_id]
  ) {
    const studentId = adminReplyMap[msg.reply_to_message.message_id];

    if (msg.text) {
      await bot.sendMessage(studentId, msg.text);
    } else if (msg.photo) {
      await bot.sendPhoto(studentId, msg.photo.at(-1).file_id);
    } else if (msg.document) {
      await bot.sendDocument(studentId, msg.document.file_id);
    }

    return;
  }

  /* 🔵 STUDENT SUPPORT MESSAGE */
  if (user && user.step === 'support' && msg.text) {
    const sent = await bot.sendMessage(
      ADMIN_CHAT_ID,
`📩 *Support Message*
👤 User: ${chatId}

${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    adminReplyMap[sent.message_id] = chatId;
    bot.sendMessage(chatId, '✅ Message sent to support');
    delete users[chatId];
    return;
  }

  if (!user) return;

  if (user.step === 1 && msg.text) {
    user.name = msg.text; user.step = 2;
    return bot.sendMessage(chatId, '📧 Email ID:');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text; user.step = 3;
    return bot.sendMessage(chatId, '📞 Telegram Number:');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text; user.step = 4;
    return bot.sendMessage(chatId, '📚 Course Name:');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text; user.step = 5;
    return bot.sendMessage(chatId, '💳 UTR / Transaction ID:');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text; user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload payment screenshot');
  }
});

/* ======================
   GOOGLE SHEET
====================== */

async function sendToSheet(user, chatId, status = 'Pending') {
  await fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      telegramId: chatId,
      phone: user.phone,
      course: user.course,
      utr: user.utr,
      status
    })
  });
}

async function updateSheetStatus(chatId, status) {
  await fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'update',
      telegramId: chatId,
      status
    })
  });
}

/* ======================
   PHOTO HANDLER
====================== */

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo.at(-1).file_id;

  const sent = await bot.sendPhoto(
    ADMIN_CHAT_ID,
    photoId,
    {
      caption:
`🧾 Payment Submission

👤 ${user.name}
📧 ${user.email}
📞 ${user.phone}
📚 ${user.course}
💳 ${user.utr}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve_${chatId}` },
            { text: '❌ Reject', callback_data: `reject_${chatId}` }
          ],
          [
            { text: '💬 Message Student', callback_data: `msg_${chatId}` }
          ]
        ]
      }
    }
  );

  adminReplyMap[sent.message_id] = chatId;
  await sendToSheet(user, chatId);

  bot.sendMessage(
    chatId,
    '✅ Payment received. Wait for verification.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Contact Support', callback_data: `support_${chatId}` }]
        ]
      }
    }
  );

  delete users[chatId];
});

/* ======================
   CALLBACK HANDLER
====================== */

bot.on('callback_query', async (q) => {
  const data = q.data;
  const fromId = q.from.id.toString();

  if (data.startsWith('support_')) {
    const id = data.split('_')[1];
    users[id] = { step: 'support' };
    bot.sendMessage(id, 'Type your issue below 👇');
    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith('msg_') && fromId === ADMIN_CHAT_ID) {
    const id = data.split('_')[1];
    bot.sendMessage(
      ADMIN_CHAT_ID,
      `✍️ Reply to THIS message to chat with student\nID: ${id}`
    ).then(m => adminReplyMap[m.message_id] = id);

    return bot.answerCallbackQuery(q.id);
  }

  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(q.id, { text: 'Unauthorized' });
  }

  const [action, id] = data.split('_');

  if (action === 'approve') {
    await updateSheetStatus(id, 'Approved');
    await bot.sendMessage(id, '🎉 Payment Approved');
    return bot.answerCallbackQuery(q.id, { text: 'Approved' });
  }

  if (action === 'reject') {
    await updateSheetStatus(id, 'Rejected');
    await bot.sendMessage(id, '❌ Payment Rejected');
    return bot.answerCallbackQuery(q.id, { text: 'Rejected' });
  }
});

/* ======================
   WEBHOOK
====================== */

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('🚀 Bot running');
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
});
