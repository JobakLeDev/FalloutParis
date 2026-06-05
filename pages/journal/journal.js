// ============================================================
// JOURNAL DE CAMPAGNE — Firebase /journal/data
// Hybride : MJ ajoute manuellement (+ hooks auto révélation quête/POI).
// Révélation PAR JOUEUR (revealedFor). Horodaté par l'horloge /temps/data.
// ============================================================

const MJ_CODE = '1234';
const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb;
let joueurs = {};
let jData = { entries: [] };
let tempsData = { parties: [] };
let curMin = (typeof TEMPS_DEFAUT !== 'undefined') ? TEMPS_DEFAUT : 480;  // temps courant du groupe du viewer
let filter = 'all';
let _editing = false;

const TYPES = {
  pnj:   { icon:'👤', label:'PNJ',   c:'#5dbe5d' },
  lieu:  { icon:'📍', label:'Lieu',  c:'#3a7bd5' },
  quete: { icon:'📜', label:'Quête', c:'#e8a820' },
  info:  { icon:'💡', label:'Info',  c:'#b0f0b0' },
};

document.addEventListener('DOMContentLoaded', init);
function init(){
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  updateModeUI();
  fdb.collection('joueurs').onSnapshot(s => { joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id:d.id }); render(); renderNotes(); });
  fdb.collection('journal').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    jData = { entries: Array.isArray(d.entries) ? d.entries : [] };
    if (!_editing) render();
  });
  fdb.collection('temps').doc('data').onSnapshot(s => {
    tempsData = { parties: s.exists && Array.isArray(s.data().parties) ? s.data().parties : [] };
    curMin = partyMinutesFor(tempsData, viewerId);
    renderClock(); if (!_editing) render();
  });
  window.addEventListener('message', e => { if (e.data === 'journal-refresh') render(); });
}

function demanderMJ(){ if (isMJ || viewerId) return; if (prompt('Code MJ :') !== MJ_CODE) return; sessionStorage.setItem('mj_auth','1'); isMJ = true; updateModeUI(); render(); }
function updateModeUI(){
  const m = document.getElementById('jhdr-mode'); if (m) m.textContent = isMJ ? 'Vue MJ' : (viewerId ? 'Vue joueur' : 'Visiteur');
  const mb = document.getElementById('jmj-btn'); if (mb) mb.style.display = (isMJ || viewerId) ? 'none' : '';
  const add = document.getElementById('j-add'); if (add) add.style.display = isMJ ? 'flex' : 'none';
  const notes = document.getElementById('j-notes'); if (notes) notes.style.display = (!isMJ && viewerId) ? 'flex' : 'none';
}

// ---- Notes personnelles du joueur (/joueurs/{id}.notes) ----
function _myNotes(){ const n = joueurs[viewerId]?.notes; return Array.isArray(n) ? n : []; }
function renderNotes(){
  const el = document.getElementById('j-notes-list'); if (!el || !viewerId || isMJ) return;
  const notes = _myNotes().slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  if (!notes.length){ el.innerHTML = '<div class="jn-empty">Aucune note. Note ce que tu veux retenir…</div>'; return; }
  el.innerHTML = notes.map(n => `<div class="jn-note"><button class="jn-del" onclick="delNote('${n.id}')" title="Supprimer">✕</button><div class="jn-text">${esc(n.text)}</div></div>`).join('');
}
function addNote(){
  if (!fdb || !viewerId) return;
  const inp = document.getElementById('jn-input'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  const notes = _myNotes().slice();
  notes.push({ id: 'n' + Date.now().toString(36) + Math.floor(Math.random()*999), text, ts: Date.now() });
  inp.value = '';
  fdb.collection('joueurs').doc(viewerId).set({ notes }, { merge: true }).catch(e => console.error('addNote', e));
}
function delNote(id){
  if (!fdb || !viewerId) return;
  const notes = _myNotes().filter(n => n.id !== id);
  fdb.collection('joueurs').doc(viewerId).set({ notes }, { merge: true }).catch(e => console.error('delNote', e));
}
function saveJournal(){ if (fdb) fdb.collection('journal').doc('data').set(jData).catch(e => console.error('saveJournal', e)); }

// ---- Temps (helpers de date dans shared.js) ----
function renderClock(){ const el = document.getElementById('j-clock'); if (el) el.textContent = '📅 ' + fmtDateTime(curMin); }

// ---- Visibilité ----
function entryVisible(e){ if (isMJ) return true; if (!viewerId) return false; return e.revealed === true || (Array.isArray(e.revealedFor) && e.revealedFor.includes(viewerId)); }

// ---- MJ ----
function uid(){ return 'j' + Date.now().toString(36) + Math.floor(Math.random()*999); }
function addEntry(){
  const type = document.getElementById('j-add-type').value || 'info';
  const title = document.getElementById('j-add-title').value.trim() || TYPES[type].label;
  jData.entries.push({ id: uid(), time: curMin, type, title, text:'', revealedFor: [] });
  document.getElementById('j-add-title').value = '';
  saveJournal(); render();
}
function delEntry(idx){ if (confirm('Supprimer cette entrée ?')) { jData.entries.splice(idx,1); saveJournal(); render(); } }
function setE(idx, k, v){ if (!jData.entries[idx]) return; jData.entries[idx][k] = v; saveJournal(); }   // texte : pas de re-render
function setEType(idx, v){ jData.entries[idx].type = v; saveJournal(); render(); }
function reglerTemps(idx){
  const e = jData.entries[idx]; const cur = tempsDate(e.time||0);
  const ds = prompt('Date (JJ/MM/AAAA) :', `${cur.getDate()}/${cur.getMonth()+1}/${cur.getFullYear()}`); if (ds==null) return;
  const dm = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!dm) return;
  const hs = prompt('Heure (HH:MM) :', fmtHeure(e.time||0)); if (hs==null) return;
  const hm = hs.match(/^(\d{1,2})[:hH]?(\d{0,2})$/); if (!hm) return;
  const nd = new Date(parseInt(dm[3]), (parseInt(dm[2])||1)-1, parseInt(dm[1])||1, Math.min(23,parseInt(hm[1])||0), Math.min(59,parseInt(hm[2])||0), 0);
  e.time = Math.max(0, tempsMinutesDepuis(nd));
  saveJournal(); render();
}
function toggleRevealE(idx, pid){ const e = jData.entries[idx]; e.revealedFor = e.revealedFor || []; const k = e.revealedFor.indexOf(pid); if (k>=0) e.revealedFor.splice(k,1); else e.revealedFor.push(pid); e.revealed = false; saveJournal(); render(); }
function revealAllE(idx){ jData.entries[idx].revealedFor = Object.keys(joueurs); jData.entries[idx].revealed = false; saveJournal(); render(); }
function revealNoneE(idx){ jData.entries[idx].revealedFor = []; jData.entries[idx].revealed = false; saveJournal(); render(); }

function setFilter(f){ filter = f; document.querySelectorAll('.j-filter').forEach(b => b.classList.toggle('on', b.dataset.f === f)); render(); }

// ---- Rendu ----
function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s){ return esc(s).replace(/"/g,'&quot;'); }

function render(){
  const el = document.getElementById('journal-list'); if (!el) return;
  let entries = jData.entries.map((e,idx) => ({ e, idx })).filter(x => entryVisible(x.e));
  if (filter !== 'all') entries = entries.filter(x => (x.e.type||'info') === filter);
  entries.sort((a,b) => (a.e.time||0) - (b.e.time||0));   // chronologique
  if (!entries.length) { el.innerHTML = `<div class="j-empty">${isMJ ? 'Aucune entrée — ajoute-en une ci-dessus.' : 'Aucune entrée pour l\'instant.'}</div>`; return; }

  let html = '', lastDay = null;
  entries.forEach(({ e, idx }) => {
    const dayKey = tempsDate(e.time||0).toDateString();
    if (dayKey !== lastDay) { html += `<div class="j-day">${fmtDateLong(e.time||0)}</div>`; lastDay = dayKey; }
    html += isMJ ? entryMJ(e, idx) : entryJoueur(e);
  });
  el.innerHTML = html;
}

function entryJoueur(e){
  const ty = TYPES[e.type] || TYPES.info;
  return `<div class="j-entry t-${e.type||'info'}">
    <div class="j-time">${fmtHeure(e.time||0)}</div>
    <div class="j-body">
      <div class="j-line"><span class="j-icon">${ty.icon}</span><span class="j-title">${esc(e.title)}</span></div>
      ${e.text ? `<div class="j-text">${esc(e.text)}</div>` : ''}
    </div>
  </div>`;
}
function entryMJ(e, idx){
  const ty = TYPES[e.type] || TYPES.info;
  const pids = Object.keys(joueurs);
  const reveal = pids.map(pid => { const on = (e.revealedFor||[]).includes(pid); return `<button class="j-reveal${on?' on':''}" onclick="toggleRevealE(${idx},'${pid}')">${on?'👁':'∅'} ${esc(joueurs[pid]?.nom||pid)}</button>`; }).join('');
  return `<div class="j-entry mj t-${e.type||'info'}">
    <button class="j-time set" onclick="reglerTemps(${idx})" title="Régler date/heure">${fmtHeure(e.time||0)}</button>
    <div class="j-body">
      <div class="j-line">
        <select class="j-type-sel" onchange="setEType(${idx},this.value)">
          ${Object.entries(TYPES).map(([k,v]) => `<option value="${k}"${(e.type||'info')===k?' selected':''}>${v.icon} ${v.label}</option>`).join('')}
        </select>
        <input class="j-inp j-title-inp" value="${escAttr(e.title)}" placeholder="Titre…" onfocus="_editing=true" onblur="_editing=false" onchange="setE(${idx},'title',this.value)">
        <button class="j-del" onclick="delEntry(${idx})">✕</button>
      </div>
      <textarea class="j-inp j-text-inp" placeholder="Détails (optionnel)…" onfocus="_editing=true" onblur="_editing=false" onchange="setE(${idx},'text',this.value)">${esc(e.text)}</textarea>
      <div class="j-reveal-row"><span class="j-reveal-lbl">Visible :</span>${reveal || '<span class="j-empty-inline">aucun joueur</span>'}
        <button class="j-reveal-all" onclick="revealAllE(${idx})">Tous</button><button class="j-reveal-all" onclick="revealNoneE(${idx})">Aucun</button></div>
    </div>
  </div>`;
}
