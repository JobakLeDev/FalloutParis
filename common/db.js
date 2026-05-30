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
]).then(([weapons, armor, items, enemies, perks, npc]) => {

  window.DB = {
    weapons,
    armor,
    food:   items.food   || [],
    drinks: items.drinks || [],
    drugs:  items.drugs  || [],
    stuff:  items.stuff  || [],
  };

  window.PERKS_DEF   = perks;
  window.ENNEMIS_DB  = enemies;
  window.NPC_DB      = npc;

  // WEAPONS_DB : format objet keyed par nom (accès O(1) dans les pages combat)
  window.WEAPONS_DB = {};
  weapons.forEach(w => {
    window.WEAPONS_DB[w.n] = { t: w.t, dmg: w.dmg, eff: w.eff, fr: w.fr, rng: w.rng, sk: w.sk };
  });

  return window.DB;

}).catch(err => {
  console.error('DB_READY failed:', err);
  // Fallback : résoudre quand même pour ne pas bloquer l'app
  window.DB = { weapons: [], armor: [], food: [], drinks: [], drugs: [], stuff: [] };
  window.PERKS_DEF = {}; window.ENNEMIS_DB = {}; window.WEAPONS_DB = {};
});
