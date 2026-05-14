require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const supabase = require('./supabase');

const bot = new Telegraf(process.env.BOT_TOKEN);

const MINI_APP_URL = 'https://rollx-app.vercel.app';

// =========================
// USER UPSERT
// =========================

async function upsertUser(ctx) {
  const from = ctx.from;

  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        telegram_id: from.id,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        language_code: from.language_code || null,
        last_seen_at: new Date().toISOString()
      },
      {
        onConflict: 'telegram_id'
      }
    )
    .select()
    .single();

  if (error) {
    console.error('❌ Supabase Error:', error);
    return null;
  }

  return data;
}

// =========================
// MENU
// =========================

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

// =========================
// START COMMAND
// =========================

bot.start(async (ctx) => {
  const user = await upsertUser(ctx);

  const firstName = user?.first_name || 'Player';

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

// =========================
// MENU COMMAND
// =========================

bot.command('menu', async (ctx) => {
  await ctx.reply(
    `📋 RollX Menu`,
    mainMenu
  );
});

// =========================
// PLACEHOLDER BUTTONS
// =========================

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('👤 Profile coming soon.');
});

bot.action('balance', async (ctx) => {
  const telegramId = ctx.from.id;

  const { data } = await supabase
    .from('users')
    .select('balance')
    .eq('telegram_id', telegramId)
    .single();

  const balance = data?.balance || 0;

  await ctx.answerCbQuery();

  await ctx.reply(`💰 Your balance: $${balance}`);
});

bot.action('rewards', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🎁 Rewards system coming soon.');
});

bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('⚙️ Settings coming soon.');
});

// =========================
// START BOT
// =========================

bot.launch();

console.log('🎲 RollX bot is running...');

// =========================
// SAFE SHUTDOWN
// =========================

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
