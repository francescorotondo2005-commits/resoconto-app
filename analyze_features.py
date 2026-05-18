import pandas as pd
import numpy as np
import shap
import xgboost as xgb
import os
os.environ["PYTHONWARNINGS"] = "ignore"
from ml_train_all import load_data, feature_engineering, STATS, get_feature_cols

def format_feature_name(feat, stat):
    if "_h_for" in feat:
        num = feat.split("for")[-1]
        return f"Media FATTI in casa (ultime {num})" if num else f"Media FATTI in casa (solo casa)"
    if "_h_ag" in feat:
        num = feat.split("ag")[-1]
        return f"Media SUBITI in casa (ultime {num})" if num else f"Media SUBITI in casa (solo casa)"
    if "_h_hfor" in feat: return "Media FATTI in casa (SOLO partite in casa)"
    if "_h_hag" in feat:  return "Media SUBITI in casa (SOLO partite in casa)"
    
    if "_a_for" in feat:
        num = feat.split("for")[-1]
        return f"Media FATTI ospite (ultime {num})" if num else f"Media FATTI ospite (solo trasferta)"
    if "_a_ag" in feat:
        num = feat.split("ag")[-1]
        return f"Media SUBITI ospite (ultime {num})" if num else f"Media SUBITI ospite (solo trasferta)"
    if "_a_afor" in feat: return "Media FATTI ospite (SOLO partite in trasferta)"
    if "_a_aag" in feat:  return "Media SUBITI ospite (SOLO partite in trasferta)"
    
    if "_str_h" in feat: return "Diff. Forza: Attacco Casa vs Difesa Ospite"
    if "_str_a" in feat: return "Diff. Forza: Attacco Ospite vs Difesa Casa"
    if "_ref" in feat:   return "Media Arbitro (storico totale)"
    
    return feat

def run_shap_analysis():
    print("Avvio analisi SHAP... (Calcolo importanza matematica delle feature)")
    df = load_data('resoconto.db')
    ml_df = feature_engineering(df)
    
    report_lines = [
        "# 🧠 SHAP Feature Importance Report",
        "",
        "Questo report svela il \"cervello\" del Machine Learning, mostrando esattamente quanto ogni singola feature pesa sulla decisione finale per ogni statistica.",
        "Le percentuali indicano l'impatto medio assoluto (Mean Absolute SHAP Value) sul risultato atteso.",
        ""
    ]
    
    for stat in STATS:
        print(f"Analizzando {stat.upper()}...")
        fcols = get_feature_cols(stat)
        X = ml_df[fcols]
        # Per l'analisi globale ci concentriamo sul target di casa (o un mix) 
        # Siccome le feature sono simmetriche, analizzare la casa ci darà il peso esatto delle logiche.
        yc = ml_df[f'target_{stat}_casa']
        
        # Addestriamo un modello XGBoost veloce ed efficace per l'estrazione SHAP
        model = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.05, random_state=42, n_jobs=-1)
        model.fit(X, yc)
        
        # Calcolo Valori SHAP (TreeExplainer è perfetto e rapidissimo per XGBoost)
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)
        
        # Importanza media assoluta per ogni feature
        vals = np.abs(shap_values).mean(0)
        feat_imp = pd.DataFrame(list(zip(X.columns, vals)), columns=['col_name', 'importanza'])
        feat_imp.sort_values(by=['importanza'], ascending=False, inplace=True)
        
        # Normalizzazione in percentuale
        total_imp = feat_imp['importanza'].sum()
        feat_imp['percentuale'] = (feat_imp['importanza'] / total_imp) * 100
        
        report_lines.append(f"## Statistica: {stat.upper()}")
        report_lines.append("| Feature | Peso (%) | Descrizione |")
        report_lines.append("|---|---|---|")
        
        for _, row in feat_imp.head(10).iterrows(): # Mostra le Top 10
            feat = row['col_name']
            pct = row['percentuale']
            desc = format_feature_name(feat, stat)
            report_lines.append(f"| `{feat}` | **{pct:.1f}%** | {desc} |")
        
        report_lines.append("")
        
    with open('SHAP_REPORT.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_lines))
        
    print("\n[OK] Analisi completata! Leggi il file SHAP_REPORT.md")

if __name__ == '__main__':
    run_shap_analysis()
