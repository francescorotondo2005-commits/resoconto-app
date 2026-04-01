import { NextResponse } from 'next/server';
import { getDb, getSetting } from '@/lib/db';
import { fetchFixtures, LEAGUE_NAMES } from '@/lib/fixtures';

// GET - Fetch fixtures for today (from cache or API)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const forceRefresh = searchParams.get('refresh') === 'true';

    const db = await getDb();
    const apiKey = await getSetting('api_football_key') || process.env.API_FOOTBALL_KEY;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedRes = await db.execute({
        sql: 'SELECT * FROM fixtures_cache WHERE date = ? AND cached_at > datetime("now", "-4 hours")',
        args: [date]
      });
      const cached = cachedRes.rows;

      if (cached.length > 0) {
        return NextResponse.json({ fixtures: cached, source: 'cache' });
      }
    }

    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      return NextResponse.json({
        fixtures: [],
        source: 'none',
        message: 'API Key non configurata. Vai in Impostazioni.',
      });
    }

    // Fetch from API for all leagues
    const allFixtures = [];
    const leagues = Object.keys(LEAGUE_NAMES);

    for (const league of leagues) {
      const result = await fetchFixtures(league, date, apiKey);
      if (result.fixtures) {
        for (const f of result.fixtures) {
          allFixtures.push({ ...f, league });
        }
      }
    }

    // Clear old cache for this date and save
    await db.execute({ sql: 'DELETE FROM fixtures_cache WHERE date = ?', args: [date] });

    const insertSql = `
      INSERT INTO fixtures_cache (league, date, home_team, away_team, kick_off, api_fixture_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    for (const f of allFixtures) {
      await db.execute({ sql: insertSql, args: [f.league, date, f.home_team, f.away_team, f.kick_off, f.api_fixture_id] });
    }

    return NextResponse.json({ fixtures: allFixtures, source: 'api' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
