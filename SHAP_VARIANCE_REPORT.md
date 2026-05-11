# 🧠 SHAP Feature Importance Report - MODELLI DI VARIANZA

Questo report mostra quali feature influenzano maggiormente la VOLATILITÀ (varianza) invece che la media.
Le percentuali indicano l'impatto medio assoluto (Mean Absolute SHAP Value) sulla varianza predetta.

## Statistica: GOL (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_gol_h_for10` | **10.3%** | Media FATTI in casa (ultime 10) |
| `f_gol_a_for10` | **8.4%** | Media FATTI ospite (ultime 10) |
| `f_gol_a_ag10` | **8.1%** | Media SUBITI ospite (ultime 10) |
| `f_gol_a_for3` | **7.7%** | Media FATTI ospite (ultime 3) |
| `f_gol_a_aag` | **7.0%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_gol_h_for3` | **6.2%** | Media FATTI in casa (ultime 3) |
| `f_gol_h_ag10` | **6.1%** | Media SUBITI in casa (ultime 10) |
| `f_gol_a_afor` | **5.7%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_gol_a_ag5` | **5.7%** | Media SUBITI ospite (ultime 5) |
| `f_gol_h_for5` | **5.5%** | Media FATTI in casa (ultime 5) |

## Statistica: TIRI (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tiri_h_ag5` | **9.3%** | Media SUBITI in casa (ultime 5) |
| `f_tiri_a_aag` | **8.0%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_tiri_h_ag10` | **7.6%** | Media SUBITI in casa (ultime 10) |
| `f_tiri_a_ag5` | **7.5%** | Media SUBITI ospite (ultime 5) |
| `f_tiri_str_h` | **7.2%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_tiri_a_ag3` | **6.8%** | Media SUBITI ospite (ultime 3) |
| `f_tiri_a_afor` | **5.9%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_tiri_a_for3` | **5.8%** | Media FATTI ospite (ultime 3) |
| `f_tiri_h_hfor` | **5.5%** | Media FATTI in casa (SOLO partite in casa) |
| `f_tiri_a_for10` | **5.0%** | Media FATTI ospite (ultime 10) |

## Statistica: TIP (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tip_str_h` | **10.6%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_tip_a_for10` | **8.4%** | Media FATTI ospite (ultime 10) |
| `f_tip_a_for3` | **7.7%** | Media FATTI ospite (ultime 3) |
| `f_tip_a_ag10` | **7.2%** | Media SUBITI ospite (ultime 10) |
| `f_tip_a_afor` | **6.3%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_tip_h_for3` | **5.8%** | Media FATTI in casa (ultime 3) |
| `f_tip_a_aag` | **5.7%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_tip_str_a` | **5.0%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_tip_h_for10` | **4.9%** | Media FATTI in casa (ultime 10) |
| `f_tip_h_ag10` | **4.8%** | Media SUBITI in casa (ultime 10) |

## Statistica: FALLI (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_falli_a_for10` | **11.6%** | Media FATTI ospite (ultime 10) |
| `f_falli_h_hag` | **8.4%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_falli_a_for3` | **8.2%** | Media FATTI ospite (ultime 3) |
| `f_falli_ref` | **7.1%** | Media Arbitro (storico totale) |
| `f_falli_a_ag10` | **5.5%** | Media SUBITI ospite (ultime 10) |
| `f_falli_a_for5` | **5.2%** | Media FATTI ospite (ultime 5) |
| `f_falli_h_hfor` | **5.1%** | Media FATTI in casa (SOLO partite in casa) |
| `f_falli_a_aag` | **5.1%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_falli_h_ag5` | **5.0%** | Media SUBITI in casa (ultime 5) |
| `f_falli_a_afor` | **4.9%** | Media FATTI ospite (SOLO partite in trasferta) |

## Statistica: CORNER (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_corner_a_for3` | **16.0%** | Media FATTI ospite (ultime 3) |
| `f_corner_str_a` | **10.0%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_corner_a_for10` | **9.5%** | Media FATTI ospite (ultime 10) |
| `f_corner_h_ag10` | **6.3%** | Media SUBITI in casa (ultime 10) |
| `f_corner_a_aag` | **6.1%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_corner_a_ag10` | **5.9%** | Media SUBITI ospite (ultime 10) |
| `f_corner_a_afor` | **5.4%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_corner_h_for10` | **5.2%** | Media FATTI in casa (ultime 10) |
| `f_corner_h_hag` | **5.1%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_corner_h_for5` | **4.5%** | Media FATTI in casa (ultime 5) |

## Statistica: CARTELLINI (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_cartellini_a_ag10` | **9.6%** | Media SUBITI ospite (ultime 10) |
| `f_cartellini_h_ag10` | **9.1%** | Media SUBITI in casa (ultime 10) |
| `f_cartellini_h_for3` | **8.0%** | Media FATTI in casa (ultime 3) |
| `f_cartellini_h_hag` | **7.8%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_cartellini_a_for10` | **7.2%** | Media FATTI ospite (ultime 10) |
| `f_cartellini_a_for5` | **6.3%** | Media FATTI ospite (ultime 5) |
| `f_cartellini_ref` | **5.8%** | Media Arbitro (storico totale) |
| `f_cartellini_str_h` | **5.6%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_cartellini_h_hfor` | **5.5%** | Media FATTI in casa (SOLO partite in casa) |
| `f_cartellini_a_ag3` | **5.3%** | Media SUBITI ospite (ultime 3) |

## Statistica: PARATE (ANALISI VARIANZA)
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_parate_a_for10` | **12.5%** | Media FATTI ospite (ultime 10) |
| `f_parate_h_for3` | **10.3%** | Media FATTI in casa (ultime 3) |
| `f_parate_h_ag3` | **7.3%** | Media SUBITI in casa (ultime 3) |
| `f_parate_h_ag5` | **6.7%** | Media SUBITI in casa (ultime 5) |
| `f_parate_h_for10` | **6.6%** | Media FATTI in casa (ultime 10) |
| `f_parate_h_ag10` | **5.6%** | Media SUBITI in casa (ultime 10) |
| `f_parate_a_aag` | **5.3%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_parate_h_for5` | **5.3%** | Media FATTI in casa (ultime 5) |
| `f_parate_a_ag10` | **5.0%** | Media SUBITI ospite (ultime 10) |
| `f_parate_a_ag5` | **4.9%** | Media SUBITI ospite (ultime 5) |
