import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/ejea_next_data.json', 'utf-8'));

console.log("Searching for numerical IDs in the 12,000,000 to 13,500,000 range...");

const found = [];

function searchObj(obj, path = '') {
  if (!obj) return;
  if (typeof obj === 'number') {
    if (obj >= 12000000 && obj <= 13500000) {
      console.log(`Candidate number found at "${path}": ${obj}`);
      found.push({ path, value: obj });
    }
    return;
  }
  if (typeof obj === 'string') {
    // Also check if string is a number in that range
    const num = parseInt(obj);
    if (!isNaN(num) && num >= 12000000 && num <= 13500000) {
      console.log(`Candidate numeric string found at "${path}": "${obj}"`);
      found.push({ path, value: num });
    }
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      searchObj(v, path ? `${path}.${k}` : k);
    }
  }
}

searchObj(data);

console.log(`\nFound ${found.length} candidates.`);
