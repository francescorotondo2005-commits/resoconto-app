import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import * as XLSX from 'xlsx';

// POST - Import data from uploaded Excel file
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'Nessun file caricato' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const db = await getDb();
    const results = {};

    const sheetMap = {
      'DB_SerieA': 'SerieA',
      'DB_Premier': 'Premier',
      'DB_laliga': 'LaLiga',
      'DB_ligue1': 'Ligue1',
      'DB_bundes': 'Bundes',
    };

    const insertMatchSql = `
      INSERT OR IGNORE INTO matches (league, matchday, date, home_team, away_team,
        home_goals, away_goals, home_shots, away_shots, home_sot, away_sot,
        home_fouls, away_fouls, home_corners, away_corners,
        home_yellows, away_yellows, home_reds, away_reds,
        home_saves, away_saves, referee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const [sheetName, leagueName] of Object.entries(sheetMap)) {
      if (!workbook.SheetNames.includes(sheetName)) {
        results[sheetName] = { status: 'not_found' };
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

      let imported = 0;
      const isSerieA = leagueName === 'SerieA';
      const stmts = [];

      for (const row of rows) {
        // Map column names from the Excel structure
        const homeTeam = row['Squadra Casa'];
        const awayTeam = row['Squadra Ospite'];

        if (!homeTeam || !awayTeam) continue;

        // Handle date - Excel serial number or string
        let dateStr;
        const rawDate = row['Data'];
        if (typeof rawDate === 'number') {
          // Excel serial date
          const d = XLSX.SSF.parse_date_code(rawDate);
          dateStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        } else if (rawDate) {
          dateStr = String(rawDate);
        } else {
          dateStr = '1970-01-01';
        }

        stmts.push({
          sql: insertMatchSql,
          args: [
            leagueName,
            isSerieA ? (row['Giornata'] || null) : null,
            dateStr,
            homeTeam,
            awayTeam,
            Number(row['Gol Casa'] || 0),
            Number(row['Gol Ospite'] || 0),
            Number(row['Tiri Casa'] || 0),
            Number(row['Tiri Ospite'] || 0),
            Number(row['TIP Casa'] || 0),
            Number(row['TIP Ospite'] || 0),
            Number(row['Falli Casa'] || 0),
            Number(row['Falli Ospite'] || 0),
            Number(row['Corner Casa'] || 0),
            Number(row['Corner Ospite'] || 0),
            Number(row['Gialli Casa'] || 0),
            Number(row['Gialli Ospite'] || 0),
            Number(row['Rossi Casa'] || 0),
            Number(row['Rossi Ospite'] || 0),
            isSerieA ? Number(row['Parate Casa'] || 0) : null,
            isSerieA ? Number(row['Parate Ospite'] || 0) : null,
            row['Arbitro'] || null
          ]
        });

        stmts.push({ sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)', args: [leagueName, homeTeam] });
        stmts.push({ sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)', args: [leagueName, awayTeam] });
        imported++;
      }

      if (stmts.length > 0) {
        await db.batch(stmts);
      }
      
      results[sheetName] = { status: 'ok', imported };
    }

    // Al termine dell'import, pulisci tutti i pending_matches per le partite che sono ormai finite
    try {
      await db.execute('DELETE FROM pending_matches WHERE match_key IN (SELECT league || \'|\' || home_team || \'|\' || away_team FROM matches)');
    } catch (e) {
      console.error('Error cleaning pending matches automatically:', e);
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
