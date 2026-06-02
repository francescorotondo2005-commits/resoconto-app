import fs from 'fs';
import path from 'path';

const html = fs.readFileSync('scratch/ejea_page.html', 'utf-8');

console.log(`Analyzing ejea_page.html (${html.length} chars)...`);

// Search for __NEXT_DATA__
const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (nextDataMatch) {
  console.log(`Found __NEXT_DATA__ block! Length: ${nextDataMatch[1].length}`);
  try {
    const data = JSON.parse(nextDataMatch[1]);
    
    // Write JSON to scratch for inspection
    fs.writeFileSync('scratch/ejea_next_data.json', JSON.stringify(data, null, 2));
    console.log(`Wrote NEXT_DATA JSON to scratch/ejea_next_data.json`);
    
    // Let's search inside the JSON recursively for "id" of the event
    // SofaScore NEXT_DATA JSON typically has pageProps.initialProps.pageProps.event.id
    // or queries or similar. Let's search for "Ejea" in the JSON keys or values!
    function findEventProps(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;
      if (obj.homeTeam && obj.awayTeam && obj.id) {
        console.log(`Found candidate event object at path "${path}":`);
        console.log(`  ID: ${obj.id}`);
        console.log(`  Home: ${obj.homeTeam.name} | Away: ${obj.awayTeam.name}`);
        if (obj.startTimestamp) {
          console.log(`  StartTimestamp: ${obj.startTimestamp} (${new Date(obj.startTimestamp * 1000).toISOString()})`);
        }
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        findEventProps(v, path ? `${path}.${k}` : k);
      }
    }
    
    findEventProps(data);
  } catch (e) {
    console.error(`Failed to parse/analyze JSON:`, e.message);
  }
} else {
  console.log(`No __NEXT_DATA__ block found!`);
}

// Let's do a regex search for event API or statistics URL
const urls = html.match(/\/api\/v1\/event\/\d+/g) || html.match(/\/event\/\d+\/statistics/g);
if (urls) {
  console.log(`Found potential event URLs:`);
  console.log(Array.from(new Set(urls)));
} else {
  console.log(`No potential event URLs found via simple regex!`);
}
