const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'https://resoconto-db-francescorotondo2005-commits.aws-eu-west-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUwNTUxMjQsImlkIjoiMDE5ZDQ5ODMtOTcwMS03OWM0LTk2OTQtMWVhYmE2OGFkNzZmIiwicmlkIjoiMmIxZjkwNmMtNDM0MS00OTliLWFmZTktZDhkMTk4OTI5MjM1In0.GDyi7O2eN20V0HBGMhWqckt_aWDmdP_Qbsb2rkwi-X2l3_bwXTFUy9gI9OGUjLs799SnTq0S4IaH_Rg3lR3TDg'
});

async function main() {
  console.log("Updating matches table: Hamburg -> Amburgo");
  await client.execute("UPDATE matches SET home_team = 'Amburgo' WHERE home_team = 'Hamburg'");
  await client.execute("UPDATE matches SET away_team = 'Amburgo' WHERE away_team = 'Hamburg'");
  await client.execute("UPDATE match_odds SET match_key = REPLACE(match_key, 'Hamburg', 'Amburgo')");

  console.log("Updating matches table: Freiburg -> Friburgo");
  await client.execute("UPDATE matches SET home_team = 'Friburgo' WHERE home_team = 'Freiburg'");
  await client.execute("UPDATE matches SET away_team = 'Friburgo' WHERE away_team = 'Freiburg'");
  await client.execute("UPDATE match_odds SET match_key = REPLACE(match_key, 'Freiburg', 'Friburgo')");

  console.log("Updates completed.");
}

main().catch(console.error);
