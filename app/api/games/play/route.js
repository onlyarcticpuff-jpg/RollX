import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function money(n) {
  return Number(Number(n).toFixed(2));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacRandom(serverSeed, clientSeed, nonce) {
  const hmac = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const int = parseInt(hmac.slice(0, 8), 16);
  return int / 0xffffffff;
}

export async function POST(req) {
  try {
    const body = await req.json();

    const telegramId = body.telegram_id;
    const gameId = body.game_id || 'dice';
    const betAmount = money(body.bet_amount);
    const clientSeed = body.client_seed || `rollx-${telegramId}`;

    if (!telegramId) {
      return NextResponse.json({ error: 'Missing telegram_id' }, { status: 400 });
    }

    if (gameId !== 'dice') {
      return NextResponse.json({ error: 'Only dice is active rn' }, { status: 400 });
    }

    if (!betAmount || betAmount <= 0) {
      return NextResponse.json({ error: 'Invalid bet amount' }, { status: 400 });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const balanceBefore = money(user.balance);

    if (balanceBefore < betAmount) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }

    const { data: game } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    const minBet = Number(game?.min_bet || 1);
    const maxBet = Number(game?.max_bet || 100000);

    if (betAmount < minBet || betAmount > maxBet) {
      return NextResponse.json(
        { error: `Bet must be between ${minBet} and ${maxBet}` },
        { status: 400 }
      );
    }

    const nonce = Date.now();
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = sha256(serverSeed);

    const random = hmacRandom(serverSeed, clientSeed, nonce);
    const roll = Math.floor(random * 100) + 1;

    const win = roll >= 51;
    const multiplier = 1.98; // 50% chance × 1.98 = 99% RTP

    const payout = win ? money(betAmount * multiplier) : 0;
    const profit = money(payout - betAmount);
    const balanceAfter = money(balanceBefore - betAmount + payout);

    const { data: bet, error: betError } = await supabase
      .from('bets')
      .insert({
        user_id: user.id,
        game_id: gameId,
        idempotency_key: crypto.randomUUID(),
        status: 'resolved',
        bet_amount: betAmount,
        multiplier,
        payout,
        profit,
        result: win ? 'win' : 'loss',
        game_data: {
          roll,
          target: 'over 50',
          random
        },
        server_seed_hash: serverSeedHash,
        server_seed: serverSeed,
        client_seed: clientSeed,
        nonce,
        resolved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (betError) {
      console.error(betError);
      return NextResponse.json({ error: 'Bet insert failed' }, { status: 500 });
    }

    await supabase.from('users').update({
      balance: balanceAfter,
      total_wagered: money(Number(user.total_wagered || 0) + betAmount),
      total_won: money(Number(user.total_won || 0) + payout),
      total_profit: money(Number(user.total_profit || 0) + profit),
      xp: Number(user.xp || 0) + Math.floor(betAmount),
      updated_at: new Date().toISOString()
    }).eq('id', user.id);

    await supabase.from('transactions').insert([
      {
        user_id: user.id,
        idempotency_key: crypto.randomUUID(),
        type: 'bet',
        amount: -betAmount,
        balance_before: balanceBefore,
        balance_after: money(balanceBefore - betAmount),
        reference_type: 'bet',
        reference_id: bet.id,
        metadata: { game_id: gameId }
      },
      {
        user_id: user.id,
        idempotency_key: crypto.randomUUID(),
        type: win ? 'win' : 'push',
        amount: payout,
        balance_before: money(balanceBefore - betAmount),
        balance_after: balanceAfter,
        reference_type: 'bet',
        reference_id: bet.id,
        metadata: { game_id: gameId, roll }
      }
    ]);

    return NextResponse.json({
      success: true,
      game_id: gameId,
      bet_id: bet.id,
      roll,
      result: win ? 'win' : 'loss',
      multiplier,
      bet_amount: betAmount,
      payout,
      profit,
      balance: balanceAfter,
      provably_fair: {
        server_seed: serverSeed,
        server_seed_hash: serverSeedHash,
        client_seed: clientSeed,
        nonce
      }
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
