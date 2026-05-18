import https from 'https';

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            agent: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.sofascore.com/',
                'Origin': 'https://www.sofascore.com'
            }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', e => resolve(null));
    });
}

async function run() {
    const data = await fetchJson('https://api.sofascore.com/api/v1/sport/football/scheduled-events/2025-08-24');
    for (const e of data.events) {
        if (e.tournament.name === 'Bundesliga') {
            console.log(`${e.homeTeam.name} vs ${e.awayTeam.name}`);
        }
    }
}
run();
