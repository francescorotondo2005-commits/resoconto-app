import sqlite3
import pandas as pd
import numpy as np
import joblib
import argparse
import json
import warnings
import sys
import os

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

def calculate_team_features(df, target_teams, target_refs):
    """Calcola le medie mobili per tutte le squadre e arbitri target in un solo passaggio."""
    team_history = {t: {s: {'for': [], 'against': []} for s in STATS} for t in target_teams}
    ref_history = {r: {s: [] for s in STATS} for r in target_refs if r}
    
    # Passaggio unico sul database (vettorizzato sarebbe meglio, ma così è sicuro)
    for row in df.itertuples():
        h = getattr(row, 'home_team')
        a = getattr(row, 'away_team')
        ref = getattr(row, 'referee')
        
        for stat in STATS:
            h_val = get_stat(row._asdict(), stat, True)
            a_val = get_stat(row._asdict(), stat, False)
            
            if h in team_history:
                team_history[h][stat]['for'].append(h_val)
                team_history[h][stat]['against'].append(a_val)
            if a in team_history:
                team_history[a][stat]['for'].append(a_val)
                team_history[a][stat]['against'].append(h_val)
            
            if ref in ref_history:
                ref_history[ref][stat].append(h_val + a_val)
                
    def get_avg(lst, n=5):
        if not lst: return 0
        return float(np.mean(lst[-n:]))
        
    return team_history, ref_history

def predict_batch(matches):
    try:
        # Load recent data
        conn = sqlite3.connect('resoconto.db', timeout=30)
        df = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
        conn.close()
        
        # Identify unique teams and refs
        target_teams = set()
        target_refs = set()
        for m in matches:
            target_teams.add(m['home'])
            target_teams.add(m['away'])
            if m.get('referee'): target_refs.add(m['referee'])
            
        # Pre-calculate features for all involved
        team_history, ref_history = calculate_team_features(df, target_teams, target_refs)
        
        # Load all models once
        models = {}
        for stat in STATS:
            models[f'{stat}_casa'] = joblib.load(f'models/rf_{stat}_casa.joblib')
            models[f'{stat}_ospite'] = joblib.load(f'models/rf_{stat}_ospite.joblib')
            
        batch_results = []
        for m in matches:
            home, away, ref = m['home'], m['away'], m.get('referee')
            
            # Prepare features for this match
            features = {}
            for stat in STATS:
                def get_avg(lst, n=5):
                    if not lst: return 0
                    return float(np.mean(lst[-n:]))

                features[f'f_home_{stat}_for'] = get_avg(team_history[home][stat]['for'])
                features[f'f_home_{stat}_ag'] = get_avg(team_history[home][stat]['against'])
                features[f'f_away_{stat}_for'] = get_avg(team_history[away][stat]['for'])
                features[f'f_away_{stat}_ag'] = get_avg(team_history[away][stat]['against'])
                
                if stat in ['falli', 'cartellini']:
                    ref_avg = 0
                    if ref and ref in ref_history:
                        ref_avg = get_avg(ref_history[ref][stat], n=10)
                    
                    if not ref_avg:
                        # Fallback
                        ref_avg = (get_avg(team_history[home][stat]['for']) + get_avg(team_history[away][stat]['for']))
                    features[f'f_ref_{stat}'] = ref_avg
            
            match_preds = {}
            for stat in STATS:
                feature_cols = [f'f_home_{stat}_for', f'f_home_{stat}_ag', f'f_away_{stat}_for', f'f_away_{stat}_ag']
                if stat in ['falli', 'cartellini']: feature_cols.append(f'f_ref_{stat}')
                
                X = pd.DataFrame([{c: features[c] for c in feature_cols}])
                pred_casa = float(models[f'{stat}_casa'].predict(X)[0])
                pred_ospite = float(models[f'{stat}_ospite'].predict(X)[0])
                
                match_preds[stat] = {'casa': round(pred_casa, 2), 'ospite': round(pred_ospite, 2)}
            
            batch_results.append(match_preds)
            
        print(json.dumps(batch_results))
        
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', help='JSON string with matches list')
    parser.add_argument('--batch-file', help='Path to JSON file with matches list')
    parser.add_argument('--home')
    parser.add_argument('--away')
    parser.add_argument('--referee', default='')
    args = parser.parse_args()
    
    if args.batch_file:
        with open(args.batch_file, 'r', encoding='utf-8') as f:
            matches = json.load(f)
        predict_batch(matches)
    elif args.batch:
        matches = json.loads(args.batch)
        predict_batch(matches)
    elif args.home and args.away:
        predict_batch([{'home': args.home, 'away': args.away, 'referee': args.referee}])
    else:
        print(json.dumps({'error': 'Missing arguments'}))
        sys.exit(1)
