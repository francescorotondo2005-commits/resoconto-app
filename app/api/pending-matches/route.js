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
