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
        "home_interceptions REAL", "away_interceptions REAL"
    ]

    queries = []
    for col in columns_to_add:
        col_name = col.split()[0]
        # For Turso/SQLite, we just try to ALTER TABLE and catch the error if it exists
        queries.append(f"ALTER TABLE matches ADD COLUMN {col};")

    if url and token:
        print("[DB] Connessione a Turso in corso...")
        client = libsql.create_client_sync(url, auth_token=token)
        for q in queries:
            try:
                client.execute(q)
                print(f"Eseguito: {q}")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print(f"Colonna già esistente (skippo): {q}")
                else:
                    print(f"Errore su {q}: {e}")
        client.close()
    else:
        print("[DB] Connessione al DB locale...")
        conn = sqlite3.connect('resoconto.db', timeout=30)
        cur = conn.cursor()
        for q in queries:
            try:
                cur.execute(q)
                print(f"Eseguito: {q}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e).lower():
                    print(f"Colonna già esistente (skippo): {q}")
                else:
                    print(f"Errore su {q}: {e}")
        conn.commit()
        conn.close()
        
    print("Migrazione completata!")

if __name__ == '__main__':
    migrate_db()
