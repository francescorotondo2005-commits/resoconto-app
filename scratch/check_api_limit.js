const apiKey = "811db2ed64e4fd123eb1055a5e52e54d";

async function test() {
  const url = 'https://v3.football.api-sports.io/status';
  try {
    console.log(`Checking status from: ${url}`);
    const res = await fetch(url, {
      headers: { 'x-apisports-key': apiKey }
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response:`, text);
  } catch (e) {
    console.error(`Error:`, e.message);
  }
}

test().catch(console.error);
