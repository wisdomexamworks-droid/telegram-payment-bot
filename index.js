const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ======================
   CONFIG
   ====================== */

const token = process.env.BOT_TOKEN;        // ONLY token source
const ADMIN_CHAT_ID = '779962598';

if (!token) {
  throw new Error("BOT_TOKEN is not defined in environment variables");
}

/* ======================
   BOT + SERVER
   ====================== */

const bot = new TelegramBot(token); // ✅ NO polling
const app = express();

app.use(express.json());

/* ======================
   USER STATE
   ====================== */

const users = {};

/* ======================
   BOT LOGIC
   ====================== */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to *Wisdom Exam Works* – Mentorship Registration

Please *Enter Your Registered User Name* 👇`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!users[chatId]) return;

  const user = users[chatId];

  if (user.step === 1 && msg.text) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter your Registered Email ID:');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter your Registered Telegram Number:');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Enter Course Name (CGL Full time / CGL Part time):');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UPI / Transaction Reference Number:');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Please upload Payment Screenshot');
  }
});

bot.on('photo', (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 *New Payment Submission*

👤 Name: ${user.name}
📧 Email: ${user.email}
📞 Phone: ${user.phone}
📚 Course: ${user.course}
💳 UTR: ${user.utr}

👆 Verify and choose action below`,
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

  bot.sendMessage(
    chatId,
    '✅ Payment details received.\nPlease wait for verification.'
  );

  delete users[chatId];
});

bot.on('callback_query', (query) => {
  const data = query.data;
  const adminId = query.from.id.toString();

  if (adminId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, {
      text: '❌ You are not authorized'
    });
  }

  const [action, studentChatId] = data.split('_');

  if (action === 'approve') {
    bot.sendMessage(
      studentChatId,
      '🎉 *Payment Approved!*\n\nLogin access will be shared shortly.',
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id, { text: '✅ Student Approved' });
  }

  if (action === 'reject') {
    bot.sendMessage(
      studentChatId,
      '❌ *Payment Rejected*\n\nPlease contact support or re-upload correct details.',
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id, { text: '❌ Student Rejected' });
  }
});

/* ======================
   WEBHOOK (RENDER)
   ====================== */

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("🚀 Server running");

  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
});
