const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = '8570229743:AAGwN64uM10cGVxUKNUM3jC5HiYF3iqv1DM';
const ADMIN_CHAT_ID = '779962598';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const users = {};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  users[chatId] = { step: 1 };

  bot.sendMessage(
    chatId,
`👋 Welcome to *Wisdom Exam Works* – Mentorship Registration

Please *Enter Your Registerted User Name* 👇`,
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

  return bot.sendMessage(
    chatId,
    '💳 Enter UPI / Transaction Reference Number:'
  );
}
if (user.step === 5 && msg.text) {
  user.utr = msg.text;
  user.step = 6;

  return bot.sendMessage(
    chatId,
    '📸 Please upload Payment Screenshot'
  );
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
  const adminId = query.from.id;

  if (adminId.toString() !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, {
      text: '❌ You are not authorized'
    });
  }

  const action = data.split('_')[0];
  const studentChatId = data.split('_')[1];

  if (action === 'approve') {
    bot.sendMessage(
      studentChatId,
      '🎉 *Payment Approved!*\n\nLogin access will be shared shortly.',
      { parse_mode: 'Markdown' }
    );

    bot.answerCallbackQuery(query.id, {
      text: '✅ Student Approved'
    });
  }

  if (action === 'reject') {
    bot.sendMessage(
      studentChatId,
      '❌ *Payment Rejected*\n\nPlease contact support or re-upload correct details.',
      { parse_mode: 'Markdown' }
    );

    bot.answerCallbackQuery(query.id, {
      text: '❌ Student Rejected'
    });
  }
});

