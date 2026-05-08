const fs = require('fs');
const data = JSON.parse(fs.readFileSync('grid_search_results_relaxed.json', 'utf8'));

// Raggruppiamo i risultati in base al numero di bet per dare opzioni all'utente (volume vs winrate)
const topResults = data.results;

console.log("Top 30 risultati (ordinati per WR e Yield):");
for (let i = 0; i < Math.min(30, topResults.length); i++) {
  const r = topResults[i];
  const p = r.params;
  console.log(`${String(i+1).padStart(2)}. WR: ${(r.winRate*100).toFixed(1)}% | Yield: ${(r.yieldPct*100).toFixed(1)}% | Bets: ${r.total} | Edge: ${p.minEdge} | Prob: ${p.minProb} | HAvg: ${p.minHistAvg} | HSng: ${p.minHistSingle} | FAvg: ${p.minFormAvg} | FSng: ${p.minFormSingle}`);
}

console.log("\nTop risultati per volume (>= 20 bets):");
const over20 = topResults.filter(r => r.total >= 20).slice(0, 10);
over20.forEach(r => {
  const p = r.params;
  console.log(`WR: ${(r.winRate*100).toFixed(1)}% | Yield: ${(r.yieldPct*100).toFixed(1)}% | Bets: ${r.total} | [E:${p.minEdge} P:${p.minProb} HAvg:${p.minHistAvg} HSng:${p.minHistSingle} FAvg:${p.minFormAvg} FSng:${p.minFormSingle}]`);
});

console.log("\nTop risultati per volume (>= 30 bets):");
const over30 = topResults.filter(r => r.total >= 30).slice(0, 10);
over30.forEach(r => {
  const p = r.params;
  console.log(`WR: ${(r.winRate*100).toFixed(1)}% | Yield: ${(r.yieldPct*100).toFixed(1)}% | Bets: ${r.total} | [E:${p.minEdge} P:${p.minProb} HAvg:${p.minHistAvg} HSng:${p.minHistSingle} FAvg:${p.minFormAvg} FSng:${p.minFormSingle}]`);
});

console.log("\nTop risultati per volume (>= 40 bets):");
const over40 = topResults.filter(r => r.total >= 40).slice(0, 10);
over40.forEach(r => {
  const p = r.params;
  console.log(`WR: ${(r.winRate*100).toFixed(1)}% | Yield: ${(r.yieldPct*100).toFixed(1)}% | Bets: ${r.total} | [E:${p.minEdge} P:${p.minProb} HAvg:${p.minHistAvg} HSng:${p.minHistSingle} FAvg:${p.minFormAvg} FSng:${p.minFormSingle}]`);
});
