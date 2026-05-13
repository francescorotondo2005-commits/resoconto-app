import joblib
import pandas as pd
import numpy as np
import os
from sklearn.metrics import mean_absolute_error
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ml_train_all import load_data, feature_engineering, get_feature_cols, build_model

def debug():
    MODELS_DIR = 'models'
    stat = 'gol'
    
    # 1. Load data
    df = load_data()
    ml_df = feature_engineering(df)
    fcols = get_feature_cols(stat)
    
    holdout = ml_df.tail(30)
    X_h = holdout[fcols]
    yc_h = holdout[f'target_{stat}_casa']
    yo_h = holdout[f'target_{stat}_ospite']
    
    print(f"--- Debug Stat: {stat.upper()} ---")
    print(f"Num match in holdout: {len(holdout)}")
    
    # 2. Load Champion
    path_c = os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib')
    path_o = os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib')
    
    if os.path.exists(path_c):
        champ_c = joblib.load(path_c)
        champ_o = joblib.load(path_o)
        
        pred_c = champ_c.predict(X_h)
        pred_o = champ_o.predict(X_h)
        print(f"\nCHAMPION (on disk):")
        print(f"  Type: {type(champ_c)}")
        if hasattr(champ_c, 'get_params'):
            params = champ_c.get_params()
            relevant = ['n_estimators', 'max_depth', 'learning_rate', 'max_iter', 'min_samples_leaf']
            print(f"  Params: {[ (k, params[k]) for k in relevant if k in params ]}")
        
        mae_c = mean_absolute_error(yc_h, pred_c)
        mae_o = mean_absolute_error(yo_h, pred_o)
        mae_champ = (mae_c + mae_o) / 2
        
        print(f"  MAE Casa: {mae_c:.4f}")
        print(f"  MAE Ospite: {mae_o:.4f}")
        print(f"  MAE Total: {mae_champ:.4f}")
        if hasattr(champ_c, 'feature_names_in_'):
            print(f"  Features expected: {len(champ_c.feature_names_in_)}")
        
        # Log first 5 predictions vs targets
        print("\n  Top 5 match (Champ):")
        for i in range(5):
            print(f"    Target: {yc_h.iloc[i]}-{yo_h.iloc[i]} | Pred: {pred_c[i]:.2f}-{pred_o[i]:.2f}")
    else:
        print("\nChampion non trovato.")

    # 3. Train a "Mock Challenger" (like in the script)
    # Using XGB with default-ish params or best if available
    params = {}
    if os.path.exists('models/best_params.json'):
        import json
        with open('models/best_params.json') as f:
            bp = json.load(f)
            if stat in bp and 'xgb' in bp[stat]:
                params = bp[stat]['xgb']
    
    X = ml_df[fcols]
    yc = ml_df[f'target_{stat}_casa']
    yo = ml_df[f'target_{stat}_ospite']
    
    print(f"\nCHALLENGER (training now on {len(X)} samples):")
    chal_c = build_model('xgb', params).fit(X, yc)
    chal_o = build_model('xgb', params).fit(X, yo)
    
    pred_c_chal = chal_c.predict(X_h)
    pred_o_chal = chal_o.predict(X_h)
    
    mae_c_chal = mean_absolute_error(yc_h, pred_c_chal)
    mae_o_chal = mean_absolute_error(yo_h, pred_o_chal)
    mae_chal = (mae_c_chal + mae_o_chal) / 2
    
    print(f"  MAE Casa: {mae_c_chal:.4f}")
    print(f"  MAE Ospite: {mae_o_chal:.4f}")
    print(f"  MAE Total: {mae_chal:.4f}")
    
    print("\n  Top 5 match (Chal):")
    for i in range(5):
        print(f"    Target: {yc_h.iloc[i]}-{yo_h.iloc[i]} | Pred: {pred_c_chal[i]:.2f}-{pred_o_chal[i]:.2f}")

if __name__ == '__main__':
    debug()
