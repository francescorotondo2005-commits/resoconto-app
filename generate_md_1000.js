import fs from 'fs';

const data = JSON.parse(fs.readFileSync('grid_search_results_relaxed.json', 'utf8'));
const topResults = data.results;

// Ordinamento richiesto:
// 1. WinRate decrescente
// 2. A parità di WR, Scommesse decrescente (b.total - a.total)
// 3. A parità di WR e Scommesse, Yield decrescente (b.yieldPct - a.yieldPct)
topResults.sort((a, b) => {
  if (b.winRate !== a.winRate) return b.winRate - a.winRate;
  if (b.total !== a.total) return b.total - a.total;
  return b.yieldPct - a.yieldPct;
});

let markdown = `# Classifica Combinazioni Elite\n\n`;
markdown += `Di seguito trovi le migliori combinazioni filtrate, ordinate rigorosamente per:\n`;
markdown += `1. **Win Rate** maggiore (fino al 100%)\n`;
markdown += `2. **Numero di Scommesse** maggiore (a parità di Win Rate)\n`;
markdown += `3. **ROI (Yield)** maggiore (a parità di Win Rate e Scommesse)\n\n`;
markdown += `| # | WinRate | Yield | Scommesse | Profitto | Edge Min | Prob Min | Media Storico | Singolo Storico | Media Forma | Singolo Forma |\n`;
markdown += `|---|---|---|---|---|---|---|---|---|---|---|\n`;

for (let i = 0; i < topResults.length; i++) {
  const r = topResults[i];
  const p = r.params;
  
  const wr = `${(r.winRate*100).toFixed(1)}%`;
  const yieldPct = `${(r.yieldPct*100).toFixed(1)}%`;
  const profit = `€${r.profit.toFixed(2)}`;
  
  const edge = `${(p.minEdge*100).toFixed(0)}%`;
  const prob = `${(p.minProb*100).toFixed(0)}%`;
  const hAvg = `${(p.minHistAvg*100).toFixed(0)}%`;
  const hSng = `${(p.minHistSingle*100).toFixed(0)}%`;
  const fAvg = `${(p.minFormAvg*100).toFixed(0)}%`;
  const fSng = `${(p.minFormSingle*100).toFixed(0)}%`;

  markdown += `| **${i+1}** | **${wr}** | ${yieldPct} | ${r.total} | ${profit} | ${edge} | ${prob} | ${hAvg} | ${hSng} | ${fAvg} | ${fSng} |\n`;
}

fs.writeFileSync('topCombinations.md', markdown);
fs.writeFileSync('public/topCombinations.json', JSON.stringify({ combinations: topResults, generatedAt: new Date().toISOString() }, null, 2));
console.log(`File aggiornati con ${topResults.length} combinazioni.`);
