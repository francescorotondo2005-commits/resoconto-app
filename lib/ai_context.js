import { getDb } from './db.js';

/**
 * Normalizes RSS XML content to extract plain text
 */
function cleanXmlTags(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Fetches news snippets from Google News RSS for a specific query
 */
async function fetchNewsSnippets(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    
    // Parse items using simple regex
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(text)) !== null && items.length < 8) {
      const itemContent = match[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemContent);
      const descMatch = /<description>([\s\S]*?)<\/description>/.exec(itemContent);
      
      const title = titleMatch ? cleanXmlTags(titleMatch[1]) : '';
      const desc = descMatch ? cleanXmlTags(descMatch[1]) : '';
      
      if (title) {
        items.push(`${title} - ${desc}`);
      }
    }
    return items;
  } catch (err) {
    console.warn(`[AI Context] Failed to fetch news for query "${query}":`, err.message);
    return [];
  }
}

/**
 * Calls Gemini 2.5 Flash API to synthesize news snippets
 */
async function analyzeWithGemini(homeTeam, awayTeam, date, snippets) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[AI Context] GEMINI_API_KEY is missing. Skipping AI analysis.');
    return null;
  }

  const prompt = `Sei un analista calcistico esperto e traduttore di dati per modelli di Machine Learning.
Ti fornisco alcune notizie recenti trovate sul web riguardanti la partita tra ${homeTeam} e ${awayTeam} del ${date}.
Il tuo compito è sintetizzare le informazioni in un oggetto JSON strutturato e pulito.

Notizie/Contesto raccolto:
"""
${snippets.join('\n\n')}
"""

Analizza le notizie ed estrai:
1. injury_impact_home (float da 0.0 a 5.0): impatto complessivo degli infortunati/squalificati per la squadra in casa (${homeTeam}). 0.0 = nessun assente importante, 5.0 = emergenza totale/squadra decimata.
2. injury_impact_away (float da 0.0 a 5.0): impatto degli infortunati/squalificati per la squadra ospite (${awayTeam}).
3. motivation_home (float da 0.0 a 5.0): livello di motivazione stimato per la squadra in casa. 5.0 = finale, scontro salvezza decisivo, derby accesissimo. 1.0 = amichevole o partita senza obiettivi.
4. motivation_away (float da 0.0 a 5.0): livello di motivazione per la squadra ospite.
5. key_players_missing_home (stringa): elenco dei giocatori chiave assenti per la squadra in casa (es. "Osimhen, Kvaratskhelia"). Se nessuno, scrivi "Nessuno".
6. key_players_missing_away (stringa): elenco dei giocatori chiave assenti per la squadra ospite.
7. summary (stringa): una sintesi qualitativa di 1-2 frasi in italiano sull'atmosfera del match (es. "Il Milan fa ampio turnover in vista della Champions, mentre il Torino schiera la formazione tipo cercando punti Europa").

Ritorna ESCLUSIVAMENTE l'oggetto JSON puro. Non includere blocchi di codice markdown (\`\`\`json ... \`\`\`), spiegazioni, commenti o altri caratteri oltre al JSON stesso. Il tuo output deve essere direttamente parsabile con JSON.parse in JavaScript.

Esempio di output valido:
{
  "injury_impact_home": 1.5,
  "injury_impact_away": 3.0,
  "motivation_home": 4.0,
  "motivation_away": 4.5,
  "key_players_missing_home": "Barella",
  "key_players_missing_away": "Lookman, Scalvini",
  "summary": "L'Inter affronta l'Atalanta con poche assenze e forte motivazione scudetto, mentre l'Atalanta ha un'emergenza in difesa ma alta spinta per la zona Champions."
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[AI Context] Gemini API error: ${response.status} ${response.statusText} - ${errText}`);
      return null;
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    // Clean up any markdown code block wrap just in case
    const jsonText = rawText.trim().replace(/^```json/, '').replace(/```$/, '').trim();
    return JSON.parse(jsonText);
  } catch (err) {
    console.error('[AI Context] Failed to analyze with Gemini:', err.message);
    return null;
  }
}

/**
 * Primary entrypoint to get AI context for a match.
 * Performs database caching, web scraping, and Gemini LLM synthesis.
 */
export async function getMatchAiContext(homeTeam, awayTeam, date) {
  const db = await getDb();
  const matchKey = `${homeTeam}_${awayTeam}_${date}`;

  // 1. Check cache in database
  try {
    const cached = await db.execute({
      sql: `SELECT * FROM match_ai_context WHERE match_key = ?`,
      args: [matchKey]
    });
    
    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      return {
        injury_impact_home: row.injury_impact_home,
        injury_impact_away: row.injury_impact_away,
        motivation_home: row.motivation_home,
        motivation_away: row.motivation_away,
        key_players_missing_home: row.key_players_missing_home,
        key_players_missing_away: row.key_players_missing_away,
        summary: row.raw_analysis ? JSON.parse(row.raw_analysis).summary : ''
      };
    }
  } catch (dbErr) {
    console.warn('[AI Context] Cache read error:', dbErr.message);
  }

  console.log(`[AI Context] Cache miss for ${homeTeam} vs ${awayTeam} (${date}). Scoping online news...`);

  // 2. Scrape news from Google News RSS
  const query1 = `${homeTeam} infortuni squalificati news`;
  const query2 = `${awayTeam} infortuni squalificati news`;
  const query3 = `${homeTeam} ${awayTeam} probabili formazioni gazzetta`;

  const [newsHome, newsAway, newsMatch] = await Promise.all([
    fetchNewsSnippets(query1),
    fetchNewsSnippets(query2),
    fetchNewsSnippets(query3)
  ]);

  const allSnippets = [...newsHome, ...newsAway, ...newsMatch];
  
  if (allSnippets.length === 0) {
    console.log('[AI Context] No news snippets found. Returning default values.');
    return {
      injury_impact_home: null,
      injury_impact_away: null,
      motivation_home: null,
      motivation_away: null,
      key_players_missing_home: null,
      key_players_missing_away: null,
      summary: ''
    };
  }

  // 3. Synthesize with Gemini
  const analysis = await analyzeWithGemini(homeTeam, awayTeam, date, allSnippets);

  if (!analysis) {
    console.log('[AI Context] Gemini synthesis failed or skipped. Returning default values.');
    return {
      injury_impact_home: null,
      injury_impact_away: null,
      motivation_home: null,
      motivation_away: null,
      key_players_missing_home: null,
      key_players_missing_away: null,
      summary: ''
    };
  }

  // 4. Save to DB cache
  try {
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO match_ai_context (
          match_key, home_team, away_team, date,
          injury_impact_home, injury_impact_away,
          motivation_home, motivation_away,
          key_players_missing_home, key_players_missing_away,
          raw_analysis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        matchKey, homeTeam, awayTeam, date,
        analysis.injury_impact_home, analysis.injury_impact_away,
        analysis.motivation_home, analysis.motivation_away,
        analysis.key_players_missing_home, analysis.key_players_missing_away,
        JSON.stringify(analysis)
      ]
    });
    console.log(`[AI Context] Successfully cached analysis for ${homeTeam} vs ${awayTeam}`);
  } catch (dbErr) {
    console.warn('[AI Context] Cache write error:', dbErr.message);
  }

  return {
    injury_impact_home: analysis.injury_impact_home,
    injury_impact_away: analysis.injury_impact_away,
    motivation_home: analysis.motivation_home,
    motivation_away: analysis.motivation_away,
    key_players_missing_home: analysis.key_players_missing_home,
    key_players_missing_away: analysis.key_players_missing_away,
    summary: analysis.summary
  };
}
