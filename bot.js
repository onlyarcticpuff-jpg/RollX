require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Mini App URL
const MINI_APP_URL = 'https://rollx-app.vercel.app';

// Main menu keyboard
const mainMenu = Markup.inlineKeyboard([
  [
    Markup.button.webApp('🎲 Open RollX', MINI_APP_URL)
  ],
  [
    Markup.button.callback('👤 Profile', 'profile'),
    Markup.button.callback('💰 Balance', 'balance')
  ],
  [
    Markup.button.callback('🎁 Rewards', 'rewards'),
    Markup.button.callback('⚙️ Settings', 'settings')
  ]
]);

// /start command
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name || 'Player';

  await ctx.reply(
    `🎲 Welcome to RollX, ${firstName}

The next-gen Telegram arcade betting experience.

🚀 Fast games
💎 Rewards
🪙 TON ecosystem
🔥 Smooth Mini App experience

Tap below to enter RollX.`,
    mainMenu
  );
});

// /menu command
bot.command('menu', async (ctx) => {
  await ctx.reply(
    `📋 RollX Menu

Choose an option below.`,
    mainMenu
  );
});

// Placeholder button handlers
bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('👤 Profile system coming soon.');
});

bot.action('balance', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💰 Balance system coming soon.');
});

bot.action('rewards', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🎁 Rewards system coming soon.');
});

bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('⚙️ Settings coming soon.');
});

// Launch bot
bot.launch();

console.log('🎲 RollX bot is running...');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
