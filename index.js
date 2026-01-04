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
`👋 *Welcome to Wisdom Exam Works* – Mentorship Registration

🔐 Your details are secure  
👁️ Visible only to admin for verification

✍️ *Enter your Registered User Name:*`,
    { parse_mode: 'Markdown' }
  );
});

/* ======================
   MESSAGE HANDLER
====================== */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  /* 🔹 STUDENT → SUPPORT MESSAGE */
  if (user && user.step === 'support' && msg.text) {
    users[ADMIN_CHAT_ID] = {
      step: 'admin_support_reply',
      studentChatId: chatId
    };

    bot.sendMessage(
      ADMIN_CHAT_ID,
`📩 *New Support Message*

👤 Student ID: ${chatId}
💬 Message:
${msg.text}

✍️ Reply to this message to respond.`,
      { parse_mode: 'Markdown' }
    );

    bot.sendMessage(chatId, '✅ Message sent to support.');
    delete users[chatId];
    return;
  }

  /* 🔹 ADMIN → STUDENT SUPPORT REPLY */
  if (
    chatId.toString() === ADMIN_CHAT_ID &&
    users[ADMIN_CHAT_ID] &&
    users[ADMIN_CHAT_ID].step === 'admin_support_reply' &&
    msg.text
  ) {
    const studentChatId = users[ADMIN_CHAT_ID].studentChatId;

    bot.sendMessage(
      studentChatId,
      `💬 *Support Reply:*\n${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    delete users[ADMIN_CHAT_ID];
    return;
  }

  if (!user) return;

  /* 🔹 REGISTRATION FLOW */
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
    return bot.sendMessage(chatId, '📚 Enter Course Name (CGL Full time / Part time):');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UPI / Transaction Reference Number:');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Payment Screenshot');
  }
});

/* ======================
   GOOGLE SHEET FUNCTIONS
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

async function updateSheetStatus(utr, status) {
  await fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update_status',
      utr,
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
    '✅ Payment received.\n⏳ Please wait for verification.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Contact Support', callback_data: `support_${chatId}` }]
        ]
      }
    }
  );

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
      '💬 Type your issue below.'
    );

    return bot.answerCallbackQuery(query.id);
  }

  /* 🔒 ADMIN ONLY */
  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Unauthorized' });
  }

  const [action, studentChatId, utr] = data.split('_');

  if (action === 'approve') {
    await updateSheetStatus(utr, 'Approved');

    bot.sendMessage(
      studentChatId,
      '🎉 *Payment Approved!*\nLogin access will be shared soon.',
      { parse_mode: 'Markdown' }
    );

    return bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
  }

  if (action === 'reject') {
    await updateSheetStatus(utr, 'Rejected');

    bot.sendMessage(
      studentChatId,
      '❌ *Payment Rejected*\nPlease contact support.',
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
  console.log('🚀 Bot running');
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
});
