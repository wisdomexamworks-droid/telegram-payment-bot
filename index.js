const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ======================
   CONFIG
   ====================== */

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) {
  throw new Error("BOT_TOKEN is not defined in environment variables");
}

/* ======================
   BOT + SERVER
   ====================== */

const bot = new TelegramBot(token); // Webhook mode
const app = express();
app.use(express.json());

/* ======================
   USER STATE
   ====================== */

const users = {};

/* ======================
   START COMMAND
   ====================== */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to *Wisdom Exam Works* – Mentorship Registration

⚠️ *Disclaimer*:  
The details you share are safe & secure 🔐  
They are visible only to the admin for payment verification.

Please *Enter Your Registered User Name* 👇`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   MESSAGE HANDLER
   ====================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  /* 🔹 STUDENT → SUPPORT */
  if (user && user.step === 'support' && msg.text) {
    bot.sendMessage(
      ADMIN_CHAT_ID,
      `📩 *New Support Message*\n\n👤 User ID: ${chatId}\n💬 Message:\n${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    bot.sendMessage(chatId, '✅ Your message has been sent to support.');
    delete users[chatId];
    return;
  }

  /* 🔹 ADMIN → STUDENT DIRECT CHAT */
  if (
    msg.chat.id.toString() === ADMIN_CHAT_ID &&
    Object.values(users).some(u => u.step === 'admin_chat')
  ) {
    const entry = Object.entries(users).find(
      ([_, u]) => u.step === 'admin_chat'
    );

    if (entry) {
      const [studentChatId] = entry;

      bot.sendMessage(
        studentChatId,
        `💬 *Message from Support:*\n${msg.text}`,
        { parse_mode: 'Markdown' }
      );

      delete users[studentChatId];
      return;
    }
  }

  if (!user) return;

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

/* ======================
   PHOTO HANDLER
   ====================== */

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
        ],
        [
          { text: '💬 Message Student', callback_data: `adminchat_${chatId}` }
        ]
      ]
    }
  });

  bot.sendMessage(
    chatId,
    '✅ Payment details received.\nPlease wait for verification.\n\nNeed help?',
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

bot.on('callback_query', (query) => {
  const data = query.data;
  const fromId = query.from.id.toString();

  /* 🔹 STUDENT SUPPORT */
  if (data.startsWith('support_')) {
    const studentChatId = data.split('_')[1];
    users[studentChatId] = { step: 'support' };

    bot.sendMessage(
      studentChatId,
      '💬 Please type your issue below.\nOur support team will reply soon.'
    );

    return bot.answerCallbackQuery(query.id);
  }

  /* 🔹 ADMIN CHAT INITIATION */
  if (data.startsWith('adminchat_') && fromId === ADMIN_CHAT_ID) {
    const studentChatId = data.split('_')[1];
    users[studentChatId] = { step: 'admin_chat' };

    bot.sendMessage(
      ADMIN_CHAT_ID,
      `✍️ Type your message below.\nIt will be sent to student (${studentChatId}).`
    );

    return bot.answerCallbackQuery(query.id);
  }

  /* 🔒 ADMIN ONLY ACTIONS */
  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Unauthorized' });
  }

  const [action, studentChatId] = data.split('_');

  if (action === 'approve') {
    bot.sendMessage(
      studentChatId,
      '🎉 *Payment Approved!*\n\nLogin access will be shared shortly.',
      { parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
  }

  if (action === 'reject') {
    bot.sendMessage(
      studentChatId,
      '❌ *Payment Rejected*\n\nPlease contact support or re-upload correct details.',
      { parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(query.id, { text: '❌ Rejected' });
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
