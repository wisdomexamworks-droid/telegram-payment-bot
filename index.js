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

const bot = new TelegramBot(token); // webhook
const app = express();
app.use(express.json());

/* ======================
   USER STATE
====================== */

const users = {};

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

➡️ *Enter your Registered Name*`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   USER MESSAGE FLOW
====================== */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  // STUDENT → SUPPORT
  if (user && user.step === 'support' && msg.text) {
    await bot.sendMessage(
      ADMIN_CHAT_ID,
`📩 *Support Message*
Student ID: ${chatId}

${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    await bot.sendMessage(chatId, '✅ Message sent to support');
    delete users[chatId];
    return;
  }

  if (!user) return;

  if (user.step === 1 && msg.text) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter Email ID');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter Phone Number');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Enter Course Name');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UPI / Transaction ID');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Payment Screenshot');
  }
});

/* ======================
   GOOGLE SHEET
====================== */

async function sendToSheet(user, chatId) {
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
      status: 'Pending'
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

  // SEND TO ADMIN
  await bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 *Payment Submission*
👤 ${user.name}
📧 ${user.email}
📞 ${user.phone}
📚 ${user.course}
💳 ${user.utr}

Student ID: ${chatId}`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${chatId}` },
          { text: '❌ Reject', callback_data: `reject_${chatId}` }
        ]
      ]
    }
  });

  // ADMIN CHAT ENTRY MESSAGE
  await bot.sendMessage(
    ADMIN_CHAT_ID,
    `✍️ Reply to THIS message to chat with student\nStudent ID: ${chatId}`
  );

  await sendToSheet(user, chatId);

  await bot.sendMessage(
    chatId,
    '✅ Payment received. Please wait for verification.',
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
   CALLBACKS
====================== */

bot.on('callback_query', async (query) => {
  const data = query.data;
  const fromId = query.from.id.toString();

  // STUDENT SUPPORT
  if (data.startsWith('support_')) {
    const studentId = data.split('_')[1];
    users[studentId] = { step: 'support' };
    await bot.sendMessage(studentId, '✍️ Type your issue');
    return bot.answerCallbackQuery(query.id);
  }

  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
  }

  const [action, studentId] = data.split('_');

  if (action === 'approve') {
    await bot.sendMessage(
      studentId,
      '🎉 *Payment Approved*\nLogin access will be shared shortly',
      { parse_mode: 'Markdown' }
    );
  }

  if (action === 'reject') {
    await bot.sendMessage(
      studentId,
      '❌ *Payment Rejected*\nPlease contact support',
      { parse_mode: 'Markdown' }
    );
  }

  bot.answerCallbackQuery(query.id);
});

/* ======================
   ADMIN → STUDENT (TEXT / PHOTO / PDF)
====================== */

bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;
  if (!msg.reply_to_message?.text) return;

  const match = msg.reply_to_message.text.match(/Student ID:\s*(\d+)/);
  if (!match) return;

  const studentId = match[1];

  try {
    if (msg.text) {
      await bot.sendMessage(studentId, `💬 ${msg.text}`);
    }

    if (msg.photo) {
      const photoId = msg.photo.at(-1).file_id;
      await bot.sendPhoto(studentId, photoId, { caption: msg.caption || '' });
    }

    if (msg.document) {
      await bot.sendDocument(studentId, msg.document.file_id, {
        caption: msg.caption || ''
      });
    }

    await bot.sendMessage(ADMIN_CHAT_ID, `✅ Sent to ${studentId}`);
  } catch (e) {
    await bot.sendMessage(ADMIN_CHAT_ID, '❌ Failed to send');
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
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
  console.log('🚀 Bot live');
});
