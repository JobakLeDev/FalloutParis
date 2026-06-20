// ============================================================
// REFUGES / SETTLEMENTS — /settlements/<campId> (scopé campagne)
// MJ (code 1234) : crée un refuge, crédite la Réserve, gère les alliés, valide les constructions.
// Joueur (?id) : voit les refuges accessibles, propose des blocs (si rang de compétence suffisant).
// Inc. 1 : pose validée par le MJ (pas de jet de dé), déduction auto du stock. Couchage → point de repos.
// ============================================================
const MJ_CODE = '1234';
const _p = new URLSearchParams(location.search);
const viewerId = _p.get('id');
const embed = _p.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';
const lockSite = _p.get('site') || null;   // ouvert depuis la carte sur UN refuge précis

let fdb, me = null;                 // me = fiche du joueur (?id)
let cartePois = [];                 // noms des POI de la carte (lien settlement ↔ lieu)
let data = { sites: {} };           // /settlements/<camp>
let joueursCamp = {};               // joueurs de la campagne (pour alliés)
let selSite = null;                 // id du refuge sélectionné
let selBlock = null;                // bloc choisi dans le catalogue (à poser)

const TIERS = ['common', 'uncommon', 'rare'];
function skillName(k){ const d = (typeof SKILLS_DEF !== 'undefined' ? SKILLS_DEF : []).find(s => s.key === k); return d ? d.name : k; }
function matLabel(t){ return (window.MAT_LABELS && window.MAT_LABELS[t] && window.MAT_LABELS[t].label) || t; }
function blockDef(type){ return (window.BUILD_BLOCKS || []).find(b => b.id === type) || null; }
function matsFor(block){ return (window.BUILD_MATS && window.BUILD_MATS[block.complexity]) || { common:0, uncommon:0, rare:0 }; }

async function initSettlement(){
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  if (viewerId){
    try { const s = await fdb.collection('joueurs').doc(viewerId).get(); if (s.exists) me = { id: viewerId, ...s.data() }; } catch(e){}
    if (me && !_p.get('camp')) fpSetCamp(me.campaign || 'data');
  }
  if (lockSite){ selSite = lockSite; document.body.classList.add('sitelock'); }
  updateModeUI();
  // POI de la carte (lien settlement ↔ lieu) — pour le sélecteur de création MJ
  try { const cs = await fdb.collection('carte').doc(fpCampId()).get(); cartePois = (cs.exists && Array.isArray(cs.data().pois)) ? cs.data().pois.map(p => p.name).filter(Boolean) : []; } catch(e){}
  populatePoiSel();
  // Joueurs de la campagne (pour la gestion des alliés MJ)
  fdb.collection('joueurs').onSnapshot(s => {
    joueursCamp = {}; const cur = fpCampId();
    s.forEach(d => { const v = d.data(); if ((v.campaign || 'data') === cur) joueursCamp[d.id] = v; });
    if (viewerId && joueursCamp[viewerId]) me = { id: viewerId, ...joueursCamp[viewerId] };   // garde l'inventaire à jour (scrap)
    render();
  });
  fdb.collection('settlements').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    data = { sites: (d.sites && typeof d.sites === 'object') ? d.sites : {} };
    render();
  });
}

function demanderMJ(){
  if (isMJ || viewerId) return;
  if (prompt('Code MJ :') !== MJ_CODE) return;
  sessionStorage.setItem('mj_auth', '1'); isMJ = true; updateModeUI(); render();
}
function updateModeUI(){
  document.getElementById('shdr-mode').textContent = isMJ ? 'Vue MJ' : (viewerId ? ('Joueur : ' + (me?.nom || viewerId)) : 'Visiteur');
  const mb = document.getElementById('smj-btn'); if (mb) mb.style.display = (isMJ || viewerId) ? 'none' : '';
  const cr = document.getElementById('s-create'); if (cr) cr.style.display = isMJ ? 'block' : 'none';
}

function save(){ fdb.collection('settlements').doc(fpCampId()).set({ sites: data.sites }).catch(e => console.error('save settlement', e)); }
function populatePoiSel(){ const sel = document.getElementById('ns-poi'); if(!sel) return; sel.innerHTML = '<option value="">— Lieu lié (POI carte) —</option>' + cartePois.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''); }

// ---- accès ----
function canAccess(site){
  if (isMJ) return true;
  if (!me) return false;
  if (site.faction) return me.faction === site.faction;
  return Array.isArray(site.allies) && site.allies.includes(me.id);
}
function skillOk(block){
  if (!block.skills || !block.skills.length) return true;
  if (isMJ) return true;
  const ranks = block.skills.map(k => (me?.skills?.[k]) || 0);
  return Math.max(0, ...ranks) >= block.complexity;   // RAW : rang ≥ Complexité = réussite auto (sans jet)
}
function stockEnough(site, need){ return TIERS.every(t => (site.stock?.[t] || 0) >= (need[t] || 0)); }

// ---- MJ : création / gestion ----
function creerSite(){
  if (!isMJ) return;
  const name = (document.getElementById('ns-name').value || '').trim(); if (!name) { alert('Nom requis'); return; }
  const w = Math.max(2, Math.min(12, parseInt(document.getElementById('ns-w').value) || 4));
  const h = Math.max(2, Math.min(12, parseInt(document.getElementById('ns-h').value) || 4));
  const faction = document.getElementById('ns-fac').value || '';
  const poi = document.getElementById('ns-poi')?.value || '';
  const id = 's' + Date.now().toString(36);
  data.sites[id] = { name, w, h, faction, poi, allies: [], stock: { common:0, uncommon:0, rare:0 }, blocks: [], pending: [], restPoint: false };
  selSite = id; save();
  document.getElementById('ns-name').value = '';
}
function supprimerSite(id){ if (!isMJ) return; if (!confirm('Supprimer ce refuge ?')) return; delete data.sites[id]; if (selSite === id) selSite = null; save(); }
function creditStock(id, tier, delta){
  if (!isMJ) return; const s = data.sites[id]; if (!s) return;
  s.stock = s.stock || { common:0, uncommon:0, rare:0 };
  s.stock[tier] = Math.max(0, (s.stock[tier] || 0) + delta); save();
}
function toggleAlly(id, pid){
  if (!isMJ) return; const s = data.sites[id]; if (!s) return;
  s.allies = s.allies || []; const k = s.allies.indexOf(pid);
  if (k >= 0) s.allies.splice(k, 1); else s.allies.push(pid); save();
}

// ---- pose de bloc ----
function selectCat(type){ selBlock = (selBlock === type) ? null : type; render(); }
function cellClick(id, x, y){
  const s = data.sites[id]; if (!s) return;
  if (!selBlock) return;
  if ((s.blocks || []).some(b => b.x === x && b.y === y)) { alert('Case déjà occupée.'); return; }
  if ((s.pending || []).some(b => b.x === x && b.y === y)) { alert('Une demande est déjà en attente sur cette case.'); return; }
  const block = blockDef(selBlock); if (!block) return;
  if (!skillOk(block)) { alert('Compétence insuffisante pour ce bloc.'); return; }
  if (isMJ){
    // Le MJ pose directement (vérifie le stock)
    const need = matsFor(block);
    if (!stockEnough(s, need)) { alert('Stock de matériaux insuffisant.'); return; }
    TIERS.forEach(t => s.stock[t] -= (need[t] || 0));
    s.blocks.push({ type: selBlock, x, y });
    if (selBlock === 'bed') s.restPoint = true;
    save();
  } else {
    if(!canAccess(s)){ alert('Tu n\'es pas allié de ce refuge — tu ne peux pas y construire.'); return; }
    // Le joueur propose → validation MJ
    s.pending = s.pending || [];
    s.pending.push({ pid: me.id, type: selBlock, x, y, ts: Date.now() });
    save();
  }
  selBlock = null;
}
// ---- scrap : démonter du junk de son inventaire → Réserve du refuge ----
function _matShort(t){ return ({ common:'communs', uncommon:'peu communs', rare:'rares' })[t] || t; }
function yieldStr(def){ const y = def.yield || {}; return TIERS.filter(t => y[t]).map(t => y[t] + ' ' + _matShort(t)).join(' · ') || 'rien'; }
async function scrapJunk(name, all){
  const site = data.sites[selSite]; if (!site || !me) return;
  if (!canAccess(site)) { alert('Tu dois être allié de ce refuge.'); return; }
  const def = (window.JUNK || []).find(j => j.n === name); if (!def) return;
  const inv = (me.inventory || []).map(x => ({ ...x }));
  const it = inv.find(x => x.name === name); if (!it || !(it.qty > 0)) return;
  const n = all ? it.qty : 1;
  it.qty -= n; if (it.qty <= 0) inv.splice(inv.indexOf(it), 1);
  site.stock = site.stock || { common:0, uncommon:0, rare:0 };
  TIERS.forEach(t => site.stock[t] = (site.stock[t] || 0) + (def.yield?.[t] || 0) * n);
  try { await fdb.collection('joueurs').doc(viewerId).update({ inventory: inv, lastUpdate: Date.now() }); me.inventory = inv; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  save();
}
function renderScrap(site){
  const el = document.getElementById('s-scrap'); if (!el) return;
  if (isMJ || !me || !canAccess(site)) { el.innerHTML = ''; return; }
  const junkInv = (me.inventory || []).filter(it => it && it.qty > 0 && (window.JUNK || []).some(j => j.n === it.name));
  if (!junkInv.length){ el.innerHTML = '<div class="s-sub">🔩 Récupération</div><div class="s-note">Aucun objet de récup (junk) dans ton inventaire. Le junk looté se démonte ici pour remplir la Réserve.</div>'; return; }
  el.innerHTML = '<div class="s-sub">🔩 Récupération — démonte ton junk dans la Réserve</div>' + junkInv.map(it => {
    const def = (window.JUNK || []).find(j => j.n === it.name);
    const safe = it.name.replace(/'/g, "\\'");
    return `<div class="scrap-row"><span>🔩 <b>${esc(it.name)}</b> ×${it.qty} <small>→ ${yieldStr(def)}</small></span>
      <span><button class="bp-mini" onclick="scrapJunk('${safe}',false)">Démonter</button>${it.qty>1?`<button class="bp-mini" onclick="scrapJunk('${safe}',true)">Tout (×${it.qty})</button>`:''}</span></div>`;
  }).join('');
}
function removeBlock(id, x, y){
  if (!isMJ) return; const s = data.sites[id]; if (!s) return;
  s.blocks = (s.blocks || []).filter(b => !(b.x === x && b.y === y));
  s.restPoint = (s.blocks || []).some(b => b.type === 'bed'); save();
}
function validerPending(id, idx){
  if (!isMJ) return; const s = data.sites[id]; if (!s || !s.pending || !s.pending[idx]) return;
  const req = s.pending[idx]; const block = blockDef(req.type); if (!block) return;
  const need = matsFor(block);
  if (!stockEnough(s, need)) { alert('Stock insuffisant pour valider (' + costStr(need) + ').'); return; }
  if ((s.blocks || []).some(b => b.x === req.x && b.y === req.y)) { alert('Case déjà occupée.'); s.pending.splice(idx,1); save(); return; }
  TIERS.forEach(t => s.stock[t] = Math.max(0, (s.stock[t]||0) - (need[t] || 0)));
  s.blocks = s.blocks || []; s.blocks.push({ type: req.type, x: req.x, y: req.y });
  if (req.type === 'bed') s.restPoint = true;
  s.pending.splice(idx, 1); save();
}
function refuserPending(id, idx){ if (!isMJ) return; const s = data.sites[id]; if (!s || !s.pending) return; s.pending.splice(idx, 1); save(); }

// ---- rendu ----
function costStr(need){ return TIERS.filter(t => need[t]).map(t => need[t] + ' ' + matLabel(t).toLowerCase().replace('matériaux ','')).join(' · ') || 'gratuit'; }

function render(){
  // liste des sites
  const list = document.getElementById('s-list');
  const ids = Object.keys(data.sites).filter(id => canAccess(data.sites[id]));
  if (!ids.length) list.innerHTML = '<span class="empty">' + (isMJ ? 'Aucun refuge. Crée-en un ci-dessous.' : 'Aucun refuge accessible.') + '</span>';
  else list.innerHTML = ids.map(id => {
    const s = data.sites[id];
    const sub = (s.faction ? ('Faction : ' + s.faction) : ('Indépendant · ' + (s.allies?.length || 0) + ' allié(s)')) + (s.restPoint ? ' · 🛏 repos' : '');
    return `<button class="site-btn${selSite===id?' on':''}" onclick="selSite='${id}';render()">${esc(s.name)}<small>${sub}</small></button>`;
  }).join('');

  const site = selSite ? data.sites[selSite] : null;
  document.getElementById('s-empty').style.display = site ? 'none' : 'block';
  document.getElementById('s-site').style.display = site ? 'block' : 'none';
  if (!site) return;
  if (!isMJ && !lockSite && !canAccess(site)) { selSite = null; render(); return; }

  // en-tête
  const facTag = site.faction ? `<span class="tag">${site.faction}</span>` : `<span class="tag">Indépendant</span>`;
  const poiTag = site.poi ? `<span class="tag">📍 ${esc(site.poi)}</span>` : (isMJ ? `<span class="tag" style="color:var(--rd)">⚠ non lié à un lieu</span>` : '');
  const restTag = site.restPoint ? `<span class="tag rest">🛏 Point de repos</span>` : '';
  const mjTools = isMJ ? `<span class="s-mj-tools"><button class="sbtn" onclick="supprimerSite('${selSite}')">✕ Supprimer</button></span>` : '';
  document.getElementById('s-site-head').innerHTML = mjTools + esc(site.name) + facTag + poiTag + restTag;

  // stock (Réserve)
  document.getElementById('s-stock').innerHTML = TIERS.map(t => {
    const cr = isMJ ? `<span class="cr"><button onclick="creditStock('${selSite}','${t}',-1)">−</button><button onclick="creditStock('${selSite}','${t}',1)">+</button><button onclick="creditStock('${selSite}','${t}',5)" title="+5">⏫</button></span>` : '';
    return `<div class="s-mat"><span class="mc">${matLabel(t)}</span><b>${site.stock?.[t]||0}</b>${cr}</div>`;
  }).join('');
  renderScrap(site);

  // grille
  const gw = document.getElementById('s-grid');
  gw.style.gridTemplateColumns = `repeat(${site.w}, 56px)`;
  let cells = '';
  for (let y = 0; y < site.h; y++) for (let x = 0; x < site.w; x++){
    const b = (site.blocks||[]).find(c => c.x===x && c.y===y);
    const pend = (site.pending||[]).find(c => c.x===x && c.y===y);
    const def = b ? blockDef(b.type) : null;
    let cls = 's-cell', style = '', inner = '', title = 'Vide';
    if (def){
      cls += ' filled'; style = `style="--bc:${def.color || '#3a5c3a'}"`; title = def.name;
      inner = `<span class="bk-ic">${def.icon}</span><span class="bk-lbl">${esc(def.name)}</span>`;
    } else if (pend){
      const pdef = blockDef(pend.type); cls += ' pending'; title = 'En attente : ' + (pdef?.name || '');
      inner = `<span class="bk-ic dim">${pdef ? pdef.icon : '·'}</span><span class="pg">⏳</span>`;
    }
    const click = (isMJ && b) ? `onclick="removeBlock('${selSite}',${x},${y})" title="Retirer ${esc(def.name)}"` : `onclick="cellClick('${selSite}',${x},${y})" title="${esc(title)}"`;
    cells += `<div class="${cls}" ${style} ${click}>${inner}</div>`;
  }
  gw.innerHTML = cells;
  document.getElementById('s-grid-hint').textContent = selBlock ? ('— clique une case pour poser : ' + (blockDef(selBlock)?.name||'')) : (isMJ ? '— clique un bloc du catalogue, puis une case (clic sur un bloc posé = retirer)' : '— choisis un bloc puis une case pour proposer');

  // catalogue
  document.getElementById('s-cat').innerHTML = (window.BUILD_BLOCKS || []).map(b => {
    const need = matsFor(b);
    const ok = skillOk(b);
    const skillsTxt = b.skills && b.skills.length ? (b.skills.map(skillName).join(' / ') + ' ' + b.complexity) : 'aucune comp.';
    return `<button class="cat-item${selBlock===b.id?' sel':''}${ok?'':' locked'}" style="border-left:4px solid ${b.color||'#3a5c3a'}" ${ok?`onclick="selectCat('${b.id}')"`:''} title="${esc(b.desc)}">
      <span class="ci-ic" style="background:${b.color||'#3a5c3a'}22">${b.icon}</span> ${esc(b.name)}
      <span class="ci-meta">Requis : ${skillsTxt} · <span class="ci-cost">${costStr(need)}</span></span>
    </button>`;
  }).join('');

  // demandes en attente (MJ)
  const pend = document.getElementById('s-pending');
  if (isMJ && (site.pending||[]).length){
    pend.innerHTML = '<div class="s-sub">Demandes de construction</div>' + site.pending.map((r, i) => {
      const def = blockDef(r.type); const need = matsFor(def||{complexity:0});
      const enough = stockEnough(site, need);
      return `<div class="pend-row"><span>${def?def.icon:''} <b>${esc(def?def.name:r.type)}</b> · ${joueursCamp[r.pid]?.nom||r.pid} · case (${r.x},${r.y}) · coût ${costStr(need)} ${enough?'':'⚠ stock insuffisant'}</span>
        <span><button class="ok" onclick="validerPending('${selSite}',${i})">✓ Valider</button><button class="no" onclick="refuserPending('${selSite}',${i})">✕</button></span></div>`;
    }).join('');
  } else if (!isMJ && (site.pending||[]).some(r => r.pid === me?.id)){
    pend.innerHTML = '<div class="s-sub">Tes demandes en attente</div>' + site.pending.filter(r=>r.pid===me.id).map(r => {
      const def = blockDef(r.type); return `<div class="pend-row"><span>${def?def.icon:''} ${esc(def?def.name:r.type)} · case (${r.x},${r.y}) — en attente de validation MJ</span></div>`;
    }).join('');
  } else pend.innerHTML = '';

  // alliés (MJ, refuge indépendant)
  const al = document.getElementById('s-allies');
  if (isMJ && !site.faction){
    const chips = Object.keys(joueursCamp).map(pid => `<span class="ally-chip${(site.allies||[]).includes(pid)?' on':''}" onclick="toggleAlly('${selSite}','${pid}')">${(site.allies||[]).includes(pid)?'✓':'+'} ${esc(joueursCamp[pid].nom||pid)}</span>`).join('') || '<span class="empty">Aucun joueur dans cette campagne.</span>';
    al.innerHTML = '<div class="s-sub">Joueurs alliés (peuvent déposer / construire / se reposer)</div>' + chips;
  } else if (isMJ && site.faction){
    al.innerHTML = '<div class="s-note">Refuge affilié à <b>' + esc(site.faction) + '</b> : l\'accès suit l\'appartenance à la faction (pas de liste d\'alliés).</div>';
  } else al.innerHTML = '';

  // note dépôt (joueur) — le dépôt de matériaux par scrap arrive à l'Incrément 2
  if (!isMJ){
    al.innerHTML += '<div class="s-note">Les matériaux de la Réserve sont fournis par le MJ pour l\'instant ; le dépôt par récupération (scrap du junk) arrive bientôt.</div>';
  }
}
function esc(s){ return (''+s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
