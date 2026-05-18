import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import https from 'https';

// Costanti
const DELAY_MS = 20000;
const DB_PATH = path.join(process.cwd(), 'resoconto.db');

function getDbClient() {
    const envPath = path.join(process.cwd(), '.env.local');
    let url = `file:${DB_PATH}`;
    let authToken = undefined;

    if (fs.existsSync(envPath)) {
        const envStr = fs.readFileSync(envPath, 'utf-8');
        const env = {};
        for (const line of envStr.split('\n')) {
            if (line.includes('=')) {
                const [k, v] = line.split('=');
                env[k.trim()] = v.trim().replace(/"/g, '').replace(/\r/g, '');
            }
        }
        if (env.TURSO_DATABASE_URL) {
            url = env.TURSO_DATABASE_URL;
            authToken = env.TURSO_AUTH_TOKEN;
        }
    }

    return createClient({ url, authToken });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const TEAM_MAPPING = {
    'amburgo': 'hamburger sv',
    'ath bilbao': 'athletic club',
    'ath madrid': 'atlético madrid',
    'bayern': 'bayern münchen',
    'betis': 'real betis',
    'dortmund': 'borussia dortmund',
    'ein frankfurt': 'eintracht frankfurt',
    'espanol': 'espanyol',
    'fc koln': '1. fc köln',
    'forest': 'nottingham forest',
    'friburgo': 'sc freiburg',
    'heidenheim': '1. fc heidenheim',
    'leverkusen': 'bayer 04 leverkusen',
    'm\'gladbach': 'borussia mönchengladbach',
    'borussia m\'gladbach': 'borussia mönchengladbach',
    'man city': 'manchester city',
    'man united': 'manchester united',
    'psg': 'paris saint-germain',
    'sociedad': 'real sociedad',
    'st pauli': 'st. pauli',
    'vallecano': 'rayo vallecano',
    'wolves': 'wolverhampton',
    'rennes': 'stade rennais',
    'union berlin': '1. fc union berlin',
    'mainz': '1. fsv mainz 05',
    'werder bremen': 'werder bremen',
    'hoffenheim': 'tsg hoffenheim',
    'bologna': 'bologna',
    'inter': 'inter',
    'celta': 'celta vigo',
    'alaves': 'deportivo alavés',
    'auxerre': 'aj auxerre',
    'brest': 'stade brestois',
    'brighton': 'brighton & hove albion',
    'le havre': 'le havre',
    'leeds': 'leeds united',
    'lens': 'rc lens',
    'lyon': 'olympique lyonnais',
    'marseille': 'olympique de marseille',
    'metz': 'fc metz',
    'monaco': 'as monaco',
    'nantes': 'fc nantes',
    'newcastle': 'newcastle united',
    'nice': 'ogc nice',
    'osasuna': 'ca osasuna',
    'strasbourg': 'rc strasbourg',
    'stuttgart': 'vfb stuttgart',
    'tottenham': 'tottenham hotspur',
    'toulouse': 'toulouse',
    'west ham': 'west ham united'
};

function normalizeTeamName(name) {
    if (!name) return "";
    let n = name.toLowerCase().trim();
    
    // Check direct mapping first
    if (TEAM_MAPPING[n]) {
        n = TEAM_MAPPING[n];
    }
    
    return n.replace(/fc\s+|ac\s+|as\s+|ss\s+|\s+fc|\s+calcio/g, '')
        .replace(/internazionale|inter milan/, 'inter')
        .replace(/hellas verona/, 'verona')
        .replace(/athletic club/, 'athletic bilbao')
        .trim();
}

function getSimilarity(s1, s2) {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    
    if (longer.includes(shorter)) return 0.9;
    
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

function matchTeam(dbName, sofaName) {
    const dbNorm = normalizeTeamName(dbName);
    const sofaNorm = normalizeTeamName(sofaName);
    if (dbNorm === sofaNorm) return true;
    return getSimilarity(dbNorm, sofaNorm) > 0.75;
}

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            agent: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.sofascore.com/',
                'Origin': 'https://www.sofascore.com',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        };
        
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                console.error(`[API Error] ${url} - Status: ${res.statusCode}`);
                // Resolve con null invece di rejectare per non far crashare lo script nel loop
                return resolve(null);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    console.error(`[JSON Error] ${url} - ${e.message}`);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.error(`[Network Error] ${url} - ${e.message}`);
            resolve(null);
        });
    });
}

function extractValue(val) {
    if (val === undefined || val === null) return null;
    // se è una stringa tipo "53%", estrai solo 53
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
                    'offsides', 'insideBoxShots', 'bigChanceCreated', 'ballPossession'
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

async function processDate(targetDate) {
    console.log(`\n=================================================`);
    console.log(` Avvio Recupero Dati SofaScore: ${targetDate}`);
    console.log(`=================================================`);
    
    const db = getDbClient();
    
    // Trova partite nel DB per questa data (ignorando quelle già processate o sospese)
    const dbMatchesRes = await db.execute({
        sql: `SELECT id, home_team, away_team FROM matches WHERE date(date) = ? AND home_xg IS NULL`,
        args: [targetDate]
    });
    
    const dbMatches = dbMatchesRes.rows;
    
    if (dbMatches.length === 0) {
        console.log(`[OK] Nessuna partita da aggiornare trovata nel DB per il ${targetDate}.`);
        return;
    }
    
    console.log(`> Trovate ${dbMatches.length} partite nel DB da arricchire.`);
    
    // Scarica eventi SofaScore per la data
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`;
    const eventsData = await fetchJson(url);
    
    if (!eventsData || !eventsData.events) {
        console.log(`[!] Nessun evento SofaScore trovato per il ${targetDate}.`);
        return;
    }
    
    const finishedEvents = eventsData.events.filter(e => e.status && e.status.type === 'finished');
    console.log(`> Trovati ${finishedEvents.length} eventi conclusi su SofaScore.`);
    
    let updatedCount = 0;

    for (const dbMatch of dbMatches) {
        // Cerca match corrispondente
        const sofaEvent = finishedEvents.find(e => 
            matchTeam(dbMatch.home_team, e.homeTeam.name) && 
            matchTeam(dbMatch.away_team, e.awayTeam.name)
        );
        
        if (!sofaEvent) {
            console.log(`[SKIP] Match non trovato su SofaScore: ${dbMatch.home_team} vs ${dbMatch.away_team}`);
            continue;
        }
        
        console.log(`\n[FETCH] ${dbMatch.home_team} vs ${dbMatch.away_team} (Sofa ID: ${sofaEvent.id})`);
        
        // Attendi 20 secondi prima di chiamare l'API per evitare il BAN
        console.log(`        ⏳ Attesa 20 secondi (Anti-Ban)...`);
        await delay(DELAY_MS);
        
        const statsData = await fetchJson(`https://api.sofascore.com/api/v1/event/${sofaEvent.id}/statistics`);
        
        if (!statsData || !statsData.statistics) {
            console.log(`        [!] Nessuna statistica trovata. Inserisco NULL per evitare buchi.`);
            // Potremmo fare update a NULL ma i campi sono già NULL di default.
            continue;
        }
        
        const parsedStats = parseStatistics(statsData.statistics);
        
        // Estrai HT Goals da sofaEvent
        const home_goals_ht = sofaEvent.homeScore?.period1 ?? null;
        const away_goals_ht = sofaEvent.awayScore?.period1 ?? null;
        
        // Prepara update
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
                home_possession = ?, away_possession = ?
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
                dbMatch.id
            ]
        });
        
        console.log(`        ✅ Aggiornamento DB completato (xG: ${parsedStats['ALL'].home.expectedGoals || 'N/A'} - ${parsedStats['ALL'].away.expectedGoals || 'N/A'})`);
        updatedCount++;
    }
    
    console.log(`\n=================================================`);
    console.log(` Sessione conclusa. Partite aggiornate: ${updatedCount}`);
    console.log(`=================================================`);
}

// Supporto per argomenti da riga di comando
const args = process.argv.slice(2);

if (args.includes('--backfill')) {
    // Esempio logica backfill: iterare sulle date degli ultimi N mesi
    console.log("Modalità --backfill avviata. Estrarrò tutte le date dal DB con home_xg NULL.");
    
    (async () => {
        const db = getDbClient();
        const res = await db.execute(`SELECT DISTINCT date(date) as d FROM matches WHERE home_xg IS NULL ORDER BY date(date) DESC`);
        const dates = res.rows;
        
        if (dates.length === 0) {
             console.log("Tutto il database è già aggiornato!");
             process.exit(0);
        }
        
        console.log(`Trovate ${dates.length} date da processare in backfill.`);
    
        for (const row of dates) {
            await processDate(row.d);
            console.log("Pausa tra date per sicurezza (10s)...");
            await delay(10000);
        }
        console.log("BACKFILL COMPLETATO CON SUCCESSO.");
    })();

} else if (args.length > 0) {
    const targetDate = args[0]; // Formato YYYY-MM-DD
    processDate(targetDate);
} else {
    // Di default, usa la data di ieri
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().split('T')[0];
    processDate(targetDate);
}
