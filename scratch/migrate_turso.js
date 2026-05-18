import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
const envStr = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envStr.split('\n')) {
    if (line.includes('=')) {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/"/g, '');
    }
}

const turso = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN
});

async function migrate() {
    console.log("Migrating Turso schema...");
    const columns = [
        'home_xg REAL', 'away_xg REAL',
        'home_xg_ht REAL', 'away_xg_ht REAL',
        'home_goals_ht INTEGER', 'away_goals_ht INTEGER',
        'home_corners_ht INTEGER', 'away_corners_ht INTEGER',
        'home_yellows_ht INTEGER', 'away_yellows_ht INTEGER',
        'home_reds_ht INTEGER', 'away_reds_ht INTEGER',
        'home_offsides INTEGER', 'away_offsides INTEGER',
        'home_shots_insidebox INTEGER', 'away_shots_insidebox INTEGER',
        'home_big_chances INTEGER', 'away_big_chances INTEGER',
        'home_possession INTEGER', 'away_possession INTEGER'
    ];
    
    for (const col of columns) {
        try {
            await turso.execute(`ALTER TABLE matches ADD COLUMN ${col}`);
            console.log(`Added ${col}`);
        } catch (e) {
            console.log(`Error adding ${col} (might exist):`, e.message);
        }
    }
    console.log("Migration done!");
}

migrate().catch(console.error);
