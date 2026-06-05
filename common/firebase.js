// ============================================================
// FIREBASE — Connexion et synchronisation temps réel
// ============================================================

// firebaseConfig défini dans common/shared.js
const fbApp = firebase.initializeApp(firebaseConfig);
const db = fbApp.firestore();

// ID joueur depuis l'URL
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
  if (data.nom       !== undefined) char.name      = data.nom;
  if (data.origine   !== undefined) char.origine   = data.origine;
  if (data.niveau    !== undefined) char.niveau    = data.niveau;
  if (data.xp        !== undefined) char.xp        = data.xp;
  // allocatedLevel : niveau jusqu'auquel rang+perk ont été répartis.
  // Migration douce : un perso existant sans le champ est considéré « déjà réparti »
  // (allocatedLevel = niveau actuel), pour ne pas générer d'alertes rétroactives.
  if (data.allocatedLevel !== undefined) char.allocatedLevel = data.allocatedLevel;
  else if (char.allocatedLevel == null && data.niveau !== undefined) {
    char.allocatedLevel = data.niveau;
    saveToFirebase();
  }
  if (data.hp        !== undefined) char.hp        = data.hp;
  if (data.rad       !== undefined) char.rad       = data.rad;
  if (data.momentum  !== undefined) char.momentum  = data.momentum;
  if (data.powerArmor!== undefined) char.powerArmor= data.powerArmor;
  if (data.special   !== undefined) char.special   = data.special;
  if (data.perks     !== undefined) char.perks     = { ...char.perks, ...data.perks };
  if (data.skills    !== undefined) char.skills    = data.skills;
  if (data.taggedSkills !== undefined) char.taggedSkills = data.taggedSkills;
  if (data.inventory !== undefined) char.inventory = data.inventory;
  if (data.ammo      !== undefined) char.ammo      = data.ammo;
  if (data.wounds       !== undefined) char.wounds       = data.wounds;
  if (data.luck_points  !== undefined) char.luck_points  = data.luck_points;
  if (data.companions   !== undefined) char.companions   = data.companions;
}

// ---- Mettre à jour l'affichage du nom dans le bandeau ----
function afficherNom() {
  const el = document.getElementById('name-inp');
  if (!el) return;
  const nom = char.name || JOUEUR_ID;
  if (nom && nom !== '') el.textContent = nom.toUpperCase();
}

// ---- Sauvegarder dans Firebase ----
let saveTimer = null;
function saveToFirebase() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      setStatus('⟳ Sauvegarde...', '#e8a820');
      await db.collection('joueurs').doc(JOUEUR_ID).set({
        nom:          char.name,
        origine:      char.origine,
        niveau:       char.niveau,
        xp:           char.xp,
        allocatedLevel: char.allocatedLevel,
        hp:           char.hp,
        rad:          char.rad,
        momentum:     char.momentum,
        powerArmor:   char.powerArmor,
        special:      char.special,
        perks:        char.perks,
        skills:       char.skills,
        taggedSkills: char.taggedSkills,
        inventory:    char.inventory,
        ammo:         char.ammo,
        wounds:       char.wounds,
        luck_points:  char.luck_points,
        companions:   char.companions,
        lastUpdate:   Date.now(),
      }, { merge: true });
      setStatus('✓ Synchronisé', '#5dbe5d');
    } catch (e) {
      setStatus('✗ Erreur sync', '#e04040');
      console.error(e);
    }
  }, 800);
}

// ---- Patch rAll pour déclencher la sauvegarde ----
const _rAllOrig = rAll;
let _isRemote = false;
window.rAll = function() {
  _rAllOrig();
  afficherNom();
  if (!_isRemote) saveToFirebase();
};

// ---- Écoute temps réel ----
function startSync() {
  db.collection('joueurs').doc(JOUEUR_ID).onSnapshot((snap) => {
    if (snap.exists) {
      _isRemote = true;
      try { appliquerDonnees(snap.data()); _rAllOrig(); afficherNom(); }
      catch (e) { console.error('Erreur rendu/sync fiche :', e); }
      finally { _isRemote = false; }
      setStatus('✓ Synchronisé', '#5dbe5d');
    }
  }, (err) => {
    setStatus('✗ Connexion perdue', '#e04040');
    console.error(err);
  });
  // Lancer de dés public — isolé : une erreur ici ne doit jamais casser la fiche
  try {
    db.collection('rolls').doc('current').onSnapshot(
      (snap) => { try { renderRollJoueur(snap.exists ? snap.data() : null); } catch(e){ console.error('roll:', e); } },
      (err) => console.warn('rolls indisponible:', err && err.code)
    );
  } catch(e){ console.warn('rolls listener KO:', e); }
  // Butin partagé — bandeau d'alerte si du butin est accessible à ce joueur
  try {
    db.collection('butin').doc('data').onSnapshot(
      (snap) => { try { renderLootAlert(snap.exists ? snap.data() : null); } catch(e){ console.error('loot:', e); } },
      (err) => console.warn('butin indisponible:', err && err.code)
    );
  } catch(e){ console.warn('butin listener KO:', e); }
}

// ============================================================
// LANCER DE DÉS PUBLIC (côté joueur)
// ============================================================
let _currentRoll = null;
const _ATTR3_LETTER = { FOR:'S', PER:'P', END:'E', CHR:'C', INT:'I', AGI:'A', LCK:'L' };
function _skillAttrLetter(key){ const s = (typeof SKILLS_DEF!=='undefined'?SKILLS_DEF:[]).find(x => x.key === key); return s ? _ATTR3_LETTER[s.attr] : 'A'; }

// Calcule le résultat du joueur courant pour le lancer r
function rollPublicLocal(r){
  const nom = char.name || JOUEUR_ID;
  if(r.mode === 'dice'){
    const dice = Array.from({length: r.n}, () => 1 + Math.floor(Math.random() * r.faces));
    return { nom, dice, total: dice.reduce((a,b)=>a+b,0) };
  }
  // test 2D20
  let tn, rang = 0, tag = false;
  if(r.isAttr){ tn = char.special?.[r.skillKey] || 5; }
  else {
    const attrVal = char.special?.[_skillAttrLetter(r.skillKey)] || 5;
    rang = char.skills?.[r.skillKey] || 0;
    tag = (char.taggedSkills||[]).includes(r.skillKey);
    tn = attrVal + rang + (tag ? 2 : 0);
  }
  const critThresh = Math.max(1, tag ? rang : 1);   // crit sur 1, ou ≤ rang si compétence taguée
  const dice = [1 + Math.floor(Math.random()*20), 1 + Math.floor(Math.random()*20)];
  let succ = 0, crit = false, comp = false;
  dice.forEach(dv => { if(dv <= critThresh){ succ += 2; crit = true; } else if(dv <= tn){ succ += 1; } if(dv === 20) comp = true; });
  return { nom, dice, total: succ, tn, successes: succ, crit, comp };
}

function lancerMonDe(){
  const r = _currentRoll; if(!r || !r.open) return;
  if(!(r.players||[]).includes(JOUEUR_ID)) return;
  if(r.results && r.results[JOUEUR_ID]) return;       // déjà lancé
  const res = rollPublicLocal(r);
  // petite animation de roulement avant d'envoyer le résultat
  const box = document.getElementById('roll-box');
  if(box){ box.classList.add('rolling'); setTimeout(()=>box.classList.remove('rolling'), 520); }
  setTimeout(() => db.collection('rolls').doc('current').update({ ['results.' + JOUEUR_ID]: res }), 480);
}

function _fmtRollJoueur(res, r){
  if(r.mode === 'dice') return `[${res.dice.join(', ')}] = <b>${res.total}</b>`;
  const tags = (res.crit ? ' ✦' : '') + (res.comp ? ' ⚠' : '');
  return `[${res.dice.join(', ')}] → <b>${res.successes} succ.</b>${tags}`;
}
function renderRollJoueur(r){
  _currentRoll = r;
  const box = document.getElementById('roll-box'); if(!box) return;
  if(!r || !r.open){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  document.getElementById('roll-title').textContent = '🎲 ' + (r.label || 'Lancer');
  const involved = (r.players||[]).includes(JOUEUR_ID);
  const rolled = r.results && r.results[JOUEUR_ID];
  const btn = document.getElementById('roll-btn');
  btn.style.display = (involved && !rolled) ? 'block' : 'none';
  box.classList.toggle('alert', involved && !rolled);
  const list = (r.players||[]).map(id => {
    const res = r.results?.[id];
    const nom = res?.nom || (id === JOUEUR_ID ? (char.name||id) : id);
    const me = id === JOUEUR_ID ? ' me' : '';
    return `<div class="roll-row${me}"><span class="roll-nom">${nom}</span><span class="roll-res">${res ? _fmtRollJoueur(res, r) : '⏳…'}</span></div>`;
  }).join('');
  document.getElementById('roll-list').innerHTML = list;
}

// Bandeau butin : visible si le pool n'est pas vide ET ce joueur a l'accès (players)
function renderLootAlert(d){
  const al = document.getElementById('loot-alert'); if(!al) return;
  const items = d && Array.isArray(d.items) ? d.items : [];
  const players = d && Array.isArray(d.players) ? d.players : [];
  const accessible = items.length > 0 && players.includes(JOUEUR_ID);
  al.style.display = accessible ? 'flex' : 'none';
  if(accessible){ const c = document.getElementById('loot-count'); if(c) c.textContent = '(' + items.length + ')'; }
  else { const mo = document.getElementById('mo-loot'); if(mo) mo.classList.remove('on'); }   // accès retiré → ferme la modale
}

// ---- Initialisation ----
async function initFirebase() {
  setStatus('⟳ Connexion...', '#e8a820');
  document.title = 'Fallout Paris — ' + JOUEUR_ID;
  try {
    const snap = await db.collection('joueurs').doc(JOUEUR_ID).get();
    if (snap.exists) {
      const data = snap.data();
      // Afficher le nom immédiatement depuis Firebase, sans attendre rAll
      const ni = document.getElementById('name-inp');
      if (ni && data.nom) ni.textContent = data.nom.toUpperCase();
      const mt = document.getElementById('meta');
      if (mt && data.origine) mt.textContent = `LVL ${data.niveau||1} · ${data.origine} · ${data.xp||0}/${data.niveau>=20?21000:[0,100,300,600,1000,1500,2100,2800,3600,4500][Math.min(data.niveau||1,9)]} XP`;
      try { appliquerDonnees(data); } catch (e) { console.error('appliquerDonnees:', e); }
    } else {
      // Nouveau joueur — créer le document avec les valeurs par défaut
      await db.collection('joueurs').doc(JOUEUR_ID).set({
        nom: JOUEUR_ID, origine: '', niveau: 1, xp: 0,
        hp: 10, rad: 0, momentum: 0, powerArmor: false,
        special: char.special, perks: char.perks, skills: char.skills,
        taggedSkills: [], inventory: [], ammo: [],
        wounds: char.wounds, lastUpdate: Date.now(),
      });
    }
  } catch (e) {
    setStatus('✗ Erreur Firebase', '#e04040');
    console.error(e);
  }
  // TOUJOURS rendre + démarrer la synchro temps réel (même si le get initial a échoué)
  try { rAll(); } catch (e) { console.error('rAll init:', e); }
  startSync();
  setStatus('✓ ' + (char.name || JOUEUR_ID), '#5dbe5d');
}

window.DB_READY.then(() => {
  initFirebase();
});

// ---- Listener combat temps réel ----
function initCombatListener() {
  let _combatUnsub = null;
  let _lastCombatId = undefined;

  function _attachCombat(combatId) {
    if(combatId === _lastCombatId) return; // déjà attaché, éviter les re-attaches inutiles
    _lastCombatId = combatId;
    if(_combatUnsub) { _combatUnsub(); _combatUnsub = null; }
    if(!combatId) {
      const b = document.getElementById('combat-banner');
      if(b) b.style.display = 'none';
      return;
    }
    _combatUnsub = db.collection('combat').doc(combatId).onSnapshot(snap => {
      const data = snap.exists ? snap.data() : null;
      let banner = document.getElementById('combat-banner');

      if(!data || !data.actif) {
        if(banner) banner.style.display = 'none';
        return;
      }

      if(!banner) {
        banner = document.createElement('div');
        banner.id = 'combat-banner';
        banner.style.cssText = [
          'position:fixed;top:0;left:0;right:0;z-index:500',
          'background:#1a0505;border-bottom:2px solid #e04040',
          'display:flex;align-items:center;justify-content:space-between',
          'padding:6px 16px;font-family:"Share Tech Mono",monospace',
        ].join(';');
        document.body.appendChild(banner);
        document.body.style.paddingTop = '40px';
      }

      const ordre = data.ordreInitiative || [];
      const tourActif = data.tourActif || 0;
      const currentCombatant = ordre[tourActif];
      const isMonTour = currentCombatant?.id === JOUEUR_ID;
      const nomActif = currentCombatant?.nom || '?';
      const tourText = isMonTour ? "▶ C'EST TON TOUR !" : "Tour de " + nomActif;
      const tourColor = isMonTour ? '#5dbe5d' : '#e8a820';

      banner.style.display = 'flex';
      banner.style.background = isMonTour ? '#0a1a0a' : '#1a0505';
      banner.style.borderBottomColor = isMonTour ? '#5dbe5d' : '#e04040';
      banner.innerHTML =
        '<span style="color:#e04040;font-size:9px;letter-spacing:2px">⚔ COMBAT · Round ' + (data.numRound||1) + '</span>' +
        '<span style="color:' + tourColor + ';font-size:10px;letter-spacing:2px;font-weight:bold">' + tourText + '</span>' +
        '<a href="../mj/combat_joueur.html?id=' + JOUEUR_ID + '&combat=' + combatId + '" ' +
          'style="color:#e04040;font-size:8px;border:1px solid #e04040;padding:3px 10px;text-decoration:none;letter-spacing:2px"' +
        '>⚔ REJOINDRE</a>';
    });
  }

  // Lit le combatId depuis le doc du joueur (isolé par joueur → multi-room safe)
  db.collection('joueurs').doc(JOUEUR_ID).onSnapshot(snap => {
    _attachCombat(snap.exists ? (snap.data()?.combatId || null) : null);
  });
}

// Lancer le listener combat après init Firebase
window.DB_READY.then(() => {
  initCombatListener();
});
