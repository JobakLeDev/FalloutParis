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
