/**
 * API-Football Client con caching
 */

const LEAGUE_IDS = {
  SerieA: 135,
  Premier: 39,
  LaLiga: 140,
  Ligue1: 61,
  Bundes: 78,
  ChampionsLeague: 2,
  EuropaLeague: 3,
  ConferenceLeague: 848,
  CoppaItalia: 137,
  FACup: 45,
  CopaDelRey: 143,
  CoupeDeFrance: 66,
  DFBPokal: 81,
  EFLCup: 48,
};

const LEAGUE_SEASONS = {
  SerieA: 2025,
  Premier: 2025,
  LaLiga: 2025,
  Ligue1: 2025,
  Bundes: 2025,
  ChampionsLeague: 2025,
  EuropaLeague: 2025,
  ConferenceLeague: 2025,
  CoppaItalia: 2025,
  FACup: 2025,
  CopaDelRey: 2025,
  CoupeDeFrance: 2025,
  DFBPokal: 2025,
  EFLCup: 2025,
};

export async function fetchFixtures(league, date, apiKey) {
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    return { error: 'API Key non configurata. Vai in Impostazioni per inserirla.' };
  }

  const leagueId = LEAGUE_IDS[league];
  if (!leagueId) return { error: `Campionato non riconosciuto: ${league}` };

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${LEAGUE_SEASONS[league]}&date=${date}`,
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

    const TEAM_MAP = {
      'Hamburg': 'Amburgo',
      'Freiburg': 'Friburgo'
    };

    const fixtures = (data.response || []).map(f => ({
      api_fixture_id: f.fixture.id,
      home_team: TEAM_MAP[f.teams.home.name] || f.teams.home.name,
      away_team: TEAM_MAP[f.teams.away.name] || f.teams.away.name,
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
  ChampionsLeague: 'Champions League',
  EuropaLeague: 'Europa League',
  ConferenceLeague: 'Conference League',
  CoppaItalia: 'Coppa Italia',
  FACup: 'FA Cup',
  CopaDelRey: 'Copa del Rey',
  CoupeDeFrance: 'Coupe de France',
  DFBPokal: 'DFB Pokal',
  EFLCup: 'EFL Cup',
};
