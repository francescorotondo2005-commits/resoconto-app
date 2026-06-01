import fs from 'fs';
import { createSofaSession } from '../lib/sofa_playwright.js';

async function checkNames() {
  console.log("Initializing SofaScore session...");
  const sofaSession = await createSofaSession();
  const date = '2025-01-22';
  console.log(`Fetching events for ${date}...`);
  const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;
  const data = await sofaSession.fetch(url);
  
  if (!data || !data.events) {
    console.log("No data fetched. Possibly Cloudflare blocked.");
    await sofaSession.close();
    return;
  }

  const finished = data.events.filter(e => e.status?.type === 'finished');
  console.log(`Found ${finished.length} finished events.`);

  const sportingMatches = finished.filter(e => 
    e.homeTeam?.name.toLowerCase().includes('sporting') || 
    e.awayTeam?.name.toLowerCase().includes('sporting') ||
    e.homeTeam?.name.toLowerCase().includes('leipzig') ||
    e.awayTeam?.name.toLowerCase().includes('leipzig')
  );

  for (const m of sportingMatches) {
    console.log(`SofaScore Event ID: ${m.id}`);
    console.log(`  Home Team: "${m.homeTeam?.name}" (ID: ${m.homeTeam?.id})`);
    console.log(`  Away Team: "${m.awayTeam?.name}" (ID: ${m.awayTeam?.id})`);
  }

  await sofaSession.close();
}

checkNames().catch(console.error);
