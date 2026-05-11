import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function audit() {
  const res = await db.execute('SELECT * FROM matches ORDER BY date ASC');
  const all = res.rows;
  
  let total = all.length;
  let missingGoals = 0;
  let incompleteStats = 0;
  let historyExcluded = 0;
  let validForTraining = 0;
  
  const statsFields = [
    'home_shots', 'away_shots', 
    'home_sot', 'away_sot', 
    'home_fouls', 'away_fouls', 
    'home_corners', 'away_corners',
    'home_yellows', 'away_yellows',
    'home_saves', 'away_saves'
  ];

  const teamHistory = {};

  for (const m of all) {
    // 1. Check goals
    if (m.home_goals === null || m.away_goals === null) {
      missingGoals++;
      continue;
    }

    // 2. Check all other stats
    let incomplete = false;
    for (const field of statsFields) {
      if (m[field] === null || m[field] === undefined) {
        incomplete = true;
        break;
      }
    }

    if (incomplete) {
      incompleteStats++;
      // Non usciamo qui, vogliamo vedere se verrebbe esclusa anche per storico
    }

    // 3. Check history (min 10 matches before this date)
    const h = teamHistory[m.home_team] || 0;
    const a = teamHistory[m.away_team] || 0;
    
    if (h < 10 || a < 10) {
      historyExcluded++;
    } else if (!incomplete) {
      validForTraining++;
    }

    // Update history for next matches
    teamHistory[m.home_team] = h + 1;
    teamHistory[m.away_team] = a + 1;
  }

  console.log('--- REPORT AUDIT DATABASE ---');
  console.log('Totale partite nel DB:', total);
  console.log('Partite senza Risultato (scartate):', missingGoals);
  console.log('Partite con Risultato ma STATISTICHE INCOMPLETE:', incompleteStats);
  console.log('Partite scartate per MANCANZA DI STORICO (<10 match):', historyExcluded);
  console.log('-----------------------------');
  console.log('PARTITE VALIDE PER IL TRAINING:', validForTraining);
  
  if (incompleteStats > 0) {
    console.log('\nEsempio partita incompleta (ID):');
    const firstIncomplete = all.find(m => {
        if (m.home_goals === null) return false;
        for (const f of statsFields) if (m[f] === null) return true;
        return false;
    });
    console.log(`Match: ${firstIncomplete.home_team} vs ${firstIncomplete.away_team} (ID: ${firstIncomplete.id})`);
    console.log('Campi mancanti:', statsFields.filter(f => firstIncomplete[f] === null).join(', '));
  }

  process.exit(0);
}

audit().catch(console.error);
