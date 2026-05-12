/**
 * GRID SEARCH FAST — accumula TUTTO in memoria senza evizioni costose,
 * poi deduplica e taglia alla fine.
 * Molto più veloce perché non fa sort durante il loop.
 */
import fs from 'fs';
import { createClient } from '@libsql/client';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

let MIN_BETS = 15;
let MIN_WINRATE = 0.80;
let MIN_QUOTA = 1.60;
let TOP_K = 5000;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--minWinRate') MIN_WINRATE = parseFloat(args[++i]);
  if (args[i] === '--minBets') MIN_BETS = parseInt(args[++i], 10);
  if (args[i] === '--minQuota') MIN_QUOTA = parseFloat(args[++i]);
  if (args[i] === '--topK') TOP_K = parseInt(args[++i], 10);
}

function uniqueSortedThresholds(values, minVal = 0, maxVal = 1) {
  const set = new Set([minVal]);
  for (const v of values) {
    if (v !== null && v !== undefined) {
      set.add(Math.round(v * 100) / 100);
    }
  }
  return Array.from(set).filter(v => v >= minVal && v <= maxVal).sort((a,b) => a-b);
}

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const rawBets = res.rows;

  const bets = [];
  for (const b of rawBets) {
    const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
    if (maxOdds < MIN_QUOTA) continue;

    const win = b.outcome === 'WIN';
    const profit = win ? (maxOdds - 1) : -1;

    // Usiamo direttamente i valori pre-calcolati dal DB per massima coerenza con la Dashboard
    const histScore = b.hist_score;
    // Calcolo Form Score flessibile (come in Dashboard)
    const fParts = [];
    if (b.form_home_pct !== null) fParts.push(b.form_home_pct);
    if (b.form_away_pct !== null) fParts.push(b.form_away_pct);
    if (b.form_home_gen_pct !== null) fParts.push(b.form_home_gen_pct);
    if (b.form_away_gen_pct !== null) fParts.push(b.form_away_gen_pct);
    
    const formScore = fParts.length > 0 ? fParts.reduce((a,v) => a+v, 0) / fParts.length : null;
    const fMin = fParts.length === 4 ? Math.min(...fParts) : null;

    const hParts = [];
    if (b.home_hist_pct !== null) hParts.push(b.home_hist_pct);
    if (b.away_hist_pct !== null) hParts.push(b.away_hist_pct);
    if (b.home_hist_overall_pct !== null) hParts.push(b.home_hist_overall_pct);
    if (b.away_hist_overall_pct !== null) hParts.push(b.away_hist_overall_pct);
    if (b.ref_hist_pct !== null) hParts.push(b.ref_hist_pct);
    const hMin = hParts.length >= 4 ? Math.min(...hParts) : null;

    bets.push({ win, profit, edge: b.best_edge || 0, prob: b.probability || 0,
      formScore, fMin, histScore, hMin });
  }

  console.log(`Bets caricate: ${bets.length}`);

  const edgeThresholds   = uniqueSortedThresholds(bets.map(b => b.edge),   0, 0.5);
  const probThresholds   = uniqueSortedThresholds(bets.map(b => b.prob),   0.50, 1.0);
  const histAvgThresholds  = uniqueSortedThresholds(bets.map(b => b.histScore), 0, 1.0);
  const histSingThresholds = uniqueSortedThresholds([0, ...bets.map(b => b.hMin).filter(v => v !== null)], 0, 1.0);
  const formAvgThresholds  = uniqueSortedThresholds(bets.map(b => b.formScore), 0, 1.0);
  const formSingThresholds = uniqueSortedThresholds([0, ...bets.map(b => b.fMin).filter(v => v !== null)], 0, 1.0);

  console.log(`Soglie: edge(${edgeThresholds.length}) prob(${probThresholds.length}) hAvg(${histAvgThresholds.length}) hSng(${histSingThresholds.length}) fAvg(${formAvgThresholds.length}) fSng(${formSingThresholds.length})`);

  // Accumula tutto in una Map deduplica per (total|wins|profit)
  // Nessun sort durante il loop — solo alla fine
  const allResults = new Map();
  let totalTested = 0;
  const startTime = Date.now();
  const eps = 0.0001;

  for (const minEdge of edgeThresholds) {
    const afterEdge = bets.filter(b => b.edge >= (minEdge - eps));
    if (afterEdge.length < MIN_BETS) break;

    for (const minProb of probThresholds) {
      const afterProb = afterEdge.filter(b => b.prob >= (minProb - eps));
      if (afterProb.length < MIN_BETS) break;

      for (const minHistAvg of histAvgThresholds) {
        const afterHistAvg = afterProb.filter(b => b.histScore !== null && b.histScore >= (minHistAvg - eps));
        if (afterHistAvg.length < MIN_BETS) break;

        for (const minHistSingle of histSingThresholds) {
          const afterHistSingle = minHistSingle === 0
            ? afterHistAvg
            : afterHistAvg.filter(b => b.hMin !== null && b.hMin >= (minHistSingle - eps));
          if (afterHistSingle.length < MIN_BETS) break;

          for (const minFormAvg of formAvgThresholds) {
            const afterFormAvg = afterHistSingle.filter(b => b.formScore !== null && b.formScore >= (minFormAvg - eps));
            if (afterFormAvg.length < MIN_BETS) break;

            for (const minFormSingle of formSingThresholds) {
              const finalBets = minFormSingle === 0
                ? afterFormAvg
                : afterFormAvg.filter(b => b.fMin !== null && b.fMin >= (minFormSingle - eps));

              if (finalBets.length < MIN_BETS) break;

              totalTested++;

              const total = finalBets.length;
              const wins = finalBets.filter(b => b.win).length;
              const winRate = wins / total;

              if (winRate >= MIN_WINRATE) {
                const profit = finalBets.reduce((s, b) => s + b.profit, 0);
                const yieldPct = profit / total;
                const key = `${total}|${wins}|${profit.toFixed(4)}`;

                // Salva solo il primo rappresentante per ogni chiave unica
                if (!allResults.has(key)) {
                  allResults.set(key, {
                    total, wins, winRate, profit, yieldPct,
                    params: { minEdge, minProb, minHistAvg, minHistSingle, minFormAvg, minFormSingle }
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompletato in ${elapsed}s. Testate: ${totalTested.toLocaleString()}, Uniche: ${allResults.size}`);

  // Ordina TUTTO e poi taglia a TOP_K
  let uniqueCombos = Array.from(allResults.values());
  uniqueCombos.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.total !== a.total) return b.total - a.total;
    return b.yieldPct - a.yieldPct;
  });
  uniqueCombos = uniqueCombos.slice(0, TOP_K);

  console.log(`Top ${TOP_K}: ${uniqueCombos.length} combinazioni.`);

  const output = { results: uniqueCombos };
  fs.writeFileSync('grid_search_results_relaxed.json', JSON.stringify(output, null, 2));
  console.log('Salvato grid_search_results_relaxed.json');
}

start().catch(console.error);
