const fs = require('fs');
const data = JSON.parse(fs.readFileSync('grid_search_results.json', 'utf8'));
const top20 = data.results.slice(0, 30);

console.log("Top 30 results:");
top20.forEach((r, i) => {
  const p = r.params;
  console.log(`${i+1}. WR: ${(r.winRate*100).toFixed(1)}% | Yield: ${(r.yieldPct*100).toFixed(1)}% | Bets: ${r.total} | Edge: ${p.minEdge} | Prob: ${p.minProb} | HAvg: ${p.minHistAvg} | HSng: ${p.minHistSingle} | FAvg: ${p.minFormAvg} | FSng: ${p.minFormSingle}`);
});
