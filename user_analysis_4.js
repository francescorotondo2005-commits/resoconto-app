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

function runAnalysis(bets) {
  // --- TEST FORMA (Media > 70% AND Tutti i parametri >= X) ---
  console.log('--- TEST FORMA: Media dei 4 Parametri > 70% E Tutti i Parametri >= X ---');
  for (const t of [0.50, 0.60]) {
    let all4Wins = 0, all4Total = 0, all4Profit = 0;

    for (const b of bets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      if (b.form_home_pct !== null && b.form_away_pct !== null && b.form_home_gen_pct !== null && b.form_away_gen_pct !== null) {
        const media = (b.form_home_pct + b.form_away_pct + b.form_home_gen_pct + b.form_away_gen_pct) / 4;
        const tuttiMaggiori = b.form_home_pct >= t && b.form_away_pct >= t && b.form_home_gen_pct >= t && b.form_away_gen_pct >= t;

        if (media > 0.70 && tuttiMaggiori) {
          all4Total++;
          if (win) all4Wins++;
          all4Profit += profit;
        }
      }
    }
    
    console.log(`\nSoglia MEDIA > 70% E TUTTI I PARAMETRI >= ${t * 100}%`);
    console.log(`[Media4 > 70% & Tutti i 4 >= ${t*100}%] Bets: ${all4Total} | WinRate: ${all4Total > 0 ? ((all4Wins/all4Total)*100).toFixed(2) : 0}% | Yield: ${formatYield(all4Profit, all4Total)} | Profit: €${all4Profit.toFixed(2)}`);
  }

  console.log('\n=========================================\n');
  console.log('--- TEST STORICO: SENZA ARBITRO ---');
  const noRefBets = bets.filter(b => b.ref_hist_pct === null);

  for (const t of [0.50, 0.60]) {
    let all4Wins = 0, all4Total = 0, all4Profit = 0;

    for (const b of noRefBets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null) {
        const media = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct) / 4;
        const tuttiMaggiori = b.home_hist_pct >= t && b.away_hist_pct >= t && b.home_hist_overall_pct >= t && b.away_hist_overall_pct >= t;

        if (media > 0.70 && tuttiMaggiori) {
          all4Total++;
          if (win) all4Wins++;
          all4Profit += profit;
        }
      }
    }
    
    console.log(`\nSoglia MEDIA > 70% E TUTTI I PARAMETRI >= ${t * 100}%`);
    console.log(`[Media4 > 70% & Tutti i 4 >= ${t*100}%] Bets: ${all4Total} | WinRate: ${all4Total > 0 ? ((all4Wins/all4Total)*100).toFixed(2) : 0}% | Yield: ${formatYield(all4Profit, all4Total)} | Profit: €${all4Profit.toFixed(2)}`);
  }

  console.log('\n=========================================\n');
  console.log('--- TEST STORICO: CON ARBITRO ---');
  const refBets = bets.filter(b => b.ref_hist_pct !== null);

  for (const t of [0.50, 0.60]) {
    let all5Wins = 0, all5Total = 0, all5Profit = 0;

    for (const b of refBets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null && b.ref_hist_pct !== null) {
        const media = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct + b.ref_hist_pct) / 5;
        const tuttiMaggiori = b.home_hist_pct >= t && b.away_hist_pct >= t && b.home_hist_overall_pct >= t && b.away_hist_overall_pct >= t && b.ref_hist_pct >= t;

        if (media > 0.70 && tuttiMaggiori) {
          all5Total++;
          if (win) all5Wins++;
          all5Profit += profit;
        }
      }
    }
    
    console.log(`\nSoglia MEDIA > 70% E TUTTI I PARAMETRI >= ${t * 100}%`);
    console.log(`[Media5 > 70% & Tutti i 5 >= ${t*100}%] Bets: ${all5Total} | WinRate: ${all5Total > 0 ? ((all5Wins/all5Total)*100).toFixed(2) : 0}% | Yield: ${formatYield(all5Profit, all5Total)} | Profit: €${all5Profit.toFixed(2)}`);
  }
}

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  console.log(`Analizzando ${res.rows.length} scommesse refertate...\n`);
  runAnalysis(res.rows);
}

start().catch(console.error);
