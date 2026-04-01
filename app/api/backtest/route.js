import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET - Fetch backtest bets
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '1000');
    
    const db = await getDb();
    const res = await db.execute({ sql: 'SELECT * FROM backtest_bets ORDER BY created_at DESC LIMIT ?', args: [limit] });
    const backtestBets = res.rows;
    
    // Aggregation Stats for Backtest
    const completed = backtestBets.filter(b => b.outcome !== 'PENDING' && b.outcome !== 'VOID');
    const wins = completed.filter(b => b.outcome === 'WIN').length;
    const losses = completed.filter(b => b.outcome === 'LOSS').length;
    const total = completed.length;
    
    // Assume a flat bet of 1 euro for theoretical profit
    let theoreticalProfit = 0;
    
    // Calculate stats by Category
    const byCategory = {};

    for (const b of completed) {
      const bestOdds = Math.max(b.sportium || -1, b.sportbet || -1);
      
      let profit = 0;
      if (b.outcome === 'WIN') {
        profit = bestOdds - 1;
      } else if (b.outcome === 'LOSS') {
        profit = -1;
      }
      theoreticalProfit += profit;

      if (!byCategory[b.bet_category]) {
        byCategory[b.bet_category] = { wins: 0, total: 0, profit: 0 };
      }
      
      byCategory[b.bet_category].total++;
      if (b.outcome === 'WIN') byCategory[b.bet_category].wins++;
      byCategory[b.bet_category].profit += profit;
    }

    const hitRate = total > 0 ? wins / total : 0;
    const yieldPercentage = total > 0 ? (theoreticalProfit / total) : 0; // standard yield
    const avgEdge = total > 0 ? completed.reduce((s, b) => s + b.best_edge, 0) / total : 0;

    const stats = {
      total,
      wins,
      losses,
      hitRate,
      theoreticalProfit,
      yieldPercentage,
      avgEdge,
      byCategory
    };

    return NextResponse.json({ backtestBets, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a backtest bet
export async function DELETE(request) {
  try {
    const { id } = await request.json();
    const db = await getDb();
    
    await db.execute({ sql: 'DELETE FROM backtest_bets WHERE id = ?', args: [id] });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
