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
let typeFilter = 'all';   // MJ : 'all' | 'principale' | 'annexe'
// Repli individuel des quêtes (mémorisé en localStorage)
const collapsedQuests = new Set((()=>{ try{ return JSON.parse(localStorage.getItem('fp_collapsedQuests') || '[]'); }catch(e){ return []; } })());
function _saveCollapsedQ(){ try{ localStorage.setItem('fp_collapsedQuests', JSON.stringify([...collapsedQuests])); }catch(e){} }
function toggleQuestCollapse(id){
  if(collapsedQuests.has(id)) collapsedQuests.delete(id); else collapsedQuests.add(id);
  _saveCollapsedQ(); render();
}
function collapseAllQuests(){ qData.quests.forEach(q => collapsedQuests.add(q.id)); _saveCollapsedQ(); render(); }
function expandAllQuests(){ collapsedQuests.clear(); _saveCollapsedQ(); render(); }
let _editing = false;   // évite un re-render qui volerait le focus pendant la saisie

document.addEventListener('DOMContentLoaded', init);

function init() {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  updateModeUI();
  fdb.collection('joueurs').onSnapshot(s => {
    joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
    render();
  });
  fdb.collection('quetes').doc(fpCampId()).onSnapshot(s => {
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
  const ib = document.getElementById('qimport-btn'); if (ib) ib.style.display = isMJ ? '' : 'none';
  const tf = document.getElementById('q-typefilters'); if (tf) tf.style.display = isMJ ? '' : 'none';
  ['qcollapse-btn','qexpand-btn'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = isMJ ? '' : 'none'; });
}

// ---- Import des quêtes de design (data/quetes.json) → format jouable ----
function _normTier(t){ return ({ mineure:'mineure', standard:'standard', majeure:'majeure', moyenne:'standard' })[t] || 'standard'; }
function _designToQuest(dq){
  return {
    id: dq.id || uid(),
    title: dq.titre || dq.title || 'Quête',
    desc: dq.description || '',
    status: 'active',
    objectives: (dq.objectifs || []).map(o => ({ id: o.id || uid(), text: o.titre || '', note: o.description || '', done: false, count: 0, target: 0 })),
    revealedFor: [],
    reward: '',
    qtype: dq.qtype || dq.type || 'annexe',
    qtier: _normTier(dq.qtier),
    // métadonnées de design préservées
    versions_faction: dq.versions_faction || null,
    factionActive: dq.versions_faction ? Object.keys(dq.versions_faction)[0] : null,
    choix: dq.choix || null,
    trigger: dq.trigger || null,
    trigger_cible: dq.trigger_cible || null,
    chain_unlock: dq.chain_unlock || null,
    prerequisite: dq.prerequisite || null,
    niveau: dq.niveau || null,
    optional: !!dq.optional,
    pnj_return: !!dq.pnj_return,
  };
}
// Signature du contenu « design » (ce qui vient du JSON) → pour détecter un vrai changement
function _designSig(q){
  return JSON.stringify({
    title:q.title, desc:q.desc, qtype:q.qtype, qtier:q.qtier,
    versions_faction:q.versions_faction||null, choix:q.choix||null,
    trigger:q.trigger||null, trigger_cible:q.trigger_cible||null,
    chain_unlock:q.chain_unlock||null, prerequisite:q.prerequisite||null,
    niveau:q.niveau||null, optional:!!q.optional, pnj_return:!!q.pnj_return,
    objectives:(q.objectives||[]).map(o=>({id:o.id,text:o.text,note:o.note}))
  });
}
// Réimporte le contenu du JSON sur une quête existante en conservant l'état runtime
function _mergeDesignIntoQuest(old, dq){
  const fresh = _designToQuest(dq);
  fresh.status      = old.status || fresh.status;
  fresh.revealedFor = Array.isArray(old.revealedFor) ? old.revealedFor : fresh.revealedFor;
  fresh.reward      = old.reward || '';
  if (Array.isArray(old.xpAwardedTo)) fresh.xpAwardedTo = old.xpAwardedTo;
  // faction active choisie par le MJ, si elle existe toujours dans le JSON
  if (old.factionActive && fresh.versions_faction && fresh.versions_faction[old.factionActive])
    fresh.factionActive = old.factionActive;
  // progression des objectifs préservée (apparié par id)
  const oldObj = {}; (old.objectives||[]).forEach(o => { if(o.id) oldObj[o.id] = o; });
  fresh.objectives = fresh.objectives.map(o => {
    const prev = oldObj[o.id];
    return prev ? { ...o, done:!!prev.done, count:prev.count||0, target:prev.target||o.target||0 } : o;
  });
  return fresh;
}
async function importDesignQuests(){
  if(!isMJ) return;
  let data;
  try { data = await (await fetch('../../data/quetes.json?v=' + Date.now())).json(); }
  catch(e){ alert('Impossible de charger data/quetes.json'); return; }
  const list = (data && data.quetes) || [];
  if(!list.length){ alert('Aucune quête dans data/quetes.json'); return; }
  const idxById = {}; qData.quests.forEach((q,i) => { idxById[q.id] = i; });
  let added = 0, updated = 0, unchanged = 0;
  list.forEach(dq => {
    if(dq.id == null) return;
    const i = idxById[dq.id];
    if(i === undefined){ qData.quests.push(_designToQuest(dq)); added++; return; }
    const merged = _mergeDesignIntoQuest(qData.quests[i], dq);
    if(_designSig(qData.quests[i]) === _designSig(merged)){ unchanged++; return; }
    qData.quests[i] = merged; updated++;
  });
  saveQuetes(); render();
  alert('Import terminé : ' + added + ' ajoutée(s), ' + updated + ' mise(s) à jour'
        + (unchanged ? ', ' + unchanged + ' inchangée(s)' : '') + '.'
        + (added ? '\nRévèle les nouvelles quêtes aux joueurs et choisis la faction active.' : ''));
}

function saveQuetes() { if (fdb) fdb.collection('quetes').doc(fpCampId()).set(qData).catch(e => console.error('saveQuetes', e)); }

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
  qData.quests.unshift({ id: uid(), title: 'Nouvelle quête', desc: '', status: 'active', objectives: [], revealedFor: [], reward: '', qtype: 'annexe', qtier: 'standard' });
  saveQuetes(); render();
}
function delQuete(i) { if (confirm('Supprimer cette quête ?')) { qData.quests.splice(i, 1); saveQuetes(); render(); } }
function setQ(i, k, v) { if (!qData.quests[i]) return; qData.quests[i][k] = v; saveQuetes(); }      // texte : pas de re-render (focus)
function setQMeta(i, k, v) { if (!qData.quests[i]) return; qData.quests[i][k] = v; saveQuetes(); render(); }   // type/tier : re-render (maj aperçu XP)

// ---- XP de quête (proportionnel au niveau du joueur) ----
const QUEST_XP = {
  annexe:     { mineure: 15, standard: 30, majeure: 50 },
  principale: { mineure: 60, standard: 80, majeure: 150 },
};
function questXPFactor(q) { return (QUEST_XP[q.qtype || 'annexe'] || QUEST_XP.annexe)[_normTier(q.qtier)] || 30; }
// XP gagnée par un joueur si la quête est réussie maintenant = facteur × son niveau
function questXPForPlayer(q, pid) { const j = joueurs[pid]; return questXPFactor(q) * ((j && j.niveau) || 1); }
// Attribue l'XP de quête à tous les joueurs ayant la quête révélée (une seule fois par joueur)
function awardQuestXP(q) {
  if (!fdb) return;
  const factor = questXPFactor(q);
  q.xpAwardedTo = q.xpAwardedTo || [];
  (q.revealedFor || []).forEach(pid => {
    const j = joueurs[pid]; if (!j) return;
    if (q.xpAwardedTo.includes(pid)) return;            // déjà récompensé
    const lvl = j.niveau || 1;
    const gain = factor * lvl;
    let xp = (j.xp || 0) + gain, niveau = lvl;
    while (niveau < 20 && xp >= (XP_TABLE[niveau] || 1e9)) niveau++;   // montée de niveau (même logique que la fiche)
    fdb.collection('joueurs').doc(pid).update({ xp, niveau, lastUpdate: Date.now() }).catch(e => console.error('awardQuestXP', e));
    q.xpAwardedTo.push(pid);
    if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', '★ ' + (j.nom || pid) + ' gagne ' + gain + ' XP — quête « ' + q.title + ' » réussie' + (niveau > lvl ? ' (niv. ' + niveau + ' !)' : ''));
  });
}
function setStatut(i, v) {
  const q = qData.quests[i]; if (!q) return;
  const was = q.status;
  q.status = v;
  if (v === 'done' && was !== 'done') {
    awardQuestXP(q);          // réussie → XP auto aux joueurs sur la quête (une fois)
    chainUnlock(q);           // débloque la quête suivante (chain_unlock) pour les mêmes joueurs
  }
  saveQuetes(); render();
}
// Chaînage : révèle la quête chain_unlock aux joueurs qui avaient celle-ci
function chainUnlock(q){
  if(!q.chain_unlock) return;
  const next = qData.quests.find(x => x.id === q.chain_unlock);
  if(!next){ return; }   // la quête suivante doit être importée
  next.revealedFor = next.revealedFor || [];
  (q.revealedFor || []).forEach(pid => {
    if(!next.revealedFor.includes(pid)){ next.revealedFor.push(pid); logQuete(next, pid); }
  });
  next.revealed = false;
}
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
  Promise.all([fdb.collection('journal').doc(fpCampId()).get(), fdb.collection('temps').doc(fpCampId()).get()])
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
      fdb.collection('journal').doc(fpCampId()).set({ entries });
    }).catch(e => console.warn('logJournal', e));
}
function revealNoneQ(i) { qData.quests[i].revealedFor = []; qData.quests[i].revealed = false; saveQuetes(); render(); }

function setFilter(f) { filter = f; document.querySelectorAll('#q-filters .q-filter').forEach(b => b.classList.toggle('on', b.dataset.f === f)); render(); }
function setTypeFilter(t) { typeFilter = t; document.querySelectorAll('.q-tf').forEach(b => b.classList.toggle('on', b.dataset.tf === t)); render(); }

// ---- Rendu ----
const STATUTS = { active: { l: 'EN COURS', c: 'var(--am)' }, done: { l: 'TERMINÉE', c: 'var(--g)' }, failed: { l: 'ÉCHOUÉE', c: 'var(--rd)' } };
function esc(s) { return (s == null ? '' : '' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

function render() {
  const el = document.getElementById('quetes-list'); if (!el) return;
  let quests = qData.quests.filter(questVisible);
  if (filter !== 'all') quests = quests.filter(q => (q.status || 'active') === filter);
  if (isMJ && typeFilter !== 'all') quests = quests.filter(q => (q.qtype || 'annexe') === typeFilter);
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
// Texte affiché = version de la faction DU JOUEUR si dispo, sinon faction par défaut (factionActive), sinon desc simple
function questDisplay(q, faction) {
  if (q.versions_faction) {
    const f = (faction && q.versions_faction[faction]) ? faction : q.factionActive;
    const v = q.versions_faction[f];
    if (v) return { desc: v.description || q.desc || '', objectif: v.objectif || '' };
  }
  return { desc: q.desc || '', objectif: '' };
}
function renderQuestJoueur(q, st, objs, doneN) {
  const disp = questDisplay(q, (joueurs[viewerId] || {}).faction);
  const objHtml = objs.map(o => {
    const d = objDone(o);
    const counter = (o.target || 0) > 0 ? `<span class="q-count">${o.count || 0}/${o.target}</span>` : '';
    const mark = (o.target || 0) > 0 ? (d ? '☑' : '▸') : (d ? '☑' : '☐');
    return `<div class="q-obj${d ? ' done' : ''}"><span class="q-check">${mark}</span><span class="q-obj-t">${esc(o.text)}</span>${counter}</div>`
      + (o.note ? `<div class="q-obj-note">${esc(o.note)}</div>` : '');
  }).join('') || '<div class="q-obj-none">—</div>';
  return `<div class="q-card s-${q.status || 'active'}${collapsedQuests.has(q.id) ? ' collapsed' : ''}">
    <div class="q-head"><button class="q-collapse" onclick="toggleQuestCollapse('${q.id}')">${collapsedQuests.has(q.id) ? '▸' : '▾'}</button><span class="q-title">${esc(q.title)}</span><span class="q-badge" style="color:${st.c};border-color:${st.c}">${st.l}</span></div>
    ${disp.objectif ? `<div class="q-objectif">🎯 ${esc(disp.objectif)}</div>` : ''}
    ${disp.desc ? `<div class="q-desc">${esc(disp.desc)}</div>` : ''}
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
    </div>` + (o.note ? `<div class="q-obj-note">${esc(o.note)}</div>` : '');
  }).join('');
  // Bloc design (quêtes importées) : faction active, choix/conséquences, métadonnées
  const factionSel = q.versions_faction ? `<div class="q-field q-xp-row"><label>🎭 Faction</label>
      <select class="q-inp" onchange="setQMeta(${i},'factionActive',this.value)">${Object.keys(q.versions_faction).map(f => `<option value="${f}"${q.factionActive === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>
      <span class="q-xp-note">défaut — chaque joueur voit SA faction si définie (admin perso)</span></div>` : '';
  const choixHtml = (q.choix && q.choix.length) ? `<div class="q-choix"><div class="q-choix-h">Choix & conséquences (réf. MJ)</div>${q.choix.map(c => `<div class="q-choix-i"><b>${esc(c.label)}</b> → ${esc(c.consequences || '')}</div>`).join('')}</div>` : '';
  const metaHtml = (q.trigger || q.prerequisite || q.chain_unlock) ? `<div class="q-meta">${q.trigger ? '⚑ ' + esc(q.trigger) + (q.trigger_cible ? ' (' + esc(q.trigger_cible) + ')' : '') : ''}${q.prerequisite ? ' · ⬅ requiert ' + esc(q.prerequisite) : ''}${q.chain_unlock ? ' · ➡ débloque ' + esc(q.chain_unlock) : ''}</div>` : '';
  const pids = Object.keys(joueurs);
  const revealHtml = pids.map(pid => {
    const on = (q.revealedFor || []).includes(pid);
    return `<button class="q-reveal${on ? ' on' : ''}" onclick="toggleRevealQ(${i},'${pid}')">${on ? '👁' : '∅'} ${esc(joueurs[pid]?.nom || pid)}</button>`;
  }).join('');
  return `<div class="q-card mj s-${q.status || 'active'}${collapsedQuests.has(q.id) ? ' collapsed' : ''}">
    <div class="q-head">
      <button class="q-collapse" onclick="toggleQuestCollapse('${q.id}')">${collapsedQuests.has(q.id) ? '▸' : '▾'}</button>
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
    <div class="q-field q-xp-row"><label>★ XP</label>
      <select class="q-inp" onchange="setQMeta(${i},'qtype',this.value)">
        <option value="annexe"${(q.qtype||'annexe')==='annexe'?' selected':''}>Annexe</option>
        <option value="principale"${q.qtype==='principale'?' selected':''}>Principale</option>
      </select>
      <select class="q-inp" onchange="setQMeta(${i},'qtier',this.value)">
        <option value="mineure"${q.qtier==='mineure'?' selected':''}>mineure</option>
        <option value="standard"${(q.qtier||'standard')==='standard'?' selected':''}>standard</option>
        <option value="majeure"${q.qtier==='majeure'?' selected':''}>majeure</option>
      </select>
      <span class="q-xp-note">×${questXPFactor(q)} niveau ${q.xpAwardedTo&&q.xpAwardedTo.length?'· ✓ distribué à '+q.xpAwardedTo.length:'(à la réussite)'}</span>
    </div>
    ${factionSel}
    ${metaHtml}
    ${choixHtml}
    <div class="q-reveal-row"><span class="q-reveal-lbl">Visible par :</span>${revealHtml || '<span class="q-empty-inline">aucun joueur</span>'}
      <button class="q-reveal-all" onclick="revealAllQ(${i})">Tous</button><button class="q-reveal-all" onclick="revealNoneQ(${i})">Aucun</button></div>
  </div>`;
}
