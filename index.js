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
let supportQueue = [];          // 🔥 QUEUE
let adminCurrentStudent = null; // 🔥 ACTIVE CHAT

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to Wisdom Exam Works Mentorship 👋

Thank you for registering through our website. For any Support contact Gmail: Wisdomexamworks@gmail.com

To complete your submission, please share the details as mentioned.

🔒 Privacy Assurance:
Your details are confidential and visible only to our verification team.

🔒 Notice:
 If you are facing any issue in providing details, Resart the Bot once again by giving start or delete the chat and enter again.

 If start does'nt proceed wait for few seconds or give start once again. 

✍️ Enter your *Registered Name`,
    {
      reply_markup: {
        keyboard: [[{ text: '🆘 Support' }]],
        resize_keyboard: true
      }
    }
  );
});

/* ================= SUPPORT (BUTTON + COMMAND) ================= */

bot.onText(/\/support|🆘 Support/, (msg) => {
  const chatId = msg.chat.id;

  users[chatId] = { step: 'support' };

  bot.sendMessage(
    chatId,
`🆘 Support Mode Activated

✍️ Please type your issue.
You will be connected shortly.`,
    { reply_markup: { remove_keyboard: true } }
  );
});

/* ================= MESSAGE HANDLER ================= */

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];

  /* 🔴 ADMIN MESSAGE */
  if (chatId.toString() === ADMIN_CHAT_ID) {

    if (msg.text === '/end') {
      adminCurrentStudent = null;

      if (supportQueue.length > 0) {
        adminCurrentStudent = supportQueue.shift();
        return bot.sendMessage(
          ADMIN_CHAT_ID,
          `➡️ Next Student Connected: ${adminCurrentStudent}`
        );
      }

      return bot.sendMessage(ADMIN_CHAT_ID, '✅ No pending support requests');
    }

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

  /* 🔵 STUDENT SUPPORT MESSAGE */
  if (user && user.step === 'support' && msg.text) {

    supportQueue.push(chatId);

    await bot.sendMessage(
      ADMIN_CHAT_ID,
`🆕 Support Request Added

👤 Student ID: ${chatId}
📌 Position in Queue: ${supportQueue.length}`
    );

    if (!adminCurrentStudent) {
      adminCurrentStudent = supportQueue.shift();
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `➡️ Connected to Student: ${adminCurrentStudent}`
      );
    }

    await bot.sendMessage(
      chatId,
      '✅ Your issue is in queue. Please wait for admin reply.'
    );

    delete users[chatId];
    return;
  }

  if (!user) return;

  /* ================= REGISTRATION FLOW ================= */

  if (user.step === 1 && msg.text) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter Your Registered Email ID');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter Telegram Number');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Course (Part Time / Full Time)');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UTR/ Transaction Ref Number(NOT UPI ID)');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Payment Screenshot');
  }
});

/* ================= PHOTO HANDLER ================= */

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = users[chatId];
  if (!user || user.step !== 6) return;

  const photoId = msg.photo[msg.photo.length - 1].file_id;

  await bot.sendPhoto(ADMIN_CHAT_ID, photoId, {
    caption:
`🧾 Payment Submission

Name: ${user.name}
Email: ${user.email}
Phone: ${user.phone}
Course: ${user.course}
UTR: ${user.utr}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${chatId}` },
          { text: '❌ Reject', callback_data: `reject_${chatId}` }
        ]
      ]
    }
  });

  await bot.sendMessage(chatId, '✅ Payment received. Please wait.');
  delete users[chatId];
});

/* ================= CALLBACK ================= */

bot.on('callback_query', async (q) => {
  const [action, id] = q.data.split('_');
  if (q.from.id.toString() !== ADMIN_CHAT_ID) return;

  if (action === 'approve') {
    await bot.sendMessage(id, '🎉 Payment Approved');
  }

  if (action === 'reject') {
    await bot.sendMessage(id, '❌ Payment Rejected');
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
  console.log('✅ Bot running with support queue');
});
