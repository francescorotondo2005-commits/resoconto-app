import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
let envStr = '';
try {
    envStr = fs.readFileSync(envPath, 'utf-8');
} catch (e) {
    console.log("No .env.local found.");
}

const env = {};
for (const line of envStr.split('\n')) {
    if (line.includes('=')) {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/"/g, '');
    }
}

const localDb = createClient({ url: 'file:resoconto.db' });

let turso = null;
if (env.TURSO_DATABASE_URL) {
    turso = createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN
    });
}

async function sync() {
    console.log("Reading from local SQLite...");
    const res = await localDb.execute("SELECT * FROM matches WHERE home_xg IS NOT NULL");
    const rows = res.rows;
    console.log(`Found ${rows.length} matches to sync to Turso...`);
    
    if (rows.length === 0 || !turso) {
        console.log("Nothing to sync or Turso not configured.");
        return;
    }
    
    const batch = [];
    for (const row of rows) {
        batch.push({
            sql: `UPDATE matches SET 
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
                home_interceptions = ?, away_interceptions = ?,
                competition_type = ?
            WHERE id = ?`,
            args: [
                row.home_xg, row.away_xg, 
                row.home_xg_ht, row.away_xg_ht, 
                row.home_goals_ht, row.away_goals_ht, 
                row.home_corners_ht, row.away_corners_ht, 
                row.home_yellows_ht, row.away_yellows_ht, 
                row.home_reds_ht, row.away_reds_ht, 
                row.home_offsides, row.away_offsides, 
                row.home_shots_insidebox, row.away_shots_insidebox, 
                row.home_big_chances, row.away_big_chances, 
                row.home_possession, row.away_possession,
                row.home_passes, row.away_passes,
                row.home_crosses, row.away_crosses,
                row.home_tackles, row.away_tackles,
                row.home_interceptions, row.away_interceptions,
                row.competition_type,
                row.id
            ]
        });
    }
    
    console.log(`Executing batch update of ${batch.length} statements on Turso...`);
    const chunkSize = 100;
    for (let i = 0; i < batch.length; i += chunkSize) {
        const chunk = batch.slice(i, i + chunkSize);
        await turso.batch(chunk, "write");
        console.log(`Synced ${Math.min(i + chunk.length, batch.length)} / ${batch.length} matches...`);
    }
    console.log("Sync complete!");
}

sync().catch(console.error);
