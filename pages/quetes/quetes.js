// ============================================================
// QUÊTES & OBJECTIFS — synchronisé Firebase /quetes/data
// MJ (auth 1234, pas de ?id) édite ; joueur (?id=<id>) lit seulement
// ses quêtes révélées (revealedFor). ?embed=1 masque le header (iframe fiche).
// Objectifs cochés par le MJ uniquement.
// ============================================================

const MJ_CODE = '1234';
const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb;
let joueurs = {};
let qData = { quests: [] };
let filter = 'all';
let _editing = false;   // évite un re-render qui volerait le focus pendant la saisie

document.addEventListener('DOMContentLoaded', init);

function init() {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  if(typeof fpActivateAppCheck==="function") fpActivateAppCheck();
  updateModeUI();
  fdb.collection('joueurs').onSnapshot(s => {
    joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
    render();
  });
  fdb.collection('quetes').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    qData = { quests: Array.isArray(d.quests) ? d.quests : [] };
    if (!_editing) render();
  });
  // recadrage / refresh demandé par la fiche (réaffichage de l'onglet)
  window.addEventListener('message', e => { if (e.data === 'quetes-refresh') render(); });
}

function demanderMJ() {
  if (isMJ || viewerId) return;
  if (prompt('Code MJ :') !== MJ_CODE) return;
  sessionStorage.setItem('mj_auth', '1');
  isMJ = true; updateModeUI(); render();
}
function updateModeUI() {
  const m = document.getElementById('qhdr-mode');
  if (m) m.textContent = isMJ ? 'Vue MJ' : (viewerId ? 'Vue joueur' : 'Visiteur');
  const mb = document.getElementById('qmj-btn'); if (mb) mb.style.display = (isMJ || viewerId) ? 'none' : '';
  const ab = document.getElementById('qadd-btn'); if (ab) ab.style.display = isMJ ? '' : 'none';
}

function saveQuetes() { if (fdb) fdb.collection('quetes').doc('data').set(qData).catch(e => console.error('saveQuetes', e)); }

// ---- Visibilité ----
function questVisible(q) {
  if (isMJ) return true;
  if (!viewerId) return false;
  if (q.revealed === true) return true;
  return Array.isArray(q.revealedFor) && q.revealedFor.includes(viewerId);
}

// ---- MJ : édition ----
function uid() { return 'q' + Date.now().toString(36) + Math.floor(Math.random() * 999); }
function addQuete() {
  qData.quests.unshift({ id: uid(), title: 'Nouvelle quête', desc: '', status: 'active', objectives: [], revealedFor: [], reward: '' });
  saveQuetes(); render();
}
function delQuete(i) { if (confirm('Supprimer cette quête ?')) { qData.quests.splice(i, 1); saveQuetes(); render(); } }
function setQ(i, k, v) { if (!qData.quests[i]) return; qData.quests[i][k] = v; saveQuetes(); }      // texte : pas de re-render (focus)
function setStatut(i, v) { if (!qData.quests[i]) return; qData.quests[i].status = v; saveQuetes(); render(); }
function addObj(i) { qData.quests[i].objectives = qData.quests[i].objectives || []; qData.quests[i].objectives.push({ id: uid(), text: '', done: false, count: 0, target: 0 }); saveQuetes(); render(); }
function delObj(i, j) { qData.quests[i].objectives.splice(j, 1); saveQuetes(); render(); }
function setObj(i, j, v) { qData.quests[i].objectives[j].text = v; saveQuetes(); }
function toggleObj(i, j) { const o = qData.quests[i].objectives[j]; o.done = !o.done; saveQuetes(); render(); }
// Objectif "compteur" : cible (target) + valeur (count). done dérivé si target>0.
function setObjTarget(i, j, v) { const o = qData.quests[i].objectives[j]; o.target = Math.max(0, parseInt(v) || 0); if (o.target > 0) o.count = Math.min(o.count || 0, o.target); saveQuetes(); render(); }
function incObj(i, j, d) { const o = qData.quests[i].objectives[j]; const t = o.target || 0; o.count = Math.max(0, Math.min(t || 9999, (o.count || 0) + d)); saveQuetes(); render(); }
function objDone(o) { return (o.target || 0) > 0 ? (o.count || 0) >= o.target : !!o.done; }

function toggleRevealQ(i, pid) {
  const q = qData.quests[i]; q.revealedFor = q.revealedFor || [];
  const k = q.revealedFor.indexOf(pid);
  if (k >= 0) q.revealedFor.splice(k, 1); else { q.revealedFor.push(pid); logQuete(q, pid); }
  q.revealed = false;
  saveQuetes(); render();
}
function revealAllQ(i) { const q = qData.quests[i]; Object.keys(joueurs).forEach(pid => { if (!(q.revealedFor||[]).includes(pid)) logQuete(q, pid); }); q.revealedFor = Object.keys(joueurs); q.revealed = false; saveQuetes(); render(); }

// ---- Journal : log auto au début de quête (révélation à un joueur, dédup par src) ----
function logQuete(q, pid) { logJournal({ type: 'quete', title: q.title, text: 'Quête découverte', revealedFor: [pid], src: 'quete:' + q.id + ':' + pid }); }
function logJournal(entry) {
  if (!fdb) return;
  Promise.all([fdb.collection('journal').doc('data').get(), fdb.collection('temps').doc('data').get()])
    .then(([js, ts]) => {
      const data = js.exists ? js.data() : {};
      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (entry.src && entries.some(e => e.src === entry.src)) return;
      entry.id = 'j' + Date.now().toString(36) + Math.floor(Math.random() * 999);
      if (entry.time == null) {
        const pid = (entry.revealedFor || [])[0];
        entry.time = (typeof partyMinutesFor === 'function') ? partyMinutesFor(ts.exists ? ts.data() : {}, pid) : 480;
      }
      entries.push(entry);
      fdb.collection('journal').doc('data').set({ entries });
    }).catch(e => console.warn('logJournal', e));
}
function revealNoneQ(i) { qData.quests[i].revealedFor = []; qData.quests[i].revealed = false; saveQuetes(); render(); }

function setFilter(f) { filter = f; document.querySelectorAll('.q-filter').forEach(b => b.classList.toggle('on', b.dataset.f === f)); render(); }

// ---- Rendu ----
const STATUTS = { active: { l: 'EN COURS', c: 'var(--am)' }, done: { l: 'TERMINÉE', c: 'var(--g)' }, failed: { l: 'ÉCHOUÉE', c: 'var(--rd)' } };
function esc(s) { return (s == null ? '' : '' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

function render() {
  const el = document.getElementById('quetes-list'); if (!el) return;
  let quests = qData.quests.filter(questVisible);
  if (filter !== 'all') quests = quests.filter(q => (q.status || 'active') === filter);
  if (!quests.length) { el.innerHTML = `<div class="q-empty">${isMJ ? 'Aucune quête — clique « + Nouvelle quête ».' : 'Aucune quête pour l\'instant.'}</div>`; return; }

  el.innerHTML = quests.map(q => {
    const i = qData.quests.indexOf(q);
    const st = STATUTS[q.status || 'active'] || STATUTS.active;
    const objs = q.objectives || [];
    const doneN = objs.filter(objDone).length;
    return isMJ ? renderQuestMJ(q, i, st, objs, doneN) : renderQuestJoueur(q, st, objs, doneN);
  }).join('');
}

// Vue joueur (lecture seule)
function renderQuestJoueur(q, st, objs, doneN) {
  const objHtml = objs.map(o => {
    const d = objDone(o);
    const counter = (o.target || 0) > 0 ? `<span class="q-count">${o.count || 0}/${o.target}</span>` : '';
    const mark = (o.target || 0) > 0 ? (d ? '☑' : '▸') : (d ? '☑' : '☐');
    return `<div class="q-obj${d ? ' done' : ''}"><span class="q-check">${mark}</span><span class="q-obj-t">${esc(o.text)}</span>${counter}</div>`;
  }).join('') || '<div class="q-obj-none">—</div>';
  return `<div class="q-card s-${q.status || 'active'}">
    <div class="q-head"><span class="q-title">${esc(q.title)}</span><span class="q-badge" style="color:${st.c};border-color:${st.c}">${st.l}</span></div>
    ${q.desc ? `<div class="q-desc">${esc(q.desc)}</div>` : ''}
    ${objs.length ? `<div class="q-progress">Objectifs ${doneN}/${objs.length}</div>` : ''}
    <div class="q-objs">${objHtml}</div>
    ${q.reward ? `<div class="q-reward">🎁 ${esc(q.reward)}</div>` : ''}
  </div>`;
}

// Vue MJ (édition)
function renderQuestMJ(q, i, st, objs, doneN) {
  const objHtml = objs.map((o, j) => {
    const d = objDone(o);
    const hasCounter = (o.target || 0) > 0;
    const ctrl = hasCounter
      ? `<button class="q-cnt-btn" onclick="incObj(${i},${j},-1)">−</button><span class="q-cnt">${o.count || 0}/${o.target}</span><button class="q-cnt-btn" onclick="incObj(${i},${j},1)">+</button>`
      : `<button class="q-check-btn" onclick="toggleObj(${i},${j})" title="Cocher">${o.done ? '☑' : '☐'}</button>`;
    return `<div class="q-obj-edit${d ? ' done' : ''}">
      ${ctrl}
      <input class="q-inp" value="${escAttr(o.text)}" placeholder="objectif…" onfocus="_editing=true" onblur="_editing=false" onchange="setObj(${i},${j},this.value)">
      <input class="q-inp q-target" type="number" min="0" value="${o.target || 0}" title="Cible (0 = case à cocher)" onfocus="_editing=true" onblur="_editing=false" onchange="setObjTarget(${i},${j},this.value)">
      <button class="q-del" onclick="delObj(${i},${j})">✕</button>
    </div>`;
  }).join('');
  const pids = Object.keys(joueurs);
  const revealHtml = pids.map(pid => {
    const on = (q.revealedFor || []).includes(pid);
    return `<button class="q-reveal${on ? ' on' : ''}" onclick="toggleRevealQ(${i},'${pid}')">${on ? '👁' : '∅'} ${esc(joueurs[pid]?.nom || pid)}</button>`;
  }).join('');
  return `<div class="q-card mj s-${q.status || 'active'}">
    <div class="q-head">
      <input class="q-inp q-title-inp" value="${escAttr(q.title)}" onfocus="_editing=true" onblur="_editing=false" onchange="setQ(${i},'title',this.value)">
      <select class="q-status-sel" onchange="setStatut(${i},this.value)">
        <option value="active"${q.status==='active'?' selected':''}>En cours</option>
        <option value="done"${q.status==='done'?' selected':''}>Terminée</option>
        <option value="failed"${q.status==='failed'?' selected':''}>Échouée</option>
      </select>
      <button class="q-del" onclick="delQuete(${i})">✕</button>
    </div>
    <textarea class="q-inp q-desc-inp" placeholder="Description…" onfocus="_editing=true" onblur="_editing=false" onchange="setQ(${i},'desc',this.value)">${esc(q.desc)}</textarea>
    <div class="q-sub">Objectifs ${objs.length ? `(${doneN}/${objs.length})` : ''} <button class="q-addobj" onclick="addObj(${i})">+ objectif</button></div>
    ${objHtml}
    <div class="q-field"><label>🎁 Récompense</label><input class="q-inp" value="${escAttr(q.reward)}" placeholder="récompense (optionnel)" onfocus="_editing=true" onblur="_editing=false" onchange="setQ(${i},'reward',this.value)"></div>
    <div class="q-reveal-row"><span class="q-reveal-lbl">Visible par :</span>${revealHtml || '<span class="q-empty-inline">aucun joueur</span>'}
      <button class="q-reveal-all" onclick="revealAllQ(${i})">Tous</button><button class="q-reveal-all" onclick="revealNoneQ(${i})">Aucun</button></div>
  </div>`;
}
