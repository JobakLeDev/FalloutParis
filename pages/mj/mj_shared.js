// ============================================================
// MJ_SHARED — Constantes et fonctions partagées entre les pages MJ
// (combat.html, combat_joueur.html, mj.html)
// ============================================================

const COMBAT_DOC = 'fallout-paris';

const SK_ATTR = {
  en_weapon:'P', cac_weapon:'S', light_weapon:'A', heavy_weapon:'E',
  athletics:'S', lockpick:'P', speech:'C', sneak:'A', explosives:'P',
  barehand:'S', medicine:'I', pilot:'P', throwing:'A', repair:'I',
  science:'I', survival:'E', barter:'C',
};

const FACES_CD = ['1','2','—','—','★','★'];

const WEAPONS_DB = {
  'Ripper':               {t:'Melee',  dmg:'4D', eff:'Vicious',       fr:6,   rng:'—', sk:'cac_weapon'},
  'Pipe Wrench':          {t:'Melee',  dmg:'3D', eff:'—',             fr:'—', rng:'—', sk:'cac_weapon'},
  'Combat Knife':         {t:'Melee',  dmg:'3D', eff:'Piercing 1',    fr:'—', rng:'—', sk:'cac_weapon'},
  'Sledgehammer':         {t:'Melee',  dmg:'5D', eff:'—',             fr:'—', rng:'—', sk:'cac_weapon'},
  'Baseball Bat':         {t:'Melee',  dmg:'3D', eff:'—',             fr:'—', rng:'—', sk:'cac_weapon'},
  'Machete':              {t:'Melee',  dmg:'3D', eff:'Piercing 1',    fr:'—', rng:'—', sk:'cac_weapon'},
  '.44 Pistol':           {t:'Small Guns', dmg:'6D', eff:'—',         fr:1,   rng:'M', sk:'light_weapon'},
  '10mm Pistol':          {t:'Small Guns', dmg:'4D', eff:'—',         fr:2,   rng:'M', sk:'light_weapon'},
  'Pipe Gun':             {t:'Small Guns', dmg:'3D', eff:'—',         fr:2,   rng:'C', sk:'light_weapon'},
  'Pipe Revolver':        {t:'Small Guns', dmg:'4D', eff:'—',         fr:1,   rng:'C', sk:'light_weapon'},
  'Pipe Bolt-Action':     {t:'Small Guns', dmg:'6D', eff:'Piercing 1',fr:0,   rng:'M', sk:'light_weapon'},
  'Hunting Rifle':        {t:'Small Guns', dmg:'7D', eff:'—',         fr:0,   rng:'L', sk:'light_weapon'},
  'Double-Barrel Shotgun':{t:'Small Guns', dmg:'5D', eff:'Spread,Vicious',fr:0,rng:'C',sk:'light_weapon'},
  'Laser Pistol':         {t:'Energy', dmg:'4D', eff:'—',             fr:2,   rng:'M', sk:'en_weapon'},
  'Laser Rifle':          {t:'Energy', dmg:'7D', eff:'—',             fr:1,   rng:'L', sk:'en_weapon'},
  'Flamer':               {t:'Big Guns',dmg:'5D', eff:'Persistent,Spread',fr:2,rng:'C',sk:'heavy_weapon'},
  'Minigun':              {t:'Big Guns',dmg:'3D', eff:'Spread',        fr:6,   rng:'M', sk:'heavy_weapon'},
  'Mains nues':           {t:'Unarmed',dmg:'2D', eff:'—',             fr:'—', rng:'—', sk:'barehand'},
  'Knuckles':             {t:'Unarmed',dmg:'3D', eff:'—',             fr:'—', rng:'—', sk:'barehand'},
  'Boxing Glove':         {t:'Unarmed',dmg:'3D', eff:'Stun',          fr:'—', rng:'—', sk:'barehand'},
};

const ENNEMIS_DB = {
  'Pillard':          {pvd:'1D+2', atq:'3D',          rd:0, xp:25,  body:6,  mind:4, desc:'Humain hostile basique. STR 5, AGI 5.'},
  'Pillard Vétéran':  {pvd:'2D+4', atq:'4D',          rd:1, xp:50,  body:7,  mind:5, desc:'Pillard expérimenté. STR 6, AGI 6. Arme améliorée.'},
  'Goule errante':    {pvd:'2D+2', atq:'3D',          rd:0, xp:30,  body:5,  mind:3, desc:'Goule lente et prévisible. END 6.'},
  'Goule enragée':    {pvd:'2D+4', atq:'4D',          rd:1, xp:60,  body:8,  mind:2, desc:'Goule agressive. AGI 8. Charge dès l\'init.'},
  'Goule irradiée':   {pvd:'3D+4', atq:'4D+rad',      rd:2, xp:80,  body:7,  mind:2, desc:'Irradie au contact. RAD 2 par touche.'},
  'Chien sauvage':    {pvd:'1D+2', atq:'2D',          rd:0, xp:15,  body:8,  mind:3, desc:'Rapide. AGI 9. Priorité aux membres.'},
  'Super Mutant':     {pvd:'3D+6', atq:'5D',          rd:2, xp:100, body:10, mind:4, desc:'STR 10, END 8. Arme lourde. Résistant.'},
  'Mite de vapeur':   {pvd:'2D+3', atq:'3D+brûlure',  rd:1, xp:45,  body:6,  mind:2, desc:'Crache vapeur brûlante. Zone Courte.'},
  'Radscorpion':      {pvd:'3D+5', atq:'4D+poison',   rd:3, xp:90,  body:9,  mind:3, desc:'Venin : 1D rad/tour. Carapace RD 3.'},
  'Mole Rat':         {pvd:'1D+3', atq:'3D',          rd:0, xp:20,  body:5,  mind:2, desc:'Attaque en groupe. Peut creuser.'},
  'Mirelurk':         {pvd:'3D+6', atq:'4D',          rd:4, xp:110, body:9,  mind:3, desc:'Carapace très résistante devant. Dos RD 0.'},
  'Robot Protectron': {pvd:'2D+4', atq:'3D laser',    rd:3, xp:70,  body:6,  mind:6, desc:'Laser. Explose à mort (4D blast).'},
  'Robot Assaultron': {pvd:'3D+5', atq:'5D laser',    rd:4, xp:120, body:8,  mind:7, desc:'Très rapide. Rayon tête dévastateur.'},
  'Légion de Fer':    {pvd:'2D+4', atq:'4D',          rd:2, xp:75,  body:7,  mind:6, desc:'Organisation militaire. Tactique de groupe.'},
  'Saccageur':        {pvd:'2D+3', atq:'3D',          rd:1, xp:40,  body:6,  mind:4, desc:'Armure de fortune. Imprévisible.'},
  'Marchand hostile': {pvd:'1D+4', atq:'3D',          rd:0, xp:35,  body:5,  mind:5, desc:'Tendu, armé. Peut fuir si blessé.'},
  'Homme de main':    {pvd:'2D+3', atq:'4D',          rd:1, xp:55,  body:7,  mind:5, desc:'Mercenaire. STR 6, AGI 7. Bien équipé.'},
  'Brahmane sauvage': {pvd:'2D+5', atq:'3D',          rd:1, xp:25,  body:7,  mind:2, desc:'Charge si perturbé. Deux têtes.'},
  'Radstag':          {pvd:'1D+3', atq:'2D',          rd:0, xp:10,  body:6,  mind:3, desc:'Fuit en priorité. Attaque si acculé.'},
};

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

function getTN(d, skKey) {
  const attr = SK_ATTR[skKey] || 'A';
  const map = {S:d.special?.S||5, P:d.special?.P||5, E:d.special?.E||5, C:d.special?.C||5, I:d.special?.I||5, A:d.special?.A||5, L:d.special?.L||5};
  const rang = d.skills?.[skKey] || 0;
  const tag  = d.taggedSkills?.includes(skKey) ? 2 : 0;
  return {total: map[attr]+rang+tag, attrVal: map[attr], rang, tag};
}
