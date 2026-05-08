const fs = require('fs');
const { createClient } = require('@libsql/client');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

function formatYield(profit, bets) {
  if (bets === 0) return '0.00%';
  return ((profit / bets) * 100).toFixed(2) + '%';
}

async function start() {
  console.log("Connessione al database...");
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const rawBets = res.rows;

  const processedBets = [];
  for (const b of rawBets) {
    const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
    if (maxOdds < 1.60) continue;

    const win = b.outcome === 'WIN';
    const profit = win ? (maxOdds - 1) : -1;

    let formScore = null;
    const fParts = [];
    if (b.form_home_pct !== null) fParts.push(b.form_home_pct);
    if (b.form_away_pct !== null) fParts.push(b.form_away_pct);
    if (b.form_home_gen_pct !== null) fParts.push(b.form_home_gen_pct);
    if (b.form_away_gen_pct !== null) fParts.push(b.form_away_gen_pct);
    if (fParts.length > 0) formScore = fParts.reduce((a,v) => a+v, 0) / fParts.length;

    const hParts = [];
    if (b.home_hist_pct !== null) hParts.push(b.home_hist_pct);
    if (b.away_hist_pct !== null) hParts.push(b.away_hist_pct);
    if (b.home_hist_overall_pct !== null) hParts.push(b.home_hist_overall_pct);
    if (b.away_hist_overall_pct !== null) hParts.push(b.away_hist_overall_pct);
    
    const hasRef = b.ref_hist_pct !== null;
    if (hasRef) hParts.push(b.ref_hist_pct);
    
    let histScore = null;
    if (hParts.length > 0) histScore = hParts.reduce((a,v) => a+v, 0) / hParts.length;

    processedBets.push({
      win,
      profit,
      edge: b.best_edge,
      prob: b.probability,
      formScore,
      fMin: fParts.length === 4 ? Math.min(...fParts) : 0,
      fLen: fParts.length,
      histScore,
      hMin: hParts.length === (hasRef ? 5 : 4) ? Math.min(...hParts) : 0,
      hLen: hParts.length,
      hasRef
    });
  }

  const histAvgSteps = [0.60, 0.65, 0.70, 0.75];
  const histSingleSteps = [0.0, 0.40, 0.50, 0.60];
  const formAvgSteps = [0.60, 0.65, 0.70, 0.75];
  const formSingleSteps = [0.0, 0.40, 0.50, 0.60];
  const edgeSteps = [0.0, 0.05, 0.10, 0.15];
  const probSteps = [0.60, 0.65];

  let bestResults = [];

  for (const minHistAvg of histAvgSteps) {
    for (const minHistSingle of histSingleSteps) {
      for (const minFormAvg of formAvgSteps) {
        for (const minFormSingle of formSingleSteps) {
          for (const minEdge of edgeSteps) {
            for (const minProb of probSteps) {
              
              let total = 0, wins = 0, profit = 0;

              for (const b of processedBets) {
                if (b.edge < minEdge || b.prob < minProb) continue;
                
                if (b.histScore === null || b.histScore < minHistAvg) continue;
                if (minHistSingle > 0 && (b.hLen !== (b.hasRef ? 5 : 4) || b.hMin < minHistSingle)) continue;

                if (b.formScore === null || b.formScore < minFormAvg) continue;
                if (minFormSingle > 0 && (b.fLen !== 4 || b.fMin < minFormSingle)) continue;

                total++;
                if (b.win) wins++;
                profit += b.profit;
              }

              if (total >= 25 && wins/total > 0.75) {
                const winRate = wins / total;
                const yieldPct = profit / total;
                bestResults.push({
                  total, wins, winRate, profit, yieldPct,
                  params: {
                    minHistAvg, minHistSingle, minFormAvg, minFormSingle, minEdge, minProb
                  }
                });
              }
            }
          }
        }
      }
    }
  }

  // Remove exact duplicates in terms of total/wins/profit
  const uniqueResults = [];
  const seen = new Set();
  for (const r of bestResults) {
    const key = `${r.total}-${r.wins}-${r.profit.toFixed(2)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(r);
    }
  }

  uniqueResults.sort((a, b) => b.winRate - a.winRate || b.yieldPct - a.yieldPct);

  console.log("\n--- TOP COMBINAZIONI (ALMENO 25 BETS) ---");
  for (let i = 0; i < Math.min(10, uniqueResults.length); i++) {
    const r = uniqueResults[i];
    const p = r.params;
    console.log(`${i+1}. WR: ${(r.winRate*100).toFixed(2)}% | Yield: ${(r.yieldPct*100).toFixed(2)}% | Bets: ${r.total} | Profit: €${r.profit.toFixed(2)}`);
    console.log(`   [HistAvg: ${p.minHistAvg}, HistSing: ${p.minHistSingle}, FormAvg: ${p.minFormAvg}, FormSing: ${p.minFormSingle}, Edge: ${p.minEdge}, Prob: ${p.minProb}]`);
  }
}

start().catch(console.error);
