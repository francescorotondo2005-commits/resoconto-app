import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
const envStr = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envStr.split('\n')) {
    if (line.includes('=')) {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/"/g, '').replace(/\r/g, '');
    }
}

const turso = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN
});

async function fix() {
    console.log("Correzione Hamburg vs Freiburg (ID 1649)...");
    await turso.execute("UPDATE matches SET home_team = 'Amburgo', away_team = 'Friburgo' WHERE id = 1649");
    console.log("Fatto!");
}

fix().catch(console.error);
