const fs = require('fs');
const { createClient } = require('@libsql/client');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

const MIN_BETS = 10;
const MIN_WINRATE = 0.75; // relaxed to 75%
const MIN_QUOTA = 1.60;

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
    const hasRef = b.ref_hist_pct !== null;
    if (hasRef) hParts.push(b.ref_hist_pct);
    const histScore = hParts.length > 0 ? hParts.reduce((a,v) => a+v, 0) / hParts.length : null;
    const hFullLen = hasRef ? 5 : 4;
    const hMin = hParts.length === hFullLen ? Math.min(...hParts) : null;

    bets.push({ win, profit, edge: b.best_edge || 0, prob: b.probability || 0,
      formScore, fMin, histScore, hMin });
  }

  const edgeThresholds   = uniqueSortedThresholds(bets.map(b => b.edge),   0, 0.5);
  // Relaxing prob down to 50%
  const probThresholds   = uniqueSortedThresholds(bets.map(b => b.prob),   0.50, 1.0);
  const histAvgThresholds  = uniqueSortedThresholds(bets.map(b => b.histScore), 0, 1.0);
  const histSingThresholds = uniqueSortedThresholds([0, ...bets.map(b => b.hMin).filter(v => v !== null)], 0, 1.0);
  const formAvgThresholds  = uniqueSortedThresholds(bets.map(b => b.formScore), 0, 1.0);
  const formSingThresholds = uniqueSortedThresholds([0, ...bets.map(b => b.fMin).filter(v => v !== null)], 0, 1.0);

  const TOP_K = 1000;
  let topUniqueResults = new Map();
  let minYieldInTop = -Infinity;
  
  let totalTested = 0;

  for (const minEdge of edgeThresholds) {
    const afterEdge = bets.filter(b => b.edge >= minEdge);
    if (afterEdge.length < MIN_BETS) break;

    for (const minProb of probThresholds) {
      const afterProb = afterEdge.filter(b => b.prob >= minProb);
      if (afterProb.length < MIN_BETS) break;

      for (const minHistAvg of histAvgThresholds) {
        const afterHistAvg = afterProb.filter(b => b.histScore !== null && b.histScore >= minHistAvg);
        if (afterHistAvg.length < MIN_BETS) break;

        for (const minHistSingle of histSingThresholds) {
          const afterHistSingle = minHistSingle === 0
            ? afterHistAvg
            : afterHistAvg.filter(b => b.hMin !== null && b.hMin >= minHistSingle);
          if (afterHistSingle.length < MIN_BETS) break;

          for (const minFormAvg of formAvgThresholds) {
            const afterFormAvg = afterHistSingle.filter(b => b.formScore !== null && b.formScore >= minFormAvg);
            if (afterFormAvg.length < MIN_BETS) break;

            for (const minFormSingle of formSingThresholds) {
              const finalBets = minFormSingle === 0
                ? afterFormAvg
                : afterFormAvg.filter(b => b.fMin !== null && b.fMin >= minFormSingle);

              if (finalBets.length < MIN_BETS) break;

              totalTested++;

              const total = finalBets.length;
              const wins = finalBets.filter(b => b.win).length;
              const winRate = wins / total;

              if (winRate >= MIN_WINRATE) {
                const profit = finalBets.reduce((s, b) => s + b.profit, 0);
                const yieldPct = profit / total;
                const key = `${total}|${wins}|${profit.toFixed(4)}`;

                if (!topUniqueResults.has(key) && (topUniqueResults.size < TOP_K || yieldPct > minYieldInTop)) {
                  topUniqueResults.set(key, {
                    total, wins, winRate, profit, yieldPct,
                    params: { minEdge, minProb, minHistAvg, minHistSingle, minFormAvg, minFormSingle }
                  });

                  if (topUniqueResults.size > TOP_K) {
                    const sorted = Array.from(topUniqueResults.values()).sort((a, b) => b.yieldPct - a.yieldPct || b.winRate - a.winRate);
                    const toKeep = sorted.slice(0, TOP_K);
                    topUniqueResults = new Map(toKeep.map(r => [`${r.total}|${r.wins}|${r.profit.toFixed(4)}`, r]));
                    minYieldInTop = toKeep[toKeep.length - 1].yieldPct;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const uniqueCombos = Array.from(topUniqueResults.values());
  uniqueCombos.sort((a, b) => b.winRate - a.winRate || b.yieldPct - a.yieldPct || b.total - a.total);
  
  const output = { results: uniqueCombos };
  fs.writeFileSync('grid_search_results_relaxed.json', JSON.stringify(output, null, 2));
  console.log(`Finito! Trovate ${uniqueCombos.length} combinazioni.`);
}

start().catch(console.error);
