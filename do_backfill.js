const fs = require('fs');
const { createClient } = require('@libsql/client');
const { calcHistorySummary, calcFormSummary } = require('./lib/history');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

async function run() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  
  const histCols = [
    'ALTER TABLE backtest_bets ADD COLUMN home_hist_overall_pct REAL',
    'ALTER TABLE backtest_bets ADD COLUMN home_hist_overall_sample INTEGER',
    'ALTER TABLE backtest_bets ADD COLUMN away_hist_overall_pct REAL',
    'ALTER TABLE backtest_bets ADD COLUMN away_hist_overall_sample INTEGER',
    'ALTER TABLE backtest_bets ADD COLUMN form_home_gen_pct REAL',
    'ALTER TABLE backtest_bets ADD COLUMN form_home_gen_n INTEGER',
    'ALTER TABLE backtest_bets ADD COLUMN form_away_gen_pct REAL',
    'ALTER TABLE backtest_bets ADD COLUMN form_away_gen_n INTEGER',
  ];
  for (const sql of histCols) {
    try { await db.execute(sql); console.log("Eseguito:", sql); } catch { /* colonna già esistente */ }
  }

  const res = await db.execute('SELECT * FROM backtest_bets ORDER BY match_date ASC');
  const bets = res.rows;

  const byLeague = {};
  for (const b of bets) {
    const [league, homeTeam, awayTeam] = b.match_key.split('|');
    if (!byLeague[league]) byLeague[league] = { matches: null, bets: [] };
    byLeague[league].bets.push({ ...b, _homeTeam: homeTeam, _awayTeam: awayTeam });
  }

  for (const league of Object.keys(byLeague)) {
    const mRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ? ORDER BY date ASC', args: [league] });
    byLeague[league].matches = mRes.rows;
  }

  const pmRes = await db.execute('SELECT match_key, referee FROM pending_matches');
  const refereeMap = {};
  for (const r of pmRes.rows) refereeMap[r.match_key] = r.referee;

  let updated = 0;
  const stmts = [];

  for (const league of Object.keys(byLeague)) {
    const { matches, bets: leagueBets } = byLeague[league];

    for (const bet of leagueBets) {
      const matchesBefore = matches.filter(m => m.date < bet.match_date);
      
      let referee = refereeMap[bet.match_key] || null;
      if (!referee) {
        // Fallback al db storico per data approssimativa o match_key
        const matchInDb = matches.find(m => m.home_team === bet._homeTeam && m.away_team === bet._awayTeam && m.date >= bet.match_date && m.date <= bet.match_date + 'z');
        if (!matchInDb) {
            const matchByTeam = matches.find(m => m.home_team === bet._homeTeam && m.away_team === bet._awayTeam);
            if (matchByTeam) referee = matchByTeam.referee;
        } else {
            referee = matchInDb.referee;
        }
      }

      const hist = calcHistorySummary(bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore);
      const form = calcFormSummary(bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore, 5);

      if (!hist) continue;

      stmts.push({
        sql: `UPDATE backtest_bets SET
          hist_score = ?, home_hist_pct = ?, home_hist_sample = ?,
          away_hist_pct = ?, away_hist_sample = ?,
          home_hist_overall_pct = ?, home_hist_overall_sample = ?,
          away_hist_overall_pct = ?, away_hist_overall_sample = ?,
          ref_hist_pct = ?, ref_hist_sample = ?,
          form_home_pct = ?, form_home_n = ?,
          form_away_pct = ?, form_away_n = ?,
          form_home_gen_pct = ?, form_home_gen_n = ?,
          form_away_gen_pct = ?, form_away_gen_n = ?,
          form_ref_pct = ?, form_ref_n = ?
        WHERE id = ?`,
        args: [
          hist.histScore, hist.homePct, hist.homeSample,
          hist.awayPct, hist.awaySample,
          hist.homePctOverall ?? null, hist.homeSampleOverall ?? null,
          hist.awayPctOverall ?? null, hist.awaySampleOverall ?? null,
          hist.refPct, hist.refSample,
          form?.homeFormPct ?? null, form?.homeN ?? null,
          form?.awayFormPct ?? null, form?.awayN ?? null,
          form?.homeGenFormPct ?? null, form?.homeGenN ?? null,
          form?.awayGenFormPct ?? null, form?.awayGenN ?? null,
          form?.refFormPct ?? null, form?.refN ?? null,
          bet.id
        ]
      });
      updated++;
    }
  }

  console.log(`Eseguo l'aggiornamento di ${stmts.length} scommesse...`);
  const BATCH_SIZE = 50;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + BATCH_SIZE), 'write');
  }
  console.log('✅ Backfill completato.');
}

run().catch(console.error);
