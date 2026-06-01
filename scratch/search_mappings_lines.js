import fs from 'fs';

const files = ['do_backfill_matches.js', 'cleanup_and_backfill_local.py'];

for (const file of files) {
  console.log(`\n=== File: ${file} ===`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes('TEAM_MAPPING') || line.includes('normalizeTeam') || line.includes('matchTeam') || line.includes('lipsia') || line.includes('Lipsia')) {
      console.log(`${index + 1}: ${line.trim()}`);
    }
  });
}
process.exit(0);
