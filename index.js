const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ================= CONFIG ================= */

const SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) throw new Error('BOT_TOKEN missing');
if (typeof fetch !== 'function') throw new Error('Node 18+ required');

/* ================= BOT ================= */

const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

/* ================= MEMORY ================= */

const users = {};
let supportQueue = [];
let adminCurrentStudent = null;

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 1 };

  bot.sendMessage(chatId,
`👋 Welcome to Wisdom Exam Works Mentorship 👋

📧 wisdomexamworks@gmail.com

✍️ Enter your *Registered Name*`,
  {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [[{ text: '🆘 Support' }]],
      resize_keyboard: true
    }
  });
});

/* ================= SUPPORT ================= */

bot.onText(/\/support/, handleSupport);
bot.onText(/🆘 Support/, handleSupport);

function handleSupport(msg) {
  const chatId = msg.chat.id;
  users[chatId] = { step: 'support' };

  bot.sendMessage(chatId,
`🆘 Support Mode

Type your issue.`,
  { reply_markup: { remove_keyboard: true } });
}

/* ================= MESSAGE HANDLER ================= */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // 🔥 Ignore commands ONLY for users
  if (msg.text && msg.text.startsWith('/') && chatId.toString() !== ADMIN_CHAT_ID) {
    return;
  }

  if (!msg.text) return;

  const user = users[chatId];

  /* ================= ADMIN ================= */

  if (chatId.toString() === ADMIN_CHAT_ID) {

    if (msg.text === '/end') {
      adminCurrentStudent = null;

      if (supportQueue.length > 0) {
        const next = supportQueue.shift();
        adminCurrentStudent = next.chatId;

        return bot.sendMessage(ADMIN_CHAT_ID,
`➡️ Next Support

👤 ${next.chatId}
💬 ${next.message}`);
      }

      return bot.sendMessage(ADMIN_CHAT_ID, '✅ No pending requests');
    }

    if (adminCurrentStudent) {
      return bot.sendMessage(adminCurrentStudent, msg.text);
    }

    return;
  }

  /* ================= SUPPORT FLOW ================= */

  if (user && user.step === 'support') {

    supportQueue.push({ chatId, message: msg.text });

    await bot.sendMessage(chatId,
      '✅ Sent to support. Wait for reply.');

    if (!adminCurrentStudent) {
      const next = supportQueue.shift();
      adminCurrentStudent = next.chatId;

      await bot.sendMessage(ADMIN_CHAT_ID,
`🆕 New Support

👤 ${next.chatId}
💬 ${next.message}`);
    }

    delete users[chatId];
    return;
  }

  if (!user) return;

  /* ================= REGISTRATION ================= */

  if (user.step === 1) {
    user.name = msg.text.trim();
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter Email');
  }

  if (user.step === 2) {
    user.email = msg.text.trim();
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter Phone');
  }

  if (user.step === 3) {
    user.phone = msg.text.trim();
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Course (PT/FT)');
  }

  if (user.step === 4) {
    user.course = msg.text.trim();
    user.step = 5;
    return bot.sendMessage(chatId, '💳 UTR Number');
  }

  if (user.step === 5) {
    user.utr = msg.text.trim();
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Screenshot');
  }
});

/* ================= GOOGLE SHEET ================= */

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

async function updateStatus(chatId, status) {
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

/* ================= PHOTO ================= */

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  await bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 Payment

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
        ]
      ]
    }
  });

  await sendToSheet(user, chatId);
  await bot.sendMessage(chatId, '✅ Sent for verification');
  delete users[chatId];
});

/* ================= CALLBACK ================= */

bot.on('callback_query', async (q) => {
  const [action, id] = q.data.split('_');

  if (q.from.id.toString() !== ADMIN_CHAT_ID) return;

  if (action === 'approve') {
    await updateStatus(id, 'Approved');
    return bot.sendMessage(id, '🎉 Approved');
  }

  if (action === 'reject') {
    await updateStatus(id, 'Rejected');
    return bot.sendMessage(id, '❌ Rejected');
  }
});

/* ================= WEBHOOK ================= */

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
  console.log('🚀 Bot Running Perfectly');
});