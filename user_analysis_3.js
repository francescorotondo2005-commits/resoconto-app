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
  // --- TEST FORMA (AND CONDITIONS) ---
  console.log('--- TEST FORMA (TUTTI i parametri >= X) ---');
  for (const t of [0.50, 0.60]) {
    let specWins = 0, specTotal = 0, specProfit = 0;
    let all4Wins = 0, all4Total = 0, all4Profit = 0;

    for (const b of bets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      // 1. Entrambi i parametri Specifici >= t
      if (b.form_home_pct !== null && b.form_away_pct !== null) {
        if (b.form_home_pct >= t && b.form_away_pct >= t) {
          specTotal++;
          if (win) specWins++;
          specProfit += profit;
        }
      }

      // 2. Tutti e 4 i parametri (Specifici + Generali) >= t
      if (b.form_home_pct !== null && b.form_away_pct !== null && b.form_home_gen_pct !== null && b.form_away_gen_pct !== null) {
        if (b.form_home_pct >= t && b.form_away_pct >= t && b.form_home_gen_pct >= t && b.form_away_gen_pct >= t) {
          all4Total++;
          if (win) all4Wins++;
          all4Profit += profit;
        }
      }
    }
    
    console.log(`\nSoglia per TUTTI i parametri: >= ${t * 100}%`);
    console.log(`[CasaS>=${t*100} & TrasfS>=${t*100}]                                 Bets: ${specTotal} | WinRate: ${specTotal > 0 ? ((specWins/specTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(specProfit, specTotal)} | Profit: €${specProfit.toFixed(2)}`);
    console.log(`[CasaS>=${t*100} & TrasfS>=${t*100} & CasaG>=${t*100} & TrasfG>=${t*100}] Bets: ${all4Total} | WinRate: ${all4Total > 0 ? ((all4Wins/all4Total)*100).toFixed(2) : 0}% | Yield: ${formatYield(all4Profit, all4Total)} | Profit: €${all4Profit.toFixed(2)}`);
  }

  // --- TEST STORICO (AND CONDITIONS) ---
  console.log('\n=========================================\n');
  console.log('--- TEST STORICO (TUTTI i parametri >= X) [Solo partite CON arbitro] ---');
  const refBets = bets.filter(b => b.ref_hist_pct !== null);

  for (const t of [0.50, 0.60]) {
    let specWins = 0, specTotal = 0, specProfit = 0;
    let all5Wins = 0, all5Total = 0, all5Profit = 0;

    for (const b of refBets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      // Se ha i dati storici
      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null) {
        
        // 1. Casa Spec + Trasf Spec + Arbitro >= t
        if (b.home_hist_pct >= t && b.away_hist_pct >= t && b.ref_hist_pct >= t) {
          specTotal++;
          if (win) specWins++;
          specProfit += profit;
        }

        // 2. Tutti e 5 >= t
        if (b.home_hist_pct >= t && b.away_hist_pct >= t && b.home_hist_overall_pct >= t && b.away_hist_overall_pct >= t && b.ref_hist_pct >= t) {
          all5Total++;
          if (win) all5Wins++;
          all5Profit += profit;
        }
      }
    }
    
    console.log(`\nSoglia per TUTTI i parametri storici: >= ${t * 100}%`);
    console.log(`[CasaS & TrasfS & Arbitro >= ${t*100}]                           Bets: ${specTotal} | WinRate: ${specTotal > 0 ? ((specWins/specTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(specProfit, specTotal)} | Profit: €${specProfit.toFixed(2)}`);
    console.log(`[Tutti e 5 i parametri storici (incluso Arbitro) >= ${t*100}]   Bets: ${all5Total} | WinRate: ${all5Total > 0 ? ((all5Wins/all5Total)*100).toFixed(2) : 0}% | Yield: ${formatYield(all5Profit, all5Total)} | Profit: €${all5Profit.toFixed(2)}`);
  }

  // --- TEST STORICO PONDERATO (Nuova formula utente) ---
  console.log('\n=========================================\n');
  console.log('--- TEST STORICO: Nuova Ponderazione con Arbitro ---');
  // "Arbitro del 50%. gli altri due 25% sono le 2 medie di (Casa Spec + Casa Gen) e (Trasf Spec + Trasf Gen)"
  
  for (const t of [0.70]) { // Manteniamo il test a >70% per la media
    let weightedWins = 0, weightedTotal = 0, weightedProfit = 0;

    for (const b of refBets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      const win = b.outcome === 'WIN';
      const profit = win ? b.best_edge : -1;

      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null) {
        
        const mediaCasa = (b.home_hist_pct + b.home_hist_overall_pct) / 2;
        const mediaTrasf = (b.away_hist_pct + b.away_hist_overall_pct) / 2;
        
        // Peso: Arbitro 50%, mediaCasa 25%, mediaTrasf 25%
        const score = (mediaCasa * 0.25) + (mediaTrasf * 0.25) + (b.ref_hist_pct * 0.50);

        if (score > t) {
          weightedTotal++;
          if (win) weightedWins++;
          weightedProfit += profit;
        }
      }
    }

    console.log(`\nSoglia MEDIA PONDERATA: > ${t * 100}%`);
    console.log(`[Media (Casa*25% + Trasf*25% + Arbitro*50%)]  Bets: ${weightedTotal} | WinRate: ${weightedTotal > 0 ? ((weightedWins/weightedTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(weightedProfit, weightedTotal)} | Profit: €${weightedProfit.toFixed(2)}`);
  }
}

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  console.log(`Analizzando ${res.rows.length} scommesse refertate...\n`);
  runAnalysis(res.rows);
}

start().catch(console.error);
