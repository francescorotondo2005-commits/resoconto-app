/**
 * API-Football Client con caching
 */

const LEAGUE_IDS = {
  SerieA: 135,
  Premier: 39,
  LaLiga: 140,
  Ligue1: 61,
  Bundes: 78,
};

const LEAGUE_SEASONS = {
  SerieA: 2025,
  Premier: 2025,
  LaLiga: 2025,
  Ligue1: 2025,
  Bundes: 2025,
};

export async function fetchFixtures(league, date, apiKey) {
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    return { error: 'API Key non configurata. Vai in Impostazioni per inserirla.' };
  }

  const leagueId = LEAGUE_IDS[league];
  if (!leagueId) return { error: `Campionato non riconosciuto: ${league}` };

  try {
    const response = await fetch(
      `https://v3.football.api-sports.com/fixtures?league=${leagueId}&season=${LEAGUE_SEASONS[league]}&date=${date}`,
      {
        headers: {
          'x-apisports-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      return { error: `API error: ${response.status}` };
    }

    const data = await response.json();

    if (data.errors && Object.keys(data.errors).length > 0) {
      return { error: JSON.stringify(data.errors) };
    }

    const fixtures = (data.response || []).map(f => ({
      api_fixture_id: f.fixture.id,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      kick_off: f.fixture.date,
      status: f.fixture.status.short,
    }));

    return { fixtures, remaining: response.headers.get('x-ratelimit-requests-remaining') };
  } catch (e) {
    return { error: `Errore connessione: ${e.message}` };
  }
}

export function getLeagueIds() {
  return LEAGUE_IDS;
}

export const LEAGUE_NAMES = {
  SerieA: 'Serie A',
  Premier: 'Premier League',
  LaLiga: 'La Liga',
  Ligue1: 'Ligue 1',
  Bundes: 'Bundesliga',
};
