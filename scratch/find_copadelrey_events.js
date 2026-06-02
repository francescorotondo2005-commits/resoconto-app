import { createSofaSession } from '../lib/sofa_playwright.js';

async function run() {
  const session = await createSofaSession();
  
  const dates = ['2024-11-14', '2024-11-06', '2024-10-31', '2024-10-30'];
  
  for (const date of dates) {
    console.log(`\n=================== All Finished Events on SofaScore for ${date} ===================`);
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;
    const res = await session.fetch(url);
    if (!res || res.__error) {
      console.log(`Error fetching SofaScore for ${date}: HTTP ${res?.status}`);
      continue;
    }
    
    const events = res.events || [];
    console.log(`Total events: ${events.length}`);
    
    const finished = events.filter(e => e.status?.type === 'finished');
    console.log(`Finished events: ${finished.length}`);
    
    // Print all finished events from Spain or containing Copa or with interesting names
    const spanishOrCopa = finished.filter(e => {
      const tName = e.uniqueTournament?.name?.toLowerCase() || '';
      const cName = e.uniqueTournament?.category?.name?.toLowerCase() || '';
      return tName.includes('copa') || tName.includes('spain') || cName.includes('spain') || cName.includes('copa');
    });
    
    console.log(`Spanish/Copa finished events (${spanishOrCopa.length}):`);
    spanishOrCopa.forEach(e => {
      console.log(`  - ID: ${e.id} | "${e.homeTeam?.name}" vs "${e.awayTeam?.name}" | Tournament: "${e.uniqueTournament?.name}" (${e.uniqueTournament?.id}) | Status: ${e.status?.description}`);
    });
  }
  
  await session.close();
}

run().catch(console.error);
