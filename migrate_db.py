import sqlite3
import os
import libsql_client as libsql

def migrate_db():
    env = {}
    if os.path.exists('.env.local'):
        with open('.env.local', 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    env[k] = v.strip().strip('"')

    url = env.get('TURSO_DATABASE_URL')
    token = env.get('TURSO_AUTH_TOKEN')

    columns_to_add = [
        "home_passes REAL", "away_passes REAL",
        "home_crosses REAL", "away_crosses REAL",
        "home_tackles REAL", "away_tackles REAL",
        "home_interceptions REAL", "away_interceptions REAL",
        "competition_type TEXT"
    ]

    queries = []
    for col in columns_to_add:
        queries.append(f"ALTER TABLE matches ADD COLUMN {col};")

    # 1. Migrazione DB locale (Sempre eseguita!)
    print("[DB] Connessione al DB locale (resoconto.db)...")
    db_path = 'resoconto.db'
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path, timeout=30)
        cur = conn.cursor()
        for q in queries:
            try:
                cur.execute(q)
                print(f"  [Locale] Eseguito: {q}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e).lower():
                    pass
                else:
                    print(f"  [Locale] Errore su {q}: {e}")
        conn.commit()
        conn.close()
    else:
        print(f"[DB] Avviso: file {db_path} non trovato in locale.")

    # 2. Migrazione Turso (Se configurato)
    if url and token:
        print("[DB] Connessione a Turso in corso per la migrazione...")
        client = libsql.create_client_sync(url, auth_token=token)
        for q in queries:
            try:
                client.execute(q)
                print(f"  [Turso] Eseguito: {q}")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    pass
                else:
                    print(f"  [Turso] Errore su {q}: {e}")
        client.close()
    else:
        print("[DB] Turso non configurato o credenziali mancanti in .env.local.")
        
    print("Migrazione completata con successo su tutti i database attivi!")

if __name__ == '__main__':
    migrate_db()

