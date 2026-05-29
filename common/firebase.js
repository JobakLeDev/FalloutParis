// ============================================================
// FIREBASE — Connexion et synchronisation temps réel
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",
  authDomain: "fallout-paris.firebaseapp.com",
  projectId: "fallout-paris",
  storageBucket: "fallout-paris.firebasestorage.app",
  messagingSenderId: "1063413308699",
  appId: "1:1063413308699:web:09e0e13c2200283b22c7be"
};

const fbApp = firebase.initializeApp(firebaseConfig);
const db = fbApp.firestore();

const JOUEUR_ID = new URLSearchParams(window.location.search).get('id') || 'joueur1';

// ---- Indicateur de statut ----
function setStatus(msg, color) {
  let el = document.getElementById('fb-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fb-status';
    el.style.cssText = 'position:fixed;bottom:10px;right:10px;font-size:9px;padding:4px 10px;border:1px solid;letter-spacing:1px;font-family:"Share Tech Mono",monospace;z-index:999;background:#0c150c;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.color = color;
  el.style.borderColor = color;
}

// ---- Appliquer les données Firebase sur char ----
function appliquerDonnees(data) {
  if (!data) return;
  if (data.nom        !== undefined) char.name       = data.nom;
  if (data.origine    !== undefined) char.origine    = data.origine;
  if (data.niveau     !== undefined) char.niveau     = data.niveau;
  if (data.xp         !== undefined) char.xp         = data.xp;
  if (data.hp         !== undefined) char.hp         = data.hp;
  if (data.rad        !== undefined) char.rad        = data.rad;
  if (data.momentum   !== undefined) char.momentum   = data.momentum;
  if (data.powerArmor !== undefined) char.powerArmor = data.powerArmor;
  if (data.special    !== undefined) char.special    = data.special;
  if (data.perks      !== undefined) char.perks      = { ...char.perks, ...data.perks };
  if (data.skills     !== undefined) char.skills     = data.skills;
  if (data.taggedSkills !== undefined) char.taggedSkills = data.taggedSkills;
  if (data.inventory  !== undefined) char.inventory  = data.inventory;
  if (data.ammo       !== undefined) char.ammo       = data.ammo;
  if (data.wounds     !== undefined) char.wounds     = data.wounds;
}

// ---- Afficher nom et origine directement dans le DOM ----
function afficherBandeau() {
  const ni = document.getElementById('name-inp');
  if (ni && char.name) ni.textContent = char.name.toUpperCase();

  const mt = document.getElementById('meta');
  if (mt && char.origine !== undefined) {
    const xpNext = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];
    mt.textContent = `LVL ${char.niveau||1} · ${char.origine||'—'} · ${char.xp||0}/${xpNext[Math.min(char.niveau||1,20)]} XP`;
  }
}

// ---- Sauvegarder dans Firebase ----
let saveTimer = null;
function saveToFirebase() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      setStatus('⟳ Sauvegarde...', '#e8a820');
      await db.collection('joueurs').doc(JOUEUR_ID).set({
        nom: char.name, origine: char.origine, niveau: char.niveau,
        xp: char.xp, hp: char.hp, rad: char.rad,
        momentum: char.momentum, powerArmor: char.powerArmor,
        special: char.special, perks: char.perks, skills: char.skills,
        taggedSkills: char.taggedSkills, inventory: char.inventory,
        ammo: char.ammo, wounds: char.wounds, lastUpdate: Date.now(),
      }, { merge: true });
      setStatus('✓ Synchronisé', '#5dbe5d');
    } catch (e) {
      setStatus('✗ Erreur sync', '#e04040');
      console.error(e);
    }
  }, 800);
}

// ---- Patch rAll ----
const _rAllOrig = rAll;
let _isRemote = false;
window.rAll = function() {
  _rAllOrig();
  afficherBandeau(); // toujours après rAll pour ne pas être écrasé
  if (!_isRemote) saveToFirebase();
};

// ---- Écoute temps réel ----
function startSync() {
  db.collection('joueurs').doc(JOUEUR_ID).onSnapshot((snap) => {
    if (snap.exists) {
      _isRemote = true;
      appliquerDonnees(snap.data());
      _rAllOrig();
      if (typeof rMeta === 'function') rMeta();
      _isRemote = false;
      setStatus('✓ Synchronisé', '#5dbe5d');
    }
  }, (err) => {
    setStatus('✗ Connexion perdue', '#e04040');
    console.error(err);
  });
}

// ---- Initialisation ----
async function initFirebase() {
  setStatus('⟳ Connexion...', '#e8a820');
  document.title = 'Fallout Paris — ' + JOUEUR_ID;
  try {
    const snap = await db.collection('joueurs').doc(JOUEUR_ID).get();
    if (snap.exists) {
      appliquerDonnees(snap.data());  // 1. charger dans char
      // 2. Afficher nom et origine immédiatement
      if (typeof rMeta === 'function') rMeta();
    } else {
      await db.collection('joueurs').doc(JOUEUR_ID).set({
        nom: JOUEUR_ID, origine: '', niveau: 1, xp: 0,
        hp: 10, rad: 0, momentum: 0, powerArmor: false,
        special: char.special, perks: char.perks, skills: char.skills,
        taggedSkills: [], inventory: [], ammo: [],
        wounds: char.wounds, lastUpdate: Date.now(),
      });
    }
    _rAllOrig();          // 2. render avec les données
    afficherBandeau();    // 3. afficher nom/origine EN DERNIER
    startSync();
    setStatus('✓ ' + (char.name || JOUEUR_ID), '#5dbe5d');
  } catch (e) {
    setStatus('✗ Erreur Firebase', '#e04040');
    console.error(e);
  }
}

initFirebase();
