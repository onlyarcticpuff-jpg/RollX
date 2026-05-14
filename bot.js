require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const supabase = require('./supabase');
const crypto = require('crypto');

const bot = new Telegraf(process.env.BOT_TOKEN);

const MINI_APP_URL = process.env.MINI_APP_URL || 'https://rollx-app.vercel.app';

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from.id));
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

async function getUserByTelegramId(telegramId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (error) return null;
  return data;
}

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
      { onConflict: 'telegram_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('❌ User upsert error:', error);
    return null;
  }

  return data;
}

async function createTransaction({
  userId,
  type,
  amount,
  balanceBefore,
  balanceAfter,
  referenceType = null,
  referenceId = null,
  metadata = {}
}) {
  const { error } = await supabase.from('transactions').insert({
    user_id: userId,
    idempotency_key: crypto.randomUUID(),
    type,
    amount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    reference_type: referenceType,
    reference_id: referenceId,
    metadata
  });

  if (error) {
    console.error('❌ Transaction error:', error);
  }
}

async function setBalance(user, newBalance, type, amount, metadata = {}) {
  const balanceBefore = Number(user.balance || 0);
  const balanceAfter = Number(newBalance);

  if (balanceAfter < 0) {
    throw new Error('Balance cannot go below zero');
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      balance: balanceAfter,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    console.error('❌ Balance update error:', error);
    throw error;
  }

  await createTransaction({
    userId: user.id,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    metadata
  });

  return data;
}

async function addBalance(user, amount, type = 'admin_credit', metadata = {}) {
  const newBalance = Number(user.balance || 0) + Number(amount);
  return setBalance(user, newBalance, type, Number(amount), metadata);
}

async function removeBalance(user, amount, type = 'admin_debit', metadata = {}) {
  const newBalance = Number(user.balance || 0) - Number(amount);
  return setBalance(user, newBalance, type, -Math.abs(Number(amount)), metadata);
}

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.webApp('🎲 Open RollX', MINI_APP_URL)],
  [
    Markup.button.callback('👤 Profile', 'profile'),
    Markup.button.callback('💰 Balance', 'balance')
  ],
  [
    Markup.button.callback('🎁 Rewards', 'rewards'),
    Markup.button.callback('📜 History', 'history')
  ],
  [
    Markup.button.callback('⚙️ Settings', 'settings')
  ]
]);

bot.start(async (ctx) => {
  const user = await upsertUser(ctx);
  const firstName = user?.first_name || 'Player';

  await ctx.reply(
    `🎲 Welcome to RollX, ${firstName}

Roll. Bet. Win.

💰 Balance: ${money(user?.balance)} credits
🚀 Fast games
💎 Rewards
🪙 TON-ready ecosystem

Tap below to enter RollX.`,
    mainMenu
  );
});

bot.command('menu', async (ctx) => {
  await upsertUser(ctx);

  await ctx.reply(
    `📋 RollX Menu

Choose an option below.`,
    mainMenu
  );
});

bot.command('balance', async (ctx) => {
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  await ctx.reply(`💰 Balance: ${money(user?.balance)} credits`);
});

bot.command('profile', async (ctx) => {
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  await ctx.reply(
    `👤 RollX Profile

Name: ${user.first_name || 'Player'}
Username: @${user.username || 'none'}
Level: ${user.level}
XP: ${user.xp}

💰 Balance: ${money(user.balance)}
🎲 Wagered: ${money(user.total_wagered)}
🏆 Won: ${money(user.total_won)}
📈 Profit: ${money(user.total_profit)}`
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    `🧠 RollX Help

/start - Start RollX
/menu - Open menu
/balance - Check balance
/profile - View profile

Admin:
 /give <telegram_id> <amount>
 /take <telegram_id> <amount>`
  );
});

bot.command('give', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin only.');

  const parts = ctx.message.text.split(' ');
  const telegramId = parts[1];
  const amount = Number(parts[2]);

  if (!telegramId || !amount || amount <= 0) {
    return ctx.reply('Usage: /give <telegram_id> <amount>');
  }

  const user = await getUserByTelegramId(telegramId);
  if (!user) return ctx.reply('User not found.');

  const updated = await addBalance(user, amount, 'admin_credit', {
    by: ctx.from.id
  });

  await supabase.from('admin_logs').insert({
    admin_user_id: ctx.from.id,
    action: 'admin_credit',
    target_user_id: user.id,
    details: { amount }
  });

  await ctx.reply(
    `✅ Added ${money(amount)} credits

User: ${telegramId}
New balance: ${money(updated.balance)}`
  );
});

bot.command('take', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin only.');

  const parts = ctx.message.text.split(' ');
  const telegramId = parts[1];
  const amount = Number(parts[2]);

  if (!telegramId || !amount || amount <= 0) {
    return ctx.reply('Usage: /take <telegram_id> <amount>');
  }

  const user = await getUserByTelegramId(telegramId);
  if (!user) return ctx.reply('User not found.');

  if (Number(user.balance) < amount) {
    return ctx.reply('User does not have enough balance.');
  }

  const updated = await removeBalance(user, amount, 'admin_debit', {
    by: ctx.from.id
  });

  await supabase.from('admin_logs').insert({
    admin_user_id: ctx.from.id,
    action: 'admin_debit',
    target_user_id: user.id,
    details: { amount }
  });

  await ctx.reply(
    `✅ Removed ${money(amount)} credits

User: ${telegramId}
New balance: ${money(updated.balance)}`
  );
});

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  await ctx.reply(
    `👤 Profile

Level: ${user.level}
XP: ${user.xp}

💰 Balance: ${money(user.balance)}
🎲 Wagered: ${money(user.total_wagered)}
🏆 Won: ${money(user.total_won)}
📈 Profit: ${money(user.total_profit)}`
  );
});

bot.action('balance', async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  await ctx.reply(`💰 Your balance: ${money(user.balance)} credits`);
});

bot.action('rewards', async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  const { data: rewards } = await supabase
    .from('rewards')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!rewards || rewards.length === 0) {
    return ctx.reply('🎁 No pending rewards yet.');
  }

  const text = rewards
    .map((r) => `🎁 ${r.reward_type}: ${money(r.amount)} credits`)
    .join('\n');

  await ctx.reply(text);
});

bot.action('history', async (ctx) => {
  await ctx.answerCbQuery();
  await upsertUser(ctx);
  const user = await getUserByTelegramId(ctx.from.id);

  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!txs || txs.length === 0) {
    return ctx.reply('📜 No transaction history yet.');
  }

  const text = txs
    .map((t) => {
      const sign = Number(t.amount) >= 0 ? '+' : '';
      return `${t.type}: ${sign}${money(t.amount)} → ${money(t.balance_after)}`;
    })
    .join('\n');

  await ctx.reply(`📜 Recent Transactions\n\n${text}`);
});

bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('⚙️ Settings coming soon.');
});

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  ctx.reply('⚠️ Something broke. Try again.');
});

bot.launch();

console.log('🎲 RollX bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
