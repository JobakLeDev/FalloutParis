const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
// firebaseConfig, XP_TABLE définis dans common/shared.js
const db = firebase.initializeApp(firebaseConfig).firestore();

let joueurs = {};
let selected = new Set();

// ============================================================
// TABLES DE RENCONTRES
// Zones, variations, occupation, menace, factions → chargés via db.js.
// Moteur (resolveZonePool, rollEncounter, generateFactionUnit) dans zones.js.
// ============================================================
const VARIATION_LABELS = {irradiated:'Irradiée', abandoned:'Abandonnée', occupied:'Occupée', dark:'Sombre', flooded:'Inondée'};
const THREAT_LABELS    = {calme:'Calme', normal:'Normal', eleve:'Élevé', extreme:'Extrême'};
const OCC_LABELS       = {neutral:'Neutre'};
const THREAT_DANGER    = {calme:1, normal:2, eleve:3, extreme:4};

// ENNEMIS_DB / FACTIONS / ZONES_DB… définis via mj_shared.js + common/db.js

const EVENEMENTS_DEPLACEMENT = [
  {pct:40, type:'calme',    label:'Calme',      desc:'Le groupe se déplace sans encombre.'},
  {pct:20, type:'combat',   label:'Combat !',   desc:'Rencontre hostile sur la route.'},
  {pct:15, type:'piege',    label:'Piège',      desc:'Zone piégée. Test PER+Discrétion D2 pour éviter.'},
  {pct:10, type:'ressource',label:'Ressource',  desc:'Le groupe trouve des ressources en chemin.'},
  {pct:10, type:'pnj',      label:'Rencontre PNJ', desc:'Un personnage non-hostile croise la route du groupe.'},
  {pct:5,  type:'danger',   label:'Grand danger !', desc:'Menace majeure. Ennemi puissant ou situation critique.'},
];

// ============================================================
// LOCK
// ============================================================
document.getElementById('lock-inp').addEventListener('keydown', e => { if(e.key==='Enter') unlock(); });
function unlock(){
  if(document.getElementById('lock-inp').value === MJ_CODE){
    sessionStorage.setItem('mj_auth','1');
    document.getElementById('lock').style.display='none';
    document.getElementById('app').style.display='grid';
    window.DB_READY.then(startSync);
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-inp').value='';
  }
}

// Auto-déverrouiller si déjà authentifié
if(sessionStorage.getItem('mj_auth')==='1'){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='grid';
  window.DB_READY.then(startSync);
}

// ============================================================
// SYNC
// ============================================================
// Remplit les sélecteurs zone / occupation / variation / menace depuis les DB
function populateZoneSelectors(){
  const set = (id, html) => { const el=document.getElementById(id); if(el) el.innerHTML=html; };
  set('zone-sel', Object.entries(window.ZONES_DB||{}).map(([k,v])=>`<option value="${k}">${v.label||k}</option>`).join(''));
  set('occ-sel', Object.keys(window.ZONE_OCCUPATION||{}).map(k=>{
    const lbl = window.FACTIONS?.[k]?.label || OCC_LABELS[k] || k;
    return `<option value="${k}"${k==='neutral'?' selected':''}>${lbl}</option>`;
  }).join(''));
  set('var-sel', '<option value="">Aucune variation</option>'+Object.keys(window.ZONE_VARIATIONS||{}).map(k=>`<option value="${k}">${VARIATION_LABELS[k]||k}</option>`).join(''));
  set('threat-sel', Object.keys(window.ZONE_THREAT||{}).map(k=>`<option value="${k}"${k==='normal'?' selected':''}>${THREAT_LABELS[k]||k}</option>`).join(''));
  // Pré-sélection depuis l'URL (depuis la carte : ?zone=metro&occ=republique&var=irradiated&threat=normal)
  const p = new URLSearchParams(location.search);
  const setIf = (id, val, db) => { const el=document.getElementById(id); if(el && val!=null && (val==='' || db?.[val])) el.value = val; };
  const z = p.get('zone');
  if(z && window.ZONES_DB?.[z]){
    setIf('zone-sel', z, window.ZONES_DB);
    if(p.has('occ'))    setIf('occ-sel', p.get('occ'), window.ZONE_OCCUPATION);
    if(p.has('var'))    setIf('var-sel', p.get('var'), window.ZONE_VARIATIONS);
    if(p.has('threat')) setIf('threat-sel', p.get('threat'), window.ZONE_THREAT);
    document.getElementById('rencontre-panel')?.scrollIntoView({behavior:'smooth'});
  }
}

// Lit les 4 sélecteurs → opts pour resolveZonePool
function getRencontreOpts(){
  const g = id => document.getElementById(id)?.value || '';
  return {
    zone: g('zone-sel'),
    occupation: g('occ-sel') || undefined,
    variation: g('var-sel') || undefined,
    threat: g('threat-sel') || undefined,
  };
}

function startSync(){
  db.collection('joueurs').onSnapshot(snap => {
    joueurs = {};
    snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id: doc.id}; });
    renderJoueurs();
    if(typeof renderParties==='function') renderParties();
    if(typeof renderLootAccess==='function') renderLootAccess();
    if(typeof populateContactSelects==='function'){ populateContactSelects(); renderContactsList(); }
    if(typeof mjSyncWatchers==='function') mjSyncWatchers();
  });
  populateZoneSelectors();
  populatePublicSkillSel();
  renderCombatsActifs();
  db.collection('rolls').doc('current').onSnapshot(s => renderPublicRoll(s.exists ? s.data() : null));
  db.collection('temps').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    tempsData = { parties: Array.isArray(d.parties) ? d.parties : [] };
    tempsLoaded = true;
    renderParties();
  });
  populateLootCats();
  db.collection('butin').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    butinData = { items: Array.isArray(d.items) ? d.items : [], caps: d.caps || 0, players: Array.isArray(d.players) ? d.players : [] };
    renderButin();
    renderLootAccess();
  });
  db.collection('messagerie').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    msgLinks = (d.links && typeof d.links === 'object') ? d.links : {};
    renderContactsList();
  });
  db.collection('log').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    actionLog = Array.isArray(d.entries) ? d.entries : [];
    renderActionLog();
  });
  db.collection('boutiques').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    boutiqueData = { shops: (d.shops && typeof d.shops === 'object') ? d.shops : {} };
    renderBoutiqueMJ();
  });
  db.collection('terminaux').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    termOpen = (d.open && typeof d.open === 'object') ? d.open : {};
    renderTerminalMJ();
  });
  loadTerminauxList();
  mjRadioLoad();
}

// ============================================================
// TERMINAL — le MJ déclenche un terminal pour les joueurs sélectionnés (/terminaux/data {open:{[id]:termId}})
// ============================================================
let termCatalog = {};         // {id: {titre, ...}} depuis data/terminals.json
let termOpen = {};            // {[joueurId]: termId} — terminaux ouverts
function loadTerminauxList(){
  fetch('../../data/terminals.json?v=3').then(r => r.json()).then(d => {
    termCatalog = d.terminals || {};
    const sel = document.getElementById('term-sel'); if(!sel) return;
    sel.innerHTML = Object.keys(termCatalog).map(id =>
      '<option value="' + id + '">' + (termCatalog[id].titre || id) + '</option>').join('')
      || '<option value="">(aucun terminal dans terminals.json)</option>';
  }).catch(() => {});
}
function declencherTerminal(){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  const tid = document.getElementById('term-sel')?.value;
  if(!tid){ showMsg('Aucun terminal choisi', true); return; }
  termOpen = termOpen || {};
  [...selected].forEach(id => { termOpen[id] = tid; });
  db.collection('terminaux').doc('data').set({ open: termOpen }, { merge:true }).catch(e => console.error(e));
  const noms = [...selected].map(id => joueurs[id]?.nom || id).join(', ');
  showMsg('💻 Terminal « ' + (termCatalog[tid]?.titre || tid) + ' » ouvert à ' + selected.size + ' joueur(s)');
  logAction('Terminal « ' + (termCatalog[tid]?.titre || tid) + ' » ouvert à ' + noms);
}
function fermerTerminaux(){
  termOpen = {};
  db.collection('terminaux').doc('data').set({ open: {} }).catch(e => console.error(e));
  showMsg('Terminaux fermés');
  renderTerminalMJ();
}
function renderTerminalMJ(){
  const el = document.getElementById('term-summary'); if(!el) return;
  const entries = Object.entries(termOpen).filter(([,t]) => t);
  if(!entries.length){ el.innerHTML = '<span style="font-size:9px;color:var(--td)">Aucun terminal ouvert.</span>'; return; }
  el.innerHTML = '<div style="font-size:9px;color:var(--g);line-height:1.5">● ouvert : '
    + entries.map(([pid, t]) => (joueurs[pid]?.nom || pid) + ' → ' + (termCatalog[t]?.titre || t)).join('<br>') + '</div>';
}

// Crochetage — le MJ demande un crochetage aux joueurs sélectionnés (/crochetage/data {[id]:{diff,label,status}})
function declencherCrochetage(){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  const diff = parseInt(document.getElementById('croch-diff')?.value) || 2;
  const label = (document.getElementById('croch-label')?.value || '').trim() || 'Serrure';
  const upd = {};
  [...selected].forEach(id => { upd[id] = { diff, label, ts: Date.now(), status: 'open' }; });
  db.collection('crochetage').doc('data').set(upd, { merge: true }).catch(e => console.error(e));
  const noms = [...selected].map(id => joueurs[id]?.nom || id).join(', ');
  showMsg('🔓 Crochetage « ' + label + ' » (D' + diff + ') lancé à ' + selected.size + ' joueur(s)');
  logAction('Crochetage « ' + label + ' » (D' + diff + ') demandé à ' + noms);
}
// Annule la demande (le bandeau/la modale disparaissent côté joueur). Sélectionnés → ceux-là ; sinon → tout le monde.
function annulerCrochetage(){
  if(selected.size){
    const upd = {};
    [...selected].forEach(id => { upd[id] = firebase.firestore.FieldValue.delete(); });
    db.collection('crochetage').doc('data').set(upd, { merge: true }).catch(e => console.error(e));
    showMsg('Crochetage annulé pour ' + selected.size + ' joueur(s)');
  } else {
    db.collection('crochetage').doc('data').set({}).catch(e => console.error(e));
    showMsg('Crochetage annulé (tous)');
  }
}

// ============================================================
// RADIO — conducteur MJ : choisit station/piste, écrit /radio/current (les joueurs suivent)
// ============================================================
let _mjRadio = { loaded:false, stations:[], folder:'audio', station:null, idx:0, audio:null, playing:false };
function mjRadioLoad(){
  if(_mjRadio.loaded) return; _mjRadio.loaded = true;
  _mjRadio.audio = new Audio();
  _mjRadio.audio.volume = (parseInt(localStorage.getItem('fp_mjRadioVol')||'60')/100);
  const v = document.getElementById('mj-radio-vol'); if(v) v.value = Math.round(_mjRadio.audio.volume*100);
  _mjRadio.audio.addEventListener('ended', mjRadioNext);
  fetch('../../data/radio.json?ts='+Date.now()).then(r=>r.json()).then(d=>{
    _mjRadio.folder = d.folder || 'audio';
    _mjRadio.stations = Array.isArray(d.stations) ? d.stations : [];
    const sel = document.getElementById('mj-radio-sel');
    if(sel) sel.innerHTML = _mjRadio.stations.map(s => `<option value="${s.id}">${s.name||s.id} (${(s.tracks||[]).length})</option>`).join('');
    _mjRadio.station = _mjRadio.stations[0] || null;
    renderMjRadio();
  }).catch(e => console.warn('radio.json', e));
}
function _mjStation(){ const id = document.getElementById('mj-radio-sel')?.value; return _mjRadio.stations.find(s => s.id === id) || _mjRadio.stations[0] || null; }
// Dossier propre à la station (sinon dossier global)
function _stationFolder(s){ return (s && s.folder) || _mjRadio.folder; }
function _mjRadioSrc(track){ if(/^https?:/i.test(track)) return track; return '../../' + _stationFolder(_mjRadio.station) + '/' + track.split('/').map(encodeURIComponent).join('/'); }
function mjRadioBroadcast(startedAt){
  const s = _mjRadio.station; if(!s || !(s.tracks||[]).length) return;
  const track = s.tracks[_mjRadio.idx % s.tracks.length];
  const label = String(track).replace(/^.*\//,'').replace(/\.(mp3|ogg|m4a|wav)$/i,'').replace(/[-_]/g,' ');
  _mjRadio.now = { name: s.name || s.id, label };   // ce qui est RÉELLEMENT diffusé (≠ sélection)
  db.collection('radio').doc('current').set({ playing:true, station:s.id, name:s.name||s.id, folder:_stationFolder(s), track, trackLabel:label, startedAt: startedAt||Date.now(), ts:Date.now() }).catch(e=>console.error('radio',e));
}
function mjRadioPlayIdx(){
  const s = _mjRadio.station; if(!s || !(s.tracks||[]).length){ showMsg('Station vide', true); return; }
  _mjRadio.audio.src = _mjRadioSrc(s.tracks[_mjRadio.idx % s.tracks.length]);
  _mjRadio.audio.play().catch(()=>{}); _mjRadio.playing = true;
  mjRadioBroadcast(Date.now());
  renderMjRadio();
  logAction('Radio : « '+(s.name||s.id)+' » diffusée');
}
function _radioEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _radioTrackLabel(t){ return String(t).replace(/^.*\//,'').replace(/\.(mp3|ogg|m4a|wav)$/i,''); }
// Peuple le sélecteur de chanson avec les pistes de la station courante (sélection = piste courante)
function _populateTrackSel(){
  const sel = document.getElementById('mj-radio-track'); if(!sel) return;
  const tracks = (_mjRadio.station && _mjRadio.station.tracks) || [];
  if(!tracks.length){ sel.innerHTML = '<option value="">— aucune piste —</option>'; return; }
  const cur = _mjRadio.idx % tracks.length;
  sel.innerHTML = tracks.map((t,i) => `<option value="${i}"${i===cur?' selected':''}>${_radioEsc(_radioTrackLabel(t))}</option>`).join('');
}
// Sélection d'une chanson précise → diffuse si en cours, sinon prépare
function mjRadioPickTrack(){
  const sel = document.getElementById('mj-radio-track'); if(!sel || sel.value === '') return;
  _mjRadio.idx = parseInt(sel.value) || 0;
  if(_mjRadio.playing) mjRadioPlayIdx(); else renderMjRadio();
}
// Changer de station = juste sélectionner (ne coupe PAS la musique en cours) ;
// la diffusion change quand le MJ choisit une chanson ou clique « Diffuser ».
function mjRadioSelect(){ const s = _mjStation(); _mjRadio.station = s; _mjRadio.idx = 0; _populateTrackSel(); renderMjRadio(); }
function mjRadioToggle(){
  if(!_mjRadio.station) _mjRadio.station = _mjStation();
  if(_mjRadio.playing){
    _mjRadio.audio.pause(); _mjRadio.playing = false;
    db.collection('radio').doc('current').set({ playing:false, ts:Date.now() }, { merge:true });
    renderMjRadio();
  } else {
    if(_mjRadio.audio.src && _mjRadio.audio.currentTime > 0){
      _mjRadio.audio.play().catch(()=>{}); _mjRadio.playing = true;
      mjRadioBroadcast(Date.now() - _mjRadio.audio.currentTime*1000);
      renderMjRadio();
    } else mjRadioPlayIdx();
  }
}
function mjRadioNext(){ const s = _mjRadio.station || _mjStation(); _mjRadio.station = s; if(!s || !(s.tracks||[]).length) return; _mjRadio.idx = (_mjRadio.idx+1) % s.tracks.length; mjRadioPlayIdx(); }
function mjRadioPrev(){ const s = _mjRadio.station || _mjStation(); _mjRadio.station = s; if(!s || !(s.tracks||[]).length) return; _mjRadio.idx = (_mjRadio.idx-1+s.tracks.length) % s.tracks.length; mjRadioPlayIdx(); }
function mjRadioStop(){
  if(_mjRadio.audio){ _mjRadio.audio.pause(); _mjRadio.audio.removeAttribute('src'); }
  _mjRadio.playing = false;
  _mjRadio.now = null;   // plus aucune diffusion
  db.collection('radio').doc('current').set({ playing:false, track:null, ts:Date.now() });
  renderMjRadio(); logAction('Radio coupée');
}
function mjRadioVol(v){ if(_mjRadio.audio) _mjRadio.audio.volume = (parseInt(v)||0)/100; try{ localStorage.setItem('fp_mjRadioVol', v); }catch(e){} }
function renderMjRadio(){
  const b = document.getElementById('mj-radio-play'); if(b) b.textContent = _mjRadio.playing ? '⏸ Pause' : '▶ Diffuser';
  const el = document.getElementById('mj-radio-now');
  if(el){
    // Affiche ce qui DIFFUSE réellement (pas la station sélectionnée)
    if(_mjRadio.now) el.textContent = (_mjRadio.playing ? '📡 ' : '⏸ ') + _mjRadio.now.name + ' — ' + _mjRadio.now.label;
    else el.textContent = 'Aucune diffusion.';
  }
  _populateTrackSel();   // sélecteur de chanson = station sélectionnée (peut différer de la diffusion)
}

// ============================================================
// BOUTIQUE / MARCHAND — /boutiques/data {shops:{[id]:shop}} ; itinérante = id 'mj'
// ============================================================
let boutiqueData = { shops: {} };
function saveBoutique(){ if(db) db.collection('boutiques').doc('data').set(boutiqueData).catch(e=>console.error('saveBoutique',e)); }
function _shopType(cat, it){ return cat==='weapons'?'WEAPON':cat==='armor'?(it.t||'ARMOR'):cat==='food'?'FOOD':cat==='drinks'?'DRINK':cat==='drugs'?'DRUGS':'STUFF'; }
function genBoutique(){
  const name = (document.getElementById('shop-name').value||'').trim() || 'Marchand itinérant';
  const markup = Math.max(0.1, parseFloat(document.getElementById('shop-markup').value)||1);
  const n = Math.min(40, Math.max(1, parseInt(document.getElementById('shop-size').value)||12));
  const cats = ['weapons','armor','food','drinks','drugs','stuff'];
  const items = [];
  for(let i=0;i<n*2 && items.length<n;i++){
    const cat = cats[Math.floor(Math.random()*cats.length)];
    const src = lootSource(cat); if(!src.length) continue;
    const it = weightedPick(src);
    const ex = items.find(x => x.name===it.n);
    if(ex){ ex.qty++; continue; }
    items.push({ id:'s'+Date.now().toString(36)+i, name:it.n, type:_shopType(cat,it), cat, r:it.r||3, w:it.w||0, qty:1+Math.floor(Math.random()*4) });
  }
  boutiqueData.shops = boutiqueData.shops || {};
  const prev = boutiqueData.shops['mj'] || {};
  boutiqueData.shops['mj'] = { id:'mj', name, markup, items, openFor: prev.openFor || [] };
  saveBoutique(); renderBoutiqueMJ();
  logAction('Boutique « '+name+' » générée ('+items.length+' articles)');
  showMsg('🛒 Boutique générée — '+items.length+' articles');
}
function ouvrirBoutique(){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  if(!boutiqueData.shops || !boutiqueData.shops['mj']){ showMsg('Génère d\'abord un stock', true); return; }
  boutiqueData.shops['mj'].openFor = [...selected];
  saveBoutique(); renderBoutiqueMJ();
  const noms = [...selected].map(id=>joueurs[id]?.nom||id).join(', ');
  showMsg('🛒 Boutique ouverte à '+selected.size+' joueur(s)');
  logAction('Boutique ouverte à '+noms);
}
function fermerBoutique(){ if(boutiqueData.shops && boutiqueData.shops['mj']){ boutiqueData.shops['mj'].openFor = []; saveBoutique(); renderBoutiqueMJ(); showMsg('Boutique fermée'); } }
function clearBoutique(){ if(confirm('Supprimer la boutique itinérante ?')){ if(boutiqueData.shops) delete boutiqueData.shops['mj']; saveBoutique(); renderBoutiqueMJ(); } }
function renderBoutiqueMJ(){
  const el = document.getElementById('shop-summary'); if(!el) return;
  const sh = boutiqueData.shops && boutiqueData.shops['mj'];
  if(!sh){ el.innerHTML = '<span style="font-size:9px;color:var(--td)">Aucune boutique itinérante.</span>'; return; }
  const nb = (sh.items||[]).reduce((a,x)=>a+(x.qty||0),0);
  const open = (sh.openFor||[]).length;
  el.innerHTML = `<div style="font-size:9px;color:var(--t);line-height:1.5">🛒 <b style="color:var(--tb)">${sh.name}</b> — ${nb} article(s) · marge ×${sh.markup}<br>`
    + (open ? `<span style="color:var(--g)">● ouverte à ${open} joueur(s)</span>` : '<span style="color:var(--td)">○ fermée</span>') + '</div>';
}

// ============================================================
// JOURNAL D'ACTIONS — toutes les actions joueur/MJ (/log/data)
// ============================================================
let actionLog = [];
function logAction(text){ if(typeof fpLogAction === 'function') fpLogAction(db, 'MJ', text); }
function clearActionLog(){ if(confirm('Vider le journal d\'actions ?')) db.collection('log').doc('data').set({ entries: [] }).catch(e=>console.error(e)); }
function renderActionLog(){
  const el = document.getElementById('actionlog-list'); if(!el) return;
  if(!actionLog.length){ el.innerHTML = '<div class="empty" style="font-size:8px;color:var(--td);padding:10px">Aucune action enregistrée.</div>'; return; }
  const fmtT = ts => { const d = new Date(ts||0); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  el.innerHTML = actionLog.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).map(e => {
    const cls = e.who === 'MJ' ? 'mj' : 'pj';
    return `<div class="alog-row"><span class="alog-time">${fmtT(e.ts)}</span><span class="alog-who ${cls}">${_logEsc(e.who)}</span><span class="alog-text">${_logEsc(e.text)}</span></div>`;
  }).join('');
}
function _logEsc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================
// MESSAGERIE — contacts (échange de numéros) /messagerie/data {links:{id:[ids]}}
// ============================================================
let msgLinks = {};
function populateContactSelects(){
  const ids = Object.keys(joueurs);
  const opts = '<option value="">— joueur —</option>' + ids.map(id=>`<option value="${id}">${joueurs[id]?.nom||id}</option>`).join('');
  ['contact-a','contact-b'].forEach(s => { const el=document.getElementById(s); if(el) el.innerHTML = opts; });
}
function saveLinks(){ if(db) db.collection('messagerie').doc('data').set({links:msgLinks}).catch(e=>console.error('saveLinks',e)); }
function _link(a,b){ msgLinks[a]=msgLinks[a]||[]; if(!msgLinks[a].includes(b)) msgLinks[a].push(b); }
function lierContacts(){
  const a=document.getElementById('contact-a').value, b=document.getElementById('contact-b').value;
  if(!a||!b||a===b){ showMsg('Choisis deux joueurs différents',true); return; }
  _link(a,b); _link(b,a); saveLinks(); renderContactsList();
  showMsg('📟 '+(joueurs[a]?.nom||a)+' ↔ '+(joueurs[b]?.nom||b)+' — numéros échangés');
  logAction('Numéros liés : '+(joueurs[a]?.nom||a)+' ↔ '+(joueurs[b]?.nom||b));
}
function delierContacts(a,b){
  if(msgLinks[a]) msgLinks[a]=msgLinks[a].filter(x=>x!==b);
  if(msgLinks[b]) msgLinks[b]=msgLinks[b].filter(x=>x!==a);
  saveLinks(); renderContactsList();
}
function renderContactsList(){
  const el = document.getElementById('contacts-list'); if(!el) return;
  const pairs = []; const seen = new Set();
  Object.keys(msgLinks).forEach(a => (msgLinks[a]||[]).forEach(b => {
    const k = [a,b].sort().join('__'); if(seen.has(k)) return; seen.add(k); pairs.push([a,b]);
  }));
  el.innerHTML = pairs.length
    ? pairs.map(([a,b]) => `<div class="contact-row"><span>${joueurs[a]?.nom||a} ↔ ${joueurs[b]?.nom||b}</span><button class="bp-del" onclick="delierContacts('${a}','${b}')">✕</button></div>`).join('')
    : '<div class="empty" style="font-size:8px;color:var(--td);padding:6px">Aucun contact établi</div>';
}

// ============================================================
// BUTIN / FOUILLE (générateur MJ → pool partagé Firebase /butin/data)
// ============================================================
let butinData = { items: [], caps: 0, players: [] };
const LOOT_CATS = [
  {k:'weapons',l:'Armes'},{k:'armor',l:'Armure'},{k:'ammo',l:'Munitions'},
  {k:'food',l:'Nourriture'},{k:'drinks',l:'Boissons'},{k:'drugs',l:'Chems'},
  {k:'stuff',l:'Divers'},{k:'caps',l:'Caps'},
];
const CAT_ICON = {weapons:'🔫',armor:'🛡',ammo:'▪',food:'🍖',drinks:'🥤',drugs:'💊',stuff:'🔧'};

function populateLootCats(){
  const el = document.getElementById('loot-cats'); if(!el) return;
  el.innerHTML = LOOT_CATS.map(c =>
    `<label class="loot-cat"><input type="checkbox" class="loot-cat-cb" value="${c.k}" checked> ${c.l}</label>`
  ).join('');
}
function lootSource(cat){ return ({weapons:DB.weapons,armor:DB.armor,food:DB.food,drinks:DB.drinks,drugs:DB.drugs,stuff:DB.stuff})[cat] || []; }
// Tirage pondéré par rareté (commun r1 = plus fréquent, légendaire r5 = rare)
function weightedPick(list){
  let tot=0; const w=list.map(it=>{ const x=Math.max(1,6-(it.r||3)); tot+=x; return x; });
  let r=Math.random()*tot;
  for(let i=0;i<list.length;i++){ r-=w[i]; if(r<=0) return list[i]; }
  return list[list.length-1];
}
// Munitions : jet 2D20 sur la table officielle AMMO_LOOT → {ammo, qty}
function rollAmmoLoot(){
  const tbl = window.AMMO_LOOT; if(!tbl||!tbl.length) return null;
  const roll = (1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20));
  const e = tbl.find(x => roll>=x.min && roll<=x.max); if(!e) return null;
  let q = e.base||0;
  for(let i=0;i<(e.cd||0);i++) q += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0;
  return { ammo: e.ammo, qty: Math.max(1, q*(e.mult||1)) };
}
function addToPool(item){
  butinData.items = butinData.items || [];
  const ex = butinData.items.find(x => x.name===item.name && x.cat===item.cat);
  if(ex) ex.qty += item.qty;
  else { item.id = 'b'+Date.now().toString(36)+Math.floor(Math.random()*999); butinData.items.push(item); }
}
function saveButin(){ if(db) db.collection('butin').doc('data').set(butinData).catch(e=>console.error('saveButin',e)); }
function genButin(){
  const scale = parseInt(document.getElementById('loot-scale').value)||2;
  const ranges = {1:[1,2],2:[2,4],3:[4,6],4:[6,10]};
  const [mn,mx] = ranges[scale] || [2,4];
  const rolls = mn + Math.floor(Math.random()*(mx-mn+1));
  const cats = [...document.querySelectorAll('.loot-cat-cb:checked')].map(c=>c.value);
  const itemCats = cats.filter(c=>c!=='caps');
  let added = 0;
  for(let i=0;i<rolls && itemCats.length;i++){
    const cat = itemCats[Math.floor(Math.random()*itemCats.length)];
    if(cat==='ammo'){ const a=rollAmmoLoot(); if(a){ addToPool({name:a.ammo,type:'AMMO',cat:'ammo',qty:a.qty}); added++; } continue; }
    const src = lootSource(cat); if(!src.length) continue;
    const it = weightedPick(src);
    addToPool({name:it.n, type:it.t||cat, cat, qty:1, w:it.w||0, r:it.r||3});
    added++;
  }
  if(cats.includes('caps')){
    const caps = scale * ((1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20)));
    butinData.caps = (butinData.caps||0) + caps;
  }
  saveButin();
  showMsg(`🎒 Butin généré — ${added} objet(s)${cats.includes('caps')?' + caps':''}`);
  logAction(`Butin généré — ${added} objet(s)${cats.includes('caps')?' + caps':''}`);
}
function rmButin(i){ butinData.items.splice(i,1); saveButin(); }
function clearButin(){ if(confirm('Vider le pool de butin ?')){ butinData = {items:[],caps:0,players:[]}; saveButin(); } }
function chButinCaps(d){ butinData.caps = Math.max(0,(butinData.caps||0)+d); saveButin(); }

// ============================================================
// CATALOGUE D'OBJETS (MJ) — parcourir tous les objets par catégorie
// et les ajouter au pool de butin OU directement à un joueur.
// ============================================================
const CATALOGUE_CATS = [
  {k:'weapons',l:'Armes',type:'WEAPON'},{k:'armor',l:'Armure',type:'ARMOR'},
  {k:'food',l:'Nourriture',type:'FOOD'},{k:'drinks',l:'Boissons',type:'DRINK'},
  {k:'drugs',l:'Chems',type:'DRUGS'},{k:'stuff',l:'Divers',type:'STUFF'},
  {k:'ammo',l:'Munitions',type:'AMMO'},
];
let _catCat = 'weapons';
const CAT_AMMO_QTY = 10;   // quantité de munitions ajoutée par clic
function _catList(cat){
  if(cat==='ammo') return (DB.ammo||[]).map(n=>({n}));
  return ({weapons:DB.weapons,armor:DB.armor,food:DB.food,drinks:DB.drinks,drugs:DB.drugs,stuff:DB.stuff})[cat]||[];
}
function _catInfo(it,cat){
  const fx=e=>(e&&e!=='—'&&e!=='–')?e:'';
  if(cat==='weapons') return `${it.dmg||''}${fx(it.eff)?' · '+fx(it.eff):''}${it.a&&it.a!=='-'?' · '+it.a:''}`;
  if(cat==='armor')   return `Ph${it.ph||0}/En${it.en||0}${it.rad?'/Rad'+it.rad:''} ${it.z||''}`;
  if(cat==='food'||cat==='drinks') return `+${it.hp||0}PV${fx(it.eff)?' · '+fx(it.eff):''}`;
  if(cat==='drugs')   return fx(it.eff);
  if(cat==='stuff')   return fx(it.eff);
  return '';
}
function _catBuildInv(name,cat){
  const def=_catList(cat).find(x=>x.n===name)||{};
  let type=({weapons:'WEAPON',food:'FOOD',drinks:'DRINK',drugs:'DRUGS',stuff:'STUFF'})[cat]||'STUFF';
  if(cat==='armor') type=def.t||'ARMOR';
  const item={name, type, qty:1, w:def.w||0, equipped:false};
  if(type==='ARMOR'||type==='POWERARMOR') item.zone=def.z||'';
  if(type==='WEAPON') item.persoBonus=false;
  return item;
}
function renderCatTabs(){
  const tb=document.getElementById('mj-cat-tabs'); if(!tb) return;
  tb.innerHTML=CATALOGUE_CATS.map(c=>`<button class="mj-cat-tab${c.k===_catCat?' on':''}" onclick="setCatCat('${c.k}')">${c.l}</button>`).join('');
}
function setCatCat(k){ _catCat=k; renderCatTabs(); renderCatalogue(); }
function openCatalogue(){
  const m=document.getElementById('mj-cat-modal'); if(!m) return;
  renderCatTabs();
  const js=document.getElementById('mj-cat-joueur');
  if(js) js.innerHTML = Object.keys(joueurs).length
    ? Object.keys(joueurs).map(id=>`<option value="${id}">${joueurs[id]?.nom||id}</option>`).join('')
    : '<option value="">Aucun joueur</option>';
  m.classList.add('on');
  // Le body est zoomé (responsive.js) → vh×zoom déborde. On fixe la taille en px réels / zoom.
  const z = window.__fpZoom || 1;
  const box = m.querySelector('.mj-cat-box');
  if(box){
    box.style.maxHeight = Math.round(0.86 * window.innerHeight / z) + 'px';
    box.style.maxWidth  = Math.round(0.92 * window.innerWidth  / z) + 'px';
  }
  renderCatalogue();
}
function closeCatalogue(){ document.getElementById('mj-cat-modal')?.classList.remove('on'); }
function renderCatalogue(){
  const el=document.getElementById('mj-cat-list'); if(!el) return;
  const q=(document.getElementById('mj-cat-search')?.value||'').toLowerCase();
  let list=_catList(_catCat);
  if(q) list=list.filter(it=>(it.n||'').toLowerCase().includes(q));
  if(!list.length){ el.innerHTML='<div class="empty" style="padding:10px;font-size:9px;color:var(--td)">Aucun objet.</div>'; return; }
  el.innerHTML=list.map(it=>{
    const nm=(it.n||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const info=_catInfo(it,_catCat);
    return `<div class="mj-cat-row">
      <span class="mj-cat-nom">${it.n}${info?` <small>${info}</small>`:''}</span>
      <button class="bp-mini" onclick="catToPool('${nm}','${_catCat}')" title="Ajouter au pool de butin">+ Pool</button>
      <button class="bp-mini cat-give" onclick="catToJoueur('${nm}','${_catCat}')" title="Donner au joueur sélectionné">→ joueur</button>
    </div>`;
  }).join('');
}
function catToPool(name,cat){
  const def=_catList(cat).find(x=>x.n===name)||{};
  const catDef=CATALOGUE_CATS.find(c=>c.k===cat)||{};
  const type = cat==='armor' ? (def.t||'ARMOR') : catDef.type;
  const qty = cat==='ammo' ? CAT_AMMO_QTY : 1;
  addToPool({name, type, cat, qty, w:def.w||0, r:def.r||3});
  saveButin();
  if(typeof showMsg==='function') showMsg(`+ ${name} → pool de butin`);
}
async function catToJoueur(name,cat){
  const jid=document.getElementById('mj-cat-joueur')?.value;
  if(!jid){ alert('Aucun joueur sélectionné.'); return; }
  const ref=db.collection('joueurs').doc(jid);
  let snap; try{ snap=await ref.get(); }catch(e){ alert('Erreur Firebase'); return; }
  if(!snap.exists){ alert('Fiche joueur introuvable.'); return; }
  const d=snap.data();
  if(cat==='ammo'){
    const ammo=Array.isArray(d.ammo)?d.ammo:[];
    const ex=ammo.find(a=>a.cal===name);
    if(ex) ex.qty=(ex.qty||0)+CAT_AMMO_QTY; else ammo.push({cal:name,qty:CAT_AMMO_QTY});
    await ref.update({ammo,lastUpdate:Date.now()});
  } else {
    const inv=Array.isArray(d.inventory)?d.inventory:[];
    const item=_catBuildInv(name,cat);
    const ex=inv.find(it=>it.name===item.name && it.type===item.type);
    if(ex) ex.qty=(ex.qty||1)+1; else inv.push(item);
    await ref.update({inventory:inv,lastUpdate:Date.now()});
  }
  if(typeof showMsg==='function') showMsg(`${name} → ${joueurs[jid]?.nom||jid}`);
  logAction(`Objet donné : ${name}${cat==='ammo'?' ×'+CAT_AMMO_QTY:''} → ${joueurs[jid]?.nom||jid}`);
}

// Accès joueurs au butin (bandeau sur leur fiche)
function renderLootAccess(){
  const el = document.getElementById('loot-access-list'); if(!el) return;
  const ids = Object.keys(joueurs);
  if(!ids.length){ el.innerHTML = '<span class="empty" style="font-size:8px;color:var(--td)">Aucun joueur</span>'; return; }
  el.innerHTML = ids.map(id => {
    const on = (butinData.players||[]).includes(id);
    return `<button class="loot-acc${on?' on':''}" onclick="toggleLootAccess('${id}')">${on?'👁':'∅'} ${joueurs[id]?.nom||id}</button>`;
  }).join('');
}
function toggleLootAccess(id){
  butinData.players = butinData.players || [];
  const i = butinData.players.indexOf(id);
  if(i>=0) butinData.players.splice(i,1); else butinData.players.push(id);
  saveButin(); renderLootAccess();
}
function lootAccessAll(all){ butinData.players = all ? Object.keys(joueurs) : []; saveButin(); renderLootAccess(); }
function renderButin(){
  const el = document.getElementById('butin-pool'); if(!el) return;
  const items = butinData.items||[], caps = butinData.caps||0;
  let h = `<div class="butin-caps">💰 Caps : <b>${caps}</b> <button class="bp-mini" onclick="chButinCaps(-10)">−10</button><button class="bp-mini" onclick="chButinCaps(10)">+10</button><button class="bp-mini" onclick="chButinCaps(-${caps})">0</button></div>`;
  if(!items.length){ h += '<div class="empty" style="font-size:8px;color:var(--td);padding:6px">Pool vide</div>'; }
  else {
    h += items.map((it,i)=>`<div class="bp-row"><span class="bp-cat">${CAT_ICON[it.cat]||'▪'}</span><span class="bp-nom">${it.name}${it.qty>1?' <b>×'+it.qty+'</b>':''}</span><button class="bp-del" onclick="rmButin(${i})">✕</button></div>`).join('');
    h += `<button class="bp-clear" onclick="clearButin()">Vider le pool</button>`;
  }
  el.innerHTML = h;
}

// ============================================================
// CALENDRIER & GROUPES (parties) — Firebase /temps/data
// { parties: [{id, name, players:[ids], minutes}] } ; minutes = depuis l'époque (14 juil. 2189)
// Helpers de date dans shared.js (tempsDate, fmtDateTime, TEMPS_DEFAUT…)
// ============================================================
let tempsData = { parties: [] };
let tempsLoaded = false;   // vrai une fois /temps/data reçu — évite d'écraser les groupes au chargement
// état UI local (réduit/déplié) — mémorisé en localStorage (survit au rafraîchissement)
const collapsedParties = new Set((()=>{ try{ return JSON.parse(localStorage.getItem('fp_collapsedParties')||'[]'); }catch(e){ return []; } })());
function saveCollapsed(){ try{ localStorage.setItem('fp_collapsedParties', JSON.stringify([...collapsedParties])); }catch(e){} }
function togglePartyCollapse(id){ if(collapsedParties.has(id)) collapsedParties.delete(id); else collapsedParties.add(id); saveCollapsed(); renderParties(); }

// Réduction des panneaux de la colonne droite (mémorisé en localStorage)
const collapsedPanels = new Set((()=>{ try{ return JSON.parse(localStorage.getItem('fp_collapsedPanels')||'[]'); }catch(e){ return []; } })());
const PANEL_IDS = ['actions-pnl','actionlog-pnl','clock-pnl','rencontre-pnl-main','combats-actifs','butin-pnl','boutique-pnl','terminal-pnl','crochetage-pnl','radio-pnl','contacts-pnl'];
function applyPanelState(id){
  const el = document.getElementById(id); if(!el) return;
  const col = collapsedPanels.has(id);
  el.classList.toggle('collapsed', col);
  const t = el.querySelector('.pnl-toggle'); if(t) t.textContent = col ? '▸' : '▾';
}
function togglePanel(id){
  if(collapsedPanels.has(id)) collapsedPanels.delete(id); else collapsedPanels.add(id);
  try{ localStorage.setItem('fp_collapsedPanels', JSON.stringify([...collapsedPanels])); }catch(e){}
  applyPanelState(id);
}
function initPanelCollapse(){ PANEL_IDS.forEach(applyPanelState); }
window.addEventListener('DOMContentLoaded', initPanelCollapse);

// Repli individuel de chaque bloc d'action (bandeau gauche) — clic sur le titre, état mémorisé
function initActGroupCollapse(){
  const pnl = document.getElementById('actions-pnl'); if(!pnl) return;
  let saved = {}; try{ saved = JSON.parse(localStorage.getItem('fp_actGroups')||'{}'); }catch(e){}
  pnl.querySelectorAll('.action-group').forEach(g => {
    const t = g.querySelector('.action-group-title'); if(!t) return;
    if(saved[t.textContent.trim()]) g.classList.add('collapsed');
  });
  pnl.addEventListener('click', e => {
    const t = e.target.closest('.action-group-title'); if(!t || !pnl.contains(t)) return;
    const g = t.closest('.action-group'); if(!g) return;
    g.classList.toggle('collapsed');
    saved[t.textContent.trim()] = g.classList.contains('collapsed');
    try{ localStorage.setItem('fp_actGroups', JSON.stringify(saved)); }catch(e){}
  });
}
window.addEventListener('DOMContentLoaded', initActGroupCollapse);
function uidParty(){ return 'p' + Date.now().toString(36) + Math.floor(Math.random()*99); }
function saveTemps(){ if(db) db.collection('temps').doc('data').set(tempsData).catch(e=>console.error('saveTemps',e)); }
function findParty(id){ return (tempsData.parties||[]).find(p => p.id === id); }

// Chaque joueur a une ligne de temps individuelle par défaut (groupe "solo" auto-créé).
// Un GROUPE explicite (solo:false) sert à synchroniser plusieurs joueurs.
function ensureSoloParties(){
  if(!tempsLoaded) return;   // tant que /temps/data n'est pas reçu, ne rien créer (sinon on écrase les groupes)
  tempsData.parties = tempsData.parties || [];
  const assigned = new Set(); tempsData.parties.forEach(p => (p.players||[]).forEach(id => assigned.add(id)));
  const orphans = Object.keys(joueurs).filter(id => !assigned.has(id));
  if(orphans.length){
    orphans.forEach(id => tempsData.parties.push({ id: uidParty(), name: joueurs[id]?.nom||id, players:[id], minutes: TEMPS_DEFAUT, solo:true }));
    saveTemps();   // converge : au prochain snapshot, plus d'orphelins
  }
}
function addParty(){
  tempsData.parties = tempsData.parties || [];
  const n = tempsData.parties.filter(p=>!p.solo).length + 1;
  tempsData.parties.push({ id: uidParty(), name: 'Groupe ' + n, players: [], minutes: TEMPS_DEFAUT, solo:false });
  saveTemps(); renderParties();
}
function delParty(id){
  const p = findParty(id); if(!p) return;
  if(!confirm('Supprimer ce groupe ? Ses membres redeviennent individuels (ils gardent l\'heure du groupe).')) return;
  const mins = (p.minutes != null) ? p.minutes : TEMPS_DEFAUT;
  const members = (p.players || []).slice();
  tempsData.parties = tempsData.parties.filter(x => x.id !== id);
  // chaque membre devient une party solo qui hérite de l'heure du groupe au moment de la dissolution
  members.forEach(pid => tempsData.parties.push({ id: uidParty(), name: joueurs[pid]?.nom || pid, players:[pid], minutes: mins, solo:true }));
  saveTemps(); renderParties();
  logAction(`Groupe « ${p.name||'Groupe'} » dissous (heure conservée : ${fmtHeure(mins)})`);
}
function setPartyName(id,v){ const p=findParty(id); if(p){ p.name=v; saveTemps(); } }
function avanceParty(id,delta){ const p=findParty(id); if(!p) return; p.minutes = Math.max(0,(p.minutes||0)+(parseInt(delta)||0)); saveTemps(); renderParties(); }
function reglerDateParty(id){
  const p=findParty(id); if(!p) return;
  const cur = tempsDate(p.minutes);
  const ds = prompt('Date (JJ/MM/AAAA) :', `${cur.getDate()}/${cur.getMonth()+1}/${cur.getFullYear()}`); if(ds==null) return;
  const dm = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(!dm){ showMsg('Format date invalide',true); return; }
  const hs = prompt('Heure (HH:MM) :', fmtHeure(p.minutes)); if(hs==null) return;
  const hm = hs.match(/^(\d{1,2})[:hH]?(\d{0,2})$/); if(!hm){ showMsg('Format heure invalide',true); return; }
  const nd = new Date(parseInt(dm[3]), (parseInt(dm[2])||1)-1, parseInt(dm[1])||1, Math.min(23,parseInt(hm[1])||0), Math.min(59,parseInt(hm[2])||0), 0);
  p.minutes = Math.max(0, tempsMinutesDepuis(nd));
  saveTemps(); renderParties();
}
function _detach(pid){   // retire le joueur de toutes les parties + nettoie les solos vides
  tempsData.parties.forEach(p => p.players = (p.players||[]).filter(x=>x!==pid));
  tempsData.parties = tempsData.parties.filter(p => !(p.solo && (p.players||[]).length===0));
}
function addPlayerToParty(targetId,pid){
  if(!pid) return; _detach(pid);
  const t = findParty(targetId); if(t) t.players.push(pid);
  saveTemps(); renderParties();
  if(t) logAction(`${joueurs[pid]?.nom||pid} rejoint le groupe « ${t.name||'Groupe'} »`);
}
function rmPlayerFromParty(id,pid){
  const p=findParty(id); if(!p) return;
  const mins = (p.minutes != null) ? p.minutes : TEMPS_DEFAUT;
  p.players=(p.players||[]).filter(x=>x!==pid);
  // le joueur retiré devient solo en gardant l'heure du groupe
  tempsData.parties.push({ id: uidParty(), name: joueurs[pid]?.nom || pid, players:[pid], minutes: mins, solo:true });
  saveTemps(); renderParties();
  logAction(`${joueurs[pid]?.nom||pid} quitte le groupe « ${p.name||'Groupe'} » (heure conservée)`);
}
// Grouper un joueur solo : vers un groupe existant (val=id) ou nouveau groupe (val='new')
function groupSolo(pid,val){
  if(!val) return;
  if(val==='new'){ const nom='Groupe '+(tempsData.parties.filter(p=>!p.solo).length+1); _detach(pid); tempsData.parties.push({ id:uidParty(), name:nom, players:[pid], minutes:TEMPS_DEFAUT, solo:false }); saveTemps(); renderParties(); logAction(`${joueurs[pid]?.nom||pid} placé dans un nouveau groupe « ${nom} »`); }
  else addPlayerToParty(val,pid);
}

function clockBtns(p){
  return `<div class="clock-btns">
    <button class="clock-btn" onclick="avanceParty('${p.id}',-60)">−1h</button>
    <button class="clock-btn" onclick="avanceParty('${p.id}',60)">+1h</button>
    <button class="clock-btn" onclick="avanceParty('${p.id}',720)">+12h</button>
    <button class="clock-btn" onclick="avanceParty('${p.id}',1440)">+1J</button>
    <input type="number" class="clock-x" id="px-${p.id}" value="2" min="1" title="X">
    <button class="clock-btn" onclick="avanceParty('${p.id}',(parseInt(document.getElementById('px-${p.id}').value)||1)*60)">+Xh</button>
    <button class="clock-btn" onclick="avanceParty('${p.id}',(parseInt(document.getElementById('px-${p.id}').value)||1)*1440)">+XJ</button>
    <button class="clock-mini" onclick="reglerDateParty('${p.id}')">Régler…</button>
  </div>`;
}
function renderParties(){
  const el = document.getElementById('parties-list'); if(!el) return;
  ensureSoloParties();
  // Tri auto par temps de campagne croissant : le groupe/joueur le PLUS EN AVANCE est en bas
  const byTime = (a,b) => ((a.minutes!=null?a.minutes:TEMPS_DEFAUT) - (b.minutes!=null?b.minutes:TEMPS_DEFAUT));
  const groups = (tempsData.parties||[]).filter(p=>!p.solo).sort(byTime);
  const solos  = (tempsData.parties||[]).filter(p=>p.solo).sort(byTime);
  let h = '';
  groups.forEach(p => {
    const col = collapsedParties.has(p.id);
    const members = (p.players||[]).map(id =>
      `<span class="pm-chip">${joueurs[id]?.nom||id}${col?'':`<button onclick="rmPlayerFromParty('${p.id}','${id}')">✕</button>`}</span>`).join('') || '<span class="pm-none">aucun membre</span>';
    const others = Object.keys(joueurs).filter(id => !(p.players||[]).includes(id));
    const addSel = others.length ? `<select class="pm-add" onchange="addPlayerToParty('${p.id}',this.value);this.value=''">
      <option value="">+ joueur…</option>${others.map(id=>`<option value="${id}">${joueurs[id]?.nom||id}</option>`).join('')}</select>` : '';
    h += `<div class="party-card${col?' collapsed':''}">
      <div class="party-head">
        <button class="party-toggle" onclick="togglePartyCollapse('${p.id}')" title="${col?'Déplier':'Réduire'}">${col?'▸':'▾'}</button>
        <input class="party-name" value="${(p.name||'').replace(/"/g,'&quot;')}" onchange="setPartyName('${p.id}',this.value)">
        ${col?`<span class="party-time-mini">${fmtHeure(p.minutes)}</span>`:''}
        <button class="party-del" onclick="delParty('${p.id}')">✕</button>
      </div>
      ${col ? '' : `<div class="party-date">📅 ${fmtDateLong(p.minutes)}</div>
      <div class="party-time">🕐 ${fmtHeure(p.minutes)}</div>
      ${clockBtns(p)}`}
      <div class="party-members">${members}${col?'':' '+addSel}</div>
    </div>`;
  });
  if(solos.length){
    h += '<div class="solo-lbl">Joueurs individuels</div>';
    solos.forEach(p => {
      const pid = (p.players||[])[0];
      const col = collapsedParties.has(p.id);
      const grpOpts = groups.map(g=>`<option value="${g.id}">→ ${g.name||'Groupe'}</option>`).join('');
      h += `<div class="party-card solo${col?' collapsed':''}">
        <div class="party-head">
          <button class="party-toggle" onclick="togglePartyCollapse('${p.id}')" title="${col?'Déplier':'Réduire'}">${col?'▸':'▾'}</button>
          <span class="solo-nom">🧍 ${joueurs[pid]?.nom||pid}</span>
          ${col?`<span class="party-time-mini">${fmtHeure(p.minutes)}</span>`:''}
        </div>
        ${col ? '' : `<div class="party-date">📅 ${fmtDateLong(p.minutes)} · <span style="color:var(--am)">${fmtHeure(p.minutes)}</span></div>
        ${clockBtns(p)}
        <div class="party-members"><select class="pm-add" onchange="groupSolo('${pid}',this.value);this.value=''"><option value="">grouper…</option>${grpOpts}<option value="new">+ Nouveau groupe</option></select></div>`}
      </div>`;
    });
  }
  el.innerHTML = h || '<div class="empty" style="font-size:9px;color:var(--td);padding:8px">Aucun joueur.</div>';
  const un = document.getElementById('unassigned-players'); if(un) un.innerHTML = '';
}

// ============================================================
// LANCER DE DÉS PUBLIC (MJ → joueurs sélectionnés)
// ============================================================
const ATTR3_LETTER = { FOR:'S', PER:'P', END:'E', CHR:'C', INT:'I', AGI:'A', LCK:'L' };
const SPECIAL_LABELS = { S:'FORCE', P:'PERCEPTION', E:'ENDURANCE', C:'CHARISME', I:'INTELLIGENCE', A:'AGILITÉ', L:'CHANCE' };

function populatePublicSkillSel(){
  const sel = document.getElementById('pub-skill-sel'); if(!sel) return;
  const attrs = ['S','P','E','C','I','A','L'].map(k => `<option value="attr:${k}">${SPECIAL_LABELS[k]}</option>`).join('');
  const skills = (typeof SKILLS_DEF!=='undefined'?SKILLS_DEF:[]).map(s => `<option value="sk:${s.key}">${s.name}</option>`).join('');
  sel.innerHTML = `<optgroup label="S.P.E.C.I.A.L">${attrs}</optgroup><optgroup label="Compétences">${skills}</optgroup>`;
}

function lancerPublic(mode){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  const doc = { id: 'r' + Date.now().toString(36), mode, players:[...selected], results:{}, open:true, ts: Date.now() };
  if(mode === 'dice'){
    doc.n = Math.min(20, Math.max(1, parseInt(document.getElementById('pub-dice-nb').value)||1));
    doc.faces = Math.min(100, Math.max(2, parseInt(document.getElementById('pub-dice-faces').value)||6));
    doc.label = `${doc.n}D${doc.faces}`;
  } else {
    const selEl = document.getElementById('pub-skill-sel');
    const [t, k] = selEl.value.split(':');
    doc.isAttr = (t === 'attr');
    doc.skillKey = k;
    doc.label = (selEl.selectedOptions[0]?.textContent || k) + ' — test 2D20';
  }
  db.collection('rolls').doc('current').set(doc);
  showMsg(`📣 Lancer envoyé à ${selected.size} joueur(s)`);
  const noms = [...selected].map(id => joueurs[id]?.nom || id).join(', ');
  logAction(`Lancer public « ${doc.label} » → ${noms}`);
}
function cloreLancer(){ db.collection('rolls').doc('current').set({ open:false, ts: Date.now() }); }

function fmtRollMJ(res, r){
  if(r.mode === 'dice') return `[${res.dice.join(', ')}] = <b style="color:var(--am)">${res.total}</b>`;
  const tags = (res.crit?' <span style="color:var(--g)">✦crit</span>':'') + (res.comp?' <span style="color:var(--rd)">⚠compl.</span>':'');
  return `[${res.dice.join(', ')}] vs TN ${res.tn} → <b style="color:var(--am)">${res.successes} succ.</b>${tags}`;
}
function renderPublicRoll(r){
  const el = document.getElementById('pub-roll-results'); if(!el) return;
  if(!r || !r.open){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='block';
  const rows = (r.players||[]).map(id => {
    const res = r.results?.[id];
    const nom = joueurs[id]?.nom || id;
    return `<div class="pr-row"><span class="pr-nom">${nom}</span><span class="pr-res">${res ? fmtRollMJ(res, r) : '⏳ en attente…'}</span></div>`;
  }).join('');
  el.innerHTML = `<div style="font-size:9px;letter-spacing:1px;color:var(--am);margin-bottom:4px">🎲 ${r.label}</div>${rows}`
    + `<button class="action-btn" onclick="cloreLancer()" style="width:100%;margin-top:5px;font-size:9px">Clore le lancer</button>`;
}

// ============================================================
// RENDER JOUEURS
// ============================================================
function renderJoueurs(){
  const grid = document.getElementById('joueurs-grid');
  const ids = Object.keys(joueurs);
  if(!ids.length){ grid.innerHTML='<div style="font-size:9px;color:var(--td);padding:20px">Aucun personnage</div>'; return; }
  grid.innerHTML = '';
  ids.forEach(id => {
    const d = joueurs[id];
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const _hs = (typeof fpHealthStatus==='function') ? fpHealthStatus(pct) : {sev:pct>=100?0:pct<30?3:1,label:pct>=100?'OK':pct<30?'CRITIQUE':'BLESSÉ'};
    const statut = ['ok','blesse','grave','critique'][_hs.sev];
    const statutLbl = _hs.label;
    const sel = selected.has(id);
    const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON').map(it=>it.name).join(', ')||'—';
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const blessures = d.wounds ? Object.entries(d.wounds).filter(([,v])=>v).map(([k])=>k).join(', ') : '';

    grid.innerHTML += `<div class="joueur-card${sel?' selected':''}${statut==='critique'?' critique':''}" onclick="toggleSel('${id}')">
      <div class="sel-indicator"></div>
      <div class="jc-name">${(d.nom||id).toUpperCase()}
        <span class="jc-badge ${statut}">${statutLbl}</span>
      </div>
      <div class="jc-stat"><span class="jc-stat-lbl">PV</span><span class="jc-stat-val${pct<30?' danger':pct<60?' warn':''}">${d.hp||0} / ${hpMax}</span></div>
      <div class="jc-bar"><div class="jc-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="jc-stat"><span class="jc-stat-lbl">RAD</span><span class="jc-stat-val${(d.rad||0)>0?' warn':''}">${d.rad||0}</span></div>
      <div class="jc-stat"><span class="jc-stat-lbl">LVL</span><span class="jc-stat-val">${d.niveau||1} · ${d.xp||0} XP</span></div>
      <div class="jc-stat"><span class="jc-stat-lbl">LUCK</span><span class="jc-stat-val" style="color:var(--am)">${d.luck_points||0}/${d.special?.L||5}</span></div>
      <div class="jc-weap">🔫 ${weaps}${blessures?`<br>🩸 ${blessures}`:''}</div>
      <a class="jc-link-bottom" href="${FICHE_URL}?id=${id}" target="_blank" onclick="event.stopPropagation()">↗ Fiche</a>
    </div>`;
  });
  document.getElementById('sel-count').textContent = selected.size;
}

// ============================================================
// SELECTION
// ============================================================
function toggleSel(id){ selected.has(id)?selected.delete(id):selected.add(id); renderJoueurs(); }
function selTous(){ selected = new Set(Object.keys(joueurs)); renderJoueurs(); }
function selAucun(){ selected.clear(); renderJoueurs(); }

// ============================================================
// ACTIONS JOUEURS
// ============================================================
async function appliquer(action){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  // Repos : fait avancer l'horloge des groupes des joueurs sélectionnés (durée selon le type)
  const REPOS_MIN = { 'repos-court': 60, 'repos-long': 480, 'bien-repos': 480 };
  if(REPOS_MIN[action]){
    const delta = REPOS_MIN[action];
    const vues = new Set();
    [...selected].forEach(id => {
      const p = (tempsData.parties||[]).find(x => (x.players||[]).includes(id));
      if(p && !vues.has(p.id)){ vues.add(p.id); p.minutes = (p.minutes||0) + delta; }
    });
    if(vues.size){ saveTemps(); logAction(`⏱ Repos : +${Math.round(delta/60)}h (${vues.size} groupe(s))`); }
  }
  const promises = [...selected].map(async id => {
    const d = joueurs[id]; if(!d) return;
    const hpMax = getHpMax(d);
    let upd = {};
    if(action==='dmg')       upd.hp = Math.max(0,(d.hp||0)-parseInt(document.getElementById('val-dmg').value||1));
    else if(action==='heal') upd.hp = Math.min(hpMax,(d.hp||0)+parseInt(document.getElementById('val-heal').value||1));
    else if(action==='fullheal') upd.hp = hpMax;
    else if(action==='rad')  upd.rad = Math.min(hpMax,(d.rad||0)+parseInt(document.getElementById('val-rad').value||1));
    else if(action==='derad') upd.rad = Math.max(0,(d.rad||0)-parseInt(document.getElementById('val-derad').value||4));
    else if(action==='derad-full') upd.rad = 0;
    else if(action==='clear-effects') upd.activeEffects = [];
    else if(action==='xp'||action==='xp-500'||action==='xp-1000'){
      const v = action==='xp'?parseInt(document.getElementById('val-xp').value||100):action==='xp-500'?500:1000;
      let xp=(d.xp||0)+v, niv=d.niveau||1;
      while(niv<20&&xp>=XP_TABLE[niv])niv++;
      upd.xp=xp; upd.niveau=niv;
    }
    else if(action==='repos-court') { upd.hp=Math.min(hpMax,(d.hp||0)+(d.special?.E||5)); upd.rad=Math.max(0,(d.rad||0)-2); }
    else if(action==='repos-long')  {
      const now = (typeof partyMinutesFor==='function') ? partyMinutesFor(tempsData, id) : (d.survie?.sleep||0);
      upd.survie = { ...(d.survie||{}), sleep: now, wellRested: false };   // dort → Reposé (annule bien-reposé)
      upd.hp = getHpMax({ ...d, survie: upd.survie });
      upd.rad = Math.max(0, Math.floor((d.rad||0)/2));
    }
    else if(action==='bien-repos')  {
      const now = (typeof partyMinutesFor==='function') ? partyMinutesFor(tempsData, id) : (d.survie?.sleep||0);
      upd.survie = { ...(d.survie||{}), sleep: now, eat: (d.survie?.eat ?? now), drink: (d.survie?.drink ?? now), wellRested: true };
      upd.hp = getHpMax({ ...d, survie: upd.survie });   // PV max + 2 (bien reposé)
      upd.rad = Math.max(0, Math.floor((d.rad||0)/2));
    }
    else if(action==='reset-wounds') upd.wounds={head:false,torso:false,armL:false,armR:false,legL:false,legR:false};
    else if(action==='luck-init')    upd.luck_points = d.special?.L||5;
    else if(action==='luck-recover') upd.luck_points = Math.min(d.special?.L||5, (d.luck_points||0) + parseInt(document.getElementById('val-luck-rec').value||1));
    else if(action==='caps-give')    upd.caps = (d.caps||0) + parseInt(document.getElementById('val-caps').value||0);
    else if(action==='caps-remove')  upd.caps = Math.max(0, (d.caps||0) - parseInt(document.getElementById('val-caps').value||0));
    upd.lastUpdate=Date.now();
    await db.collection('joueurs').doc(id).update(upd);
  });
  await Promise.all(promises);
  const lbls={dmg:'Dégâts',heal:'Soins',fullheal:'Soin complet',rad:'Radiation',derad:'Rad soignée','derad-full':'Rad retirée','clear-effects':'Effets purgés',xp:'XP','xp-500':'+500 XP','xp-1000':'+1000 XP','repos-court':'Repos court','repos-long':'Repos long','bien-repos':'Bien reposé','reset-wounds':'Blessures effacées','luck-init':'Luck initialisé','luck-recover':'Luck récupéré','caps-give':'Caps donnés','caps-remove':'Caps retirés'};
  showMsg(`✓ ${lbls[action]||action} — ${selected.size} joueur(s)`);
  const names = [...selected].map(id => joueurs[id]?.nom || id).join(', ');
  const valMap = { dmg:'val-dmg', heal:'val-heal', rad:'val-rad', derad:'val-derad', xp:'val-xp', 'luck-recover':'val-luck-rec', 'caps-give':'val-caps', 'caps-remove':'val-caps' };
  const v = valMap[action] ? (document.getElementById(valMap[action])?.value || '') : '';
  logAction(`${lbls[action]||action}${v?' ('+v+')':''} → ${names}`);
}

// ============================================================
// GÉNÉRATION DE RENCONTRE (zones pondérées + factions)
// ============================================================
function _ctxTags(opts){
  const t = [];
  if(opts.occupation && opts.occupation!=='neutral') t.push(window.FACTIONS?.[opts.occupation]?.label || opts.occupation);
  if(opts.variation) t.push(VARIATION_LABELS[opts.variation]||opts.variation);
  if(opts.threat && opts.threat!=='normal') t.push('Menace '+(THREAT_LABELS[opts.threat]||opts.threat));
  return t.join(' · ');
}

// Aperçu des probabilités du pool résolu (pour le réglage des poids)
function apercuPool(){
  const opts = getRencontreOpts();
  if(!opts.zone || !window.ZONES_DB?.[opts.zone]) return;
  const probs = zonePoolProbabilities(opts.zone, opts);
  const panel = document.getElementById('rencontre-panel');
  document.getElementById('btn-combat-wrap').style.display='none';
  panel.innerHTML = `<div class="rencontre-header">📊 ${window.ZONES_DB[opts.zone].label}</div>`
    + `<div class="rencontre-sub">${_ctxTags(opts)||'Pool de base'}</div>`
    + probs.map(p=>`<div style="display:flex;justify-content:space-between;font-size:9px;padding:2px 4px;border-bottom:1px solid var(--b)">
        <span style="color:${p.nom==='none'?'var(--td)':'var(--t)'}">${p.nom==='none'?'— pas de rencontre':p.nom}</span>
        <span style="color:var(--am)">${p.pct}%</span></div>`).join('');
}

// Génère une rencontre : N jets sur le pool résolu (none = créneau vide)
function genRencontre(){
  const opts = getRencontreOpts();
  if(!opts.zone || !window.ZONES_DB?.[opts.zone]){ showMsg('Zone invalide', true); return; }
  const slots = Math.max(1, parseInt(document.getElementById('nb-slots')?.value)||4);
  const pool = resolveZonePool(opts.zone, opts);
  const panel = document.getElementById('rencontre-panel');
  const zoneLabel = window.ZONES_DB[opts.zone].label || opts.zone;

  const combatData = [];
  for(let i=0;i<slots;i++){
    const name = rollEncounter(pool);
    if(!name || name==='none') continue;
    let inst = null;
    if(window.ENNEMIS_DB?.[name]){
      inst = enemyInstanceFromDB(name, 1);
    } else if(opts.occupation && opts.occupation!=='neutral' && window.FACTIONS?.[opts.occupation]){
      // nom sans fiche → unité générée de la faction occupante
      inst = generateFactionUnit(opts.occupation, {});
    }
    if(inst){ inst.id = Date.now()+i; combatData.push(inst); }
  }

  if(!combatData.length){
    sessionStorage.removeItem('combat_ennemis');
    document.getElementById('btn-combat-wrap').style.display='none';
    panel.innerHTML = `<div class="rencontre-header">🌿 ${zoneLabel}</div>`
      + (_ctxTags(opts)?`<div class="rencontre-sub">${_ctxTags(opts)}</div>`:'')
      + `<div class="event-calme">✓ AUCUNE RENCONTRE<br><span>La zone est calme.</span></div>`;
    return;
  }

  const totalXP = combatData.reduce((a,e)=>a+(e.xp||0),0);
  sessionStorage.setItem('combat_ennemis', JSON.stringify(combatData));
  sessionStorage.setItem('combat_joueurs', JSON.stringify([...selected]));
  document.getElementById('btn-combat-wrap').style.display='block';

  panel.innerHTML = `
    <div class="rencontre-header">⚔ ${zoneLabel}</div>
    <div class="rencontre-sub">${_ctxTags(opts)?_ctxTags(opts)+' · ':''}${combatData.length} ennemi(s) · XP total : ${totalXP}</div>
    ${combatData.map((e,i)=>{
      const def = window.ENNEMIS_DB?.[e.nom] || {};
      const col = e.factionColor || 'var(--rd)';
      return `
    <div class="ennemi-card" style="border-left:3px solid ${col}">
      <div class="ennemi-name">${i+1}. ${e.nom} <span style="font-size:7px;color:var(--td)">Niv.${e.level||'?'}${e.category&&e.category!=='normal'?' '+e.category:''}</span></div>
      <div class="ennemi-stats">PV : <b>${e.pvMax}</b> · Atq : <b>${e.atq}</b> · RD : <b>${e.rd}</b>${e.eff?` · <span style="color:var(--am)">${e.eff}</span>`:''}</div>
      ${def.desc?`<div class="ennemi-desc">${def.desc}</div>`:''}
      <div class="ennemi-xp">XP : ${e.xp}</div>
    </div>`;}).join('')}
    <div class="rencontre-actions">
      <button class="r-btn" onclick="donnerXPCombat(${totalXP})">✓ Donner ${totalXP} XP aux sélectionnés</button>
    </div>`;
}

async function lancerCombat(){
  const zk = document.getElementById('zone-sel')?.value || '';
  const zone = window.ZONES_DB?.[zk]?.label || zk;
  const joueurIds = JSON.parse(sessionStorage.getItem('combat_joueurs') || '[]');
  const ennemisData = JSON.parse(sessionStorage.getItem('combat_ennemis') || '[]');
  const btn = document.getElementById('btn-vers-combat');
  if(btn){ btn.textContent = '⏳ Création...'; btn.disabled = true; }
  try {
    await createCombatSession(ennemisData, joueurIds, zone);
    await applyFatigueDebutCombat(joueurIds);
    logAction(`Combat lancé — ${zone||'?'} (${ennemisData.length} ennemi(s))`);
    window.location.href = 'combat.html';
  } catch(e){
    console.error('lancerCombat:', e);
    if(btn){ btn.textContent = '⚔ Ouvrir l\'écran combat'; btn.disabled = false; }
  }
}

// Survie : à l'ouverture d'un combat (= début de scène), chaque joueur perd 1 PV / 2 Fatigue (RAW p.190)
async function applyFatigueDebutCombat(joueurIds){
  if(typeof SURVIE === 'undefined' || typeof partyMinutesFor !== 'function') return;
  for(const id of (joueurIds||[])){
    const d = joueurs[id]; if(!d) continue;
    const now = partyMinutesFor(tempsData, id);
    const s = SURVIE.compute(d.survie, now);
    if(s.hpLoss > 0){
      const nv = Math.max(0, (d.hp||0) - s.hpLoss);
      try { await db.collection('joueurs').doc(id).update({ hp: nv }); } catch(e){}
      d.hp = nv;
      logAction(`${d.nom||id} : −${s.hpLoss} PV (Fatigue ${s.fatigue} en début de combat)`);
    }
  }
}
function donnerXPCombat(xp){
  document.getElementById('val-xp').value = xp;
  appliquer('xp');
}

// ============================================================
// DÉPLACEMENT
// ============================================================
function genDeplacement(){
  const unite = parseInt(document.getElementById('nb-unites').value)||1;
  const opts = getRencontreOpts();
  const zoneLabel = window.ZONES_DB?.[opts.zone]?.label || opts.zone;
  const danger = THREAT_DANGER[opts.threat] || 2;
  const panel = document.getElementById('rencontre-panel');

  // Probabilité d'événement augmente avec distance et niveau de menace
  const pctEvent = Math.min(95, 20 + (unite*5) + (danger*8));
  const roll = Math.random()*100;

  let html = `<div class="rencontre-header">🚶 DÉPLACEMENT — ${zoneLabel}</div>
    <div class="rencontre-sub">${unite} unité(s)${opts.threat&&opts.threat!=='normal'?' · '+(THREAT_LABELS[opts.threat]||opts.threat):''} · Risque calculé : <b>${pctEvent}%</b></div>
    <div class="deplacement-roll">Jet : <b>${Math.round(roll)}</b> / 100</div>`;

  if(roll > pctEvent){
    html += `<div class="event-calme">✓ DÉPLACEMENT SANS ENCOMBRE<br><span>Le groupe arrive à destination.</span></div>`;
    document.getElementById('btn-combat-wrap').style.display='none';
  } else {
    const r2 = Math.random()*100;
    let cumul=0, evt=EVENEMENTS_DEPLACEMENT[0];
    for(const e of EVENEMENTS_DEPLACEMENT){
      cumul+=e.pct;
      if(r2<=cumul){ evt=e; break; }
    }

    const color = evt.type==='calme'?'var(--g)':evt.type==='combat'||evt.type==='danger'?'var(--rd)':'var(--am)';
    html += `<div class="event-card" style="border-color:${color}">
      <div class="event-type" style="color:${color}">⚡ ${evt.label.toUpperCase()}</div>
      <div class="event-desc">${evt.desc}</div>
    </div>`;

    if(evt.type==='combat'||evt.type==='danger'){
      html += `<button class="r-btn" onclick="genRencontre()" style="margin-top:8px">⚔ Générer la rencontre</button>`;
    }
  }

  panel.innerHTML = html;
}

// ============================================================
// MSG
// ============================================================
function showMsg(txt, err=false){
  const el=document.getElementById('msg-bar');
  el.textContent=txt;
  el.style.borderColor=err?'var(--rd)':'var(--g)';
  el.style.color=err?'var(--rd)':'var(--g)';
  el.style.display='block';
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.style.display='none',2500);
}

// ============================================================
// LANCEUR DE DÉS
// ============================================================
// Animation « dés qui roulent » : défile des valeurs aléatoires puis se fige
function animateDiceRoll(el, frameFn, finalHtml, dur=520){
  el.style.display='block';
  el.classList.add('rolling');
  const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    if(t < dur){
      el.innerHTML = frameFn();
      setTimeout(tick, 45 + (t/dur)*70);   // ralentit vers la fin
    } else {
      el.classList.remove('rolling');
      el.innerHTML = finalHtml;
      el.classList.add('settled');
      setTimeout(()=>el.classList.remove('settled'), 360);
    }
  };
  tick();
}

function lancerDes(){
  const nb = Math.min(20, parseInt(document.getElementById('dice-nb').value)||2);
  const faces = Math.min(100, parseInt(document.getElementById('dice-faces').value)||20);
  const resultats = Array.from({length:nb}, ()=>Math.floor(Math.random()*faces)+1);
  const total = resultats.reduce((a,b)=>a+b,0);
  const el = document.getElementById('dice-result');
  const finalHtml = `<span style="color:var(--td)">${nb}D${faces} → </span>${resultats.join(' + ')} <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:16px"> = ${total}</span>`;
  animateDiceRoll(el, ()=>{
    const scr = Array.from({length:nb}, ()=>Math.floor(Math.random()*faces)+1);
    return `<span style="color:var(--td)">${nb}D${faces} → </span><span style="color:var(--tb)">${scr.join(' + ')}</span>`;
  }, finalHtml);
}

// Dés de Combat Fallout 2D20 : 1|2dmg, blank, blank, 1dmg+effet, 1dmg+effet
function lancerCD(){
  const nb = Math.min(10, parseInt(document.getElementById('dice-nb').value)||2);
  const resultats = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = resultats.reduce((a,f)=>a+(parseInt(f)||0),0);
  const effets = resultats.filter(f=>f.includes('⚡')).length;
  const el = document.getElementById('dice-result');
  const finalHtml = `<span style="color:var(--td)">${nb}DC → </span>`
    + resultats.map(f=>`<span style="color:${f.includes('⚡')?'var(--am)':f==='—'?'var(--td)':'var(--tb)'}">` + f + '</span>').join(' ')
    + ` <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:14px"> = ${dmg} dmg${effets>0?` + ${effets} Effet(s)`:''}</span>`;
  animateDiceRoll(el, ()=>{
    const scr = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
    return `<span style="color:var(--td)">${nb}DC → </span>` + scr.map(f=>`<span style="color:var(--tb)">${f}</span>`).join(' ');
  }, finalHtml);
}

// rollDice défini dans mj_shared.js

// ============================================================
// GESTION DES SESSIONS COMBAT (multi-room)
// ============================================================

function genCombatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function createCombatSession(combatData, joueurIds, zone) {
  const combatId = genCombatId();
  await db.collection(COMBATS_COLL).doc(combatId).set({
    actif: true, numRound: 0, tourActif: 0,
    ordreInitiative: [], actionsState: {},
    ennemis: combatData, apPool: 0, mjApPool: 0,
    meta: { createdAt: Date.now(), status: 'active', joueurs: joueurIds, round: 0, zone: zone||'' },
    lastUpdate: Date.now(),
  });
  await db.collection(COMBATS_COLL).doc('current').set({combatId, lastUpdate: Date.now()});
  sessionStorage.setItem('currentCombatId', combatId);
  return combatId;
}

function joinCombat(combatId) {
  sessionStorage.setItem('currentCombatId', combatId);
  window.location.href = 'combat.html';
}

async function terminerCombatSession(combatId) {
  await db.collection(COMBATS_COLL).doc(combatId).update({
    actif: false, 'meta.status': 'termine', lastUpdate: Date.now()
  });
  const cur = await db.collection(COMBATS_COLL).doc('current').get();
  if(cur.exists && cur.data()?.combatId === combatId)
    db.collection(COMBATS_COLL).doc('current').set({combatId: null, lastUpdate: Date.now()});
  renderCombatsActifs();
}

function renderCombatsActifs() {
  const el = document.getElementById('combats-actifs-list'); if(!el) return;
  el.innerHTML = '<div class="empty">Chargement...</div>';
  db.collection(COMBATS_COLL).get().then(snap => {
    const actifs = [];
    snap.forEach(doc => {
      if(doc.id === 'current' || doc.id === 'fallout-paris') return;
      const d = doc.data();
      if(!d.meta) return; // ignorer les docs sans meta (ancien format)
      if(d.actif && d.meta.status !== 'termine') actifs.push({id: doc.id, ...d});
    });
    if(!actifs.length){ el.innerHTML = '<div class="empty">Aucun combat actif</div>'; return; }
    el.innerHTML = actifs.map(c => {
      const joueurs = (c.meta?.joueurs||[]).join(', ') || '—';
      const zone   = c.meta?.zone ? ' · ' + c.meta.zone : '';
      return '<div class="combat-item">' +
        '<div class="combat-item-info">' +
          '<span class="combat-id">' + c.id + '</span>' +
          '<span class="combat-meta">R' + (c.numRound||0) + zone + ' · ' + joueurs + '</span>' +
        '</div>' +
        '<div class="combat-item-btns">' +
          '<button class="r-btn" onclick="joinCombat(\'' + c.id + '\')">↗ Rejoindre</button>' +
          '<button class="r-btn" style="border-color:var(--rd);color:var(--rd)" onclick="terminerCombatSession(\'' + c.id + '\')">✕ Terminer</button>' +
        '</div></div>';
    }).join('');
  }).catch(() => { el.innerHTML = '<div class="empty">Erreur</div>'; });
}



// ============================================================
// MESSAGERIE MJ — écrire à chaque joueur (identité 'mj')
// ============================================================
const MJ_ID = 'mj';
let mjActiveConv = null;
let mjConvUnsub = null;
let mjConvLatest = {};   // convId -> ts du dernier message reçu (from !== mj)
let mjConvWatch = {};    // convId -> unsub
let mjMsgRead = (()=>{ try{ return JSON.parse(localStorage.getItem('fp_msgRead_mj')||'{}'); }catch(e){ return {}; } })();
function mjSaveRead(){ try{ localStorage.setItem('fp_msgRead_mj', JSON.stringify(mjMsgRead)); }catch(e){} }
function mjConvIdFor(pid){ return [MJ_ID, pid].sort().join('__'); }
function mjEsc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function mjLatestIncoming(msgs){ let t=0; (msgs||[]).forEach(m=>{ if(m && m.from!==MJ_ID && (m.ts||0)>t) t=m.ts||0; }); return t; }
function mjHasUnread(){ return Object.keys(mjConvLatest).some(cid => (mjConvLatest[cid]||0) > (mjMsgRead[cid]||0)); }
function mjUpdateIcon(){ const d=document.getElementById('mj-msg-dot'); if(d) d.style.display = mjHasUnread()?'block':'none'; }

// (Ré)abonne une écoute légère à chaque conversation MJ↔joueur pour repérer les non-lus
function mjSyncWatchers(){
  const wanted = {};
  Object.keys(joueurs).forEach(pid => { wanted[mjConvIdFor(pid)] = true; });
  Object.keys(mjConvWatch).forEach(cid => { if(!wanted[cid]){ mjConvWatch[cid](); delete mjConvWatch[cid]; delete mjConvLatest[cid]; } });
  Object.keys(wanted).forEach(cid => {
    if(mjConvWatch[cid]) return;
    mjConvWatch[cid] = db.collection('messages').doc(cid).onSnapshot((s) => {
      const msgs = (s.exists && Array.isArray(s.data().msgs)) ? s.data().msgs : [];
      mjConvLatest[cid] = mjLatestIncoming(msgs);
      if(mjActiveConv && mjConvIdFor(mjActiveConv) === cid){ mjMsgRead[cid] = Math.max(mjMsgRead[cid]||0, mjConvLatest[cid]); mjSaveRead(); }
      mjUpdateIcon();
      if(document.getElementById('mj-msg-modal')?.classList.contains('on')) mjRenderContacts();
    }, (e)=>console.warn('mj conv-watch:', e && e.code));
  });
}
function openMsgMJ(){ const m=document.getElementById('mj-msg-modal'); if(!m) return; m.classList.add('on'); mjRenderContacts(); }
function closeMsgMJ(){ const m=document.getElementById('mj-msg-modal'); if(m) m.classList.remove('on'); }
function mjRenderContacts(){
  const el = document.getElementById('mj-msg-contacts'); if(!el) return;
  const ids = Object.keys(joueurs);
  if(!ids.length){ el.innerHTML = '<div class="msg-empty">Aucun joueur.</div>'; return; }
  el.innerHTML = ids.map(pid => {
    const nom = joueurs[pid]?.nom || pid;
    const on = mjActiveConv === pid;
    const cid = mjConvIdFor(pid);
    const unread = (mjConvLatest[cid]||0) > (mjMsgRead[cid]||0);
    return `<button class="msg-contact${on?' on':''}${unread?' unread':''}" onclick="openConvMJ('${pid}')">${mjEsc(nom)}${unread?'<span class="msg-contact-dot"></span>':''}</button>`;
  }).join('');
}
function openConvMJ(pid){
  mjActiveConv = pid;
  mjRenderContacts();
  document.getElementById('mj-msg-conv-head').textContent = '💬 ' + (joueurs[pid]?.nom || pid);
  document.getElementById('mj-msg-input-row').style.display = 'flex';
  if(mjConvUnsub){ mjConvUnsub(); mjConvUnsub = null; }
  const cid = mjConvIdFor(pid);
  mjConvUnsub = db.collection('messages').doc(cid).onSnapshot((s) => {
    const msgs = (s.exists && Array.isArray(s.data().msgs)) ? s.data().msgs : [];
    mjRenderMsgs(msgs);
    mjConvLatest[cid] = mjLatestIncoming(msgs);
    mjMsgRead[cid] = Math.max(mjMsgRead[cid]||0, mjConvLatest[cid]); mjSaveRead(); mjUpdateIcon();
  }, (e)=>console.warn('mj conv:', e && e.code));
}
function mjRenderMsgs(msgs){
  const el = document.getElementById('mj-msg-list'); if(!el) return;
  if(!msgs.length){ el.innerHTML = '<div class="msg-empty">Aucun message. Dis bonjour !</div>'; return; }
  el.innerHTML = msgs.slice().sort((a,b)=>(a.ts||0)-(b.ts||0)).map(m => {
    const me = m.from === MJ_ID;
    const t = new Date(m.ts||0);
    const hh = String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
    return `<div class="msg-bubble${me?' me':''}"><div class="msg-txt">${mjEsc(m.text)}</div><div class="msg-ts">${hh}</div></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
function sendMsgMJ(){
  const inp = document.getElementById('mj-msg-text'); if(!inp || !mjActiveConv) return;
  const text = inp.value.trim(); if(!text) return;
  inp.value = '';
  const msg = { from: MJ_ID, text, ts: Date.now() };
  db.collection('messages').doc(mjConvIdFor(mjActiveConv))
    .set({ msgs: firebase.firestore.FieldValue.arrayUnion(msg) }, { merge: true })
    .catch(e => console.error('sendMsgMJ:', e));
}
