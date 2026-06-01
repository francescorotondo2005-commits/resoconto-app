import pandas as pd
import numpy as np
import os
import sys
import sqlite3

# Aggiungi la directory del progetto al path per poter importare da ml_train_all
sys.path.append(r'c:\Users\pierr\OneDrive\Desktop\app\resoconto-app')

# Modifichiamo temporaneamente il caricamento dei dati per usare SOLO il DB locale
def load_data_local(db_path=r'c:\Users\pierr\OneDrive\Desktop\app\resoconto-app\resoconto.db'):
    print(f"[DB] Connessione forzata al database locale ({db_path})...")
    conn = sqlite3.connect(db_path, timeout=30)
    df   = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
    conn.close()
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).sort_values('date').reset_index(drop=True)
    return df

import ml_train_all
ml_train_all.load_data = load_data_local

from ml_train_all import feature_engineering

def check_nans():
    df = load_data_local()
    print(f"Caricati {len(df)} match dal DB locale.")
    
    print("Eseguo feature engineering...")
    
    # Eseguiamo feature_engineering originale ma catturiamo prima del fillna(0)
    # Per farlo in modo pulito, leggiamo il codice di feature_engineering ed eseguiamo senza il fillna(0) alla fine.
    # In ml_train_all.py, feature_engineering ha:
    # result = pd.DataFrame(features)
    # ...
    # result = result.fillna(0)
    # weights = ...
    # return result, sample_weights
    
    # Possiamo monkeypatchare fillna di DataFrame temporaneamente durante la chiamata!
    orig_fillna = pd.DataFrame.fillna
    pd.DataFrame.fillna = lambda self, *args, **kwargs: self # Non fa nulla!
    
    try:
        ml_df, weights = feature_engineering(df)
    finally:
        pd.DataFrame.fillna = orig_fillna # Ripristina
        
    # Controlliamo quali colonne hanno NaN
    nan_counts = ml_df.isna().sum()
    nan_cols = nan_counts[nan_counts > 0]
    
    print(f"\n--- RISULTATI ANALISI NAN (su {len(ml_df)} righe) ---")
    if len(nan_cols) == 0:
        print("Nessuna colonna ha valori NaN prima del fillna(0)!")
    else:
        print(f"Trovate {len(nan_cols)} colonne con valori NaN:")
        for col, count in nan_cols.items():
            print(f"  {col}: {count} NaN ({count/len(ml_df)*100:.1f}%)")
            
    # Controlliamo se ci sono colonne interamente a 0 che potrebbero essere "mancanza dati" mascherate
    zero_counts = (ml_df == 0).sum()
    zero_cols = zero_counts[zero_counts > 0]
    print(f"\n--- ANALISI VALORI A 0 ---")
    print(f"Trovate {len(zero_cols)} colonne che contengono zeri.")
    # Mostriamo solo le prime 10 colonne con più zeri
    for col, count in zero_cols.sort_values(ascending=False).head(15).items():
        print(f"  {col}: {count} zeri ({count/len(ml_df)*100:.1f}%)")

if __name__ == '__main__':
    check_nans()
