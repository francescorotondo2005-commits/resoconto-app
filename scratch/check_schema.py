import sqlite3
import re

db = sqlite3.connect('resoconto.db')
db.row_factory = sqlite3.Row
cur = db.cursor()

# Check backtest_bets distinct bet names to understand pattern
cur.execute("SELECT DISTINCT bet_name, bet_category, custom_direction, custom_line, custom_stat FROM backtest_bets ORDER BY bet_category, bet_name")
rows = cur.fetchall()
print("All bet names in backtest_bets:")
for row in rows:
    print(f"  [{row['bet_category']}] {row['bet_name']} | dir={row['custom_direction']} | line={row['custom_line']} | stat={row['custom_stat']}")

# Check if ev_ml is in backtest_bets at all
cur.execute("SELECT COUNT(*) FROM backtest_bets WHERE ev_ml IS NOT NULL")
print(f"\nbacktest_bets with ev_ml: {cur.fetchone()[0]}")

# Check match_odds for ev data
cur.execute("SELECT * FROM match_odds LIMIT 5")
print("\nmatch_odds sample:")
for row in cur.fetchall():
    print(dict(row))

db.close()
