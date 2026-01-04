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

/* ======================
   BOT + SERVER
====================== */

const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

/* ======================
   USER STATE (IMPORTANT)
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
`👋 *Wisdom Exam Works – Registration*

Please enter your *Registered Name* 👇`,
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
      `📩 *Support Message*\nUser: ${chatId}\n\n${msg.text}`,
      { parse_mode: 'Markdown' }
    );

    bot.sendMessage(chatId, '✅ Message sent to support.');
    delete users[chatId];
    return;
  }

  /* 🔹 ADMIN → STUDENT (TEXT / PHOTO / PDF) */
  if (
    msg.chat.id.toString() === ADMIN_CHAT_ID &&
    Object.values(users).some(u => u.step === 'admin_chat')
  ) {
    const entry = Object.entries(users).find(
      ([_, u]) => u.step === 'admin_chat'
    );
    if (!entry) return;

    const [studentChatId] = entry;

    if (msg.text) {
      bot.sendMessage(studentChatId, msg.text);
    }

    if (msg.photo) {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      bot.sendPhoto(studentChatId, photoId, { caption: msg.caption || '' });
    }

    if (msg.document) {
      bot.sendDocument(studentChatId, msg.document.file_id, {
        caption: msg.caption || ''
      });
    }

    delete users[studentChatId];
    return;
  }

  if (!user) return;

  if (user.step === 1 && msg.text) {
    user.name = msg.text;
    user.step = 2;
    return bot.sendMessage(chatId, '📧 Enter Email ID:');
  }

  if (user.step === 2 && msg.text) {
    user.email = msg.text;
    user.step = 3;
    return bot.sendMessage(chatId, '📞 Enter Phone Number:');
  }

  if (user.step === 3 && msg.text) {
    user.phone = msg.text;
    user.step = 4;
    return bot.sendMessage(chatId, '📚 Enter Course Name:');
  }

  if (user.step === 4 && msg.text) {
    user.course = msg.text;
    user.step = 5;
    return bot.sendMessage(chatId, '💳 Enter UTR Number:');
  }

  if (user.step === 5 && msg.text) {
    user.utr = msg.text;
    user.step = 6;
    return bot.sendMessage(chatId, '📸 Upload Payment Screenshot');
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
`🧾 *Payment Received*

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
    '✅ Payment received.\nPlease wait for verification.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Contact Support', callback_data: `support_${chatId}` }]
        ]
      }
    }
  );

  /* ❌ DO NOT DELETE user here – VERY IMPORTANT */
});

/* ======================
   CALLBACK HANDLER
====================== */

bot.on('callback_query', (query) => {
  const data = query.data;
  const fromId = query.from.id.toString();

  if (data.startsWith('support_')) {
    const studentChatId = data.split('_')[1];
    users[studentChatId] = { step: 'support' };

    bot.sendMessage(studentChatId, '💬 Type your issue below.');
    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('adminchat_') && fromId === ADMIN_CHAT_ID) {
    const studentChatId = data.split('_')[1];
    users[studentChatId] = { step: 'admin_chat' };

    bot.sendMessage(
      ADMIN_CHAT_ID,
      `✍️ Send message / photo / PDF now.\nStudent ID: ${studentChatId}`
    );
    return bot.answerCallbackQuery(query.id);
  }

  if (fromId !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
  }

  const [action, studentChatId] = data.split('_');

  if (action === 'approve') {
    bot.sendMessage(studentChatId, '🎉 Payment Approved!');
    return bot.answerCallbackQuery(query.id);
  }

  if (action === 'reject') {
    bot.sendMessage(studentChatId, '❌ Payment Rejected.');
    return bot.answerCallbackQuery(query.id);
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
  await bot.setWebHook(
    `https://telegram-payment-bot-3vk9.onrender.com/bot${token}`
  );
  console.log('🚀 Bot Live');
});
