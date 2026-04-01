import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const matchKey = searchParams.get('matchKey');

    if (!matchKey) {
      return NextResponse.json({ error: 'matchKey richiesto' }, { status: 400 });
    }

    const db = await getDb();
    const res = await db.execute({ sql: 'SELECT * FROM match_odds WHERE match_key = ?', args: [matchKey] });
    
    return NextResponse.json({ odds: res.rows });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const data = await request.json();
    const { matchKey, marketName, sportium, sportbet, isCustom, customDef } = data;

    if (!matchKey || !marketName) {
      return NextResponse.json({ error: 'matchKey e marketName richiesti' }, { status: 400 });
    }

    const db = await getDb();
    
    await db.execute({
      sql: `
        INSERT INTO match_odds (
          match_key, market_name, sportium, sportbet, is_custom, 
          custom_stat, custom_type, custom_scope, custom_direction, custom_line, custom_esito,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(match_key, market_name) DO UPDATE SET
          sportium = excluded.sportium,
          sportbet = excluded.sportbet,
          is_custom = excluded.is_custom,
          custom_stat = excluded.custom_stat,
          custom_type = excluded.custom_type,
          custom_scope = excluded.custom_scope,
          custom_direction = excluded.custom_direction,
          custom_line = excluded.custom_line,
          custom_esito = excluded.custom_esito,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [
        matchKey, 
        marketName, 
        sportium !== undefined && sportium !== null ? sportium : null, 
        sportbet !== undefined && sportbet !== null ? sportbet : null,
        isCustom ? 1 : 0,
        customDef?.stat || null,
        customDef?.type || null,
        customDef?.scope || null,
        customDef?.direction || null,
        customDef?.line !== undefined ? customDef.line : null,
        customDef?.esito || null
      ]
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const matchKey = searchParams.get('matchKey');

    if (!matchKey) {
      return NextResponse.json({ error: 'matchKey richiesto' }, { status: 400 });
    }

    const db = await getDb();
    await db.execute({ sql: 'DELETE FROM match_odds WHERE match_key = ?', args: [matchKey] });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
