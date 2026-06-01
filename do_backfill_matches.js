import { getDb } from './lib/db.js';
import fs from 'fs';

// Configuration
const apiKey = "811db2ed64e4fd123eb1055a5e52e54d";

const LEAGUES = {
  // Campionati 2024-25 (Season 2024)
  SerieA: { id: 135, season: 2024, type: 'league' },
  Premier: { id: 39, season: 2024, type: 'league' },
  LaLiga: { id: 140, season: 2024, type: 'league' },
  Ligue1: { id: 61, season: 2024, type: 'league' },
  Bundes: { id: 78, season: 2024, type: 'league' },
  
  // Coppe Europee 2024-25 (Season 2024)
  ChampionsLeague_2024: { id: 2, season: 2024, type: 'cup_european', name: 'ChampionsLeague' },
  EuropaLeague_2024: { id: 3, season: 2024, type: 'cup_european', name: 'EuropaLeague' },
  ConferenceLeague_2024: { id: 848, season: 2024, type: 'cup_european', name: 'ConferenceLeague' },
  
  // Coppe Nazionali 2024-25 (Season 2024)
  CoppaItalia_2024: { id: 137, season: 2024, type: 'cup_national', name: 'CoppaItalia' },
  FACup_2024: { id: 45, season: 2024, type: 'cup_national', name: 'FACup' },
  CopaDelRey_2024: { id: 143, season: 2024, type: 'cup_national', name: 'CopaDelRey' },
  CoupeDeFrance_2024: { id: 66, season: 2024, type: 'cup_national', name: 'CoupeDeFrance' },
  DFBPokal_2024: { id: 81, season: 2024, type: 'cup_national', name: 'DFBPokal' },
  EFLCup_2024: { id: 48, season: 2024, type: 'cup_national', name: 'EFLCup' },

  // Coppe Europee 2025-26 (Season 2025)
  ChampionsLeague_2025: { id: 2, season: 2025, type: 'cup_european', name: 'ChampionsLeague' },
  EuropaLeague_2025: { id: 3, season: 2025, type: 'cup_european', name: 'EuropaLeague' },
  ConferenceLeague_2025: { id: 848, season: 2025, type: 'cup_european', name: 'ConferenceLeague' },
  
  // Coppe Nazionali 2025-26 (Season 2025)
  CoppaItalia_2025: { id: 137, season: 2025, type: 'cup_national', name: 'CoppaItalia' },
  FACup_2025: { id: 45, season: 2025, type: 'cup_national', name: 'FACup' },
  CopaDelRey_2025: { id: 143, season: 2025, type: 'cup_national', name: 'CopaDelRey' },
  CoupeDeFrance_2025: { id: 66, season: 2025, type: 'cup_national', name: 'CoupeDeFrance' },
  DFBPokal_2025: { id: 81, season: 2025, type: 'cup_national', name: 'DFBPokal' },
  EFLCup_2025: { id: 48, season: 2025, type: 'cup_national', name: 'EFLCup' },
};

// Direct translations for common team names to ensure consistency
const MANUAL_TEAM_MAP = {
  // Serie A
  'AC Milan': 'Milan',
  'AS Roma': 'Roma',
  'Inter Milan': 'Inter',
  'Juventus FC': 'Juventus',
  'SSC Napoli': 'Napoli',
  'Lazio Roma': 'Lazio',
  'ACF Fiorentina': 'Fiorentina',
  'Bologna FC 1909': 'Bologna',
  'FC Torino': 'Torino',
  'Genoa CFC': 'Genoa',
  'US Lecce': 'Lecce',
  'Udinese Calcio': 'Udinese',
  'Cagliari Calcio': 'Cagliari',
  'Hellas Verona': 'Verona',
  'AC Monza': 'Monza',
  'Frosinone Calcio': 'Frosinone',
  'US Salernitana 1919': 'Salernitana',
  'US Sassuolo Calcio': 'Sassuolo',
  'Empoli FC': 'Empoli',
  'Atalanta BC': 'Atalanta',
  'Venezia FC': 'Venezia',
  'Parma Calcio 1913': 'Parma',
  'Como 1907': 'Como',

  // Premier League
  'Manchester City FC': 'Manchester City',
  'Arsenal FC': 'Arsenal',
  'Liverpool FC': 'Liverpool',
  'Aston Villa FC': 'Aston Villa',
  'Tottenham Hotspur FC': 'Tottenham',
  'Chelsea FC': 'Chelsea',
  'Manchester United FC': 'Manchester United',
  'Newcastle United FC': 'Newcastle',
  'West Ham United FC': 'West Ham',
  'Brighton & Hove Albion FC': 'Brighton',
  'Bournemouth FC': 'Bournemouth',
  'Crystal Palace FC': 'Crystal Palace',
  'Wolverhampton Wanderers FC': 'Wolves',
  'Fulham FC': 'Fulham',
  'Everton FC': 'Everton',
  'Brentford FC': 'Brentford',
  'Nottingham Forest FC': 'Forest',
  'Luton Town FC': 'Luton',
  'Burnley FC': 'Burnley',
  'Sheffield United FC': 'Sheffield Utd',
  'Ipswich Town FC': 'Ipswich',
  'Leicester City FC': 'Leicester',
  'Southampton FC': 'Southampton',

  // La Liga
  'Real Madrid CF': 'Real Madrid',
  'FC Barcelona': 'Barcellona',
  'Girona FC': 'Girona',
  'Atletico Madrid': 'Ath Madrid',
  'Athletic Club': 'Ath Bilbao',
  'Real Sociedad de Futbol': 'Sociedad',
  'Real Betis Balompie': 'Betis',
  'Villarreal CF': 'Villarreal',
  'Valencia CF': 'Valencia',
  'Deportivo Alaves': 'Alaves',
  'CA Osasuna': 'Osasuna',
  'Getafe CF': 'Getafe',
  'RC Celta de Vigo': 'Celta',
  'Sevilla FC': 'Siviglia',
  'RCD Mallorca': 'Maiorca',
  'UD Las Palmas': 'Las Palmas',
  'Rayo Vallecano de Madrid': 'Vallecano',
  'Cadiz CF': 'Cadice',
  'UD Almeria': 'Almeria',
  'Granada CF': 'Granada',
  'RCD Espanyol Barcelona': 'Espanol',
  'Real Valladolid CF': 'Valladolid',
  'CD Leganes': 'Leganes',

  // Bundesliga
  'Bayer 04 Leverkusen': 'Leverkusen',
  'FC Bayern München': 'Bayern',
  'VfB Stuttgart 1893': 'Stuttgart',
  'Borussia Dortmund': 'Dortmund',
  'RB Leipzig': 'Lipsia',
  'Eintracht Frankfurt': 'Ein Frankfurt',
  'TSG Hoffenheim': 'Hoffenheim',
  'SC Freiburg': 'Friburgo',
  '1. FC Heidenheim 1846': 'Heidenheim',
  'SV Werder Bremen': 'Werder',
  'FC Augsburg': 'Augsburg',
  'VfL Wolfsburg': 'Wolfsburg',
  '1. FSV Mainz 05': 'Mainz',
  'Borussia Mönchengladbach': "M'gladbach",
  '1. FC Union Berlin': 'Union Berlin',
  'VfL Bochum 1848': 'Bochum',
  '1. FC Köln': 'FC Koln',
  'SV Darmstadt 98': 'Darmstadt',
  'FC St. Pauli 1910': 'St Pauli',
  'Holstein Kiel': 'Holstein Kiel',

  // Ligue 1
  'Paris Saint-Germain FC': 'PSG',
  'AS Monaco FC': 'Monaco',
  'Stade Brestois 29': 'Brest',
  'Lille OSC': 'Lilla',
  'OGC Nice Côte d\'Azur': 'Nice',
  'Racing Club de Lens': 'Lens',
  'Olympique de Marseille': 'Marseille',
  'Stade de Reims': 'Reims',
  'Stade Rennais FC 1901': 'Rennes',
  'Toulouse FC': 'Toulouse',
  'Montpellier Hérault SC': 'Montpellier',
  'Olympique Lyonnais': 'Lyon',
  'FC Nantes': 'Nantes',
  'RC Strasbourg Alsace': 'Strasbourg',
  'Le Havre AC': 'Le Havre',
  'FC Metz': 'Metz',
  'FC Lorient': 'Lorient',
  'Clermont Foot 63': 'Clermont',
  'AS Saint-Étienne': 'Saint Etienne',
  'Angers SCO': 'Angers',
  'AJ Auxerre': 'Auxerre',
};

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/fc\s+|ac\s+|as\s+|ss\s+|rc\s+|ud\s+|usc\s+|usd\s+|\s+fc|\s+calcio|\s+cf|\s+sc|\s+osc|\s+bc|\s+cFC/g, '')
    .replace(/münchen/, 'munich')
    .replace(/mönchengladbach/, 'gladbach')
    .replace(/atletico/, 'ath')
    .replace(/athletic/, 'ath')
    .replace(/deportivo/, 'dep')
    .replace(/spagna|espana/, 'spain')
    .replace(/italy|italia/, 'italy')
    .replace(/france|francia/, 'france')
    .replace(/germany|germania/, 'germany')
    .trim();
}

function getSimilarity(s1, s2) {
  let longer = s1.toLowerCase();
  let shorter = s2.toLowerCase();
  if (s1.length < s2.length) {
    longer = s2.toLowerCase();
    shorter = s1.toLowerCase();
  }
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  if (longer.includes(shorter)) return 0.85;
  
  const costs = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longerLength - costs[shorter.length]) / parseFloat(longerLength);
}

// Load env variables
const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) {
    process.env[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
  }
});

async function run() {
  const db = await getDb();
  
  // Load existing teams to match names
  const teamsRes = await db.execute('SELECT name, league FROM teams');
  const dbTeams = teamsRes.rows;
  console.log(`Loaded ${dbTeams.length} existing teams from DB.`);

  function getBestTeamMatch(apiName, leagueName) {
    // 1. Direct manual mapping
    if (MANUAL_TEAM_MAP[apiName]) {
      return MANUAL_TEAM_MAP[apiName];
    }
    
    // 2. Direct name mapping (removing common prefixes/suffixes)
    const normApi = normalizeName(apiName);
    
    let bestMatch = null;
    let highestSim = 0.0;
    
    for (const team of dbTeams) {
      // Prioritize teams in the same league
      if (team.league === leagueName) {
        if (team.name === apiName) return team.name;
        const normDb = normalizeName(team.name);
        if (normDb === normApi) return team.name;
        
        const sim = getSimilarity(normApi, normDb);
        if (sim > highestSim) {
          highestSim = sim;
          bestMatch = team.name;
        }
      }
    }
    
    if (highestSim > 0.78) {
      return bestMatch;
    }
    
    // 3. Fallback search across all leagues
    for (const team of dbTeams) {
      const normDb = normalizeName(team.name);
      if (normDb === normApi) return team.name;
      
      const sim = getSimilarity(normApi, normDb);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = team.name;
      }
    }
    
    if (highestSim > 0.82) {
      return bestMatch;
    }
    
    // If no good match, return clean API name
    return apiName.replace(/\s+FC$|\s+CF$|\s+UD$|\s+CD$/gi, '').trim();
  }

  let totalAdded = 0;

  for (const [key, config] of Object.entries(LEAGUES)) {
    const leagueName = config.name || key;
    console.log(`\nFetching ${leagueName} (ID: ${config.id}, Season: ${config.season})...`);
    
    const url = `https://v3.football.api-sports.io/fixtures?league=${config.id}&season=${config.season}`;
    
    let json;
    try {
      const res = await fetch(url, {
        headers: { 'x-apisports-key': apiKey }
      });
      if (!res.ok) {
        console.error(`  [ERROR] API responded with status ${res.status}`);
        continue;
      }
      json = await res.json();
    } catch (e) {
      console.error(`  [ERROR] Fetch failed: ${e.message}`);
      continue;
    }
    
    if (json.errors && Object.keys(json.errors).length > 0) {
      console.error(`  [ERROR] API error: ${JSON.stringify(json.errors)}`);
      continue;
    }
    
    const fixtures = json.response || [];
    console.log(`  Found ${fixtures.length} total matches.`);
    
    // Filter finished matches
    const finished = fixtures.filter(f => 
      f.fixture.status.short === 'FT' || 
      f.fixture.status.short === 'AET' || 
      f.fixture.status.short === 'PEN'
    );
    console.log(`  Finished matches: ${finished.length}`);
    
    const insertMatchSql = `
      INSERT OR IGNORE INTO matches (
        league, date, home_team, away_team,
        home_goals, away_goals, home_shots, away_shots, home_sot, away_sot,
        home_fouls, away_fouls, home_corners, away_corners,
        home_yellows, away_yellows, home_reds, away_reds,
        referee, competition_type
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)
    `;
    
    let addedCount = 0;
    const stmts = [];
    
    for (const f of finished) {
      const rawDate = f.fixture.date.split('T')[0];
      const apiHome = f.teams.home.name;
      const apiAway = f.teams.away.name;
      
      const homeTeam = getBestTeamMatch(apiHome, leagueName);
      const awayTeam = getBestTeamMatch(apiAway, leagueName);
      
      const homeGoals = f.goals.home ?? 0;
      const awayGoals = f.goals.away ?? 0;
      
      let referee = f.fixture.referee || null;
      if (referee) {
        // clean referee name (e.g. "A. Calzavara, Italy" -> "Calzavara")
        referee = referee.split(',')[0].replace(/^[A-Z]\.\s+/, '').trim();
      }
      
      stmts.push({
        sql: insertMatchSql,
        args: [
          leagueName,
          rawDate,
          homeTeam,
          awayTeam,
          homeGoals,
          awayGoals,
          referee,
          config.type
        ]
      });
      
      // Also register teams if they are not already in teams table
      stmts.push({
        sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)',
        args: [leagueName, homeTeam]
      });
      stmts.push({
        sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)',
        args: [leagueName, awayTeam]
      });
      
      addedCount++;
    }
    
    if (stmts.length > 0) {
      const res = await db.batch(stmts);
      // SQLite INSERT OR IGNORE returns lastInsertRowid, we can check how many rows were actually inserted by checking row counts
      console.log(`  Batched ${stmts.length / 3} matches for insertion.`);
      totalAdded += (stmts.length / 3);
    }
    
    // Avoid hitting rate limits (wait 1s between leagues)
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\n=================================================`);
  console.log(` Base Backfill Completed! Added ${totalAdded} matches.`);
  console.log(`=================================================`);
}

run().catch(console.error);
