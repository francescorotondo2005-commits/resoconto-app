import fs from 'fs';

const html = fs.readFileSync('scratch/ejea_page.html', 'utf-8');

console.log("Analyzing entire HTML string...");

// Let's search for "statistics" in the whole HTML
let index = 0;
let matchCount = 0;
while ((index = html.indexOf('statistics', index)) !== -1) {
  console.log(`\nMatch ${++matchCount} of 'statistics' at index ${index}:`);
  console.log(html.slice(Math.max(0, index - 100), index + 150));
  index += 10;
  if (matchCount >= 10) break;
}

// Let's search for "/event/" in the whole HTML
index = 0;
matchCount = 0;
while ((index = html.indexOf('/event/', index)) !== -1) {
  console.log(`\nMatch ${++matchCount} of '/event/' at index ${index}:`);
  console.log(html.slice(Math.max(0, index - 100), index + 150));
  index += 7;
  if (matchCount >= 10) break;
}

// Let's search for "dEscOcb" in the whole HTML to see where the slug is defined and if there's any JSON/metadata near it
index = 0;
matchCount = 0;
while ((index = html.indexOf('dEscOcb', index)) !== -1) {
  console.log(`\nMatch ${++matchCount} of 'dEscOcb' at index ${index}:`);
  console.log(html.slice(Math.max(0, index - 150), index + 150));
  index += 7;
  if (matchCount >= 10) break;
}
