import sqlite3
import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

def load_data(db_path):
    print("Connessione al database...")
    conn = sqlite3.connect(db_path)
    # Carichiamo tutte le partite ordinate per data
    query = "SELECT * FROM matches ORDER BY date ASC"
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    # Pulizia e conversione date
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).sort_values('date').reset_index(drop=True)
    return df

def feature_engineering(df):
    print("Creazione delle feature (Feature Engineering)...")
    # Creiamo un dataframe vuoto per raccogliere le righe arricchite
    features = []
    
    # Dizionari per tenere traccia dello storico in modo incrementale (senza data leakage)
    team_history = {}
    referee_history = {}
    
    # Per semplificare, in questo esempio cercheremo di prevedere 'home_shots' (tiri in casa)
    # Potrai poi estenderlo a qualsiasi altra statistica.
    
    for idx, row in df.iterrows():
        home = row['home_team']
        away = row['away_team']
        ref = row['referee']
        
        # Inizializza se non esiste
        if home not in team_history:
            team_history[home] = {'shots_for': [], 'shots_against': [], 'fouls_for': []}
        if away not in team_history:
            team_history[away] = {'shots_for': [], 'shots_against': [], 'fouls_for': []}
        if ref not in referee_history:
            referee_history[ref] = {'fouls_given': []}
            
        # Calcoliamo le medie sulle ultime 5 partite (escludendo l'attuale)
        def get_avg(history_list, n=5):
            if len(history_list) == 0:
                return -1 # Valore mancante
            return np.mean(history_list[-n:])
        
        home_shots_for_avg = get_avg(team_history[home]['shots_for'])
        home_shots_ag_avg = get_avg(team_history[home]['shots_against'])
        
        away_shots_for_avg = get_avg(team_history[away]['shots_for'])
        away_shots_ag_avg = get_avg(team_history[away]['shots_against'])
        
        ref_fouls_avg = get_avg(referee_history[ref]['fouls_given'], n=10)
        
        # Saltiamo le prime partite dove non abbiamo storico (es. prime 5 giornate)
        if home_shots_for_avg != -1 and away_shots_for_avg != -1:
            features.append({
                'date': row['date'],
                'home_team': home,
                'away_team': away,
                
                # Le nostre feature predittive
                'f_home_shots_for': home_shots_for_avg,
                'f_home_shots_ag': home_shots_ag_avg,
                'f_away_shots_for': away_shots_for_avg,
                'f_away_shots_ag': away_shots_ag_avg,
                'f_ref_fouls': ref_fouls_avg if ref_fouls_avg != -1 else 25.0, # media di fallback
                
                # I target (ciò che vogliamo prevedere)
                'target_home_shots': row['home_shots'],
                'target_home_fouls': row['home_fouls']
            })
            
        # AGGIORNIAMO LO STORICO DOPO AVER CREATO LE FEATURE (Cruciale per evitare Data Leakage)
        team_history[home]['shots_for'].append(row['home_shots'])
        team_history[home]['shots_against'].append(row['away_shots'])
        team_history[home]['fouls_for'].append(row['home_fouls'])
        
        team_history[away]['shots_for'].append(row['away_shots'])
        team_history[away]['shots_against'].append(row['home_shots'])
        team_history[away]['fouls_for'].append(row['away_fouls'])
        
        referee_history[ref]['fouls_given'].append(row['home_fouls'] + row['away_fouls'])
        
    return pd.DataFrame(features)

def train_and_evaluate():
    df = load_data('resoconto.db')
    ml_df = feature_engineering(df)
    
    print(f"\nDataset finale per ML: {len(ml_df)} partite con storico valido.")
    
    # Feature X e Target y
    feature_cols = ['f_home_shots_for', 'f_home_shots_ag', 'f_away_shots_for', 'f_away_shots_ag']
    X = ml_df[feature_cols]
    y = ml_df['target_home_shots'] # Alleniamo per prevedere i tiri in porta in casa
    
    # Split Temporale (Niente dati futuri nel passato)
    # Prendiamo i primi 75% per allenamento, ultimi 25% per test
    split_index = int(len(ml_df) * 0.75)
    
    X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
    y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]
    
    print(f"\nAddestramento del Modello (Random Forest) su {len(X_train)} partite storiche...")
    print(f"Validazione (Test) del modello su {len(X_test)} partite recenti nascoste...")
    
    # Inizializziamo il modello
    model = RandomForestRegressor(n_estimators=100, max_depth=5, random_state=42)
    model.fit(X_train, y_train)
    
    # Facciamo le previsioni sul test set nascosto
    predictions = model.predict(X_test)
    
    # Valutiamo
    mae = mean_absolute_error(y_test, predictions)
    rmse = np.sqrt(mean_squared_error(y_test, predictions))
    
    print("\n" + "="*50)
    print("RISULTATI DEL MODELLO MACHINE LEARNING SUL TEST SET:")
    print("="*50)
    print(f"Target Predetto: Tiri Squadra in Casa")
    print(f"Mean Absolute Error (MAE): {mae:.3f} tiri")
    print(f"Root Mean Squared Error (RMSE): {rmse:.3f} tiri")
    print("="*50)
    
    print("\nConfronto con la Media Base calcolata prima (circa 4.3 MAE e 5.4 RMSE)")
    print("Se i numeri qui sopra sono inferiori, il Machine Learning ha ufficialmente battuto la media banale e l'algoritmo attuale!")
    
    # Feature Importance
    importances = model.feature_importances_
    print("\nImportanza delle variabili (Cosa guarda di più il modello?):")
    for col, imp in zip(feature_cols, importances):
        print(f" - {col}: {imp:.1%}")

if __name__ == "__main__":
    train_and_evaluate()
