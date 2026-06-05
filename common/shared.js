// ============================================================
// SHARED — Constantes partagées entre toutes les pages
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",
  authDomain: "fallout-paris.firebaseapp.com",
  projectId: "fallout-paris",
  storageBucket: "fallout-paris.firebasestorage.app",
  messagingSenderId: "1063413308699",
  appId: "1:1063413308699:web:09e0e13c2200283b22c7be"
};

const XP_TABLE = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];

const SKILLS_DEF = [
  {name:'Armes énergie', attr:'PER', key:'en_weapon'},
  {name:'Armes de CàC',  attr:'FOR', key:'cac_weapon'},
  {name:'Armes légères', attr:'AGI', key:'light_weapon'},
  {name:'Armes lourdes', attr:'END', key:'heavy_weapon'},
  {name:'Athlétisme',    attr:'FOR', key:'athletics'},
  {name:'Crochetage',    attr:'PER', key:'lockpick'},
  {name:'Discours',      attr:'CHR', key:'speech'},
  {name:'Discrétion',    attr:'AGI', key:'sneak'},
  {name:'Explosifs',     attr:'PER', key:'explosives'},
  {name:'Mains nues',    attr:'FOR', key:'barehand'},
  {name:'Médecine',      attr:'INT', key:'medicine'},
  {name:'Pilotage',      attr:'PER', key:'pilot'},
  {name:'Projectiles',   attr:'AGI', key:'throwing'},
  {name:'Réparation',    attr:'INT', key:'repair'},
  {name:'Sciences',      attr:'INT', key:'science'},
  {name:'Survie',        attr:'END', key:'survival'},
  {name:'Troc',          attr:'CHR', key:'barter'},
];

// ============================================================
// CALENDRIER DE CAMPAGNE
// Époque (Jour 0 = minute 0) : 14 juillet 2189 00:00.
// Le temps est stocké en MINUTES écoulées depuis l'époque, par GROUPE (party).
// /temps/data = { parties: [{id, name, players:[ids], minutes}] }
// ============================================================
const TEMPS_EPOCH = new Date(2189, 6, 14, 0, 0, 0);   // mois 6 = juillet
const TEMPS_DEFAUT = 8 * 60;                          // démarrage par défaut : 08:00
const TEMPS_MOIS  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const TEMPS_JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
function tempsDate(min){ return new Date(TEMPS_EPOCH.getTime() + (min||0) * 60000); }
function tempsMinutesDepuis(d){ return Math.round((d.getTime() - TEMPS_EPOCH.getTime()) / 60000); }
function fmtHeure(min){ const d = tempsDate(min); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function fmtDateCourt(min){ const d = tempsDate(min); return `${d.getDate()} ${TEMPS_MOIS[d.getMonth()].slice(0,4)}. ${d.getFullYear()}`; }
function fmtDateLong(min){ const d = tempsDate(min); return `${TEMPS_JOURS[d.getDay()]} ${d.getDate()} ${TEMPS_MOIS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtDateTime(min){ return fmtDateLong(min) + ' · ' + fmtHeure(min); }
// Minutes du groupe auquel appartient le joueur pid (sinon 1er groupe, sinon défaut)
function partyMinutesFor(tempsData, pid){
  const parties = (tempsData && Array.isArray(tempsData.parties)) ? tempsData.parties : [];
  const p = parties.find(x => (x.players || []).includes(pid));
  if (p) return p.minutes || 0;
  return parties.length ? (parties[0].minutes || 0) : TEMPS_DEFAUT;
}
