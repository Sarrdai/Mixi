/**
 * RYB Subtraktives Farbmischsystem
 * Konfigurierbare Farbhierarchie mit Nearest-Neighbour-Matching
 */
const ColorEngine = (() => {

  // --- RYB ↔ RGB Konvertierung ---
  // Kubische Interpolation basierend auf dem RYB-Farbwürfel
  const RYB_TO_RGB_CUBE = [
    // RYB corners → RGB values
    [1, 1, 1],       // white
    [1, 0, 0],       // red
    [1, 1, 0],       // yellow  (RYB yellow → RGB yellow)
    [1, 0.5, 0],     // orange  (red+yellow → orange)
    [0.163, 0.373, 0.6], // blue
    [0.5, 0, 0.5],   // purple  (red+blue → purple)
    [0, 0.66, 0.2],  // green   (yellow+blue → green)
    [0.2, 0.094, 0.0],// dark   (all)
  ];

  function cubicInterp(t, a, b) {
    return a + t * (b - a);
  }

  function rybToRgb(r, y, b) {
    const c = RYB_TO_RGB_CUBE;
    // Trilinear interpolation
    const r0 = cubicInterp(b, cubicInterp(y, cubicInterp(r, c[0][0], c[1][0]),
                                                         cubicInterp(r, c[2][0], c[3][0])),
                                cubicInterp(y, cubicInterp(r, c[4][0], c[5][0]),
                                                         cubicInterp(r, c[6][0], c[7][0])));
    const g0 = cubicInterp(b, cubicInterp(y, cubicInterp(r, c[0][1], c[1][1]),
                                                         cubicInterp(r, c[2][1], c[3][1])),
                                cubicInterp(y, cubicInterp(r, c[4][1], c[5][1]),
                                                         cubicInterp(r, c[6][1], c[7][1])));
    const b0 = cubicInterp(b, cubicInterp(y, cubicInterp(r, c[0][2], c[1][2]),
                                                         cubicInterp(r, c[2][2], c[3][2])),
                                cubicInterp(y, cubicInterp(r, c[4][2], c[5][2]),
                                                         cubicInterp(r, c[6][2], c[7][2])));
    return [
      Math.round(Math.max(0, Math.min(1, r0)) * 255),
      Math.round(Math.max(0, Math.min(1, g0)) * 255),
      Math.round(Math.max(0, Math.min(1, b0)) * 255),
    ];
  }

  // --- Farbdefinitionen (RYB-Anteile) ---
  // Jede Farbe ist definiert als [R, Y, B] Anteile (0-1)
  // wheelAngle: Position auf dem Farbkreis in Grad (0° = oben/12-Uhr, im Uhrzeigersinn)
  // ring: 1 = äußerer Ring (Primär), 2 = mittlerer Ring (Sekundär), 3 = innerer Ring (Tertiär)
  const COLOR_DEFS = {
    // Primärfarben (Stufe 1) - 120° Abstände
    rot:          { ryb: [1, 0, 0],     tier: 1, name: 'Rot',         wheelAngle: 0,   ring: 1 },
    gelb:         { ryb: [0, 1, 0],     tier: 1, name: 'Gelb',        wheelAngle: 120, ring: 1 },
    blau:         { ryb: [0, 0, 1],     tier: 1, name: 'Blau',        wheelAngle: 240, ring: 1 },

    // Sekundärfarben (Stufe 2) - zwischen Primärfarben
    orange:       { ryb: [1, 1, 0],     tier: 2, name: 'Orange',      wheelAngle: 60,  ring: 2 },
    gruen:        { ryb: [0, 1, 1],     tier: 2, name: 'Grün',        wheelAngle: 180, ring: 2 },
    violett:      { ryb: [1, 0, 1],     tier: 2, name: 'Violett',     wheelAngle: 300, ring: 2 },

    // Tertiärfarben (Stufe 3) - zwischen Primär- und Sekundärfarben
    rotorange:    { ryb: [2, 1, 0],     tier: 3, name: 'Rot-Orange',  wheelAngle: 30,  ring: 3 },
    gelborange:   { ryb: [1, 2, 0],     tier: 3, name: 'Gelb-Orange', wheelAngle: 90,  ring: 3 },
    gelbgruen:    { ryb: [0, 2, 1],     tier: 3, name: 'Gelb-Grün',   wheelAngle: 150, ring: 3 },
    blaugruen:    { ryb: [0, 1, 2],     tier: 3, name: 'Blau-Grün',   wheelAngle: 210, ring: 3 },
    blauviolett:  { ryb: [1, 0, 2],     tier: 3, name: 'Blau-Violett',wheelAngle: 270, ring: 3 },
    rotviolett:   { ryb: [2, 0, 1],     tier: 3, name: 'Rot-Violett', wheelAngle: 330, ring: 3 },

  };

  // Vorberechne RGB-Werte für alle Farben
  Object.keys(COLOR_DEFS).forEach(key => {
    const c = COLOR_DEFS[key];
    const maxVal = Math.max(...c.ryb, 1);
    const normalized = c.ryb.map(v => v / maxVal);
    c.rgb = rybToRgb(normalized[0], normalized[1], normalized[2]);
    c.hex = rgbToHex(c.rgb);
  });

  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function colorDistance(rgb1, rgb2) {
    // Gewichteter euklidischer Abstand (menschliche Wahrnehmung)
    const dr = rgb1[0] - rgb2[0];
    const dg = rgb1[1] - rgb2[1];
    const db = rgb1[2] - rgb2[2];
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
  }

  // --- Misch-Funktion (intern, unabhängig von maxTier) ---

  function mixInternal(colorId1, colorId2) {
    const c1 = COLOR_DEFS[colorId1];
    const c2 = COLOR_DEFS[colorId2];
    if (!c1 || !c2) return null;

    const mixedRyb = [
      c1.ryb[0] + c2.ryb[0],
      c1.ryb[1] + c2.ryb[1],
      c1.ryb[2] + c2.ryb[2],
    ];

    const maxVal = Math.max(...mixedRyb, 1);
    const normalized = mixedRyb.map(v => v / maxVal);
    const mixedRgb = rybToRgb(normalized[0], normalized[1], normalized[2]);

    // Nearest Neighbour über ALLE Farben (unabhängig von maxTier)
    let bestId = null;
    let bestDist = Infinity;

    for (const [id, c] of Object.entries(COLOR_DEFS)) {
      const dist = colorDistance(mixedRgb, c.rgb);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }

    return bestId;
  }

  // --- Rezepte automatisch berechnen aus der echten Mischlogik ---
  // Garantiert, dass Hinweis-Linien exakt dem Matching entsprechen.
  const allIds = Object.keys(COLOR_DEFS);
  allIds.forEach(id => { COLOR_DEFS[id].recipes = []; });

  for (let i = 0; i < allIds.length; i++) {
    for (let j = i + 1; j < allIds.length; j++) {
      const a = allIds[i], b = allIds[j];
      const resultId = mixInternal(a, b);
      if (resultId && resultId !== a && resultId !== b) {
        COLOR_DEFS[resultId].recipes.push([a, b]);
      }
    }
  }

  // --- Öffentliche API ---

  let maxTier = 3;

  function setMaxTier(tier) {
    maxTier = Math.max(1, Math.min(3, tier));
  }

  function getAvailableColors() {
    return Object.entries(COLOR_DEFS)
      .filter(([, c]) => c.tier <= maxTier)
      .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});
  }

  function getPrimaryColors() {
    return Object.entries(COLOR_DEFS)
      .filter(([, c]) => c.tier === 1)
      .map(([key, val]) => ({ id: key, ...val }));
  }

  function getTotalDiscoverable() {
    return Object.values(COLOR_DEFS).filter(c => c.tier <= maxTier).length;
  }

  /**
   * Mischt zwei Farben im RYB-Raum und findet die nächste konfigurierte Farbe.
   * Beachtet maxTier für die Nearest-Neighbour-Suche.
   */
  function mix(colorId1, colorId2) {
    const c1 = COLOR_DEFS[colorId1];
    const c2 = COLOR_DEFS[colorId2];
    if (!c1 || !c2) return null;

    const mixedRyb = [
      c1.ryb[0] + c2.ryb[0],
      c1.ryb[1] + c2.ryb[1],
      c1.ryb[2] + c2.ryb[2],
    ];

    const maxVal = Math.max(...mixedRyb, 1);
    const normalized = mixedRyb.map(v => v / maxVal);
    const mixedRgb = rybToRgb(normalized[0], normalized[1], normalized[2]);

    const available = getAvailableColors();
    let bestId = null;
    let bestDist = Infinity;

    for (const [id, c] of Object.entries(available)) {
      const dist = colorDistance(mixedRgb, c.rgb);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }

    return {
      id: bestId,
      color: COLOR_DEFS[bestId],
      mixRgb: mixedRgb,
      mixHex: rgbToHex(mixedRgb),
    };
  }

  function getColor(id) {
    return COLOR_DEFS[id] || null;
  }

  function getAllColorIds() {
    return Object.keys(COLOR_DEFS).filter(k => COLOR_DEFS[k].tier <= maxTier);
  }

  /** Returns color IDs sorted by wheel angle for proper color-wheel layout */
  function getWheelOrder() {
    return getAllColorIds()
      .filter(id => COLOR_DEFS[id].ring > 0)
      .sort((a, b) => COLOR_DEFS[a].wheelAngle - COLOR_DEFS[b].wheelAngle);
  }

  return {
    mix,
    getColor,
    getPrimaryColors,
    getAvailableColors,
    getTotalDiscoverable,
    getAllColorIds,
    getWheelOrder,
    setMaxTier,
    rgbToHex,
    rybToRgb,
    COLOR_DEFS,
  };
})();
