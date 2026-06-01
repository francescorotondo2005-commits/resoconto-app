import sqlite3

conn = sqlite3.connect('resoconto.db')
c = conn.cursor()

# Campionati principali: competition_type = 'league'
leagues = ['SerieA', 'Premier', 'LaLiga', 'Ligue1', 'Bundes']
for lg in leagues:
    c.execute("UPDATE matches SET competition_type = 'league' WHERE league = ? AND competition_type IS NULL", (lg,))
    print(f'{lg}: {c.rowcount} partite aggiornate -> league')

# Coppe europee
euro_cups = ['ChampionsLeague', 'EuropaLeague', 'ConferenceLeague']
for lg in euro_cups:
    c.execute("UPDATE matches SET competition_type = 'cup_european' WHERE league = ? AND competition_type IS NULL", (lg,))
    print(f'{lg}: {c.rowcount} partite aggiornate -> cup_european')

# Coppe nazionali
nat_cups = ['CoppaItalia', 'FACup', 'CopaDelRey', 'CoupeDeFrance', 'DFBPokal', 'EFLCup']
for lg in nat_cups:
    c.execute("UPDATE matches SET competition_type = 'cup_national' WHERE league = ? AND competition_type IS NULL", (lg,))
    print(f'{lg}: {c.rowcount} partite aggiornate -> cup_national')

conn.commit()

# Verifica finale
c.execute('SELECT competition_type, COUNT(*) FROM matches GROUP BY competition_type')
print('\n=== RISULTATO FINALE ===')
for r in c.fetchall():
    print(f'  {r[0]}: {r[1]} partite')

conn.close()
print('\nDone!')
