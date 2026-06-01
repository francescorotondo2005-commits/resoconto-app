import sqlite3
import pandas as pd

def audit_db():
    db_path = r'c:\Users\pierr\OneDrive\Desktop\app\resoconto-app\resoconto.db'
    conn = sqlite3.connect(db_path)
    
    # Ottieni info sulle colonne di matches
    df = pd.read_sql_query("SELECT * FROM matches", conn)
    conn.close()
    
    print(f"Total matches in DB: {len(df)}")
    
    sofa_cols = [
        'home_xg', 'away_xg', 'home_possession', 'away_possession',
        'home_passes', 'away_passes', 'home_crosses', 'away_crosses',
        'home_tackles', 'away_tackles', 'home_interceptions', 'away_interceptions'
    ]
    
    print("\n--- STATISTICHE COLONNE SOFASCORE ---")
    for col in sofa_cols:
        if col in df.columns:
            non_null = df[col].notna().sum()
            null_count = df[col].isna().sum()
            unique_vals = df[col].nunique()
            print(f"  {col:20s} | Non-Null: {non_null:4d} | Null: {null_count:4d} | Unique Values: {unique_vals:4d}")
        else:
            print(f"  {col:20s} | NON ESISTE NEL DB!")

if __name__ == '__main__':
    audit_db()
