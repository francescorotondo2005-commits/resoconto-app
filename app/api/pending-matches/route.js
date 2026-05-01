import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDb();
    const res = await db.execute(`
      SELECT p.*,
             (SELECT COUNT(*) FROM match_odds m WHERE m.match_key = p.match_key) as odds_count
      FROM pending_matches p
      ORDER BY p.updated_at DESC
    `);
    
    return NextResponse.json({ pendingMatches: res.rows });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { matchKey, in_gioco } = await request.json();
    if (!matchKey) return NextResponse.json({ error: 'Manca matchKey' }, { status: 400 });

    const db = await getDb();
    await db.execute({
      sql: 'UPDATE pending_matches SET in_gioco = ? WHERE match_key = ?',
      args: [in_gioco ? 1 : 0, matchKey],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const matchKey = url.searchParams.get('matchKey');
    if (!matchKey) return NextResponse.json({ error: 'Manca matchKey' }, { status: 400 });

    const db = await getDb();
    // Eliminiamo sia il record da pending_matches che tutte le relative quote salvate
    await db.execute({ sql: 'DELETE FROM pending_matches WHERE match_key = ?', args: [matchKey] });
    await db.execute({ sql: 'DELETE FROM match_odds WHERE match_key = ?', args: [matchKey] });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
