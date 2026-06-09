// ============================================================
// MJ_SHARED — Constantes et fonctions partagées entre les pages MJ
// (combat.html, combat_joueur.html, mj.html)
// ============================================================

const COMBATS_COLL = 'combat'; // collection existante Firebase (réutilisée avec IDs dynamiques)

const SK_ATTR = {
  en_weapon:'P', cac_weapon:'S', light_weapon:'A', heavy_weapon:'E',
  athletics:'S', lockpick:'P', speech:'C', sneak:'A', explosives:'P',
  barehand:'S', medicine:'I', pilot:'P', throwing:'A', repair:'I',
  science:'I', survival:'E', barter:'C',
};

// Faces du dé de combat : 1dmg | 2dmg | blank | blank | 1dmg+effet | 1dmg+effet
const FACES_CD = ['1','2','—','—','1⚡','1⚡'];

// WEAPONS_DB et ENNEMIS_DB chargés depuis /data/*.json via common/db.js → window.WEAPONS_DB / window.ENNEMIS_DB

function getHpMax(d) {
  if (!d || !d.special) return 10;
  return (d.special?.L||5) + (d.special?.E||5) + Math.max(0,(d.niveau||1)-1) + (d.perks?.['Life Giver']||0) * (d.special?.E||5)
    + (d.survie?.wellRested ? 2 : 0);   // bien reposé : +2 PV max jusqu'au prochain sommeil
}

function rollDice(expr) {
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if (!m) return 10;
  const nb = parseInt(m[1])||1, bonus = parseInt(m[2])||0;
  let total = bonus;
  for (let i = 0; i < nb; i++) total += Math.floor(Math.random()*6)+1;
  return total;
}

// Construit une instance de combat depuis une fiche ennemi (nouveau schéma officiel)
// Retourne {nom, pvMax, pvCur, atq, rd, initiative, xp, body, mind, tn, dmgType, eff, dr, defense, level, category}
function enemyInstanceFromDB(nom, lvl = 1) {
  const e = window.ENNEMIS_DB?.[nom]; if (!e) return null;
  const L = Math.max(1, parseInt(lvl) || 1);
  const scale = 1 + (L - 1) * 0.25;
  const hp = Math.round((e.hp || 6) * scale);
  const atk = (e.attacks && e.attacks[0]) || {};
  // dr.phys peut être un nombre, ou une string (RD localisée : "4 tête / 3 jambes...")
  let phys;
  if (typeof e.dr?.phys === 'number') phys = e.dr.phys + Math.floor((L - 1) / 2);
  else if (typeof e.dr?.phys === 'string') phys = parseInt(e.dr.phys) || 0;
  else phys = 0;
  return {
    nom,
    pvMax: hp, pvCur: hp,
    atq: (atk.dmg != null ? atk.dmg : 3) + 'D',
    rd: phys,
    initiative: e.initiative || ((e.attrs?.body || 6) + (e.attrs?.mind || 4)),
    xp: Math.round((e.xp || 0) * scale),   // XP suit le facteur de difficulté (×1 au niv.1 = XP du bestiaire)
    body: e.attrs?.body || 6,
    mind: e.attrs?.mind || 4,
    tn: atk.tn ?? null,
    dmgType: atk.dmgType || 'physical',
    eff: atk.eff || '',
    dr: e.dr || { phys, energy: 0, rad: 0, poison: 0 },
    defense: e.defense ?? 1,
    level: e.level ?? L,
    category: e.category || 'normal'
  };
}

// XP d'un PNJ selon son niveau et sa catégorie (window.NPC_XP chargé via db.js)
// cat : 'normal' | 'mighty' | 'legendary'  — extrapole au-delà du niveau 20
function getNpcXP(level, cat = 'normal') {
  const T = window.NPC_XP; if (!T || !T.perLevel?.length) return 0;
  const lvl = Math.max(1, parseInt(level) || 1);
  const c = ['normal','mighty','legendary'].includes(cat) ? cat : 'normal';
  if (lvl <= 20) return T.perLevel[lvl - 1][c];
  return T.perLevel[19][c] + (lvl - 20) * (T.above20[c] || 0);
}

function getTN(d, skKey) {
  const attr = SK_ATTR[skKey] || 'A';
  const map = {S:d.special?.S||5, P:d.special?.P||5, E:d.special?.E||5, C:d.special?.C||5, I:d.special?.I||5, A:d.special?.A||5, L:d.special?.L||5};
  const rang = d.skills?.[skKey] || 0;
  const tag  = d.taggedSkills?.includes(skKey) ? 2 : 0;
  return {total: map[attr]+rang+tag, attrVal: map[attr], rang, tag};
}

// ============================================================
// LOOT DE COMBAT — génère le butin en fonction des ennemis vaincus.
// Profils dans data/loot_profiles.json (window.LOOT_PROFILES) :
//   beast    → viande (selon la créature) + matériaux
//   human    → arme / armure / chems / nourriture / boisson / munitions / caps
//   machine  → ferraille/composants + munitions + (rare) arme/caps
// Quantités mises à l'échelle par category (swarm<normal<elite<boss).
// Retourne { items:[{name,type,cat,qty}], caps:int } à fusionner dans /butin/data.
// ============================================================
function lootTier(cat){ return (window.LOOT_PROFILES?.tierByCategory || {})[cat] || 2; }

// Tirage pondéré par rareté (commun = fréquent, légendaire = rare)
function lootWeightedPick(list){
  if(!Array.isArray(list) || !list.length) return null;
  let tot=0; const w=list.map(it=>{ const x=Math.max(1,6-(it.r||3)); tot+=x; return x; });
  let r=Math.random()*tot;
  for(let i=0;i<list.length;i++){ r-=w[i]; if(r<=0) return list[i]; }
  return list[list.length-1];
}
// Somme de n dés de combat (faces : 1,2,0,0,1,1 — comme FACES_CD)
function lootSumCD(n){ let s=0; for(let i=0;i<n;i++) s += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0; return s; }
// Munitions : jet 2D20 sur la table officielle (window.AMMO_LOOT) → {ammo, qty}
function lootRollAmmo(){
  const tbl = window.AMMO_LOOT; if(!tbl||!tbl.length) return null;
  const roll = (1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20));
  const e = tbl.find(x => roll>=x.min && roll<=x.max); if(!e) return null;
  let q = e.base||0;
  for(let i=0;i<(e.cd||0);i++) q += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0;
  return { ammo: e.ammo, qty: Math.max(1, q*(e.mult||1)) };
}
// Profil (beast/human/machine) d'un ennemi en combat (type relu depuis ENNEMIS_DB ; fallback humain)
function lootProfileKey(enemy){
  const LP = window.LOOT_PROFILES || {};
  const type = window.ENNEMIS_DB?.[enemy?.nom]?.type;
  if(type && LP.typeProfile && LP.typeProfile[type]) return LP.typeProfile[type];
  return 'human';   // unités de faction relabellisées / inconnus → humanoïdes
}
function generateCombatLoot(enemies){
  const LP = window.LOOT_PROFILES || {}; const DB = window.DB || {};
  const items = []; let caps = 0;
  const add = (name, type, cat, qty) => {
    if(!name || qty <= 0) return;
    const ex = items.find(x => x.name===name && x.cat===cat);
    if(ex) ex.qty += qty; else items.push({ name, type, cat, qty });
  };
  (enemies || []).forEach(en => {
    const prof = lootProfileKey(en);
    const t = lootTier(en.category);
    if(prof === 'beast'){
      const p = LP.profiles?.beast || {};
      const meat = (LP.meatByCreature && LP.meatByCreature[en.nom]) || LP.defaultMeat || 'Viande crue mutée';
      add(meat, 'FOOD', 'food', Math.max(1, Math.round(t * (p.foodPerTier || 1))));
      const m = p.materials;
      if(m && Math.random() < (m.chance ?? 0.7)){
        const mat = m.pool[Math.floor(Math.random()*m.pool.length)];
        add(mat, 'STUFF', 'stuff', 1 + lootSumCD(t));
      }
    } else if(prof === 'machine'){
      const p = LP.profiles?.machine || {};
      const sc = p.scrap;
      if(sc && sc.pool?.length){ const n = Math.max(1, t * (sc.perTier || 1)); for(let i=0;i<n;i++){ add(sc.pool[Math.floor(Math.random()*sc.pool.length)], 'STUFF', 'stuff', 1); } }
      if(p.ammo && Math.random() < (p.ammo.chance ?? 0.45)){ const a = lootRollAmmo(); if(a) add(a.ammo, 'AMMO', 'ammo', a.qty); }
      if(p.weapon && Math.random() < (p.weapon.chance ?? 0.15)){ const w = lootWeightedPick(DB.weapons); if(w) add(w.n, w.t || 'WEAPON', 'weapons', 1); }
      if(p.caps && Math.random() < (p.caps.chance ?? 0.2)) caps += (p.caps.base || 0) + lootSumCD(t) * (p.caps.perTier || 2);
    } else { // human
      const p = LP.profiles?.human || {};
      if(p.weapon && Math.random() < (p.weapon.chance ?? 0.5)){ const w = lootWeightedPick(DB.weapons); if(w) add(w.n, w.t || 'WEAPON', 'weapons', 1); }
      if(p.armor  && Math.random() < (p.armor.chance  ?? 0.35)){ const a = lootWeightedPick(DB.armor);  if(a) add(a.n, a.t || 'ARMOR', 'armor', 1); }
      if(p.drugs  && Math.random() < (p.drugs.chance  ?? 0.4)){ const d = lootWeightedPick(DB.drugs);  if(d) add(d.n, d.t || 'DRUGS', 'drugs', 1); }
      if(p.food   && Math.random() < (p.food.chance   ?? 0.5)){ const f = lootWeightedPick(DB.food);   if(f) add(f.n, f.t || 'FOOD', 'food', 1); }
      if(p.drinks && Math.random() < (p.drinks.chance ?? 0.4)){ const dr = lootWeightedPick(DB.drinks); if(dr) add(dr.n, dr.t || 'DRINK', 'drinks', 1); }
      if(p.ammo   && Math.random() < (p.ammo.chance   ?? 0.7)){ const a = lootRollAmmo(); if(a) add(a.ammo, 'AMMO', 'ammo', a.qty); }
      caps += (p.caps?.base || 0) + lootSumCD(t) * (p.caps?.perTier || 3);
    }
  });
  return { items, caps };
}
