import sqlite3
import pandas as pd
import numpy as np
import os
import joblib
from sklearn.ensemble import RandomForestRegressor
import warnings
warnings.filterwarnings('ignore')

def get_stat(row, stat_name, is_home):
    if stat_name == 'gol':
        return row['home_goals'] if is_home else row['away_goals']
    elif stat_name == 'tiri':
        return row['home_shots'] if is_home else row['away_shots']
    elif stat_name == 'tip':
        return row['home_sot'] if is_home else row['away_sot']
    elif stat_name == 'falli':
        return row['home_fouls'] if is_home else row['away_fouls']
    elif stat_name == 'corner':
        return row['home_corners'] if is_home else row['away_corners']
    elif stat_name == 'cartellini':
        y = row['home_yellows'] if is_home else row['away_yellows']
        r = row['home_reds'] if is_home else row['away_reds']
        return y + (r * 2)
    elif stat_name == 'parate':
        # Parate = TIP subiti - Gol subiti
        tip_sub = row['away_sot'] if is_home else row['home_sot']
        gol_sub = row['away_goals'] if is_home else row['home_goals']
        return max(0, tip_sub - gol_sub)
    return 0

STATS = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate']

def load_data(db_path):
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
    conn.close()
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).sort_values('date').reset_index(drop=True)
    return df

def feature_engineering(df):
    print("Creazione delle feature storiche...")
    features = []
    
    # Store histories: team -> stat_name -> 'for' or 'against' -> list
    team_history = {}
    referee_history = {}
    
    for idx, row in df.iterrows():
        home = row['home_team']
        away = row['away_team']
        ref = row['referee']
        
        if home not in team_history:
            team_history[home] = {s: {'for': [], 'against': []} for s in STATS}
        if away not in team_history:
            team_history[away] = {s: {'for': [], 'against': []} for s in STATS}
        if ref not in referee_history:
            referee_history[ref] = {s: [] for s in STATS}
            
        def get_avg(history_list, n=5):
            if len(history_list) == 0:
                return -1
            return np.mean(history_list[-n:])
        
        row_features = {
            'date': row['date'],
            'home_team': home,
            'away_team': away,
            'referee': ref
        }
        
        valid = True
        
        for stat in STATS:
            home_for_avg = get_avg(team_history[home][stat]['for'])
            home_ag_avg = get_avg(team_history[home][stat]['against'])
            away_for_avg = get_avg(team_history[away][stat]['for'])
            away_ag_avg = get_avg(team_history[away][stat]['against'])
            ref_avg = get_avg(referee_history[ref][stat], n=10)
            
            if home_for_avg == -1 or away_for_avg == -1:
                valid = False
                break
                
            row_features[f'f_home_{stat}_for'] = home_for_avg
            row_features[f'f_home_{stat}_ag'] = home_ag_avg
            row_features[f'f_away_{stat}_for'] = away_for_avg
            row_features[f'f_away_{stat}_ag'] = away_ag_avg
            row_features[f'f_ref_{stat}'] = ref_avg if ref_avg != -1 else get_avg([np.mean(team_history[home][stat]['for']), np.mean(team_history[away][stat]['for'])])
            
            # Targets
            row_features[f'target_{stat}_casa'] = get_stat(row, stat, True)
            row_features[f'target_{stat}_ospite'] = get_stat(row, stat, False)
            
        if valid:
            features.append(row_features)
            
        # Update history
        for stat in STATS:
            h_stat = get_stat(row, stat, True)
            a_stat = get_stat(row, stat, False)
            
            team_history[home][stat]['for'].append(h_stat)
            team_history[home][stat]['against'].append(a_stat)
            
            team_history[away][stat]['for'].append(a_stat)
            team_history[away][stat]['against'].append(h_stat)
            
            referee_history[ref][stat].append(h_stat + a_stat)
            
    return pd.DataFrame(features)

def train_and_save_models():
    df = load_data('resoconto.db')
    ml_df = feature_engineering(df)
    
    os.makedirs('models', exist_ok=True)
    
    print(f"Allenamento modelli su {len(ml_df)} partite valide...")
    
    # Train 2 models (Casa e Ospite) per each of the 7 stats
    for stat in STATS:
        # Features definition
        feature_cols = [
            f'f_home_{stat}_for', f'f_home_{stat}_ag',
            f'f_away_{stat}_for', f'f_away_{stat}_ag'
        ]
        if stat in ['falli', 'cartellini']:
            feature_cols.append(f'f_ref_{stat}')
            
        # Modello CASA
        X = ml_df[feature_cols]
        # Sostituisci eventuali NaN con 0
        X = X.fillna(0)
        y_casa = ml_df[f'target_{stat}_casa']
        model_casa = RandomForestRegressor(n_estimators=100, max_depth=5, random_state=42)
        model_casa.fit(X, y_casa)
        joblib.dump(model_casa, f'models/rf_{stat}_casa.joblib')
        
        # Modello OSPITE
        y_ospite = ml_df[f'target_{stat}_ospite']
        model_ospite = RandomForestRegressor(n_estimators=100, max_depth=5, random_state=42)
        model_ospite.fit(X, y_ospite)
        joblib.dump(model_ospite, f'models/rf_{stat}_ospite.joblib')
        
        print(f"Salvato modello per {stat.upper()}")
        
    print("Tutti i modelli sono stati salvati nella cartella 'models/'.")

if __name__ == "__main__":
    train_and_save_models()
