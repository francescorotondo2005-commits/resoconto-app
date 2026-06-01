"""
Script che:
1. Rimuove le righe duplicate dei campionati su Turso
   (quelle con home_shots=0 inserite dal backfill — le originali hanno home_xg popolato)
2. Popola il DB locale (resoconto.db) con le partite delle coppe 2024-25
   usando direttamente l'API football-api-sports
"""

import sqlite3
import urllib.request
import json
import time
import os

# ── Configurazione ───────────────────────────────────────────────
API_KEY = "811db2ed64e4fd123eb1055a5e52e54d"
LOCAL_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resoconto.db')

# Solo le COPPE per il backfill locale (i campionati esistono già)
CUP_LEAGUES = {
    'ChampionsLeague': {'id': 2,   'season': 2024, 'type': 'cup_european'},
    'EuropaLeague':    {'id': 3,   'season': 2024, 'type': 'cup_european'},
    'ConferenceLeague':{'id': 848, 'season': 2024, 'type': 'cup_european'},
    'CoppaItalia':     {'id': 137, 'season': 2024, 'type': 'cup_national'},
    'FACup':           {'id': 45,  'season': 2024, 'type': 'cup_national'},
    'CopaDelRey':      {'id': 143, 'season': 2024, 'type': 'cup_national'},
    'CoupeDeFrance':   {'id': 66,  'season': 2024, 'type': 'cup_national'},
    'DFBPokal':        {'id': 81,  'season': 2024, 'type': 'cup_national'},
    'EFLCup':          {'id': 48,  'season': 2024, 'type': 'cup_national'},
}

# Mapping nomi squadre API -> nomi DB
TEAM_MAP = {
    'AC Milan': 'Milan', 'AS Roma': 'Roma', 'Inter Milan': 'Inter',
    'Juventus FC': 'Juventus', 'SSC Napoli': 'Napoli', 'Lazio Roma': 'Lazio',
    'ACF Fiorentina': 'Fiorentina', 'Bologna FC 1909': 'Bologna',
    'FC Torino': 'Torino', 'Genoa CFC': 'Genoa', 'US Lecce': 'Lecce',
    'Udinese Calcio': 'Udinese', 'Cagliari Calcio': 'Cagliari',
    'Hellas Verona': 'Verona', 'AC Monza': 'Monza', 'Atalanta BC': 'Atalanta',
    'Venezia FC': 'Venezia', 'Parma Calcio 1913': 'Parma', 'Como 1907': 'Como',
    'Empoli FC': 'Empoli',
    'Manchester City FC': 'Manchester City', 'Arsenal FC': 'Arsenal',
    'Liverpool FC': 'Liverpool', 'Aston Villa FC': 'Aston Villa',
    'Tottenham Hotspur FC': 'Tottenham', 'Chelsea FC': 'Chelsea',
    'Manchester United FC': 'Manchester United', 'Newcastle United FC': 'Newcastle',
    'West Ham United FC': 'West Ham', 'Brighton & Hove Albion FC': 'Brighton',
    'Crystal Palace FC': 'Crystal Palace', 'Wolverhampton Wanderers FC': 'Wolves',
    'Fulham FC': 'Fulham', 'Everton FC': 'Everton', 'Brentford FC': 'Brentford',
    'Nottingham Forest FC': 'Forest', 'Ipswich Town FC': 'Ipswich',
    'Leicester City FC': 'Leicester', 'Southampton FC': 'Southampton',
    'Bournemouth FC': 'Bournemouth',
    'Real Madrid CF': 'Real Madrid', 'FC Barcelona': 'Barcellona',
    'Atletico Madrid': 'Ath Madrid', 'Athletic Club': 'Ath Bilbao',
    'Real Sociedad de Futbol': 'Sociedad', 'Real Betis Balompie': 'Betis',
    'Villarreal CF': 'Villarreal', 'Valencia CF': 'Valencia',
    'Deportivo Alaves': 'Alaves', 'CA Osasuna': 'Osasuna',
    'Getafe CF': 'Getafe', 'RC Celta de Vigo': 'Celta',
    'Sevilla FC': 'Siviglia', 'RCD Mallorca': 'Maiorca',
    'UD Las Palmas': 'Las Palmas', 'Rayo Vallecano de Madrid': 'Vallecano',
    'RCD Espanyol Barcelona': 'Espanol', 'Real Valladolid CF': 'Valladolid',
    'CD Leganes': 'Leganes', 'Girona FC': 'Girona',
    'Bayer 04 Leverkusen': 'Leverkusen', 'FC Bayern München': 'Bayern',
    'VfB Stuttgart 1893': 'Stuttgart', 'Borussia Dortmund': 'Dortmund',
    'RB Leipzig': 'Lipsia', 'Eintracht Frankfurt': 'Ein Frankfurt',
    'TSG Hoffenheim': 'Hoffenheim', 'SC Freiburg': 'Friburgo',
    '1. FC Heidenheim 1846': 'Heidenheim', 'SV Werder Bremen': 'Werder',
    'FC Augsburg': 'Augsburg', 'VfL Wolfsburg': 'Wolfsburg',
    '1. FSV Mainz 05': 'Mainz', "Borussia Mönchengladbach": "M'gladbach",
    '1. FC Union Berlin': 'Union Berlin', 'VfL Bochum 1848': 'Bochum',
    '1. FC Köln': 'FC Koln', 'FC St. Pauli 1910': 'St Pauli',
    'Holstein Kiel': 'Holstein Kiel',
    'Paris Saint-Germain FC': 'PSG', 'AS Monaco FC': 'Monaco',
    'Stade Brestois 29': 'Brest', 'Lille OSC': 'Lilla',
    "OGC Nice Côte d'Azur": 'Nice', 'Racing Club de Lens': 'Lens',
    'Olympique de Marseille': 'Marseille', 'Stade de Reims': 'Reims',
    'Stade Rennais FC 1901': 'Rennes', 'Toulouse FC': 'Toulouse',
    'Olympique Lyonnais': 'Lyon', 'FC Nantes': 'Nantes',
    'RC Strasbourg Alsace': 'Strasbourg', 'Le Havre AC': 'Le Havre',
    'AS Saint-Étienne': 'Saint Etienne', 'Angers SCO': 'Angers',
    'AJ Auxerre': 'Auxerre', 'Montpellier Hérault SC': 'Montpellier',
}

def normalize(name):
    """Normalizza nome squadra per confronto fuzzy."""
    if not name: return ""
    return name.lower().strip() \
        .replace('fc ', '').replace(' fc', '') \
        .replace('ac ', '').replace(' ac', '') \
        .replace('as ', '').replace('ss ', '') \
        .replace('münchen', 'munich') \
        .replace('mönchengladbach', 'gladbach')

def similarity(s1, s2):
    s1, s2 = s1.lower(), s2.lower()
    if s1 == s2: return 1.0
    if s1 in s2 or s2 in s1: return 0.85
    # Levenshtein semplificato
    longer, shorter = (s1, s2) if len(s1) >= len(s2) else (s2, s1)
    if not longer: return 1.0
    costs = list(range(len(shorter) + 1))
    for i, c1 in enumerate(longer):
        prev = costs[:]
        costs[0] = i + 1
        for j, c2 in enumerate(shorter):
            costs[j+1] = min(prev[j] + (0 if c1==c2 else 1),
                             costs[j] + 1, prev[j+1] + 1)
    return (len(longer) - costs[len(shorter)]) / len(longer)

def map_team(api_name, db_teams):
    if api_name in TEAM_MAP:
        return TEAM_MAP[api_name]
    norm_api = normalize(api_name)
    best, best_sim = api_name, 0.0
    for t in db_teams:
        s = similarity(norm_api, normalize(t))
        if s > best_sim:
            best_sim, best = s, t
    if best_sim > 0.75:
        return best
    # Pulizia base
    return api_name.replace(' FC','').replace(' CF','').strip()

def fetch_api(url):
    req = urllib.request.Request(url, headers={'x-apisports-key': API_KEY})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  [ERR] {e}")
        return None


# ════════════════════════════════════════════════════════════════
# STEP 1 — Rimozione duplicati campionati da Turso
# ════════════════════════════════════════════════════════════════
def cleanup_turso_duplicates():
    print("\n" + "="*60)
    print(" STEP 1: Pulizia duplicati campionati su Turso")
    print("="*60)

    env = {}
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.local')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    env[k.strip()] = v.strip().strip('"')

    turso_url = env.get('TURSO_DATABASE_URL')
    turso_token = env.get('TURSO_AUTH_TOKEN')

    if not turso_url or not turso_token:
        print("  [SKIP] Turso non configurato, salto pulizia cloud.")
        return

    try:
        import libsql_client as libsql
        client = libsql.create_client_sync(turso_url, auth_token=turso_token)

        # Conta totale prima
        res = client.execute("SELECT COUNT(*) FROM matches")
        before = res.rows[0][0]
        print(f"  Partite in Turso prima: {before}")

        # Rimuovi duplicati: campionati con home_shots=0 (inseriti dal backfill)
        # I campionati originali hanno home_shots > 0 o home_xg NOT NULL
        leagues = ('SerieA', 'Premier', 'LaLiga', 'Ligue1', 'Bundes')
        total_deleted = 0
        for lg in leagues:
            # Trova i duplicati: stesso (date, home_team, away_team), tieni quello con home_xg NOT NULL
            # Cancella quelli con home_shots=0 e home_xg IS NULL
            res = client.execute(
                f"DELETE FROM matches WHERE league = '{lg}' AND home_shots = 0 AND home_xg IS NULL AND competition_type = 'league'"
            )
            deleted = res.rows_affected if hasattr(res, 'rows_affected') else 0
            print(f"  {lg}: {deleted} duplicati rimossi")
            total_deleted += deleted

        res = client.execute("SELECT COUNT(*) FROM matches")
        after = res.rows[0][0]
        print(f"\n  Partite in Turso dopo: {after} (rimossi {before - after} duplicati)")
        client.close()
    except Exception as e:
        print(f"  [ERR] Errore pulizia Turso: {e}")
        print("  Continuazione con il backfill locale...")


# ════════════════════════════════════════════════════════════════
# STEP 2 — Backfill coppe nel DB locale
# ════════════════════════════════════════════════════════════════
def backfill_cups_local():
    print("\n" + "="*60)
    print(" STEP 2: Backfill coppe nel DB locale")
    print("="*60)

    conn = sqlite3.connect(LOCAL_DB)
    c = conn.cursor()

    # Carica i team già presenti (per il fuzzy matching)
    c.execute("SELECT DISTINCT home_team FROM matches UNION SELECT DISTINCT away_team FROM matches")
    db_teams = [r[0] for r in c.fetchall()]
    print(f"  Team nel DB locale: {len(db_teams)}")

    total_inserted = 0

    for league_name, cfg in CUP_LEAGUES.items():
        url = f"https://v3.football.api-sports.io/fixtures?league={cfg['id']}&season={cfg['season']}"
        print(f"\n  Fetching {league_name} (id={cfg['id']}, season={cfg['season']})...")

        data = fetch_api(url)
        if not data:
            print(f"  [SKIP] Nessun dato ricevuto")
            continue

        if data.get('errors') and data['errors']:
            print(f"  [SKIP] Errore API: {data['errors']}")
            continue

        fixtures = data.get('response', [])
        finished = [f for f in fixtures
                    if f['fixture']['status']['short'] in ('FT', 'AET', 'PEN')]
        print(f"  Trovate {len(finished)} partite finite su {len(fixtures)} totali")

        inserted = 0
        for f in finished:
            date = f['fixture']['date'].split('T')[0]
            home_raw = f['teams']['home']['name']
            away_raw = f['teams']['away']['name']
            home = map_team(home_raw, db_teams)
            away = map_team(away_raw, db_teams)
            home_goals = f['goals']['home'] or 0
            away_goals = f['goals']['away'] or 0
            ref_raw = f['fixture'].get('referee') or ''
            referee = ref_raw.split(',')[0].replace('.', '').strip() if ref_raw else None

            # Controlla se già presente (stessa data + squadre)
            c.execute(
                "SELECT id FROM matches WHERE date=? AND home_team=? AND away_team=?",
                (date, home, away)
            )
            if c.fetchone():
                continue  # già presente, skip

            c.execute("""
                INSERT INTO matches (
                    league, date, home_team, away_team,
                    home_goals, away_goals,
                    home_shots, away_shots, home_sot, away_sot,
                    home_fouls, away_fouls, home_corners, away_corners,
                    home_yellows, away_yellows, home_reds, away_reds,
                    referee, competition_type
                ) VALUES (?,?,?,?,?,?,0,0,0,0,0,0,0,0,0,0,0,0,?,?)
            """, (league_name, date, home, away, home_goals, away_goals,
                  referee, cfg['type']))
            inserted += 1

        conn.commit()
        print(f"  [OK] Inserite {inserted} nuove partite di {league_name}")
        total_inserted += inserted

        # Pausa per non superare il rate limit API
        time.sleep(1.5)

    conn.close()
    print(f"\n  TOTALE nuove partite inserite nel DB locale: {total_inserted}")


# ════════════════════════════════════════════════════════════════
# STEP 3 — Riepilogo DB locale
# ════════════════════════════════════════════════════════════════
def print_summary():
    print("\n" + "="*60)
    print(" RIEPILOGO FINALE DB LOCALE")
    print("="*60)
    conn = sqlite3.connect(LOCAL_DB)
    c = conn.cursor()
    c.execute("SELECT competition_type, COUNT(*) FROM matches GROUP BY competition_type")
    rows = c.fetchall()
    total = 0
    for r in rows:
        print(f"  [{r[0]}]: {r[1]} partite")
        total += r[1]
    print(f"\n  TOTALE: {total} partite")
    c.execute("SELECT COUNT(*) FROM matches WHERE home_xg IS NULL")
    missing_sofa = c.fetchone()[0]
    print(f"  Partite senza statistiche SofaScore: {missing_sofa}")
    conn.close()


if __name__ == '__main__':
    # cleanup_turso_duplicates()  # GIA' ESEGUITO - Turso ora ha 6480 partite
    backfill_cups_local()
    print_summary()
    print("\n[DONE] COMPLETATO! Prossimo step: node lib/collect_sofascore.js --backfill")
