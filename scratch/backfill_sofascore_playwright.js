import { getDb } from '../lib/db.js';
import fs from 'fs';
import { chromium } from 'playwright';

// Configure delay between matches to be polite
const DELAY_MS = 1500;

const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) {
    process.env[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
  }
});

const TEAM_MAPPING = {
  'amburgo': 'hamburger sv', 'ath bilbao': 'athletic club',
  'ath madrid': 'atlético madrid', 'bayern': 'bayern münchen',
  'betis': 'real betis', 'dortmund': 'borussia dortmund',
  'ein frankfurt': 'eintracht frankfurt', 'espanol': 'espanyol',
  'fc koln': '1. fc köln', 'forest': 'nottingham forest',
  'friburgo': 'sc freiburg', 'heidenheim': '1. fc heidenheim',
  'leverkusen': 'bayer 04 leverkusen',
  "m'gladbach": 'borussia mönchengladbach',
  "borussia m'gladbach": 'borussia mönchengladbach',
  'man city': 'manchester city', 'man united': 'manchester united',
  'psg': 'paris saint-germain', 'sociedad': 'real sociedad',
  'st pauli': 'st. pauli', 'vallecano': 'rayo vallecano',
  'wolves': 'wolverhampton', 'rennes': 'stade rennais',
  'union berlin': '1. fc union berlin', 'mainz': '1. fsv mainz 05',
  'werder bremen': 'werder bremen', 'hoffenheim': 'tsg hoffenheim',
  'celta': 'celta vigo', 'alaves': 'deportivo alavés',
  'auxerre': 'aj auxerre', 'brest': 'stade brestois',
  'brighton': 'brighton & hove albion', 'le havre': 'le havre',
  'leeds': 'leeds united', 'lens': 'rc lens', 'lyon': 'olympique lyonnais',
  'marseille': 'olympique de marseille', 'metz': 'fc metz',
  'monaco': 'as monaco', 'nantes': 'fc nantes',
  'newcastle': 'newcastle united', 'nice': 'ogc nice',
  'osasuna': 'ca osasuna', 'strasbourg': 'rc strasbourg',
  'stuttgart': 'vfb stuttgart', 'tottenham': 'tottenham hotspur',
  'toulouse': 'toulouse', 'west ham': 'west ham united',
  'barcellona': 'barcelona', 'siviglia': 'sevilla', 'maiorca': 'mallorca',
  'cadice': 'cadiz', 'lipsia': 'rb leipzig', 'lilla': 'lille',
  'saint etienne': 'saint-étienne', 'amateur': 'amateurs',
  'amburgo sv': 'hamburger sv', 'athletic club': 'athletic bilbao',
  'atlético madrid': 'ath madrid', 'bayern münchen': 'bayern',
  'real betis': 'betis', 'borussia dortmund': 'dortmund',
  'eintracht frankfurt': 'ein frankfurt', 'espanyol': 'espanol',
  '1. fc köln': 'fc koln', 'nottingham forest': 'forest',
  'sc freiburg': 'friburgo', '1. fc heidenheim': 'heidenheim',
  'bayer 04 leverkusen': 'leverkusen', 'borussia mönchengladbach': "m'gladbach",
  'manchester city': 'man city', 'manchester united': 'man united',
  'paris saint-germain': 'psg', 'real sociedad': 'sociedad',
  'st. pauli': 'st pauli', 'rayo vallecano': 'vallecano',
  'wolverhampton': 'wolves', 'stade rennais': 'rennes',
  '1. fc union berlin': 'union berlin', '1. fsv mainz 05': 'mainz',
  'tsg hoffenheim': 'hoffenheim', 'celta vigo': 'celta',
  'deportivo alavés': 'alaves', 'aj auxerre': 'auxerre',
  'stade brestois': 'brest', 'brighton & hove albion': 'brighton',
  'leeds united': 'leeds', 'rc lens': 'lens', 'olympique lyonnais': 'lyon',
  'olympique de marseille': 'marseille', 'as monaco': 'monaco',
  'fc nantes': 'nantes', 'newcastle united': 'newcastle',
  'ogc nice': 'nice', 'ca osasuna': 'osasuna', 'rc strasbourg': 'strasbourg',
  'vfb stuttgart': 'stuttgart', 'tottenham hotspur': 'tottenham',
  'west ham united': 'west ham'
};

function normalizeTeamName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  if (TEAM_MAPPING[n]) n = TEAM_MAPPING[n];
  return n
    .replace(/fc\s+|ac\s+|as\s+|ss\s+|\s+fc|\s+calcio|\s+cf|\s+sc|\s+osc|\s+bc|\s+cFC/g, '')
    .replace(/internazionale|inter milan/, 'inter')
    .replace(/hellas verona/, 'verona')
    .replace(/athletic club/, 'athletic bilbao')
    .trim();
}

function getSimilarity(s1, s2) {
  let longer = s1, shorter = s2;
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  const ll = longer.length;
  if (ll === 0) return 1.0;
  if (longer.includes(shorter)) return 0.9;
  const costs = [];
  for (let i = 0; i <= ll; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) { costs[j] = j; }
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (ll - costs[shorter.length]) / parseFloat(ll);
}

function matchTeam(dbName, sofaName) {
  const a = normalizeTeamName(dbName);
  const b = normalizeTeamName(sofaName);
  return a === b || getSimilarity(a, b) > 0.75 || a.includes(b) || b.includes(a);
}

function extractValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string' && val.includes('%')) {
    return parseFloat(val.replace('%', ''));
  }
  return parseFloat(val);
}

function parseStatistics(statisticsArray) {
  const result = { ALL: { home: {}, away: {} }, '1ST': { home: {}, away: {} } };
  if (!statisticsArray) return result;

  for (const period of statisticsArray) {
    const pName = period.period; 
    if (pName !== 'ALL' && pName !== '1ST') continue;
    
    for (const group of period.groups) {
      for (const item of group.statisticsItems) {
        const key = item.key;
        const validKeys = [
          'expectedGoals', 'cornerKicks', 'yellowCards', 'redCards', 
          'offsides', 'insideBoxShots', 'bigChanceCreated', 'ballPossession',
          'passes', 'accurateCross', 'totalTackle', 'interceptionWon'
        ];
        
        if (validKeys.includes(key)) {
          result[pName].home[key] = extractValue(item.homeValue);
          result[pName].away[key] = extractValue(item.awayValue);
        }
      }
    }
  }
  return result;
}

async function run() {
  const db = await getDb();
  
  // Find all distinct dates with missing SofaScore stats
  const datesRes = await db.execute(`
    SELECT DISTINCT date(date) as d 
    FROM matches 
    WHERE home_xg IS NULL 
    ORDER BY date(date) DESC
  `);
  
  const dates = datesRes.rows;
  console.log(`Found ${dates.length} dates with missing SofaScore stats.`);
  
  if (dates.length === 0) {
    console.log("Database is already fully populated!");
    return;
  }
  
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  let totalUpdated = 0;
  
  for (const dateRow of dates) {
    const targetDate = dateRow.d;
    
    const dbMatchesRes = await db.execute({
      sql: `SELECT id, home_team, away_team FROM matches WHERE date(date) = ? AND home_xg IS NULL`,
      args: [targetDate]
    });
    
    const dbMatches = dbMatchesRes.rows;
    if (dbMatches.length === 0) continue;
    
    console.log(`\nProcessing date ${targetDate} (${dbMatches.length} matches needed)...`);
    
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`;
    let eventsData = null;
    try {
      await page.goto(url);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.startsWith('{')) {
        eventsData = JSON.parse(text);
      }
    } catch (err) {
      console.error(`  [ERROR] Failed to fetch events for ${targetDate}: ${err.message}`);
      continue;
    }
    
    if (!eventsData || !eventsData.events) {
      console.log(`  [WARN] No events found on SofaScore for date ${targetDate}.`);
      continue;
    }
    
    const finishedEvents = eventsData.events.filter(e => e.status && e.status.type === 'finished');
    console.log(`  SofaScore finished events: ${finishedEvents.length}`);
    
    for (const dbMatch of dbMatches) {
      // Find matching SofaScore event
      const sofaEvent = finishedEvents.find(e => 
        matchTeam(dbMatch.home_team, e.homeTeam.name) && 
        matchTeam(dbMatch.away_team, e.awayTeam.name)
      );
      
      if (!sofaEvent) {
        console.log(`  [SKIP] Match not found on SofaScore: ${dbMatch.home_team} vs ${dbMatch.away_team}`);
        continue;
      }
      
      console.log(`  [FETCH] ${dbMatch.home_team} vs ${dbMatch.away_team} (Sofa ID: ${sofaEvent.id})...`);
      
      // Delay to be polite
      await new Promise(r => setTimeout(r, DELAY_MS));
      
      const statsUrl = `https://api.sofascore.com/api/v1/event/${sofaEvent.id}/statistics`;
      let statsData = null;
      try {
        await page.goto(statsUrl);
        const statsText = await page.evaluate(() => document.body.innerText);
        if (statsText.startsWith('{')) {
          statsData = JSON.parse(statsText);
        }
      } catch (err) {
        console.error(`    [ERROR] Failed to fetch stats: ${err.message}`);
        continue;
      }
      
      if (!statsData || !statsData.statistics) {
        console.log(`    [WARN] No stats found for Sofa ID: ${sofaEvent.id}. Initializing with zeros.`);
        await db.execute({
          sql: `UPDATE matches SET home_xg = 0.0, away_xg = 0.0 WHERE id = ?`,
          args: [dbMatch.id]
        });
        continue;
      }
      
      const parsedStats = parseStatistics(statsData.statistics);
      const home_goals_ht = sofaEvent.homeScore?.period1 ?? null;
      const away_goals_ht = sofaEvent.awayScore?.period1 ?? null;
      
      await db.execute({
        sql: `
          UPDATE matches SET
            home_xg = ?, away_xg = ?,
            home_xg_ht = ?, away_xg_ht = ?,
            home_goals_ht = ?, away_goals_ht = ?,
            home_corners_ht = ?, away_corners_ht = ?,
            home_yellows_ht = ?, away_yellows_ht = ?,
            home_reds_ht = ?, away_reds_ht = ?,
            home_offsides = ?, away_offsides = ?,
            home_shots_insidebox = ?, away_shots_insidebox = ?,
            home_big_chances = ?, away_big_chances = ?,
            home_possession = ?, away_possession = ?,
            home_passes = ?, away_passes = ?,
            home_crosses = ?, away_crosses = ?,
            home_tackles = ?, away_tackles = ?,
            home_interceptions = ?, away_interceptions = ?
          WHERE id = ?
        `,
        args: [
          parsedStats['ALL'].home.expectedGoals ?? null, parsedStats['ALL'].away.expectedGoals ?? null,
          parsedStats['1ST'].home.expectedGoals ?? null, parsedStats['1ST'].away.expectedGoals ?? null,
          home_goals_ht, away_goals_ht,
          parsedStats['1ST'].home.cornerKicks ?? null, parsedStats['1ST'].away.cornerKicks ?? null,
          parsedStats['1ST'].home.yellowCards ?? null, parsedStats['1ST'].away.yellowCards ?? null,
          parsedStats['1ST'].home.redCards ?? null, parsedStats['1ST'].away.redCards ?? null,
          parsedStats['ALL'].home.offsides ?? null, parsedStats['ALL'].away.offsides ?? null,
          parsedStats['ALL'].home.insideBoxShots ?? null, parsedStats['ALL'].away.insideBoxShots ?? null,
          parsedStats['ALL'].home.bigChanceCreated ?? null, parsedStats['ALL'].away.bigChanceCreated ?? null,
          parsedStats['ALL'].home.ballPossession ?? null, parsedStats['ALL'].away.ballPossession ?? null,
          parsedStats['ALL'].home.passes ?? null, parsedStats['ALL'].away.passes ?? null,
          parsedStats['ALL'].home.accurateCross ?? null, parsedStats['ALL'].away.accurateCross ?? null,
          parsedStats['ALL'].home.totalTackle ?? null, parsedStats['ALL'].away.totalTackle ?? null,
          parsedStats['ALL'].home.interceptionWon ?? null, parsedStats['ALL'].away.interceptionWon ?? null,
          dbMatch.id
        ]
      });
      
      console.log(`    ✅ Updated stats successfully.`);
      totalUpdated++;
    }
    
    // Safety check cap for the turn
    if (totalUpdated >= 15) {
      console.log(`\nReached limit of 15 updates for this turn.`);
      break;
    }
  }
  
  await browser.close();
  console.log(`\n=================================================`);
  console.log(` SofaScore Playwright Backfill Session Finished! Updated ${totalUpdated} matches.`);
  console.log(`=================================================`);
}

run().catch(console.error);
