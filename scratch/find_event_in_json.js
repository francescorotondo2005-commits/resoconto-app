import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/ejea_next_data.json', 'utf-8'));

console.log("Searching for SD Ejea or Hércules in JSON...");

function searchObj(obj, query, path = '') {
  if (!obj) return;
  if (typeof obj === 'string') {
    if (obj.toLowerCase().includes(query.toLowerCase())) {
      console.log(`Match string found at "${path}": "${obj}"`);
    }
    return;
  }
  if (typeof obj === 'object') {
    // Let's check if it's an object with an ID that could be the event
    if (obj.id && (obj.nameCode === 'ejea' || obj.nameCode === 'hercules' || obj.slug === 'sd-ejea' || obj.slug === 'hercules-cf')) {
      console.log(`Found Team Object at "${path}": ID ${obj.id}, Name: "${obj.name}"`);
    }
    
    for (const [k, v] of Object.entries(obj)) {
      searchObj(v, query, path ? `${path}.${k}` : k);
    }
  }
}

searchObj(data, "Ejea");
searchObj(data, "Hércules");
