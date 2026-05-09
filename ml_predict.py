import sqlite3
import pandas as pd
import numpy as np
import joblib
import argparse
import json
import warnings
import sys
warnings.filterwarnings('ignore')

STATS = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate']

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
        tip_sub = row['away_sot'] if is_home else row['home_sot']
        gol_sub = row['away_goals'] if is_home else row['home_goals']
        return max(0, tip_sub - gol_sub)
    return 0

def predict_match(home, away, ref):
    # Load recent data
    conn = sqlite3.connect('resoconto.db')
    query = "SELECT * FROM matches ORDER BY date ASC"
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    # Pre-calculate rolling averages for home, away, ref
    home_history = {s: {'for': [], 'against': []} for s in STATS}
    away_history = {s: {'for': [], 'against': []} for s in STATS}
    ref_history = {s: [] for s in STATS}
    
    for idx, row in df.iterrows():
        h = row['home_team']
        a = row['away_team']
        r = row['referee']
        
        for stat in STATS:
            h_stat = get_stat(row, stat, True)
            a_stat = get_stat(row, stat, False)
            
            if h == home:
                home_history[stat]['for'].append(h_stat)
                home_history[stat]['against'].append(a_stat)
            elif a == home:
                home_history[stat]['for'].append(a_stat)
                home_history[stat]['against'].append(h_stat)
                
            if h == away:
                away_history[stat]['for'].append(h_stat)
                away_history[stat]['against'].append(a_stat)
            elif a == away:
                away_history[stat]['for'].append(a_stat)
                away_history[stat]['against'].append(h_stat)
                
            if r == ref and ref is not None:
                ref_history[stat].append(h_stat + a_stat)
                
    def get_avg(lst, n=5):
        if not lst: return 0 # fallback
        return float(np.mean(lst[-n:]))
        
    features = {}
    for stat in STATS:
        features[f'f_home_{stat}_for'] = get_avg(home_history[stat]['for'])
        features[f'f_home_{stat}_ag'] = get_avg(home_history[stat]['against'])
        features[f'f_away_{stat}_for'] = get_avg(away_history[stat]['for'])
        features[f'f_away_{stat}_ag'] = get_avg(away_history[stat]['against'])
        if stat in ['falli', 'cartellini']:
            ref_avg = get_avg(ref_history[stat], n=10)
            if not ref_history[stat]:
                # fallback se arbitro sconosciuto: media tra le due squadre
                ref_avg = (get_avg(home_history[stat]['for']) + get_avg(away_history[stat]['for']))
            features[f'f_ref_{stat}'] = ref_avg

    results = {}
    try:
        for stat in STATS:
            feature_cols = [
                f'f_home_{stat}_for', f'f_home_{stat}_ag',
                f'f_away_{stat}_for', f'f_away_{stat}_ag'
            ]
            if stat in ['falli', 'cartellini']:
                feature_cols.append(f'f_ref_{stat}')
                
            X = pd.DataFrame([{c: features[c] for c in feature_cols}])
            
            # Predict Casa
            model_casa = joblib.load(f'models/rf_{stat}_casa.joblib')
            pred_casa = float(model_casa.predict(X)[0])
            
            # Predict Ospite
            model_ospite = joblib.load(f'models/rf_{stat}_ospite.joblib')
            pred_ospite = float(model_ospite.predict(X)[0])
            
            results[stat] = {
                'casa': round(pred_casa, 2),
                'ospite': round(pred_ospite, 2)
            }
            
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', required=True)
    parser.add_argument('--away', required=True)
    parser.add_argument('--referee', required=False, default='')
    args = parser.parse_args()
    
    predict_match(args.home, args.away, args.referee if args.referee else None)
