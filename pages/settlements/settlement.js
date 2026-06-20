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
let _edgeBrush = null;              // MJ : pinceau d'arête ('wall'|'door'|'window'|'erase')

// Rendu des arêtes (murs/portes/fenêtres) — porté de mj_shared.js (battlemap)
function gridEdgesHtmlS(grid, cs){
  const pad = 5, gap = 1, pitch = cs + gap; const E = grid.edges || {}; let h = '';
  const isWall = (o,x,y) => E[o+','+x+','+y] === 'wall';
  for(const key in E){
    const p = key.split(','); const o = p[0], x = +p[1], y = +p[2], type = E[key];
    if(o === 'V') h += '<div class="cedge cedge-v e-'+type+'" style="left:'+(pad+x*pitch-gap)+'px;top:'+(pad+y*pitch-gap)+'px;height:'+(cs+2*gap)+'px"></div>';
    else          h += '<div class="cedge cedge-h e-'+type+'" style="top:'+(pad+y*pitch-gap)+'px;left:'+(pad+x*pitch-gap)+'px;width:'+(cs+2*gap)+'px"></div>';
  }
  for(let vx=0; vx<=grid.w; vx++) for(let vy=0; vy<=grid.h; vy++){
    const nv = (isWall('V',vx,vy-1)?1:0) + (isWall('V',vx,vy)?1:0);
    const nh = (isWall('H',vx-1,vy)?1:0) + (isWall('H',vx,vy)?1:0);
    if(nv===1 && nh===1){ const cx = pad+vx*pitch-gap/2, cy = pad+vy*pitch-gap/2; h += '<div class="cedge-knee" style="left:'+(cx-2)+'px;top:'+(cy-2)+'px"></div>'; }
  }
  return h;
}
function sEdgeHotspots(site, cs){
  const pad = 5, gap = 1, pitch = cs + gap; let h = '';
  for(let y=0;y<site.h;y++) for(let x=0;x<=site.w;x++)
    h += `<div class="cedge-hot" style="left:${pad+x*pitch-gap-2}px;top:${pad+y*pitch}px;width:6px;height:${cs}px" onclick="sEdgeClick('V,${x},${y}')"></div>`;
  for(let y=0;y<=site.h;y++) for(let x=0;x<site.w;x++)
    h += `<div class="cedge-hot" style="top:${pad+y*pitch-gap-2}px;left:${pad+x*pitch}px;height:6px;width:${cs}px" onclick="sEdgeClick('H,${x},${y}')"></div>`;
  return h;
}
function sEdgeClick(key){
  if(!isMJ || !_edgeBrush) return;
  const site = data.sites[selSite]; if(!site) return;
  site.edges = site.edges || {};
  if(_edgeBrush === 'erase' || site.edges[key] === _edgeBrush) delete site.edges[key];
  else site.edges[key] = _edgeBrush;
  save();
}
function setEdgeBrush(t){ _edgeBrush = (_edgeBrush === t) ? null : t; render(); }
function renderEdgePal(){
  const el = document.getElementById('s-edge-pal'); if(!el) return;
  if(!isMJ){ el.innerHTML = ''; return; }
  const L = { wall:'▦ Mur', door:'╫ Porte', window:'┆ Fenêtre' };
  el.innerHTML = Object.keys(L).map(t => `<button class="s-ebtn${_edgeBrush===t?' on':''}" onclick="setEdgeBrush('${t}')">${L[t]}</button>`).join('')
    + `<button class="s-ebtn${_edgeBrush==='erase'?' on':''}" onclick="setEdgeBrush('erase')">✕ Effacer</button>`;
}

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
    // Le MJ pose directement et GRATUITEMENT (aucun matériau consommé)
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
// ---- repos au refuge : long repos bonifié par les blocs présents ----
function _siteHas(site, type){ return (site.blocks || []).some(b => b.type === type); }
function renderRest(site){
  const el = document.getElementById('s-rest'); if (!el) return;
  if (isMJ || !me || !canAccess(site) || !site.restPoint) { el.innerHTML = ''; return; }
  const bonus = [];
  if (_siteHas(site,'cooking')) bonus.push('🍖 faim'); if (_siteHas(site,'water')) bonus.push('🚰 soif');
  if (_siteHas(site,'medical')) bonus.push('🩺 rad soignée'); if (_siteHas(site,'door')) bonus.push('🚪 repos sûr');
  el.innerHTML = '<div class="s-sub">😴 Repos</div>'
    + '<button class="sbtn add" style="max-width:340px" onclick="reposRefuge()">😴 Se reposer ici — PV au max · Bien reposé</button>'
    + (bonus.length ? `<div class="s-note">Bonus de ce refuge : ${bonus.join(' · ')}</div>` : '<div class="s-note">Ajoute cuisine / eau / poste médical pour bonifier le repos.</div>');
}
async function reposRefuge(){
  const site = data.sites[selSite]; if (!site || !me) return;
  if (!canAccess(site)) { alert('Réservé aux alliés du refuge.'); return; }
  if (!site.restPoint) { alert('Ce refuge n\'a pas de couchage.'); return; }
  const gains = ['🛏 Bien reposé (PV au max)'];
  if (_siteHas(site,'cooking')) gains.push('🍖 faim restaurée');
  if (_siteHas(site,'water'))   gains.push('🚰 soif restaurée');
  if (_siteHas(site,'medical')) gains.push('🩺 radiations soignées');
  if (_siteHas(site,'door'))    gains.push('🚪 repos sécurisé');
  if (!confirm('Se reposer ici ?\n\n' + gains.join('\n'))) return;
  let nowMin = 0;
  try { const ts = await fdb.collection('temps').doc(fpCampId()).get(); nowMin = (typeof partyMinutesFor === 'function') ? partyMinutesFor(ts.exists ? ts.data() : {}, me.id) : 0; } catch(e){}
  const sp = me.special || {}, niv = me.niveau || 1;
  const sv = { ...(me.survie || {}), sleep: nowMin, wellRested: true };   // lit confortable → Bien reposé
  if (_siteHas(site,'cooking')) sv.eat = nowMin;
  if (_siteHas(site,'water'))   sv.drink = nowMin;
  const hpMax = (sp.L || 5) + (sp.E || 5) + Math.max(0, niv - 1) + 2;       // base RAW + 2 (bien reposé)
  const upd = { survie: sv, hp: hpMax, lastUpdate: Date.now() };
  if (_siteHas(site,'medical')) upd.rad = 0;
  try { await fdb.collection('joueurs').doc(viewerId).update(upd); me.survie = sv; me.hp = hpMax; if (upd.rad != null) me.rad = 0; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  alert('😴 Repos terminé.\n' + gains.join('\n'));
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
// ---- établis : pose / retrait de mods sur armes & armures (consomme la Réserve) ----
function _perkComplexity(perk){ const m = (''+(perk||'')).match(/(\d+)/); const r = m ? parseInt(m[1]) : 0; return Math.min(6, Math.max(0, 2 + r)); }
function _modMats(mod){ return (window.BUILD_MATS && window.BUILD_MATS[_perkComplexity(mod.perk)]) || { common:0, uncommon:0, rare:0 }; }
function _benchSkill(kind){ const s = me?.skills || {}; return kind === 'weapon' ? Math.max(s.repair||0, s.science||0) : (s.repair||0); }
function _matCostShort(need){ const ab = { common:'C', uncommon:'PC', rare:'R' }; return TIERS.filter(t => need[t]).map(t => need[t]+ab[t]).join('·') || 'gratuit'; }
function _benchBlock(site, kind, title, types, MODS){
  if(!MODS || !MODS.slots) return '';
  const items = (me.inventory || []).map((it,i) => ({it,i})).filter(x => types.includes(x.it.type));
  let h = '<div class="s-sub">' + title + ' — pose de mods (matériaux de la Réserve)</div>';
  if(!items.length) return h + '<div class="s-note">Aucun objet compatible dans ton inventaire.</div>';
  items.forEach(({it,i}) => {
    h += '<div class="bench-item"><div class="bench-name">🔩 ' + esc(it.name) + '</div>';
    (MODS.slots).forEach(slot => {
      const cur = (it.mods && it.mods[slot]) || '';
      const opts = ['<option value="">— ' + esc(MODS.slotLabels?.[slot] || slot) + ' : aucun —</option>'].concat(
        (MODS[slot] || []).map(m => { const c = _perkComplexity(m.perk); const ok = _benchSkill(kind) >= c;
          return '<option value="' + m.id + '"' + (cur===m.id?' selected':'') + (ok?'':' disabled') + '>' + esc(m.name) + ' · ' + _matCostShort(_modMats(m)) + (ok?'':' 🔒 rang ' + c) + '</option>'; })
      ).join('');
      h += '<select class="s-inp bench-sel" onchange="installMod(' + i + ',\'' + slot + '\',this.value,\'' + kind + '\')">' + opts + '</select>';
    });
    h += '</div>';
  });
  return h;
}
function renderBench(site){
  const el = document.getElementById('s-bench'); if(!el) return;
  if(isMJ || !me || !canAccess(site)){ el.innerHTML = ''; return; }
  let html = '';
  if(_siteHas(site,'wbench_weapon')) html += _benchBlock(site, 'weapon', '🔧 Établi d\'armes', ['WEAPON'], window.WEAPON_MODS);
  if(_siteHas(site,'wbench_armor'))  html += _benchBlock(site, 'armor', '🛡️ Établi d\'armures', ['ARMOR','CLOTHING'], window.ARMOR_MODS);
  el.innerHTML = html;
}
async function installMod(idx, slot, modId, kind){
  const site = data.sites[selSite]; if(!site || !me) return;
  if(!canAccess(site)){ alert('Réservé aux alliés du refuge.'); renderBench(site); return; }
  const benchType = kind === 'weapon' ? 'wbench_weapon' : 'wbench_armor';
  if(!_siteHas(site, benchType)){ alert('Établi absent.'); return; }
  const inv = (me.inventory || []).map(x => ({ ...x, mods: x.mods ? { ...x.mods } : undefined }));
  const it = inv[idx]; if(!it) return;
  if(!modId){ if(it.mods) it.mods[slot] = null; }   // retrait (gratuit)
  else {
    const MODS = kind === 'weapon' ? window.WEAPON_MODS : window.ARMOR_MODS;
    const mod = (MODS[slot] || []).find(m => m.id === modId); if(!mod) return;
    if(_benchSkill(kind) < _perkComplexity(mod.perk)){ alert('Compétence insuffisante pour ce mod.'); renderBench(site); return; }
    const need = _modMats(mod);
    if(!stockEnough(site, need)){ alert('Stock de matériaux insuffisant (' + costStr(need) + ').'); renderBench(site); return; }
    site.stock = site.stock || { common:0, uncommon:0, rare:0 };
    TIERS.forEach(t => site.stock[t] = Math.max(0, (site.stock[t]||0) - (need[t]||0)));
    it.mods = it.mods || {}; it.mods[slot] = modId;
  }
  try { await fdb.collection('joueurs').doc(viewerId).update({ inventory: inv, lastUpdate: Date.now() }); me.inventory = inv; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  save();   // sauve la Réserve (matériaux déduits)
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
  renderRest(site);
  renderBench(site);
  renderScrap(site);

  // grille — layout pixel (permet les arêtes murs/portes/fenêtres comme la battlemap)
  const CS = 52, GP = 1, PAD = 5, PITCH = CS + GP;
  const gw = document.getElementById('s-grid');
  gw.style.display = 'block'; gw.style.position = 'relative'; gw.style.padding = '0'; gw.style.backgroundImage = 'none';
  gw.style.width = (PAD*2 + site.w*PITCH) + 'px'; gw.style.height = (PAD*2 + site.h*PITCH) + 'px';
  let cells = '';
  for (let y = 0; y < site.h; y++) for (let x = 0; x < site.w; x++){
    const b = (site.blocks||[]).find(c => c.x===x && c.y===y);
    const pend = (site.pending||[]).find(c => c.x===x && c.y===y);
    const def = b ? blockDef(b.type) : null;
    let cls = 's-cell', bc = '', inner = '', title = 'Vide';
    if (def){ cls += ' filled'; bc = '--bc:' + (def.color || '#3a5c3a') + ';'; title = def.name;
      inner = `<span class="bk-ic">${def.icon}</span><span class="bk-lbl">${esc(def.name)}</span>`; }
    else if (pend){ const pdef = blockDef(pend.type); cls += ' pending'; title = 'En attente : ' + (pdef?.name || '');
      inner = `<span class="bk-ic dim">${pdef ? pdef.icon : '·'}</span><span class="pg">⏳</span>`; }
    const click = (isMJ && b) ? `onclick="removeBlock('${selSite}',${x},${y})" title="Retirer ${esc(def.name)}"` : `onclick="cellClick('${selSite}',${x},${y})" title="${esc(title)}"`;
    cells += `<div class="${cls}" style="position:absolute;left:${PAD+x*PITCH}px;top:${PAD+y*PITCH}px;width:${CS}px;height:${CS}px;${bc}" ${click}>${inner}</div>`;
  }
  cells += '<div class="s-edges">' + gridEdgesHtmlS({ w: site.w, h: site.h, edges: site.edges || {} }, CS) + '</div>';
  if (isMJ && _edgeBrush) cells += sEdgeHotspots(site, CS);
  gw.innerHTML = cells;
  renderEdgePal();
  document.getElementById('s-grid-hint').textContent = _edgeBrush ? ('— clique les BORDS des cases pour poser : ' + ({wall:'Mur',door:'Porte',window:'Fenêtre',erase:'Effacer'}[_edgeBrush])) : selBlock ? ('— clique une case pour poser : ' + (blockDef(selBlock)?.name||'')) : (isMJ ? '— clique un bloc du catalogue puis une case · ou un pinceau Mur/Porte/Fenêtre puis les bords (clic sur bloc posé = retirer)' : '— choisis un bloc puis une case pour proposer');

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
