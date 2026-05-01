const fs = require('fs');
const html = fs.readFileSync('staryes_true_dom.html', 'utf8');
const regex = /<div class="match">[\s\S]*?(?=<div class="match">|$)/gi;
let match;
while ((match = regex.exec(html)) !== null) {
   if(match[0].toLowerCase().includes('brentford')) {
      console.log('--- FOUND MATCH BLOCK ---');
      const lines = match[0].replace(/<div/g, '\n<div').split('\n');
      for (let l of lines) console.log(l);
      break;
   }
}
