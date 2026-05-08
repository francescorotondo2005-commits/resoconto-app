const fs = require('fs');

const data = JSON.parse(fs.readFileSync('grid_search_results_relaxed.json', 'utf8'));
const topResults = data.results; // Già ordinati per WR e Yield nel JSON

let markdown = `# Classifica Top 100 Combinazioni (WinRate >= 80%, Scommesse >= 10)\n\n`;
markdown += `Di seguito trovi le migliori 100 configurazioni in assoluto, ordinate dal WinRate più alto (fino al 100%) e successivamente per Yield.\n\n`;
markdown += `| # | WinRate | Yield | Scommesse | Profitto | Edge Min | Prob Min | Media Storico | Singolo Storico | Media Forma | Singolo Forma |\n`;
markdown += `|---|---|---|---|---|---|---|---|---|---|---|\n`;

for (let i = 0; i < Math.min(100, topResults.length); i++) {
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

fs.writeFileSync('top_100.md', markdown);
console.log("File top_100.md generato con successo.");
