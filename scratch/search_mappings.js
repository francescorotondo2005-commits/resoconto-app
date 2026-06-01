import fs from 'fs';
import path from 'path';

const files = fs.readdirSync(process.cwd());

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.py')) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('TEAM_MAPPING') || content.includes('normalizeTeam') || content.includes('lipsia') || content.includes('Lipsia')) {
      console.log(`Found in file: ${file}`);
    }
  }
}
process.exit(0);
