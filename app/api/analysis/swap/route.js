import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request) {
  try {
    const { league, homeTeam, awayTeam } = await request.json();

    if (!league || !homeTeam || !awayTeam) {
      return NextResponse.json({ error: 'Nomi squadre mancanti' }, { status: 400 });
    }

    const db = await getDb();
    
    const oldKey = `${league}|${homeTeam}|${awayTeam}`;
    const newKey = `${league}|${awayTeam}|${homeTeam}`;

    // Se esiste già il newKey nel DB (perché avevamo creato una partita vuota), 
    // lo cancelliamo preventivamente per far spazio a quello popolato ed evitare collisioni.
    await db.execute({ sql: 'DELETE FROM pending_matches WHERE match_key = ?', args: [newKey] });
    await db.execute({ sql: 'DELETE FROM match_odds WHERE match_key = ?', args: [newKey] });

    // Swap match odds
    await db.execute({ 
      sql: 'UPDATE match_odds SET match_key = ? WHERE match_key = ?', 
      args: [newKey, oldKey] 
    });

    // Swap pending_matches (il carrello)
    await db.execute({ 
      sql: 'UPDATE pending_matches SET match_key = ?, home_team = ?, away_team = ? WHERE match_key = ?', 
      args: [newKey, awayTeam, homeTeam, oldKey] 
    });

    return NextResponse.json({ success: true, newHome: awayTeam, newAway: homeTeam });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Swap teams error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
