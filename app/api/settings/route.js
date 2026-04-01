import { NextResponse } from 'next/server';
import { getDb, getSetting, setSetting } from '@/lib/db';

// GET - Get all settings
export async function GET() {
  try {
    const db = await getDb();
    const res = await db.execute('SELECT * FROM settings');
    const settings = {};
    for (const row of res.rows) {
      settings[row.key] = row.value;
    }

    // Also include API key status (don't expose the full key)
    const apiKey = settings.api_football_key || process.env.API_FOOTBALL_KEY || '';
    settings.api_football_configured = apiKey && apiKey !== 'YOUR_API_KEY_HERE';

    // DB stats
    const matchCount = await db.execute('SELECT COUNT(*) as count FROM matches');
    const betCount = await db.execute('SELECT COUNT(*) as count FROM bets');
    const leagueCounts = await db.execute(
      'SELECT league, COUNT(*) as count FROM matches GROUP BY league'
    );

    settings.db_stats = {
      totalMatches: matchCount.rows[0].count,
      totalBets: betCount.rows[0].count,
      byLeague: leagueCounts.rows,
    };

    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Update settings
export async function POST(request) {
  try {
    const updates = await request.json();
    
    for (const [key, value] of Object.entries(updates)) {
      await setSetting(key, value);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
