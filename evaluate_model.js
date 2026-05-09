const { createClient } = require('@libsql/client');
const { EV_AVANZATO } = require('./lib/engine.js');

async function run() {
  const client = createClient({ url: 'file:resoconto.db' });
  const result = await client.execute("SELECT * FROM matches ORDER BY date ASC");
  const rows = result.rows;

  console.log(`Loaded ${rows.length} matches.`);

  let totalAbsoluteError = 0;
  let totalSquaredError = 0;
  let count = 0;

  // Evaluate EV_AVANZATO
  for (let i = 50; i < rows.length; i++) {
    const match = rows[i];
    const pastMatches = rows.slice(0, i);

    // Predict Home Shots
    const predictedHomeShots = EV_AVANZATO(match.home_team, match.away_team, 'tiri', 'casa', pastMatches);
    
    if (predictedHomeShots > 0) {
      const actualHomeShots = Number(match.home_shots);
      const error = actualHomeShots - predictedHomeShots;
      totalAbsoluteError += Math.abs(error);
      totalSquaredError += error * error;
      count++;
    }
  }

  console.log(`\n--- Evaluation of current EV_AVANZATO model on Home Shots ---`);
  console.log(`Matches Evaluated: ${count}`);
  console.log(`Mean Absolute Error (MAE): ${(totalAbsoluteError / count).toFixed(3)} tiri`);
  console.log(`Root Mean Squared Error (RMSE): ${Math.sqrt(totalSquaredError / count).toFixed(3)} tiri`);

  // Baseline Naive
  let baselineAbsoluteError = 0;
  let baselineSquaredError = 0;
  let baselineCount = 0;
  for (let i = 50; i < rows.length; i++) {
    const match = rows[i];
    const pastMatches = rows.slice(0, i);
    
    const homeTeamPast = pastMatches.filter(m => m.home_team === match.home_team).slice(-5);
    if (homeTeamPast.length > 0) {
      const baselinePred = homeTeamPast.reduce((sum, m) => sum + Number(m.home_shots), 0) / homeTeamPast.length;
      const actualHomeShots = Number(match.home_shots);
      const err = actualHomeShots - baselinePred;
      baselineAbsoluteError += Math.abs(err);
      baselineSquaredError += err * err;
      baselineCount++;
    }
  }

  console.log(`\n--- Evaluation of Naive Baseline (Last 5 home games average) ---`);
  console.log(`Mean Absolute Error (MAE): ${(baselineAbsoluteError / baselineCount).toFixed(3)} tiri`);
  console.log(`Root Mean Squared Error (RMSE): ${Math.sqrt(baselineSquaredError / baselineCount).toFixed(3)} tiri`);
}

run().catch(console.error);
