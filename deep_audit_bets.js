import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function deepAudit() {
  const res = await db.execute("SELECT id, outcome, sportium, sportbet, probability, best_edge, match_key FROM backtest_bets");
  const rows = res.rows;
  
  let stats = {
    total: rows.length,
    outcomes: {},
    withOdds160: 0,
    withOdds160_and_Outcome: 0,
    noOdds: 0,
    strangeKeys: 0
  };

  for (const r of rows) {
    stats.outcomes[r.outcome] = (stats.outcomes[r.outcome] || 0) + 1;
    
    const odds = Math.max(r.sportium || 0, r.sportbet || 0);
    if (odds === 0) stats.noOdds++;
    
    if (odds >= 1.60) {
      stats.withOdds160++;
      if (r.outcome === 'WIN' || r.outcome === 'LOSS') {
        stats.withOdds160_and_Outcome++;
      }
    }

    if (!r.match_key || r.match_key.split('|').length < 3) {
      stats.strangeKeys++;
    }
  }

  console.log('--- AUDIT PROFONDO BACKTEST_BETS ---');
  console.log('Righe totali nella tabella:', stats.total);
  console.log('Distribuzione esiti:', stats.outcomes);
  console.log('Scommesse senza alcuna quota (0):', stats.noOdds);
  console.log('Scommesse con Quota >= 1.60 (Totali):', stats.withOdds160);
  console.log('Scommesse con Quota >= 1.60 E Esito (WIN/LOSS):', stats.withOdds160_and_Outcome);
  console.log('Match Key malformati (es: mancano |):', stats.strangeKeys);
  
  process.exit(0);
}

deepAudit().catch(console.error);
