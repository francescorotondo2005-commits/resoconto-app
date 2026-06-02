import fs from 'fs';
import path from 'path';

const searchDir = process.cwd();
const word = 'angers';

function searchFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.toLowerCase().includes(word)) {
      const lines = content.split('\n');
      console.log(`\nFound in: ${filePath}`);
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(word)) {
          console.log(`  L${idx + 1}: ${line.trim()}`);
        }
      });
    }
  } catch (err) {
    // ignore binary or unreadable files
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.next' || file === '.git') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.py') || file.endsWith('.json'))) {
      searchFile(fullPath);
    }
  }
}

console.log(`Searching for the word "${word}" in JS/MJS/Python/JSON files...`);
walkDir(searchDir);
console.log('Search complete.');
