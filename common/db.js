// ============================================================
// DB — Charge toutes les données statiques depuis /data/*.json
// Expose window.DB et window.DB_READY (Promise)
// ============================================================

const _dataBase = (() => {
  const src = (document.currentScript || {}).src || '';
  return src.replace(/common\/db\.js.*$/, 'data/');
})();

function _fetch(file) {
  return fetch(_dataBase + file).then(r => {
    if (!r.ok) throw new Error('DB: impossible de charger ' + file + ' (' + r.status + ')');
    return r.json();
  });
}

window.DB_READY = Promise.all([
  _fetch('weapons.json'),
  _fetch('armor.json'),
  _fetch('items.json'),
  _fetch('enemies.json'),
  _fetch('perks.json'),
  _fetch('npc.json'),
  _fetch('ammo.json'),
  _fetch('ammo_loot.json'),
  _fetch('npc_xp.json'),
  _fetch('zones.json'),
  _fetch('zone_variations.json'),
  _fetch('zone_occupation.json'),
  _fetch('zone_threat.json'),
]).then(([weapons, armor, items, enemies, perks, npc, ammo, ammoLoot, npcXp, zones, zoneVariations, zoneOccupation, zoneThreat]) => {

  window.DB = {
    weapons,
    armor,
    food:   items.food   || [],
    drinks: items.drinks || [],
    drugs:  items.drugs  || [],
    stuff:  items.stuff  || [],
    ammo:   ammo         || [],
  };

  window.PERKS_DEF   = perks;
  window.ENNEMIS_DB  = enemies;
  window.NPC_DB      = npc;
  window.AMMO_LOOT   = ammoLoot || [];
  window.NPC_XP      = npcXp || {perLevel:[], above20:{normal:7,mighty:14,legendary:21}};
  window.ZONES_DB        = zones || {};
  window.ZONE_VARIATIONS = zoneVariations || {};
  window.ZONE_OCCUPATION = zoneOccupation || {};
  window.ZONE_THREAT     = zoneThreat || {};

  // WEAPONS_DB : format objet keyed par nom (accès O(1) dans les pages combat)
  window.WEAPONS_DB = {};
  weapons.forEach(w => {
    window.WEAPONS_DB[w.n] = { t: w.t, dmg: w.dmg, eff: w.eff, fr: w.fr, rng: w.rng, sk: w.sk };
  });

  return window.DB;

}).catch(err => {
  console.error('DB_READY failed:', err);
  // Fallback : résoudre quand même pour ne pas bloquer l'app
  window.DB = { weapons: [], armor: [], food: [], drinks: [], drugs: [], stuff: [], ammo: [] };
  window.PERKS_DEF = {}; window.ENNEMIS_DB = {}; window.WEAPONS_DB = {}; window.AMMO_LOOT = [];
  window.NPC_XP = {perLevel:[], above20:{normal:7,mighty:14,legendary:21}};
  window.ZONES_DB = {}; window.ZONE_VARIATIONS = {}; window.ZONE_OCCUPATION = {}; window.ZONE_THREAT = {};
});
