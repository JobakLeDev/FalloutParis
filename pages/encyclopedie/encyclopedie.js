// ============================================================
// ENCYCLOPÉDIE — contenu statique /data/encyclopedie.json (window.ENCY),
// état de découverte dynamique Firebase /encyclopedie/data { reveal:{id:[pids]}, lieuxPoi:{poi:[pids]} }.
// MJ (auth 1234, pas de ?id) voit tout + révèle ; joueur (?id) voit seulement le découvert.
// Déblocage auto des Lieux via la carte (POI révélé → lieuxPoi). ?embed=1 masque le header (iframe fiche).
// ============================================================

const MJ_CODE = '1234';
const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb;
let joueurs = {};
let state = { reveal: {}, lieuxPoi: {} };   // état de découverte (Firebase)
let cat = 'lieux';

// Garantit un id stable sur chaque entrée (clé de révélation) même si le JSON Notion l'omet
function _slug(s){ return ('' + s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'x'; }
function ensureIds(){
  const E = window.ENCY || {};
  const pref = { lieux:'lieu', personnages:'pnj', bestiaire:'best', evenements:'evt' };
  Object.keys(pref).forEach(k => (E[k] || []).forEach((e, i) => {
    if(!e.id) e.id = pref[k] + '-' + _slug(e.titre || e.ref || ('x' + i));
  }));
  (E.factions || []).forEach(f => {
    if(!f.id) f.id = _slug(f.titre);
    (f.entries || []).forEach((s, i) => { if(!s.id) s.id = 'fac-' + f.id + '-' + _slug(s.titre || ('x' + i)); });
  });
}

function initEncy(){
  if(embed) document.body.classList.add('embed');
  ensureIds();
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  updateModeUI();
  fdb.collection('joueurs').onSnapshot(s => {
    joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
    render();
  });
  fdb.collection('encyclopedie').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    state = { reveal: d.reveal || {}, lieuxPoi: d.lieuxPoi || {} };
    render();
  });
  window.addEventListener('message', e => { if(e.data === 'ency-refresh') render(); });
}

function demanderMJ(){
  if(isMJ || viewerId) return;
  if(prompt('Code MJ :') !== MJ_CODE) return;
  sessionStorage.setItem('mj_auth', '1');
  isMJ = true; updateModeUI(); render();
}
function updateModeUI(){
  const m = document.getElementById('ehdr-mode');
  if(m) m.textContent = isMJ ? 'Vue MJ' : (viewerId ? 'Vue joueur' : 'Visiteur');
  const mb = document.getElementById('emj-btn'); if(mb) mb.style.display = (isMJ || viewerId) ? 'none' : '';
}
function saveState(){ if(fdb) fdb.collection('encyclopedie').doc(fpCampId()).set(state, { merge:true }).catch(e => console.error('saveEncy', e)); }

function setCat(c){ cat = c; document.querySelectorAll('.ecat').forEach(b => b.classList.toggle('on', b.dataset.c === c)); render(); }

// ---- Données ----
const ENCY = () => window.ENCY || { lieux:[], personnages:[], bestiaire:[], evenements:[], factions:[] };
function catList(c){ const E = ENCY(); return c === 'timeline' ? (E.evenements||[]) : (E[c] || []); }
function allEntries(){ const E = ENCY(); const facs = (E.factions||[]); return [...(E.lieux||[]),...(E.personnages||[]),...(E.bestiaire||[]),...(E.evenements||[]),...facs,...facs.flatMap(f => f.entries||[])]; }
function entryById(id){ return allEntries().find(e => e.id === id); }
function titreOf(e){ return e.titre || (e.ref ? (window.ENNEMIS_DB?.[e.ref] ? e.ref : e.ref) : '') || e.id; }

// ---- Visibilité ----
function visible(e){
  if(isMJ) return true;
  if(!viewerId) return false;
  if((state.reveal[e.id] || []).includes(viewerId)) return true;
  if(e.poi && (state.lieuxPoi[e.poi] || []).includes(viewerId)) return true;   // auto via carte
  return false;
}
function effOn(e, pid){
  return (state.reveal[e.id] || []).includes(pid) || (e.poi && (state.lieuxPoi[e.poi] || []).includes(pid));
}

// ---- MJ : révélation ----
function toggleReveal(id, pid){
  state.reveal[id] = state.reveal[id] || [];
  const k = state.reveal[id].indexOf(pid);
  if(k >= 0) state.reveal[id].splice(k, 1); else state.reveal[id].push(pid);
  saveState(); render();
}
function revealAll(id){ state.reveal[id] = Object.keys(joueurs); saveState(); render(); }
function revealNone(id){ state.reveal[id] = []; saveState(); render(); }

// ---- Rendu ----
function esc(s){ return (s == null ? '' : '' + s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function imgSrc(p){ if(!p) return ''; return /^(https?:|\.\.\/)/.test(p) ? p : '../../' + p; }

function render(){
  const el = document.getElementById('ency-list'); if(!el) return;
  const q = (document.getElementById('esearch')?.value || '').trim().toLowerCase();
  let list = catList(cat).filter(visible);
  if(q) list = list.filter(e => (titreOf(e) + ' ' + (e.corps||'')).toLowerCase().includes(q));

  if(cat === 'factions'){
    let facs = (ENCY().factions || []);
    if(q) facs = facs.filter(f => ((f.titre||'') + ' ' + (f.corps||'')).toLowerCase().includes(q));
    const cards = facs.map(renderFactionCard).filter(Boolean);
    el.innerHTML = cards.length ? '<div class="ecards">' + cards.join('') + '</div>'
      : `<div class="e-empty">${isMJ ? 'Aucune faction dans encyclopedie.json.' : 'Aucune faction découverte.'}</div>`;
    return;
  }
  if(cat === 'timeline'){
    list = list.slice().sort((a,b) => (a.ordre||0) - (b.ordre||0) || ('' + (a.date||'')).localeCompare('' + (b.date||'')));
    el.innerHTML = list.length ? '<div class="etl">' + list.map(renderEvent).join('') + '</div>'
      : `<div class="e-empty">${isMJ ? 'Aucun événement dans encyclopedie.json.' : 'Aucun événement découvert.'}</div>`;
    return;
  }
  if(!list.length){ el.innerHTML = `<div class="e-empty">${isMJ ? 'Aucune entrée — remplis encyclopedie.json.' : 'Rien de découvert pour l\'instant.'}</div>`; return; }
  el.innerHTML = '<div class="ecards">' + list.map(renderCard).join('') + '</div>';
}

function revealRow(e){
  if(!isMJ) return '';
  const pids = Object.keys(joueurs);
  const btns = pids.map(pid => {
    const on = effOn(e, pid);
    const auto = e.poi && (state.lieuxPoi[e.poi] || []).includes(pid);
    return `<button class="e-reveal${on ? ' on' : ''}" onclick="toggleReveal('${e.id}','${pid}')" title="${auto ? 'Découvert via la carte' : ''}">${on ? '👁' : '∅'} ${esc(joueurs[pid]?.nom || pid)}${auto ? ' 📍' : ''}</button>`;
  }).join('');
  return `<div class="e-reveal-row"><span class="e-reveal-lbl">Visible par :</span>${btns || '<span class="e-muted">aucun joueur</span>'}
    <button class="e-reveal-all" onclick="revealAll('${e.id}')">Tous</button><button class="e-reveal-all" onclick="revealNone('${e.id}')">Aucun</button></div>`;
}

function liensChips(e){
  const l = e.liens || []; if(!l.length) return '';
  const chips = l.map(id => { const t = entryById(id); return t ? `<span class="e-chip">${esc(titreOf(t))}</span>` : ''; }).join('');
  return chips ? `<div class="e-liens">${chips}</div>` : '';
}

function renderCard(e){
  const img = imgSrc(e.img);
  let meta = '';
  if(cat === 'personnages'){
    const fac = window.FACTIONS?.[e.faction];
    if(fac) meta += `<span class="e-badge" style="color:${fac.color||'var(--am)'};border-color:${fac.color||'var(--am)'}">${esc(fac.label||e.faction)}</span>`;
    const lieu = e.lieu ? entryById(e.lieu) : null;
    if(lieu) meta += `<span class="e-meta">📍 ${esc(titreOf(lieu))}</span>`;
  }
  if(cat === 'bestiaire'){
    const db = window.ENNEMIS_DB?.[e.ref];
    if(db){
      meta += `<span class="e-meta">Niv. ${db.level ?? '?'} · ${esc(db.type || '')} · ${db.hp ?? '?'} PV</span>`;
      if(Array.isArray(db.attacks) && db.attacks.length) meta += `<span class="e-meta">⚔ ${esc(db.attacks.map(a => a.name).filter(Boolean).join(', '))}</span>`;
    }
  }
  return `<div class="ecard">
    ${img ? `<div class="e-img"><img src="${esc(img)}" alt=""></div>` : ''}
    <div class="e-body">
      <div class="e-title">${esc(titreOf(e))}</div>
      ${meta ? `<div class="e-metas">${meta}</div>` : ''}
      ${e.corps ? `<div class="e-text">${esc(e.corps)}</div>` : ''}
      ${liensChips(e)}
      ${revealRow(e)}
    </div>
  </div>`;
}

// ---- Factions ----
const REL_LBL = { allie:{t:'Allié',c:'var(--g)'}, ennemi:{t:'Ennemi',c:'var(--rd)'}, neutre:{t:'Neutre',c:'var(--td)'} };
function factionBaseVisible(f){
  if(isMJ) return true;
  if(!viewerId) return false;
  if((state.reveal[f.id] || []).includes(viewerId)) return true;
  if((joueurs[viewerId] || {}).faction === f.id) return true;   // membre → voit sa faction (version de base)
  return false;
}
function subVisible(id){ if(isMJ) return true; if(!viewerId) return false; return (state.reveal[id] || []).includes(viewerId); }
function relBadge(fid){
  if(!viewerId) return '';
  const rel = (joueurs[viewerId]?.factionRel || {})[fid] || 'neutre';
  const r = REL_LBL[rel] || REL_LBL.neutre;
  return `<span class="e-badge" style="color:${r.c};border-color:${r.c}">Rapport : ${r.t}</span>`;
}
function renderFactionCard(f){
  const baseVis = factionBaseVisible(f);
  const subs = f.entries || [];
  const visSubs = subs.filter(s => isMJ || subVisible(s.id));
  if(!isMJ && !baseVis && !visSubs.length) return '';   // rien de découvert
  const img = imgSrc(f.img);
  const fac = window.FACTIONS?.[f.id];
  const color = (fac && fac.color) || 'var(--am)';
  let h = '<div class="ecard efac">';
  if(img) h += `<div class="e-img"><img src="${esc(img)}" alt=""></div>`;
  h += '<div class="e-body">';
  h += `<div class="e-title" style="color:${color}">🚩 ${esc(f.titre || (fac && fac.label) || f.id)}</div>`;
  const rb = relBadge(f.id); if(rb) h += `<div class="e-metas">${rb}</div>`;
  if(baseVis && f.corps) h += `<div class="e-text">${esc(f.corps)}</div>`;
  if(isMJ){ h += '<div class="e-sub-h">Entrée de base (auto-visible aux membres)</div>' + revealRow({ id:f.id }); }
  (isMJ ? subs : visSubs).forEach(s => {
    h += '<div class="e-fac-entry">';
    h += `<div class="e-sub-h">${esc(s.titre || '(sans titre)')}</div>`;
    if((isMJ || subVisible(s.id)) && s.corps) h += `<div class="e-text">${esc(s.corps)}</div>`;
    if(isMJ) h += revealRow({ id:s.id });
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}

function renderEvent(e){
  const img = imgSrc(e.img);
  return `<div class="etl-item">
    <div class="etl-dot"></div>
    <div class="etl-card">
      <div class="etl-date">${esc(e.date || '')}</div>
      <div class="e-title">${esc(titreOf(e))}</div>
      ${img ? `<div class="e-img sm"><img src="${esc(img)}" alt=""></div>` : ''}
      ${e.corps ? `<div class="e-text">${esc(e.corps)}</div>` : ''}
      ${liensChips(e)}
      ${revealRow(e)}
    </div>
  </div>`;
}
