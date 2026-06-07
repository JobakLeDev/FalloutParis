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
  if (data.caps         !== undefined) char.caps         = data.caps;
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
        caps:         char.caps,
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
  // Calendrier — date/heure du groupe du joueur
  try {
    db.collection('temps').doc('data').onSnapshot(
      (snap) => { try { renderFicheClock(snap.exists ? snap.data() : null); } catch(e){ console.error('temps:', e); } },
      (err) => console.warn('temps indisponible:', err && err.code)
    );
  } catch(e){ console.warn('temps listener KO:', e); }
  // Messagerie — noms des joueurs + contacts (numéros échangés)
  try {
    db.collection('joueurs').onSnapshot((s) => { _allJoueurs = {}; s.forEach(d => _allJoueurs[d.id] = d.data()); if (document.getElementById('mo-msg')?.classList.contains('on')) renderContacts(); renderFicheGroup(_tempsData); });
    db.collection('messagerie').doc('data').onSnapshot((s) => { const d = s.exists ? s.data() : {}; _msgLinks = (d.links && typeof d.links === 'object') ? d.links : {}; _syncConvWatchers(); updateMsgIcon(); if (document.getElementById('mo-msg')?.classList.contains('on')) renderContacts(); });
  } catch(e){ console.warn('messagerie listener KO:', e); }
  // Échanges entre joueurs — bandeau d'alerte (la proposition s'accepte dans l'onglet CARTE)
  try {
    db.collection('echanges').where('to','==',JOUEUR_ID).onSnapshot(
      (s) => { let n = 0; s.forEach(d => { if(d.data().status === 'pending') n++; }); renderPropAlert(n); },
      (err) => console.warn('echanges indisponible:', err && err.code)
    );
  } catch(e){ console.warn('echanges listener KO:', e); }
  // Boutique itinérante — bandeau si le marchand est ouvert à ce joueur
  try {
    db.collection('boutiques').doc('data').onSnapshot(
      (s) => { try { renderShopAlert(s.exists ? s.data() : null); } catch(e){ console.error('shop:', e); } },
      (err) => console.warn('boutiques indisponible:', err && err.code)
    );
  } catch(e){ console.warn('boutiques listener KO:', e); }
  // Radio — diffusion synchronisée pilotée par le MJ (le joueur suit ; couper + volume)
  try {
    radioInitFollower();
    db.collection('radio').doc('current').onSnapshot(
      (s) => { try { _radioState = s.exists ? s.data() : null; applyRadio(); } catch(e){ console.error('radio:', e); } },
      (err) => console.warn('radio indisponible:', err && err.code)
    );
  } catch(e){ console.warn('radio listener KO:', e); }
}

// ============================================================
// RADIO (côté joueur) — suit /radio/current, audio persistant dans le header
// ============================================================
let _radioAudio = null, _radioState = null;
let _radioMuted = (localStorage.getItem('fp_radioMuted') === '1');
let _radioVol   = parseInt(localStorage.getItem('fp_radioVol') || '70');
function _radioSrcBuild(folder, track){
  if(/^https?:/i.test(track)) return track;
  return '../../' + (folder||'audio') + '/' + track.split('/').map(encodeURIComponent).join('/');
}
function radioInitFollower(){
  if(!_radioAudio){ _radioAudio = new Audio(); _radioAudio.volume = _radioVol/100; }
  const v = document.getElementById('rad-vol'); if(v) v.value = _radioVol;
  _radioUpdateMuteBtn();
}
const _SPK_ON  = '<svg class="ic" viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const _SPK_OFF = '<svg class="ic" viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
function _radioUpdateMuteBtn(){ const b=document.getElementById('rad-mute'); if(b){ b.innerHTML = _radioMuted ? _SPK_OFF : _SPK_ON; b.classList.toggle('off', _radioMuted); } }
function applyRadio(){
  if(!_radioAudio) radioInitFollower();
  const box = document.getElementById('hdr-radio');
  const lbl = document.getElementById('rad-bc-track');
  const d = _radioState;
  if(!d || !d.playing || !d.track){
    if(_radioAudio){ _radioAudio.pause(); _radioAudio.dataset.k=''; }
    if(box) box.style.display = 'none';
    return;
  }
  if(box) box.style.display = 'flex';
  const key = (d.track||'') + '@' + (d.startedAt||0);
  if(_radioAudio.dataset.k !== key){
    _radioAudio.dataset.k = key;
    _radioAudio.src = _radioSrcBuild(d.folder, d.track);
    const off = (Date.now() - (d.startedAt||Date.now())) / 1000;
    _radioAudio.addEventListener('loadedmetadata', function h(){
      _radioAudio.removeEventListener('loadedmetadata', h);
      if(off > 0 && isFinite(_radioAudio.duration) && off < _radioAudio.duration){ try{ _radioAudio.currentTime = off; }catch(e){} }
    });
    if(!_radioMuted) _radioAudio.play().catch(()=>{ if(lbl) lbl.textContent = '🔇 clique pour activer le son'; });
  } else {
    if(_radioMuted) _radioAudio.pause(); else if(_radioAudio.paused) _radioAudio.play().catch(()=>{});
  }
  if(lbl){
    const text = (d.name || d.station || 'Radio') + (d.trackLabel ? ' — ' + d.trackLabel : '');
    lbl.innerHTML = '<span class="mq">' + esc(text) + '</span>';
    requestAnimationFrame(() => {
      const mq = lbl.querySelector('.mq'); if(!mq) return;
      const over = mq.scrollWidth - lbl.clientWidth;
      if(over > 4){ lbl.classList.add('scrolling'); lbl.style.setProperty('--mq-shift', (-over - 6) + 'px'); lbl.style.setProperty('--mq-dur', Math.max(4, (over + 6) / 22) + 's'); }
      else { lbl.classList.remove('scrolling'); lbl.style.removeProperty('--mq-shift'); }
    });
  }
}
function radioMute(){
  _radioMuted = !_radioMuted;
  try{ localStorage.setItem('fp_radioMuted', _radioMuted ? '1' : '0'); }catch(e){}
  _radioUpdateMuteBtn();
  applyRadio();
}
function radioVol(v){ _radioVol = parseInt(v)||0; if(_radioAudio) _radioAudio.volume = _radioVol/100; try{ localStorage.setItem('fp_radioVol', _radioVol); }catch(e){} }

// Bandeau « marchand disponible » → ouvre la modale boutique itinérante ('mj')
function renderShopAlert(d){
  const al = document.getElementById('shop-alert'); if(!al) return;
  const sh = d && d.shops && d.shops['mj'];
  const open = !!(sh && Array.isArray(sh.openFor) && sh.openFor.includes(JOUEUR_ID) && (sh.items||[]).length);
  al.style.display = open ? 'flex' : 'none';
  if(!open){ const mo = document.getElementById('mo-shop'); if(mo) mo.classList.remove('on'); }
}

// Bandeau « proposition d'un autre joueur » → ouvre l'onglet CARTE pour accepter/refuser
function renderPropAlert(n){
  const al = document.getElementById('prop-alert'); if(!al) return;
  al.style.display = n > 0 ? 'flex' : 'none';
  const c = document.getElementById('prop-count'); if(c) c.textContent = n > 1 ? '(' + n + ')' : '';
}
function openPropOnMap(){ if(typeof sw === 'function') sw('carte'); }

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
  const detail = r.mode === 'dice' ? `${res.dice.join(', ')} = ${res.total}` : `${res.successes} succ.${res.crit?' ✦':''}${res.comp?' ⚠':''}`;
  if(typeof fpLogAction === 'function') fpLogAction(db, char.name || JOUEUR_ID, `a lancé « ${r.label||'dés'} » : ${detail}`);
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

// Affiche la date/heure du groupe (party) du joueur dans le header de la fiche
let _tempsData = null;
function renderFicheClock(d){
  _tempsData = d;
  const el = document.getElementById('fiche-clock');
  if(el && typeof partyMinutesFor === 'function') el.textContent = fmtDateTime(partyMinutesFor(d, JOUEUR_ID));
  renderFicheGroup(d);
}
// Affiche le groupe (party) du joueur + ses coéquipiers
function renderFicheGroup(d){
  const el = document.getElementById('fiche-group'); if(!el) return;
  const parties = (d && Array.isArray(d.parties)) ? d.parties : [];
  const p = parties.find(x => Array.isArray(x.players) && x.players.includes(JOUEUR_ID) && !x.solo);
  if(!p){ el.style.display = 'none'; el.innerHTML = ''; return; }
  const others = (p.players || []).filter(id => id !== JOUEUR_ID).map(id => esc(_allJoueurs[id]?.nom || id));
  el.style.display = '';
  el.innerHTML = `👥 <b>${esc(p.name || 'Groupe')}</b> — ` + (others.length ? others.join(', ') : 'toi seul pour l\'instant');
}

// ============================================================
// MESSAGERIE (PIP-MESSAGER) — contacts via /messagerie/data, historique /messages/{convId}
// ============================================================
let _allJoueurs = {};
let _msgLinks = {};
let _activeConv = null;     // id du contact courant
let _convUnsub = null;
let _convLatest = {};       // convId -> ts du dernier message REÇU (from !== moi)
let _convWatch = {};        // convId -> unsub (écoute non-lus)
let _msgRead = (()=>{ try{ return JSON.parse(localStorage.getItem('fp_msgRead_'+JOUEUR_ID)||'{}'); }catch(e){ return {}; } })();
function _saveMsgRead(){ try{ localStorage.setItem('fp_msgRead_'+JOUEUR_ID, JSON.stringify(_msgRead)); }catch(e){} }
function _convId(a, b){ return [a, b].sort().join('__'); }
function _contactName(id){ return id === 'mj' ? '📟 Maître du Jeu' : (_allJoueurs[id]?.nom || id); }
function _myContacts(){
  const arr = Array.isArray(_msgLinks[JOUEUR_ID]) ? _msgLinks[JOUEUR_ID].slice() : [];
  if(!arr.includes('mj')) arr.unshift('mj');   // le MJ est toujours joignable
  return arr;
}
function _latestIncoming(msgs){ let t=0; (msgs||[]).forEach(m=>{ if(m && m.from!==JOUEUR_ID && (m.ts||0)>t) t=m.ts||0; }); return t; }
function _hasUnread(){ return Object.keys(_convLatest).some(cid => (_convLatest[cid]||0) > (_msgRead[cid]||0)); }
// (Ré)abonne une écoute légère à chaque conversation de mes contacts pour repérer les non-lus
function _syncConvWatchers(){
  const wanted = {};
  _myContacts().forEach(id => { wanted[_convId(JOUEUR_ID, id)] = true; });
  Object.keys(_convWatch).forEach(cid => { if(!wanted[cid]){ _convWatch[cid](); delete _convWatch[cid]; delete _convLatest[cid]; } });
  Object.keys(wanted).forEach(cid => {
    if(_convWatch[cid]) return;
    _convWatch[cid] = db.collection('messages').doc(cid).onSnapshot((s) => {
      const msgs = (s.exists && Array.isArray(s.data().msgs)) ? s.data().msgs : [];
      _convLatest[cid] = _latestIncoming(msgs);
      // si la conversation est ouverte, on considère le contenu comme lu
      if(_activeConv && _convId(JOUEUR_ID, _activeConv) === cid){ _msgRead[cid] = Math.max(_msgRead[cid]||0, _convLatest[cid]); _saveMsgRead(); }
      updateMsgIcon();
      if(document.getElementById('mo-msg')?.classList.contains('on')) renderContacts();
    }, (e)=>console.warn('conv-watch:', e && e.code));
  });
}
function updateMsgIcon(){
  const ic = document.getElementById('msg-icon'); if(ic) ic.style.display = 'inline-block';   // toujours visible
  const dot = document.getElementById('msg-dot'); if(dot) dot.style.display = _hasUnread() ? 'block' : 'none';
}
function openMsg(){
  const mo = document.getElementById('mo-msg'); if(!mo) return;
  renderContacts();
  mo.classList.add('on');
}
function renderContacts(){
  const el = document.getElementById('msg-contacts'); if(!el) return;
  const contacts = _myContacts();
  if(!contacts.length){ el.innerHTML = '<div class="msg-empty">Aucun contact. Échange ton numéro avec quelqu\'un (via le MJ).</div>'; return; }
  el.innerHTML = contacts.map(id => {
    const nom = _contactName(id);
    const on = _activeConv === id;
    const cid = _convId(JOUEUR_ID, id);
    const unread = (_convLatest[cid]||0) > (_msgRead[cid]||0);
    return `<button class="msg-contact${on?' on':''}${unread?' unread':''}" onclick="openConv('${id}')">${esc(nom)}${unread?'<span class="msg-contact-dot"></span>':''}</button>`;
  }).join('');
}
function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function openConv(otherId){
  _activeConv = otherId;
  renderContacts();
  document.getElementById('msg-conv-head').textContent = '💬 ' + _contactName(otherId);
  document.getElementById('msg-input-row').style.display = 'flex';
  if(_convUnsub){ _convUnsub(); _convUnsub = null; }
  const cid = _convId(JOUEUR_ID, otherId);
  _convUnsub = db.collection('messages').doc(cid).onSnapshot((s) => {
    const msgs = (s.exists && Array.isArray(s.data().msgs)) ? s.data().msgs : [];
    renderMsgs(msgs);
    // conversation ouverte → marquée lue
    _convLatest[cid] = _latestIncoming(msgs);
    _msgRead[cid] = Math.max(_msgRead[cid]||0, _convLatest[cid]);
    _saveMsgRead();
    updateMsgIcon();
  }, (e)=>console.warn('conv:', e && e.code));
}
function renderMsgs(msgs){
  const el = document.getElementById('msg-list'); if(!el) return;
  if(!msgs.length){ el.innerHTML = '<div class="msg-empty">Aucun message. Dis bonjour !</div>'; return; }
  el.innerHTML = msgs.slice().sort((a,b)=>(a.ts||0)-(b.ts||0)).map(m => {
    const me = m.from === JOUEUR_ID;
    const t = new Date(m.ts||0);
    const hh = String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
    return `<div class="msg-bubble${me?' me':''}"><div class="msg-txt">${esc(m.text)}</div><div class="msg-ts">${hh}</div></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
function sendMsg(){
  const inp = document.getElementById('msg-text'); if(!inp || !_activeConv) return;
  const text = inp.value.trim(); if(!text) return;
  inp.value = '';
  const msg = { from: JOUEUR_ID, text, ts: Date.now() };
  db.collection('messages').doc(_convId(JOUEUR_ID, _activeConv))
    .set({ msgs: firebase.firestore.FieldValue.arrayUnion(msg) }, { merge: true })
    .catch(e => console.error('sendMsg:', e));
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
      const banner = document.getElementById('combat-banner');
      if(!banner) return;

      if(!data || !data.actif) { banner.style.display = 'none'; return; }

      const ordre = data.ordreInitiative || [];
      const tourActif = data.tourActif || 0;
      const currentCombatant = ordre[tourActif];
      const isMonTour = currentCombatant?.id === JOUEUR_ID;
      const nomActif = currentCombatant?.nom || '?';
      const tourText = isMonTour ? "▶ C'EST TON TOUR !" : "Tour de " + nomActif;
      const tourColor = isMonTour ? '#5dbe5d' : '#e8a820';

      banner.style.display = 'flex';
      banner.style.background = isMonTour ? '#0a1a0a' : '#1a0505';
      banner.style.borderColor = isMonTour ? '#5dbe5d' : '#e04040';
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
