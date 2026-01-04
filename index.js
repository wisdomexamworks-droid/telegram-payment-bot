const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// 🔴 FIX 1: Render fetch issue
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

/* ======================
   CONFIG
====================== */

const SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) {
  throw new Error('BOT_TOKEN is not defined in environment variables');
}

/* ======================
   BOT + SERVER
====================== */

const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

/* ======================
   USER STATE
====================== */

const users = {};
const replyMap = {}; // 🔥 FIX 2: admin reply mapping

/* ======================
   START COMMAND
====================== */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to *Wisdom Exam Works* – Mentorship Registration

⚠️ *Disclaimer*
Your details are safe & secure 🔐  
Visible only to admin for payment verification.

Please *Enter Your Registered User Name* 👇`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   MESSAGE HANDLER
====================== */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  /* 🔹 ADMIN → STUDENT (reply based – FIXED) */
  if (chatId.toString() === ADMIN_CHAT_ID && msg.reply_to_message) {
    const studentChatId = replyMap[msg.reply_to_message.message_id];
    if (studentChatId) {
      bot.sendMessage(
        studentChatId,
        `💬 *Message from Support:*\n${msg.text}`,
        { parse_mode: 'Markdown' }
      );
      delete replyMap[msg.reply_to_message.message_id];
    }
    return;
  }

  const user = users[chatId];
  if (!user) return;

  /* 🔹 STUDENT → SUPPORT */
  if (user.step === 'support' && msg.text) {
    const sent = await bot.sendMessage(
      ADMIN_CHAT_ID,
      `📩 *New Support Message*\n\n👤 User ID: ${chatId}\n💬 Message:\n${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    replyMap[sent.message_id] = chatId;

    bot.sendMessage(chatId, '✅ Your message has been sent to support.');
    delete users[chatId];
    return;
  }

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
   SEND TO GOOGLE SHEET
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

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 *New Payment Submission*

👤 Name: ${user.name}
📧 Email: ${user.email}
📞 Phone: ${user.phone}
📚 Course: ${user.course}
💳 UTR: ${user.utr}`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${chatId}_${user.utr}` },
          { text: '❌ Reject', callback_data: `reject_${chatId}_${user.utr}` }
        ],
        [
          { text: '💬 Message Student', callback_data: `support_${chatId}` }
        ]
      ]
    }
  });

  await sendToSheet(user, chatId);

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

  // 🔴 FIX 3: delete pannala (support / approve venum)
  user.step = 'submitted';
});

/* ======================
   CALLBACK HANDLER
====================== */

bot.on('callback_query', async (query) => {
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

  /* 🔒 ADMIN ONLY */
  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Unauthorized' });
  }

  const [action, studentChatId, utr] = data.split('_');

  if (action === 'approve') {
    await fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_status',
        utr,
        status: 'Approved'
      })
    });

    bot.sendMessage(
      studentChatId,
      '🎉 *Payment Approved!*\n\nLogin access will be shared shortly.\nPlease check your registered email ✉️',
      { parse_mode: 'Markdown' }
    );
    return bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
  }

  if (action === 'reject') {
    await fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_status',
        utr,
        status: 'Rejected'
      })
    });

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
  console.log('🚀 Server running');
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
});
