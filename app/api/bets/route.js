import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET - Fetch bets
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = searchParams.get('league');
    const category = searchParams.get('category');
    const outcome = searchParams.get('outcome');
    const limit = parseInt(searchParams.get('limit') || '500');

    const db = await getDb();
    let query = 'SELECT * FROM bets WHERE 1=1';
    const params = [];

    if (league) { query += ' AND league = ?'; params.push(league); }
    if (category) { query += ' AND bet_category = ?'; params.push(category); }
    if (outcome) { query += ' AND outcome = ?'; params.push(outcome); }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const betsRes = await db.execute({ sql: query, args: params });
    const bets = betsRes.rows;

    // Aggregate stats
    const allBetsRes = await db.execute({ sql: 'SELECT * FROM bets WHERE outcome != ?', args: ['PENDING']});
    const allBets = allBetsRes.rows;
    
    const stats = {
      total: allBets.length,
      wins: allBets.filter(b => b.outcome === 'WIN').length,
      losses: allBets.filter(b => b.outcome === 'LOSS').length,
      totalStaked: allBets.reduce((s, b) => s + (b.stake || 0), 0),
      totalProfit: allBets.reduce((s, b) => s + (b.profit || 0), 0),
      avgEdge: allBets.length > 0 ? allBets.reduce((s, b) => s + b.edge, 0) / allBets.length : 0,
      hitRate: allBets.length > 0 ? allBets.filter(b => b.outcome === 'WIN').length / allBets.length : 0,
      byLeague: {},
      byCategory: {},
      byBookmaker: {},
    };

    // Per-league stats
    for (const b of allBets) {
      if (!stats.byLeague[b.league]) stats.byLeague[b.league] = { wins: 0, total: 0, profit: 0 };
      stats.byLeague[b.league].total++;
      if (b.outcome === 'WIN') stats.byLeague[b.league].wins++;
      stats.byLeague[b.league].profit += b.profit || 0;

      if (!stats.byCategory[b.bet_category]) stats.byCategory[b.bet_category] = { wins: 0, total: 0, profit: 0 };
      stats.byCategory[b.bet_category].total++;
      if (b.outcome === 'WIN') stats.byCategory[b.bet_category].wins++;
      stats.byCategory[b.bet_category].profit += b.profit || 0;

      if (!stats.byBookmaker[b.bookmaker]) stats.byBookmaker[b.bookmaker] = { wins: 0, total: 0, profit: 0 };
      stats.byBookmaker[b.bookmaker].total++;
      if (b.outcome === 'WIN') stats.byBookmaker[b.bookmaker].wins++;
      stats.byBookmaker[b.bookmaker].profit += b.profit || 0;
    }

    return NextResponse.json({ bets, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Add a bet
export async function POST(request) {
  try {
    const bet = await request.json();
    const db = await getDb();

    const result = await db.execute({
      sql: `
        INSERT INTO bets (date, league, match_description, bet_name, bet_category,
          ev, sd, cv, probability, fair_odds, min_odds, actual_odds, bookmaker,
          edge, stake, stake_kelly, outcome, profit, referee_rating, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        bet.date, bet.league, bet.match_description, bet.bet_name, bet.bet_category,
        bet.ev, bet.sd, bet.cv, bet.probability, bet.fair_odds, bet.min_odds,
        bet.actual_odds, bet.bookmaker, bet.edge,
        bet.stake || 1, bet.stake_kelly || null,
        bet.outcome || 'PENDING', bet.profit || null,
        bet.referee_rating || null, bet.notes || null
      ]
    });

    return NextResponse.json({ id: Number(result.lastInsertRowid), success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update bet (outcome, profit, actual_odds, edge)
export async function PATCH(request) {
  try {
    const data = await request.json();
    const db = await getDb();

    if (data.action === 'edit_odds') {
      await db.execute({ 
        sql: 'UPDATE bets SET actual_odds = ?, bookmaker = ?, edge = ?, profit = ? WHERE id = ?', 
        args: [data.actual_odds, data.bookmaker, data.edge, data.profit, data.id] 
      });
    } else {
      await db.execute({ 
        sql: 'UPDATE bets SET outcome = ?, profit = ? WHERE id = ?', 
        args: [data.outcome, data.profit, data.id] 
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a bet
export async function DELETE(request) {
  try {
    const { id } = await request.json();
    const db = await getDb();
    
    await db.execute({ sql: 'DELETE FROM bets WHERE id = ?', args: [id] });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
