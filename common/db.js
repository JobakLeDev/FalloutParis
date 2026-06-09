// ============================================================
// DB — Charge toutes les données statiques depuis /data/*.json
// Expose window.DB et window.DB_READY (Promise)
// ============================================================

const _dataBase = (() => {
  const src = (document.currentScript || {}).src || '';
  return src.replace(/common\/db\.js.*$/, 'data/');
})();

const _DATA_VER = '7';   // bump quand un /data/*.json change (force le rechargement)
function _fetch(file) {
  return fetch(_dataBase + file + '?v=' + _DATA_VER).then(r => {
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
  _fetch('factions.json'),
  _fetch('npc_roles.json'),
  _fetch('loot_profiles.json'),
  _fetch('weapon_mods.json'),
  _fetch('armor_mods.json'),
]).then(([weapons, armor, items, enemies, perks, npc, ammo, ammoLoot, npcXp, zones, zoneVariations, zoneOccupation, zoneThreat, factions, npcRoles, lootProfiles, weaponMods, armorMods]) => {

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
  window.FACTIONS        = factions || {};
  window.NPC_ROLES       = npcRoles || {};
  window.LOOT_PROFILES   = lootProfiles || {};
  window.WEAPON_MODS     = weaponMods || {};
  window.ARMOR_MODS      = armorMods || {};

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
  window.ZONES_DB = {}; window.ZONE_VARIATIONS = {}; window.ZONE_OCCUPATION = {}; window.ZONE_THREAT = {}; window.FACTIONS = {}; window.NPC_ROLES = {}; window.LOOT_PROFILES = {}; window.WEAPON_MODS = {}; window.ARMOR_MODS = {};
});
