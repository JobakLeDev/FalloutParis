// ============================================================
// ZONES — Moteur de génération de rencontres pondérées
// Une zone de base (pool pondéré) + couches de modificateurs :
//   variation → occupation → menace
// Chaque couche applique d'abord ses `multipliers`, puis ses `add`.
// window.ZONES_DB / ZONE_VARIATIONS / ZONE_OCCUPATION / ZONE_THREAT
// sont chargés par common/db.js (attendre window.DB_READY).
// ============================================================

// Applique une couche {multipliers?, add?} sur un pool {nom: poids}
function _applyZoneLayer(pool, layer) {
  if (!layer) return pool;
  if (layer.multipliers) {
    for (const [nom, m] of Object.entries(layer.multipliers)) {
      if (pool[nom] != null) pool[nom] *= m;
    }
  }
  if (layer.add) {
    for (const [nom, w] of Object.entries(layer.add)) {
      pool[nom] = (pool[nom] || 0) + w;
    }
  }
  return pool;
}

// Résout le pool final d'une zone selon les critères choisis.
// opts = { variation?, occupation?, threat? } (clés des DB respectives)
// Retourne {nom: poids} (poids > 0 uniquement), "none" inclus si présent.
function resolveZonePool(zoneKey, opts = {}) {
  const zone = window.ZONES_DB?.[zoneKey];
  if (!zone) return {};
  const pool = { ...zone.pool };
  _applyZoneLayer(pool, window.ZONE_VARIATIONS?.[opts.variation]);
  _applyZoneLayer(pool, window.ZONE_OCCUPATION?.[opts.occupation]);
  _applyZoneLayer(pool, window.ZONE_THREAT?.[opts.threat]);
  for (const k of Object.keys(pool)) {
    pool[k] = Math.round(pool[k] * 100) / 100;
    if (pool[k] <= 0) delete pool[k];
  }
  return pool;
}

// Tire une entrée du pool selon les poids. Retourne un nom (ou "none").
function rollEncounter(pool) {
  const entries = Object.entries(pool).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return 'none';
  let r = Math.random() * total;
  for (const [nom, w] of entries) { r -= w; if (r < 0) return nom; }
  return entries[entries.length - 1][0];
}

// Génère N rencontres. excludeNone=true retire "none" du pool avant tirage.
function generateEncounters(zoneKey, opts = {}, count = 1, excludeNone = false) {
  let pool = resolveZonePool(zoneKey, opts);
  if (excludeNone) { pool = { ...pool }; delete pool.none; }
  const out = [];
  const hasAny = Object.values(pool).some(w => w > 0);
  for (let i = 0; i < count && hasAny; i++) out.push(rollEncounter(pool));
  return out;
}

// Probabilités normalisées d'un pool résolu (pour aperçu UI). Retourne
// un array trié décroissant : [{nom, poids, pct}]
function zonePoolProbabilities(zoneKey, opts = {}) {
  const pool = resolveZonePool(zoneKey, opts);
  const total = Object.values(pool).reduce((a, w) => a + w, 0) || 1;
  return Object.entries(pool)
    .map(([nom, poids]) => ({ nom, poids, pct: Math.round(poids / total * 1000) / 10 }))
    .sort((a, b) => b.poids - a.poids);
}
