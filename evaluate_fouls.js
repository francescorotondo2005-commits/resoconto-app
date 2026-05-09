const { createClient } = require('@libsql/client');
const { EV_AVANZATO } = require('./lib/engine.js');
const { INDICE_ARBITRO_AVANZATO } = require('./lib/referee.js');

async function run() {
  const client = createClient({ url: 'file:resoconto.db' });
  const result = await client.execute("SELECT * FROM matches ORDER BY date ASC");
  const rows = result.rows;

  let totalAbsoluteError = 0;
  let count = 0;

  for (let i = 50; i < rows.length; i++) {
    const match = rows[i];
    const pastMatches = rows.slice(0, i);

    let predictedHomeFouls = EV_AVANZATO(match.home_team, match.away_team, 'falli', 'casa', pastMatches);
    const refIndex = INDICE_ARBITRO_AVANZATO(match.referee, 'falli', pastMatches);
    predictedHomeFouls *= refIndex; // They multiply EV by the referee index
    
    if (predictedHomeFouls > 0) {
      const actualHomeFouls = Number(match.home_fouls);
      const error = actualHomeFouls - predictedHomeFouls;
      totalAbsoluteError += Math.abs(error);
      count++;
    }
  }

  console.log(`\n--- EV_AVANZATO + REFEREE MULTIPLIER (Home Fouls) ---`);
  console.log(`Mean Absolute Error (MAE): ${(totalAbsoluteError / count).toFixed(3)} falli`);

  let baselineAbsoluteError = 0;
  let baselineCount = 0;
  for (let i = 50; i < rows.length; i++) {
    const match = rows[i];
    const pastMatches = rows.slice(0, i);
    
    const homeTeamPast = pastMatches.filter(m => m.home_team === match.home_team).slice(-5);
    if (homeTeamPast.length > 0) {
      const baselinePred = homeTeamPast.reduce((sum, m) => sum + Number(m.home_fouls), 0) / homeTeamPast.length;
      const actualHomeFouls = Number(match.home_fouls);
      baselineAbsoluteError += Math.abs(actualHomeFouls - baselinePred);
      baselineCount++;
    }
  }

  console.log(`\n--- Naive Baseline (Last 5 home games average) ---`);
  console.log(`Mean Absolute Error (MAE): ${(baselineAbsoluteError / baselineCount).toFixed(3)} falli`);
}

run().catch(console.error);
