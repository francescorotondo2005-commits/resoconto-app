import joblib, pandas as pd, xgboost as xgb
try:
    m = joblib.load('models/model_gol_casa.joblib')
    if isinstance(m, dict):
        print("Model is dict. Keys:", m.keys())
    else:
        print("Model is bare. Type:", type(m))
        if hasattr(m, 'feature_names_in_'):
            print("Feature names:", len(m.feature_names_in_))
        else:
            print("No feature_names_in_")
except Exception as e:
    print("Error:", e)
