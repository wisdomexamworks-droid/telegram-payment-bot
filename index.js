const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ======================
   CONFIG
====================== */

const SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) {
  throw new Error('BOT_TOKEN is not defined');
}

if (typeof fetch !== 'function') {
  throw new Error('Node 18+ required (global fetch missing)');
}

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
`👋 Welcome to *Wisdom Exam Works* – Mentorship Registration

⚠️ Your details are secure 🔐  
Visible only to admin for verification.

Please *Enter Your Registered User Name* 👇`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   MESSAGE HANDLER (STUDENT FLOW)
====================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  // Student → Support
  if (user && user.step === 'support' && msg.text) {
    bot.sendMessage(
      ADMIN_CHAT_ID,
      `📩 *Support Message*\n\n👤 Student ID: ${chatId}\n💬 ${msg.text}`,
      { parse_mode: 'Markdown' }
    );
    bot.sendMessage(chatId, '✅ Message sent to support.');
    delete users[chatId];
    return;
  }

  if (!user) return;

  if (user.step === 1 && msg.text) {
    user.name = msg.text; user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter your Email ID:');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text; user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter Telegram Number:');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text; user.step = 4;
    return bot.sendMessage(chatId, '📚 Enter Course Name:');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text; user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UTR / Transaction ID:');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text; user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Payment Screenshot');
  }
});

/* ======================
   SEND TO GOOGLE SHEET
====================== */

async function sendToSheet(user, chatId) {
  const res = await fetch(SHEET_WEBHOOK_URL, {
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

  if (!res.ok) throw new Error('Sheet error');
}

/* ======================
   PHOTO HANDLER
====================== */

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 *Payment Submission*

👤 ${user.name}
📧 ${user.email}
📞 ${user.phone}
📚 ${user.course}
💳 ${user.utr}`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${chatId}` },
          { text: '❌ Reject', callback_data: `reject_${chatId}` }
        ],
        [
          { text: '💬 Message Student', callback_data: `adminchat_${chatId}` }
        ]
      ]
    }
  });

  await sendToSheet(user, chatId);

  bot.sendMessage(
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
});

/* ======================
   CALLBACK HANDLER (STEP-3 CONFIRMED)
====================== */

bot.on('callback_query', (query) => {
  const data = query.data;
  const fromId = query.from.id.toString();

  // Student support
  if (data.startsWith('support_')) {
    const sid = data.split('_')[1];
    users[sid] = { step: 'support' };
    bot.sendMessage(sid, '💬 Type your issue below.');
    return bot.answerCallbackQuery(query.id);
  }

  // ✅ ADMIN CHAT INIT (STEP-3 FIXED)
  if (data.startsWith('adminchat_') && fromId === ADMIN_CHAT_ID) {
    const studentChatId = data.split('_')[1];
    bot.sendMessage(
      ADMIN_CHAT_ID,
      `✍️ Reply to THIS message to chat with student\nStudent ID: ${studentChatId}`
    );
    return bot.answerCallbackQuery(query.id);
  }

  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
  }

  const [action, studentChatId] = data.split('_');

  if (action === 'approve') {
    bot.sendMessage(studentChatId, '🎉 Payment Approved!');
    return bot.answerCallbackQuery(query.id, { text: 'Approved' });
  }

  if (action === 'reject') {
    bot.sendMessage(studentChatId, '❌ Payment Rejected.');
    return bot.answerCallbackQuery(query.id, { text: 'Rejected' });
  }
});

/* ======================
   ADMIN → STUDENT (TEXT / PHOTO / PDF)
====================== */

bot.on('message', async (msg) => {
  if (
    msg.chat.id.toString() !== ADMIN_CHAT_ID ||
    !msg.reply_to_message ||
    !msg.reply_to_message.text
  ) return;

  const match = msg.reply_to_message.text.match(/Student ID:\s(\d+)/);
  if (!match) return;

  const studentChatId = match[1];

  if (msg.text) {
    await bot.sendMessage(
      studentChatId,
      `💬 *Support Message:*\n${msg.text}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (msg.photo) {
    const pid = msg.photo[msg.photo.length - 1].file_id;
    await bot.sendPhoto(studentChatId, pid, { caption: msg.caption || '📎 From Support' });
  }

  if (msg.document) {
    await bot.sendDocument(studentChatId, msg.document.file_id, {
      caption: msg.caption || '📎 From Support'
    });
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
  console.log('🚀 Server running');
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
});
