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
  return (d.special?.L||5) + (d.special?.E||5) + Math.max(0,(d.niveau||1)-1) + (d.perks?.['Life Giver']||0) * (d.special?.E||5);
}

function rollDice(expr) {
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if (!m) return 10;
  const nb = parseInt(m[1])||1, bonus = parseInt(m[2])||0;
  let total = bonus;
  for (let i = 0; i < nb; i++) total += Math.floor(Math.random()*6)+1;
  return total;
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
