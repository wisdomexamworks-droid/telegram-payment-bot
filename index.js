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
let supportQueue = [];
let adminCurrentStudent = null;

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to Wisdom Exam Works Mentorship 👋

Thank you for registering through our website.

📧 Support Email: wisdomexamworks@gmail.com

🔒 Privacy Assurance:
Your details are confidential.

⚠️ Note:
If you face any issue, restart the bot using /start
or 
tap 🆘 Support.
--------------------------------------------------------

✍️ Enter your *Registered Name*

-------------------------------------------------------`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '🆘 Support' }]],
        resize_keyboard: true
      }
    }
  );
});

/* ================= SUPPORT ================= */

bot.onText(/\/support|🆘 Support/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 'support' };

  bot.sendMessage(
    chatId,
`🆘 Support Mode Activated

✍️ Please type your issue clearly.
You will be replied shortly.`,
    { reply_markup: { remove_keyboard: true } }
  );
});

/* ================= MESSAGE HANDLER ================= */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // ✅ FIX 1: Allow admin commands, block only for users
  if (msg.text && msg.text.startsWith('/') && chatId.toString() !== ADMIN_CHAT_ID) {
    return;
  }

  if (!msg.text && !msg.photo && !msg.document) return;

  const user = users[chatId];

  /* ================= ADMIN ================= */

  if (chatId.toString() === ADMIN_CHAT_ID) {

    // ✅ FIX 2: STRONG /end LOGIC
    if (msg.text === '/end') {

      if (!adminCurrentStudent) {
        return bot.sendMessage(ADMIN_CHAT_ID, '⚠️ No active chat to end');
      }

      const endedUser = adminCurrentStudent;
      adminCurrentStudent = null;

      await bot.sendMessage(endedUser, '🔚 Support chat closed by admin.');

      if (supportQueue.length > 0) {
        const next = supportQueue.shift();
        adminCurrentStudent = next.chatId;

        return bot.sendMessage(
          ADMIN_CHAT_ID,
`➡️ Next Support Request

👤 Student ID: ${next.chatId}
💬 Message:
${next.message}

Reply now. Type /end to close.`
        );
      }

      return bot.sendMessage(ADMIN_CHAT_ID, '✅ No pending support requests');
    }

    // Admin reply handling
    if (adminCurrentStudent) {

      if (msg.text) {
        return bot.sendMessage(adminCurrentStudent, msg.text);
      }

      if (msg.photo) {
        return bot.sendPhoto(
          adminCurrentStudent,
          msg.photo[msg.photo.length - 1].file_id
        );
      }

      if (msg.document) {
        return bot.sendDocument(
          adminCurrentStudent,
          msg.document.file_id
        );
      }
    }

    return;
  }

  /* ================= SUPPORT FLOW ================= */

  if (user && user.step === 'support') {

    supportQueue.push({
      chatId,
      message: msg.text
    });

    await bot.sendMessage(
      chatId,
      '✅ Your issue has been sent to support. Please wait for reply.'
    );

    if (!adminCurrentStudent) {
      const next = supportQueue.shift();
      adminCurrentStudent = next.chatId;

      await bot.sendMessage(
        ADMIN_CHAT_ID,
`🆕 New Support Request

👤 Student ID: ${next.chatId}
💬 Message:
${next.message}

Reply now. Type /end to close.`
      );
    } else {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `📥 Added to queue. Pending: ${supportQueue.length}`
      );
    }

    delete users[chatId];
    return;
  }

  if (!user) return;

  /* ================= REGISTRATION ================= */

  if (user.step === 1) {
    user.name = msg.text.trim();
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter your Registered Email ID');
  }

  if (user.step === 2) {
    user.email = msg.text.trim();
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter your Telegram Number');
  }

  if (user.step === 3) {
    user.phone = msg.text.trim();
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Course Registered – (Part Time / Full Time)');
  }

  if (user.step === 4) {
    user.course = msg.text.trim();
    user.step = 5;
    return bot.sendMessage(chatId, '💳 UTR / Transaction Number (NOT UPI ID)');
  }

  if (user.step === 5) {
    user.utr = msg.text.trim();
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload your *Payment Screenshot*', {
      parse_mode: 'Markdown'
    });
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

/* ================= CALLBACK ================= */

bot.on('callback_query', async (q) => {
  const [action, id] = q.data.split('_');
  if (q.from.id.toString() !== ADMIN_CHAT_ID) return;

  if (action === 'msg') {
    adminCurrentStudent = id;

    return bot.sendMessage(
      ADMIN_CHAT_ID,
`✍️ Chat Opened

👤 Student ID: ${id}
Send message now.
Type /end to close.`
    );
  }

  if (action === 'approve') {
    await updateStatus(id, 'Approved');
    return bot.sendMessage(id, '🎉 Your payment has been Approved');
  }

  if (action === 'reject') {
    await updateStatus(id, 'Rejected');
    return bot.sendMessage(id, '❌ Your payment has been Rejected');
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
  console.log('✅ Bot running PERFECTLY 🚀');
});