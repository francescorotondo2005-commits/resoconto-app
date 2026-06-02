import { chromium } from 'playwright';
import fs from 'fs';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  const url = 'https://www.sofascore.com/sd-ejea-hercules-cf/dEscOcb';
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  console.log(`Page content fetched, length: ${html.length}`);
  
  // Look for event ID in the HTML
  // SofaScore stores JSON in script tags like <script id="__NEXT_DATA__" type="application/json">...</script>
  let eventId = null;
  const matches = html.match(/"event"\s*:\s*\{\s*"id"\s*:\s*(\d+)/) || html.match(/"id"\s*:\s*(\d+)\s*,\s*"homeTeam"/) || html.match(/\/event\/(\d+)\//);
  if (matches) {
    eventId = matches[1];
    console.log(`Found Event ID in HTML: ${eventId}`);
  } else {
    // Try custom extraction from next data
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextJson = JSON.parse(nextDataMatch[1]);
        // Typically it resides in props.pageProps.event.id
        const event = nextJson?.props?.pageProps?.event;
        if (event) {
          eventId = event.id;
          console.log(`Found Event ID in __NEXT_DATA__: ${eventId}`);
        }
      } catch (e) {
        console.error('Failed to parse __NEXT_DATA__ JSON', e.message);
      }
    }
  }
  
  if (eventId) {
    // Let's do a request to Sofascore API inside the page to get the event details
    console.log(`Fetching details for Event ID ${eventId} via page fetch...`);
    const details = await page.evaluate(async (id) => {
      const res = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
      return await res.json();
    }, eventId);
    
    if (details && details.event) {
      const e = details.event;
      console.log(`\n=================== SUCCESS ===================`);
      console.log(`Event Details:`);
      console.log(`  ID: ${e.id}`);
      console.log(`  Home: "${e.homeTeam?.name}" | Away: "${e.awayTeam?.name}"`);
      console.log(`  Date: ${e.startTimestamp} (${new Date(e.startTimestamp * 1000).toISOString()})`);
      console.log(`  Tournament: "${e.uniqueTournament?.name}"`);
      console.log(`  Status: ${e.status?.type} (${e.status?.description})`);
    } else {
      console.log(`Failed to fetch event details from API!`, details);
    }
  } else {
    console.log(`Could not extract event ID!`);
    fs.writeFileSync('scratch/ejea_page.html', html);
    console.log('Saved page to scratch/ejea_page.html');
  }
  
  await browser.close();
}

run().catch(console.error);
