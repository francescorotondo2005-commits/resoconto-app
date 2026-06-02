import fs from 'fs';

const html = fs.readFileSync('scratch/ejea_page.html', 'utf-8');

console.log("Searching for event ID clues in HTML...");

// Search for any 8-digit numbers in the HTML
const numbers = html.match(/\b12\d{6}\b/g) || html.match(/\b13\d{6}\b/g);
if (numbers) {
  const unique = Array.from(new Set(numbers));
  console.log(`Found ${unique.length} unique 8-digit numbers starting with 12 or 13:`);
  console.log(unique);
} else {
  console.log("No 8-digit numbers found starting with 12 or 13.");
}

// Let's also look for strings like "event/" or "statistics" or "id"
const lines = html.split('\n');
let count = 0;
lines.forEach((line, index) => {
  if (line.includes('statistics') || line.includes('/event/') || line.includes('eventId')) {
    if (count < 20) {
      console.log(`Line ${index + 1}: ${line.trim().slice(0, 150)}`);
      count++;
    }
  }
});
