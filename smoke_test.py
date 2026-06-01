from ml_train_all import load_data, feature_engineering

print("Caricamento dati...")
df = load_data()
print(f"Partite totali nel DB: {len(df)}")
print(f"Campionati: {len(df[df['competition_type']=='league'])}")
print(f"Coppe europee: {len(df[df['competition_type']=='cup_european'])}")
print(f"Coppe nazionali: {len(df[df['competition_type']=='cup_national'])}")

print("\nFeature engineering...")
ml_df, weights = feature_engineering(df)
print(f"\nPartite valide per il training (con SofaScore xG): {len(ml_df)}")
print(f"Peso medio campione: {weights.mean():.3f}")
print("SMOKE TEST OK!")
