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

// ---- Afficher nom/origine dans le bandeau ----
// Fonctionne pour fiche_perso (name-inp/meta) ET setup_perso (hdr-name/hdr-meta)
function afficherBandeau() {
  // fiche_perso
  const ni = document.getElementById('name-inp');
  if (ni && char.name) ni.textContent = char.name.toUpperCase();
  const mt = document.getElementById('meta');
  if (mt) mt.textContent = `LVL ${char.niveau||1} · ${char.origine||'—'} · ${char.xp||0} XP`;

  // setup_perso
  const hn = document.getElementById('hdr-name');
  if (hn && char.name) hn.textContent = char.name.toUpperCase();
  const hm = document.getElementById('hdr-meta');
  if (hm) hm.textContent = `${char.origine||'—'} · LVL ${char.niveau||1}`;
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

// ---- Patch rAll si elle existe (fiche_perso uniquement) ----
if (typeof rAll === 'function') {
  const _rAllOrig = rAll;
  let _isRemote = false;
  window.rAll = function() {
    _rAllOrig();
    afficherBandeau();
    if (!_isRemote) saveToFirebase();
  };

  // Écoute temps réel
  db.collection('joueurs').doc(JOUEUR_ID).onSnapshot((snap) => {
    if (snap.exists) {
      _isRemote = true;
      appliquerDonnees(snap.data());
      _rAllOrig();
      afficherBandeau();
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
      appliquerDonnees(snap.data());
    } else {
      await db.collection('joueurs').doc(JOUEUR_ID).set({
        nom: JOUEUR_ID, origine: '', niveau: 1, xp: 0,
        hp: 10, rad: 0, momentum: 0, powerArmor: false,
        special: char.special, perks: char.perks, skills: char.skills,
        taggedSkills: [], inventory: [], ammo: [],
        wounds: char.wounds, lastUpdate: Date.now(),
      });
    }
    // Render puis afficher le bandeau EN DERNIER
    if (typeof rAll === 'function') rAll();
    afficherBandeau();
    setStatus('✓ ' + (char.name || JOUEUR_ID), '#5dbe5d');
  } catch (e) {
    setStatus('✗ Erreur Firebase', '#e04040');
    console.error(e);
  }
}

initFirebase();
