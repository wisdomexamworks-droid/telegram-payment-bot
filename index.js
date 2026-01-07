const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

/* ================= CONFIG ================= */

const SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbyjwJ7tx4vAZclhaemeHrJw5GbE-hIo3erWohQyVKryXs3QWY0ztBT5epEKnV1upF4P/exec';

const token = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = '779962598';

if (!token) throw new Error('BOT_TOKEN missing');
if (typeof fetch !== 'function') throw new Error('Node 18+ required');

/* ================= BOT + SERVER ================= */

const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

/* ================= MEMORY ================= */

const users = {};
let adminCurrentStudent = null;

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to Wisdom Exam Works Mentorship 👋

Thank you for registering through our website.

To complete your submission, please share the deatils as mentioned in bracket:

🔒 Privacy Assurance:
Your details are confidential and visible only to our verification team.

✍️ Enter your *Registered Name*`,
    { parse_mode: 'Markdown' }
  );
});

/* ================= MESSAGE HANDLER ================= */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  /* 🔴 ADMIN → STUDENT DIRECT MESSAGE */
  if (chatId.toString() === ADMIN_CHAT_ID && adminCurrentStudent) {
    if (msg.text) {
      await bot.sendMessage(adminCurrentStudent, msg.text);
    } else if (msg.photo) {
      await bot.sendPhoto(
        adminCurrentStudent,
        msg.photo[msg.photo.length - 1].file_id
      );
    } else if (msg.document) {
      await bot.sendDocument(
        adminCurrentStudent,
        msg.document.file_id
      );
    }
    return;
  }

  /* 🔵 STUDENT SUPPORT */
  if (user && user.step === 'support' && msg.text) {
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `📩 Support Message\nUser: ${chatId}\n\n${msg.text}`
    );
    await bot.sendMessage(chatId, '✅ Message sent to support');
    delete users[chatId];
    return;
  }

  if (!user) return;

  if (user.step === 1 && msg.text) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter your Registered Email ID');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter your Telegram Number');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Course Registered – (Type - Part Time / Full Time) ');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 UTR / Transaction Number (NOT UPI ID)');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload your *Payment Screenshot*');
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

/* ================= PHOTO HANDLER ================= */

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  await bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 Payment Submission

👤 Name: ${user.name}
📧 Email: ${user.email}
📞 Phone: ${user.phone}
📚 Course: ${user.course}
💳 UTR: ${user.utr}`,
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
  });

  await sendToSheet(user, chatId);

  await bot.sendMessage(chatId, '✅ Payment received. Please wait for verification.');
  delete users[chatId];
});

/* ================= CALLBACK HANDLER ================= */

bot.on('callback_query', async (q) => {
  const data = q.data;
  const fromId = q.from.id.toString();

  if (data.startsWith('msg_') && fromId === ADMIN_CHAT_ID) {
    adminCurrentStudent = data.split('_')[1];
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `✍️ Now chatting with student: ${adminCurrentStudent}`
    );
    return bot.answerCallbackQuery(q.id);
  }

  if (fromId !== ADMIN_CHAT_ID) return;

  const [action, id] = data.split('_');

  if (action === 'approve') {
    await updateStatus(id, 'Approved');
    await bot.sendMessage(id, '🎉 Your payment has been *Approved*', { parse_mode: 'Markdown' });
  }

  if (action === 'reject') {
    await updateStatus(id, 'Rejected');
    await bot.sendMessage(id, '❌ Your payment has been *Rejected*', { parse_mode: 'Markdown' });
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
  console.log('✅ Bot running with webhook');
});
