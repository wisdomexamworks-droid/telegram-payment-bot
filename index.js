const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// 🔴 REQUIRED FOR RENDER
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

/* ================= CONFIG ================= */

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = 779962598;
const SHEET_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

if (!TOKEN) throw new Error('BOT_TOKEN missing');

/* ================= BOT ================= */

const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

const users = {};
const supportMap = {}; // 🔥 KEY FIX

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  users[msg.chat.id] = { step: 1 };
  bot.sendMessage(msg.chat.id, 'Enter your Name:');
});

/* ================= MESSAGE ================= */

bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const user = users[id];

  /* ADMIN REPLY TO SUPPORT */
  if (id === ADMIN_CHAT_ID && msg.reply_to_message) {
    const studentId = supportMap[msg.reply_to_message.message_id];
    if (studentId) {
      bot.sendMessage(studentId, `💬 Support Reply:\n${msg.text}`);
      delete supportMap[msg.reply_to_message.message_id];
    }
    return;
  }

  if (!user) return;

  if (user.step === 1) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(id, 'Enter Email:');
  }

  if (user.step === 2) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(id, 'Enter Phone:');
  }

  if (user.step === 3) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(id, 'Enter Course:');
  }

  if (user.step === 4) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(id, 'Enter UTR:');
  }

  if (user.step === 5) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(id, 'Upload payment screenshot');
  }

  /* SUPPORT MESSAGE */
  if (user.step === 'support') {
    const sent = await bot.sendMessage(
      ADMIN_CHAT_ID,
      `Support from ${id}:\n${msg.text}`
    );
    supportMap[sent.message_id] = id;
    delete users[id];
  }
});

/* ================= PHOTO ================= */

bot.on('photo', async (msg) => {
  const id = msg.chat.id;
  const user = users[id];
  if (!user || user.step !== 6) return;

  const fileId = msg.photo.at(-1).file_id;

  await bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
    caption: `Name: ${user.name}\nUTR: ${user.utr}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: `approve_${id}_${user.utr}` },
          { text: 'Reject', callback_data: `reject_${id}_${user.utr}` }
        ]
      ]
    }
  });

  // ✅ GOOGLE SHEET FIX
  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user)
  });

  bot.sendMessage(id, 'Payment submitted.');
  delete users[id];
});

/* ================= CALLBACK ================= */

bot.on('callback_query', async (q) => {
  const [action, studentId, utr] = q.data.split('_');

  if (q.from.id !== ADMIN_CHAT_ID) return;

  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update_status',
      utr,
      status: action === 'approve' ? 'Approved' : 'Rejected'
    })
  });

  bot.sendMessage(
    studentId,
    action === 'approve'
      ? 'Payment Approved ✅'
      : 'Payment Rejected ❌'
  );

  bot.answerCallbackQuery(q.id);
});

/* ================= WEBHOOK ================= */

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(3000, async () => {
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${TOKEN}`
  );
  console.log('🚀 LIVE');
});
