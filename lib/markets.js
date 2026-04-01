/**
 * Definizione di tutti i mercati di scommessa
 * Generati dalla struttura del foglio Gen_SerieA
 * 
 * Ordine di default richiesto dall'utente:
 * GOL: Totali -> Casa -> Ospite
 * TIRI: 1X2 -> Totali -> Casa -> Ospite
 * TIRI IN PORTA: 1X2 -> Totali -> Casa -> Ospite
 * FALLI: 1X2 -> Totali -> Casa -> Ospite
 * PARATE: Casa -> Ospite
 * CORNER: 1X2 -> Totali -> Casa -> Ospite
 * CARTELLINI: 1X2 -> Totali -> Casa -> Ospite
 */

// Helper per generare mercati Over/Under
function generateOverUnder(stat, label, minLine, maxLine, step = 1, scope = 'totale') {
  const markets = [];
  for (let line = minLine; line <= maxLine; line += step) {
    const lineStr = line % 1 === 0 ? `${line},5` : `${line}`;
    const lineCalc = line + 0.5;
    
    markets.push({
      name: `OVER ${lineStr} ${label}`,
      type: 'over_under',
      direction: 'over',
      stat,
      scope,
      line: lineCalc,
    });
    markets.push({
      name: `UNDER ${lineStr} ${label}`,
      type: 'over_under',
      direction: 'under',
      stat,
      scope,
      line: lineCalc,
    });
  }
  return markets;
}

// Helper per mercati 1X2
function generate1X2(stat, label) {
  return [
    { name: `1X2 ${label}: 1`, type: '1x2', esito: '1', stat, scope: 'totale' },
    { name: `1X2 ${label}: X`, type: '1x2', esito: 'X', stat, scope: 'totale' },
    { name: `1X2 ${label}: 2`, type: '1x2', esito: '2', stat, scope: 'totale' },
  ];
}

export function getAllMarkets() {
  const markets = [];

  // === GOL === (Totali -> Casa -> Ospite)
  // Gol Totali: 0.5 - 5.5
  markets.push(...generateOverUnder('gol', 'GOL', 0, 5, 1, 'totale'));
  // Gol Casa: 0.5 - 4.5
  markets.push(...generateOverUnder('gol', 'GOL CASA', 0, 4, 1, 'casa'));
  // Gol Ospite: 0.5 - 4.5
  markets.push(...generateOverUnder('gol', 'GOL OSPITE', 0, 4, 1, 'ospite'));

  // === TIRI === (1X2 -> Totali -> Casa -> Ospite)
  markets.push(...generate1X2('tiri', 'TIRI'));
  markets.push(...generateOverUnder('tiri', 'TIRI TOTALI', 19, 28, 1, 'totale'));
  markets.push(...generateOverUnder('tiri', 'TIRI CASA', 6, 19, 1, 'casa'));
  markets.push(...generateOverUnder('tiri', 'TIRI OSPITE', 6, 16, 1, 'ospite'));

  // === TIRI IN PORTA === (1X2 -> Totali -> Casa -> Ospite)
  markets.push(...generate1X2('tip', 'TIRI IN PORTA'));
  markets.push(...generateOverUnder('tip', 'TIRI IN PORTA TOTALI', 5, 10, 1, 'totale'));
  markets.push(...generateOverUnder('tip', 'TIRI IN PORTA CASA', 0, 6, 1, 'casa'));
  markets.push(...generateOverUnder('tip', 'TIRI IN PORTA OSPITE', 1, 5, 1, 'ospite'));

  // === FALLI === (1X2 -> Totali -> Casa -> Ospite)
  markets.push(...generate1X2('falli', 'FALLI'));
  markets.push(...generateOverUnder('falli', 'FALLI TOTALI', 20, 28, 1, 'totale'));
  markets.push(...generateOverUnder('falli', 'FALLI CASA', 9, 18, 1, 'casa'));
  markets.push(...generateOverUnder('falli', 'FALLI OSPITE', 9, 18, 1, 'ospite'));

  // === PARATE === (Casa -> Ospite, no 1X2)
  markets.push(...generateOverUnder('parate', 'PARATE CASA', 0, 3, 1, 'casa'));
  markets.push(...generateOverUnder('parate', 'PARATE OSPITE', 0, 4, 1, 'ospite'));

  // === CORNER === (1X2 -> Totali -> Casa -> Ospite)
  markets.push(...generate1X2('corner', 'CORNER'));
  markets.push(...generateOverUnder('corner', 'CORNER TOTALI', 5, 12, 1, 'totale'));
  markets.push(...generateOverUnder('corner', 'CORNER CASA', 1, 8, 1, 'casa'));
  markets.push(...generateOverUnder('corner', 'CORNER OSPITE', 0, 7, 1, 'ospite'));

  // === CARTELLINI === (1X2 -> Totali -> Casa -> Ospite)
  markets.push(...generate1X2('cartellini', 'CARTELLINI'));
  markets.push(...generateOverUnder('cartellini', 'CARTELLINI TOTALI', 1, 6, 1, 'totale'));
  markets.push(...generateOverUnder('cartellini', 'CARTELLINI CASA', 0, 3, 1, 'casa'));
  markets.push(...generateOverUnder('cartellini', 'CARTELLINI OSPITE', 0, 3, 1, 'ospite'));

  // Assign defaultOrder to every market based on array position
  markets.forEach((m, i) => { m.defaultOrder = i; });

  return markets;
}

/**
 * Generate a single custom market dynamically
 * Used when the user wants to add a line not included by default
 */
export function generateCustomMarket(stat, type, scope, direction, line, esito) {
  const labelMap = {
    gol: 'GOL', tiri: 'TIRI', tip: 'TIRI IN PORTA', falli: 'FALLI',
    corner: 'CORNER', cartellini: 'CARTELLINI', parate: 'PARATE',
  };
  const scopeLabel = { totale: '', casa: ' CASA', ospite: ' OSPITE' };
  const baseLabel = labelMap[stat] || stat.toUpperCase();
  const fullLabel = `${baseLabel}${scopeLabel[scope] || ''}`;

  if (type === '1x2') {
    return {
      name: `1X2 ${fullLabel}: ${esito}`,
      type: '1x2',
      esito,
      stat,
      scope: 'totale',
      isCustom: true,
    };
  }

  // over_under
  const lineStr = line % 1 === 0.5
    ? `${Math.floor(line)},5`
    : `${line}`;
  const dirLabel = direction === 'over' ? 'OVER' : 'UNDER';

  return {
    name: `${dirLabel} ${lineStr} ${fullLabel}`,
    type: 'over_under',
    direction,
    stat,
    scope,
    line,
    isCustom: true,
  };
}

/**
 * Categorie di mercato per i filtri
 */
export const MARKET_CATEGORIES = [
  'Gol', 'Tiri', 'Tiri in Porta', 'Falli', 'Corner', 'Cartellini', 'Parate'
];

/**
 * Mappa stat name -> categoria
 */
export function getCategory(stat) {
  const map = {
    gol: 'Gol',
    tiri: 'Tiri',
    tip: 'Tiri in Porta',
    falli: 'Falli',
    corner: 'Corner',
    cartellini: 'Cartellini',
    parate: 'Parate',
  };
  return map[stat.toLowerCase()] || stat;
}
