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
let carteData = { pois: [], geoReveal: {} };   // POI + révélations (présence du joueur sur le lieu)
let data = { sites: {} };           // /settlements/<camp>
let joueursCamp = {};               // joueurs de la campagne (pour alliés)
let tempsData = null;               // /temps/<camp> (pour le tick éco/colons)
let selSite = null;                 // id du refuge sélectionné
let selBlock = null;                // bloc choisi dans le catalogue (à poser)
let _edgeBrush = null;              // MJ : pinceau d'arête ('wall'|'door'|'window'|'erase')
let _selTok = null;                 // MJ : jeton joueur sélectionné (à déplacer)
let _autoPlaced = false;            // joueur : jeton auto-placé une fois

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
  // Carte (live) : POI (sélecteur MJ) + révélations (présence du joueur sur le lieu)
  fdb.collection('carte').doc(fpCampId()).onSnapshot(cs => {
    const d = cs.exists ? cs.data() : {};
    carteData = { pois: Array.isArray(d.pois) ? d.pois : [], geoReveal: (d.geoReveal && typeof d.geoReveal === 'object') ? d.geoReveal : {} };
    cartePois = carteData.pois.map(p => p.name).filter(Boolean);
    populatePoiSel();
    render();
  });
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
  fdb.collection('temps').doc(fpCampId()).onSnapshot(s => { tempsData = s.exists ? s.data() : {}; render(); });
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
// Le joueur doit être PHYSIQUEMENT sur le lieu (POI révélé) pour agir dans le refuge
function _onSite(site){
  if (isMJ) return true;
  if (!me || !site) return false;
  if (!site.poi) return false;   // refuge non lié à un lieu → pas de présence joueur possible
  const poi = (carteData.pois || []).find(p => p.name === site.poi);
  if (poi && Array.isArray(poi.revealedFor) && poi.revealedFor.includes(me.id)) return true;
  return (carteData.geoReveal?.[site.poi] || []).includes(me.id);
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
  const type = document.getElementById('ns-type')?.value || 'refuge';
  const id = 's' + Date.now().toString(36);
  data.sites[id] = { name, w, h, type, faction, poi, allies: [], stock: { common:0, uncommon:0, rare:0 }, blocks: [], pending: [], restPoint: false };
  selSite = id; save();
  document.getElementById('ns-name').value = '';
}
function supprimerSite(id){ if (!isMJ) return; if (!confirm('Supprimer ce refuge ?')) return; delete data.sites[id]; if (selSite === id) selSite = null; save(); }
function setType(id){ if(!isMJ) return; const s = data.sites[id]; if(!s) return; s.type = (s.type === 'settlement') ? 'refuge' : 'settlement'; save(); }
function chSettlers(id, d){ if(!isMJ) return; const s = data.sites[id]; if(!s) return; s.settlers = Math.max(0, (s.settlers||0) + d); save(); }
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
  if (isMJ && _selTok){ s.pos = s.pos || {}; s.pos[_selTok] = { x, y }; _selTok = null; save(); return; }   // MJ déplace un jeton
  // Joueur en mode déplacement de SON jeton → bouge vers une case libre (pas sur un bloc)
  if (!isMJ && _selTok && _selTok === me?.id){
    if ((s.blocks || []).some(b => b.x === x && b.y === y)){ return; }   // pas sur un bloc
    s.pos = s.pos || {}; s.pos[me.id] = { x, y }; _selTok = null; save(); return;
  }
  // Joueur : clic sur l'icône d'un bloc → pop-up d'action
  if (!isMJ && !selBlock){
    const b = (s.blocks || []).find(c => c.x === x && c.y === y);
    if (b){ if(!_onSite(s)){ alert('Tu dois être sur place (' + (s.poi || 'le lieu') + ').'); return; } openBlockPop(b.type); }
    return;
  }
  if (!selBlock) return;
  if ((s.blocks || []).some(b => b.x === x && b.y === y)) { alert('Case déjà occupée.'); return; }
  if ((s.pending || []).some(b => b.x === x && b.y === y)) { alert('Une demande est déjà en attente sur cette case.'); return; }
  const block = blockDef(selBlock); if (!block) return;
  if (block.requires && !_siteHas(s, block.requires)) { alert('Nécessite d\'abord : ' + (blockDef(block.requires)?.name || block.requires) + '.'); return; }
  if (block.settlementOnly && s.type !== 'settlement') { alert('Bloc réservé aux settlements. Change le type du refuge (en-tête).'); return; }
  if (!skillOk(block)) { alert('Compétence insuffisante pour ce bloc.'); return; }
  if (isMJ){
    // Le MJ pose directement et GRATUITEMENT (aucun matériau consommé)
    s.blocks.push({ type: selBlock, x, y });
    if (selBlock === 'bed') s.restPoint = true;
    save();
  } else {
    if(!canAccess(s)){ alert('Tu n\'es pas allié de ce refuge — tu ne peux pas y construire.'); return; }
    if(!_onSite(s)){ alert('Tu dois être sur place (' + (s.poi || 'le lieu') + ') pour proposer une construction.'); return; }
    // Le joueur propose → validation MJ
    s.pending = s.pending || [];
    s.pending.push({ pid: me.id, type: selBlock, x, y, ts: Date.now() });
    save();
  }
  selBlock = null;
}
// ---- repos au refuge : long repos bonifié par les blocs présents ----
function _siteHas(site, type){ return (site.blocks || []).some(b => b.type === type); }
function restBody(site){
  if (isMJ || !me || !canAccess(site) || !site.restPoint) return '';
  const bonus = [];
  if (_siteHas(site,'cooking')) bonus.push('🍖 faim'); if (_siteHas(site,'water')) bonus.push('🚰 soif');
  if (_siteHas(site,'medical')) bonus.push('🩺 rad'); if (_siteHas(site,'door')) bonus.push('🚪 sûr');
  return '<button class="sbtn add" onclick="reposRefuge()">😴 Se reposer (PV max)</button>'
    + (bonus.length ? `<div class="s-note">Bonus : ${bonus.join(' · ')}</div>` : '');
}
async function reposRefuge(){
  const site = data.sites[selSite]; if (!site || !me) return;
  if (!canAccess(site)) { alert('Réservé aux alliés du refuge.'); return; }
  if (!_onSite(site)) { alert('Tu dois être sur place (' + (site.poi || 'le lieu') + ') pour te reposer ici.'); return; }
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
  if (!_onSite(site)) { alert('Tu dois être sur place pour démonter ton matériel ici.'); return; }
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
function scrapBody(site){
  if (isMJ || !me || !canAccess(site)) return '';
  const junkInv = (me.inventory || []).filter(it => it && it.qty > 0 && (window.JUNK || []).some(j => j.n === it.name));
  if (!junkInv.length) return '';
  return junkInv.map(it => {
    const def = (window.JUNK || []).find(j => j.n === it.name);
    const safe = it.name.replace(/'/g, "\\'");
    return `<div class="scrap-row"><span>🔩 <b>${esc(it.name)}</b> ×${it.qty} <small>→ ${yieldStr(def)}</small></span>
      <span><button class="bp-mini" onclick="scrapJunk('${safe}',false)">Démonter</button>${it.qty>1?`<button class="bp-mini" onclick="scrapJunk('${safe}',true)">Tout (×${it.qty})</button>`:''}</span></div>`;
  }).join('');
}

// ---- économie, production, défense & colons ----
function countBlk(site, t){ return (site.blocks || []).filter(b => b.type === t).length; }
function waterPoints(site){ return countBlk(site,'water'); }
function bedCount(site){ return countBlk(site,'bed'); }
function security(site){ return countBlk(site,'turret') * 2; }
function sCampNow(){ let mx = 0; (tempsData?.parties || []).forEach(p => { mx = Math.max(mx, p.minutes || 0); }); return mx; }
function vendorFor(site, key){ return (site.vendors && site.vendors[key]) || (key === 'shop_water' ? site.vendor : null) || null; }
const _RND = () => 0.6 + Math.random() * 0.8;
function sTick(site){
  if(!isMJ || !site) return;
  const now = sCampNow();
  if(site.lastTick == null){ site.lastTick = now; save(); return; }
  const days = (now - site.lastTick) / 1440;
  if(days <= 0) return;
  const farms = countBlk(site,'farm');
  if(farms > 0) site.food = Math.round(((site.food||0) + farms * days * _RND()) * 10) / 10;
  const vW = vendorFor(site,'shop_water');
  if(countBlk(site,'shop_water') && vW && waterPoints(site) > 0) site.caps = (site.caps||0) + Math.round(waterPoints(site) * (vW.talent||1) * days * _RND());
  const vF = vendorFor(site,'shop_food');
  if(countBlk(site,'shop_food') && vF && (site.food||0) > 0){ const sold = Math.min(site.food, (vF.talent||1) * days * _RND()); if(sold > 0){ site.food = Math.round((site.food - sold) * 10) / 10; site.caps = (site.caps||0) + Math.round(sold * 2); } }
  const vD = vendorFor(site,'diner');
  if(countBlk(site,'diner') && vD && countBlk(site,'cooking') && (site.food||0) > 0){ const meals = Math.min(site.food, (vD.talent||1) * days * _RND()); if(meals > 0){ site.food = Math.round((site.food - meals) * 10) / 10; site.caps = (site.caps||0) + Math.round(meals * 4); } }
  if(countBlk(site,'beacon')){ const cap = bedCount(site); let s = site.settlers||0; if(s < cap){ let arr = 0; const tries = Math.max(1, Math.floor(days)); for(let i=0;i<tries && (s+arr)<cap;i++){ if(Math.random()<0.5) arr++; } if(arr>0) site.settlers = Math.min(cap, s+arr); } }
  site.lastTick = now; save();
}
function renderStats(site){
  const el = document.getElementById('s-stats'); if(!el) return;
  const colonsCtrl = isMJ ? ` <button class="s-stat-btn" onclick="chSettlers('${selSite}',-1)">−</button><button class="s-stat-btn" onclick="chSettlers('${selSite}',1)">+</button>` : '';
  const parts = [
    `🛡 Sécurité <b>${security(site)}</b>`,
    `🛏 Colons <b>${site.settlers||0}</b>/<b>${bedCount(site)}</b>${colonsCtrl}`,
    `🚰 Eau <b>${waterPoints(site)}</b>/j`,
    `🌱 Food <b>${countBlk(site,'farm')}</b>/j · stock <b>${Math.floor(site.food||0)}</b>`,
    `◉ Caps <b style="color:var(--am)">${site.caps||0}</b>`,
  ];
  el.innerHTML = '<div class="s-statbar">' + parts.map(p => `<span class="s-stat">${p}</span>`).join('') + '</div>';
}
function renderEco(site){
  const el = document.getElementById('s-eco'); if(!el) return;
  const shops = [['shop_water','🪧 Eau'],['shop_food','🍲 Nourriture'],['diner','🍳 Restaurant']].filter(([k]) => countBlk(site,k));
  if(!shops.length){ el.innerHTML = ''; return; }
  let h = '<div class="s-sub">🏪 Comptoirs</div>';
  shops.forEach(([k,lbl]) => { const v = vendorFor(site,k);
    h += `<div class="s-eco-row">${lbl} — vendeur : ${v ? esc(v.name)+' (talent '+v.talent+')' : '<i>aucun</i>'}</div>`;
    if(isMJ) h += `<div class="s-eco-ctrl"><input id="ev-${k}" class="s-inp" style="width:130px;display:inline-block" placeholder="Nom vendeur"><select id="et-${k}" class="s-inp" style="width:60px;display:inline-block"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select><button class="sbtn" onclick="assignVendor('${k}')">Assigner</button></div>`;
  });
  if(isMJ){ const opts = Object.keys(joueursCamp).map(pid => `<option value="${pid}">${esc(joueursCamp[pid].nom||pid)}</option>`).join('') || '<option value="">—</option>';
    h += `<div class="s-eco-ctrl">Verser <input id="eco-amt" type="number" class="s-inp" style="width:64px;display:inline-block" value="50" min="1"> caps → <select id="eco-to" class="s-inp" style="width:130px;display:inline-block">${opts}</select><button class="sbtn" onclick="withdrawCaps()">→ joueur</button></div>`;
  } else h += '<div class="s-note">La cagnotte se remplit au fil du temps ; le MJ la redistribue.</div>';
  el.innerHTML = h;
}
function assignVendor(key){
  if(!isMJ) return; const site = data.sites[selSite]; if(!site) return;
  const name = (document.getElementById('ev-'+key)?.value || '').trim();
  const tal = Math.max(1, Math.min(5, parseInt(document.getElementById('et-'+key)?.value) || 1));
  if(!name){ alert('Nom du vendeur requis.'); return; }
  site.vendors = site.vendors || {}; site.vendors[key] = { name, talent: tal };
  if(site.lastTick == null) site.lastTick = sCampNow(); save();
}
async function withdrawCaps(){
  if(!isMJ) return; const site = data.sites[selSite]; if(!site) return;
  const amt = parseInt(document.getElementById('eco-amt')?.value) || 0;
  const to = document.getElementById('eco-to')?.value;
  if(amt <= 0 || !to) return;
  if((site.caps || 0) < amt){ alert('Cagnotte insuffisante.'); return; }
  site.caps -= amt; save();
  try { const ref = fdb.collection('joueurs').doc(to); const snap = await ref.get(); const cur = (snap.exists ? snap.data().caps : 0) || 0; await ref.update({ caps: cur + amt, lastUpdate: Date.now() }); alert('💰 ' + amt + ' caps versés à ' + (joueursCamp[to]?.nom || to) + '.'); }
  catch(e){ alert('Erreur : ' + e.message); }
}
// Bandeau d'actions = cartes repliables individuelles (vue joueur)
const _openCards = new Set();
const _benchPick = { weapon: null, armor: null };
function toggleCard(id){ if(_openCards.has(id)) _openCards.delete(id); else _openCards.add(id); render(); }
function _card(id, title, body, wide){
  if(!body) return '';
  const open = _openCards.has(id);
  return `<div class="act-card${wide?' wide':''}"><button class="act-head${open?' on':''}" onclick="toggleCard('${id}')">${title}<span class="act-chev">${open?'▴':'▾'}</span></button>${open?`<div class="act-body">${body}</div>`:''}</div>`;
}
// Le bandeau ne sert plus qu'à signaler l'absence sur le lieu ; les actions passent par les icônes de la map (pop-up).
function renderActions(site){
  const box = document.getElementById('s-actions'), bar = document.getElementById('s-actbar');
  if(bar) bar.style.display='none';
  if(isMJ || !me || !canAccess(site)){ if(box){ box.innerHTML=''; box.style.display='none'; } return; }
  if(!_onSite(site)){ box.style.display=''; box.innerHTML = '<div class="s-note">📍 Tu n\'es pas sur place. Rends-toi sur <b>' + esc(site.poi || 'le lieu') + '</b> pour utiliser ce refuge.</div>'; return; }
  box.style.display='none'; box.innerHTML='';
}

// ---- Pop-up d'action : déclenché en cliquant l'icône d'un bloc sur la grille ----
let _popBlock = null;   // type de bloc dont le pop-up est ouvert (vue joueur)
const _POP_ACTION = {
  bed:           s => restBody(s),
  water:         s => waterBody(s),
  wbench_weapon: s => benchBody(s, 'weapon'),
  wbench_armor:  s => benchBody(s, 'armor'),
  storage:       s => scrapBody(s),
};
function openBlockPop(type){ _popBlock = type; render(); }
function closeBlockPop(){ _popBlock = null; render(); }
function renderPop(site){
  const ov = document.getElementById('s-pop'); if(!ov) return;
  if(isMJ || !_popBlock || !me || !canAccess(site) || !_onSite(site) || !_siteHas(site, _popBlock)){ ov.style.display='none'; return; }
  const def = blockDef(_popBlock);
  let body = (_POP_ACTION[_popBlock] ? _POP_ACTION[_popBlock](site) : '') || '';
  if(!body) body = `<div class="s-note">${esc(def?.desc || 'Aucune action directe ici.')}</div>`;
  document.getElementById('s-pop-t').innerHTML = def ? (def.icon + ' ' + esc(def.name)) : '';
  document.getElementById('s-pop-b').innerHTML = body;
  ov.style.display = 'flex';
}
function selTok(pid){
  if(isMJ){ _selTok = (_selTok === pid) ? null : pid; render(); return; }
  // Joueur : ne peut sélectionner que SON jeton, et seulement sur place
  if(pid === me?.id && _onSite(data.sites[selSite])){ _selTok = (_selTok === pid) ? null : pid; render(); }
}
function _firstFreeCell(site){ for(let y=site.h-1;y>=0;y--) for(let x=0;x<site.w;x++){ if(!(site.blocks||[]).some(b=>b.x===x&&b.y===y) && !Object.values(site.pos||{}).some(p=>p&&p.x===x&&p.y===y)) return {x,y}; } return {x:0,y:0}; }
function placeTok(pid){ if(!isMJ) return; const s = data.sites[selSite]; if(!s) return; s.pos = s.pos || {}; if(s.pos[pid]) delete s.pos[pid]; else s.pos[pid] = _firstFreeCell(s); save(); }
function renderTokens(site){
  const el = document.getElementById('s-tokens'); if(!el) return;
  if(!isMJ){ el.innerHTML = ''; return; }
  const ids = Object.keys(joueursCamp);
  if(!ids.length){ el.innerHTML = ''; return; }
  el.innerHTML = '<div class="s-sub">🧍 Jetons joueurs <small style="color:var(--td)">(placer/retirer · clic jeton puis case = déplacer)</small></div>'
    + ids.map(pid => { const on = !!(site.pos && site.pos[pid]); return `<span class="ally-chip${on?' on':''}" onclick="placeTok('${pid}')">${on?'📍':'+'} ${esc(joueursCamp[pid].nom||pid)}</span>`; }).join('');
}

// ---- point d'eau : remplir ses contenants ----
function _containers(){ return (me?.inventory || []).filter(it => { const d = (window.DB?.stuff||[]).find(s => s.n === it.name); return d && d.cap != null; }); }
function waterBody(site){
  if(isMJ || !me || !canAccess(site) || !_siteHas(site,'water')) return '';
  const conts = _containers();
  if(!conts.length) return '<div class="s-note">Apporte une gourde / un bidon / un jerrican.</div>';
  const lines = conts.map(it => { const d = (window.DB.stuff).find(s => s.n === it.name); return `${esc(it.name)} ${(it.water||0)}/${d.cap}`; }).join(' · ');
  return '<button class="sbtn add" onclick="fillContainers()">💧 Remplir</button><div class="s-note">' + lines + '</div>';
}
async function fillContainers(){
  const site = data.sites[selSite]; if(!site || !me) return;
  if(!canAccess(site)){ alert('Réservé aux alliés du refuge.'); return; }
  if(!_onSite(site)){ alert('Tu dois être sur place pour remplir tes contenants.'); return; }
  if(!_siteHas(site,'water')){ alert('Pas de point d\'eau ici.'); return; }
  const inv = (me.inventory || []).map(x => ({ ...x }));
  let n = 0;
  inv.forEach(it => { const d = (window.DB?.stuff||[]).find(s => s.n === it.name); if(d && d.cap != null && (it.water||0) < d.cap){ it.water = d.cap; it.w = Math.round((d.w + d.cap*0.5)*100)/100; n++; } });
  if(!n){ alert('Tes contenants sont déjà pleins.'); return; }
  try { await fdb.collection('joueurs').doc(viewerId).update({ inventory: inv, lastUpdate: Date.now() }); me.inventory = inv; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  alert('💧 Contenant(s) rempli(s) : ' + n + '.');
}

// ---- établis : pose / retrait de mods sur armes & armures (consomme la Réserve) ----
function _perkComplexity(perk){ const m = (''+(perk||'')).match(/(\d+)/); const r = m ? parseInt(m[1]) : 0; return Math.min(6, Math.max(0, 2 + r)); }
function _modMats(mod){ return (window.BUILD_MATS && window.BUILD_MATS[_perkComplexity(mod.perk)]) || { common:0, uncommon:0, rare:0 }; }
function _benchSkill(kind){ const s = me?.skills || {}; return kind === 'weapon' ? Math.max(s.repair||0, s.science||0) : (s.repair||0); }
function _matCostShort(need){ const ab = { common:'C', uncommon:'PC', rare:'R' }; return TIERS.filter(t => need[t]).map(t => need[t]+ab[t]).join('·') || 'gratuit'; }
// Mods déjà débloqués (bricolés une fois) sur CETTE pièce → ré-équipables gratuitement
function _unlockedList(it, slot){ return (it.unlocked && it.unlocked[slot]) || []; }
let _benchDone = null;   // clé du dernier bouton validé (retour visuel : enfoncé + coche)
function _benchFlash(key){ _benchDone = key; render(); setTimeout(() => { if(_benchDone === key){ _benchDone = null; render(); } }, 1600); }

// Drill-down d'un établi : choisir l'objet (pièce) → puis ses mods (boutons Bricoler / Équiper)
function benchBody(site, kind){
  const MODS = kind === 'weapon' ? window.WEAPON_MODS : window.ARMOR_MODS;
  const types = kind === 'weapon' ? ['WEAPON'] : ['ARMOR','CLOTHING'];
  if(!MODS || !MODS.slots) return '';
  const items = (me.inventory || []).map((it,i) => ({it,i})).filter(x => types.includes(x.it.type));
  if(!items.length) return '<div class="s-note">Aucun objet compatible.</div>';
  const sel = _benchPick[kind];
  let h = '<div class="bench-items">' + items.map(({it,i}) =>
    `<button class="bench-pick${sel===i?' on':''}" onclick="pickBenchItem('${kind}',${i})">${esc(it.name)}</button>`).join('') + '</div>';
  if(sel != null && items.some(x => x.i === sel)){
    const it = me.inventory[sel];
    h += '<div class="bench-mods">' + (MODS.slots).map(slot => {
      const list = MODS[slot] || []; if(!list.length) return '';
      const cur = (it.mods && it.mods[slot]) || '';
      const label = esc(MODS.slotLabels?.[slot] || slot);
      let row = `<div class="bench-slot"><div class="bench-slot-t">${label}</div><div class="bench-opts">`;
      // Option « Aucun » (retrait gratuit)
      const noneDone = _benchDone === (sel+':'+slot+':');
      row += `<button class="bench-opt${!cur?' equipped':''}${noneDone?' just-done':''}" onclick="benchEquip(${sel},'${slot}','','${kind}')">`
        + `<span class="bo-n">Aucun</span>${(!cur||noneDone)?'<span class="bo-ok">✓</span>':''}</button>`;
      list.forEach(m => {
        const c = _perkComplexity(m.perk), need = _modMats(m);
        const skOk = _benchSkill(kind) >= c, stOk = stockEnough(site, need);
        const unlocked = _unlockedList(it, slot).includes(m.id);
        const equipped = cur === m.id;
        const done = _benchDone === (sel+':'+slot+':'+m.id);
        let cls = 'bench-opt', act = '', tag, note = '';
        if(equipped){ cls += ' equipped'; tag = 'Équipé'; act = `onclick="benchEquip(${sel},'${slot}','${m.id}','${kind}')"`; }
        else if(unlocked){ cls += ' owned'; tag = '↺ Équiper'; act = `onclick="benchEquip(${sel},'${slot}','${m.id}','${kind}')"`; }
        else if(!skOk){ cls += ' locked'; tag = '🔧 ' + _matCostShort(need); note = ' 🔒 rang ' + c; }
        else if(!stOk){ cls += ' nostock'; tag = '🔧 ' + _matCostShort(need); note = ' ⚠ stock'; }
        else { tag = '🔧 ' + _matCostShort(need); act = `onclick="benchCraft(${sel},'${slot}','${m.id}','${kind}')"`; }
        if(done) cls += ' just-done';
        const ok = (equipped || done) ? '<span class="bo-ok">✓</span>' : '';
        row += `<button class="${cls}" ${act} title="${esc(m.name)} · ${esc(_matCostShort(need))}">`
          + `<span class="bo-n">${esc(m.name)}</span><span class="bo-a">${tag}${note}</span>${ok}</button>`;
      });
      row += '</div></div>';
      return row;
    }).join('') + '</div>';
  } else h += '<div class="s-note">Choisis un objet à modifier.</div>';
  return h;
}
function pickBenchItem(kind, i){ _benchPick[kind] = (_benchPick[kind] === i) ? null : i; render(); }

// Équiper un mod DÉJÀ débloqué (ou « Aucun ») — gratuit
async function benchEquip(idx, slot, modId, kind){
  const site = data.sites[selSite]; if(!site || !me) return;
  if(!canAccess(site)){ alert('Réservé aux alliés du refuge.'); return; }
  if(!_onSite(site)){ alert('Tu dois être sur place pour utiliser cet établi.'); return; }
  const benchType = kind === 'weapon' ? 'wbench_weapon' : 'wbench_armor';
  if(!_siteHas(site, benchType)){ alert('Établi absent.'); return; }
  const inv = (me.inventory || []).map(x => ({ ...x, mods: x.mods ? { ...x.mods } : undefined, unlocked: x.unlocked ? { ...x.unlocked } : undefined }));
  const it = inv[idx]; if(!it) return;
  if(!modId){ if(it.mods) it.mods[slot] = null; }
  else {
    if(!_unlockedList(it, slot).includes(modId)){ alert('Ce mod n\'a pas encore été bricolé sur cette pièce.'); return; }
    it.mods = it.mods || {}; it.mods[slot] = modId;
  }
  try { await fdb.collection('joueurs').doc(viewerId).update({ inventory: inv, lastUpdate: Date.now() }); me.inventory = inv; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  _benchFlash(idx + ':' + slot + ':' + (modId || ''));
}

// Bricoler un mod NEUF : consomme la Réserve, le débloque sur la pièce, et l'équipe
async function benchCraft(idx, slot, modId, kind){
  const site = data.sites[selSite]; if(!site || !me) return;
  if(!canAccess(site)){ alert('Réservé aux alliés du refuge.'); return; }
  if(!_onSite(site)){ alert('Tu dois être sur place pour utiliser cet établi.'); return; }
  const benchType = kind === 'weapon' ? 'wbench_weapon' : 'wbench_armor';
  if(!_siteHas(site, benchType)){ alert('Établi absent.'); return; }
  const MODS = kind === 'weapon' ? window.WEAPON_MODS : window.ARMOR_MODS;
  const mod = (MODS[slot] || []).find(m => m.id === modId); if(!mod) return;
  if(_benchSkill(kind) < _perkComplexity(mod.perk)){ alert('Compétence insuffisante pour ce mod.'); return; }
  const need = _modMats(mod);
  if(!stockEnough(site, need)){ alert('Stock de matériaux insuffisant (' + costStr(need) + ').'); return; }
  const inv = (me.inventory || []).map(x => ({ ...x, mods: x.mods ? { ...x.mods } : undefined, unlocked: x.unlocked ? { ...x.unlocked } : undefined }));
  const it = inv[idx]; if(!it) return;
  site.stock = site.stock || { common:0, uncommon:0, rare:0 };
  TIERS.forEach(t => site.stock[t] = Math.max(0, (site.stock[t]||0) - (need[t]||0)));
  it.unlocked = it.unlocked || {}; it.unlocked[slot] = it.unlocked[slot] || [];
  if(!it.unlocked[slot].includes(modId)) it.unlocked[slot].push(modId);
  it.mods = it.mods || {}; it.mods[slot] = modId;   // bricoler équipe directement (comme FO4)
  try { await fdb.collection('joueurs').doc(viewerId).update({ inventory: inv, lastUpdate: Date.now() }); me.inventory = inv; }
  catch(e){ alert('Erreur : ' + e.message); return; }
  save();   // sauve la Réserve (matériaux déduits)
  _benchFlash(idx + ':' + slot + ':' + modId);
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
  const isSet = site.type === 'settlement';
  const typeTag = `<span class="tag" style="${isSet?'color:#1a1200;background:var(--g);border-color:var(--g)':''}">${isSet?'🏘️ Settlement':'🏚 Refuge'}</span>${isMJ?`<button class="sbtn" style="font-size:9px;padding:2px 6px;margin-left:4px" onclick="setType('${selSite}')">⇄ type</button>`:''}`;
  const facTag = site.faction ? `<span class="tag">${site.faction}</span>` : `<span class="tag">Indépendant</span>`;
  const poiTag = site.poi ? `<span class="tag">📍 ${esc(site.poi)}</span>` : (isMJ ? `<span class="tag" style="color:var(--rd)">⚠ non lié à un lieu</span>` : '');
  const restTag = site.restPoint ? `<span class="tag rest">🛏 Point de repos</span>` : '';
  const mjTools = isMJ ? `<span class="s-mj-tools"><button class="sbtn" onclick="supprimerSite('${selSite}')">✕ Supprimer</button></span>` : '';
  document.getElementById('s-site-head').innerHTML = mjTools + esc(site.name) + typeTag + facTag + poiTag + restTag;

  // stock (Réserve)
  document.getElementById('s-stock').innerHTML = TIERS.map(t => {
    const cr = isMJ ? `<span class="cr"><button onclick="creditStock('${selSite}','${t}',-1)">−</button><button onclick="creditStock('${selSite}','${t}',1)">+</button><button onclick="creditStock('${selSite}','${t}',5)" title="+5">⏫</button></span>` : '';
    return `<div class="s-mat"><span class="mc">${matLabel(t)}</span><b>${site.stock?.[t]||0}</b>${cr}</div>`;
  }).join('');
  if(isMJ) sTick(site);
  renderStats(site);
  renderTokens(site);
  renderEco(site);
  renderActions(site);

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
      if(!isMJ && me && canAccess(site) && _onSite(site) && _POP_ACTION[b.type]) cls += ' s-cell-act';   // bloc utilisable → halo
      inner = `<span class="bk-ic">${def.icon}</span><span class="bk-lbl">${esc(def.name)}</span>`; }
    else if (pend){ const pdef = blockDef(pend.type); cls += ' pending'; title = 'En attente : ' + (pdef?.name || '');
      inner = `<span class="bk-ic dim">${pdef ? pdef.icon : '·'}</span><span class="pg">⏳</span>`; }
    const click = (isMJ && b) ? `onclick="removeBlock('${selSite}',${x},${y})" title="Retirer ${esc(def.name)}"` : `onclick="cellClick('${selSite}',${x},${y})" title="${esc(title)}"`;
    cells += `<div class="${cls}" style="position:absolute;left:${PAD+x*PITCH}px;top:${PAD+y*PITCH}px;width:${CS}px;height:${CS}px;${bc}" ${click}>${inner}</div>`;
  }
  cells += '<div class="s-edges">' + gridEdgesHtmlS({ w: site.w, h: site.h, edges: site.edges || {} }, CS) + '</div>';
  if (isMJ && _edgeBrush) cells += sEdgeHotspots(site, CS);
  // Jeton du joueur visiteur : auto-placement à la 1re visite (joueur allié, présent sur le lieu)
  if (!isMJ && me && canAccess(site) && _onSite(site) && !(site.pos && site.pos[me.id]) && !_autoPlaced){
    _autoPlaced = true; site.pos = site.pos || {}; site.pos[me.id] = _firstFreeCell(site); save();
  }
  // Jetons (tous les joueurs présents sur ce refuge)
  const pos = site.pos || {};
  const canMoveOwn = !isMJ && me && canAccess(site) && _onSite(site);
  Object.keys(pos).forEach(pid => { const p = pos[pid]; if(!p) return;
    const nom = (joueursCamp[pid]?.nom || pid);
    const mine = pid === viewerId;
    const cls = 's-tok' + (mine ? ' s-tok-me' : '') + ((isMJ && _selTok === pid) || (mine && _selTok === pid) ? ' s-tok-sel' : '');
    const click = (isMJ || (mine && canMoveOwn)) ? `onclick="selTok('${pid}')"` : '';
    cells += `<div class="${cls}" style="left:${PAD + p.x*PITCH + (CS-26)/2}px;top:${PAD + p.y*PITCH + (CS-26)/2}px" ${click} title="${esc(nom)}${mine&&canMoveOwn?' — clique pour te déplacer':''}">${esc(nom).slice(0,2).toUpperCase()}</div>`;
  });
  gw.innerHTML = cells;
  renderEdgePal();
  renderPop(site);
  document.getElementById('s-grid-hint').textContent = _selTok ? '— clique une case libre pour déplacer le jeton' : _edgeBrush ? ('— clique les BORDS des cases pour poser : ' + ({wall:'Mur',door:'Porte',window:'Fenêtre',erase:'Effacer'}[_edgeBrush])) : selBlock ? ('— clique une case pour poser : ' + (blockDef(selBlock)?.name||'')) : (isMJ ? '— bloc du catalogue + case · pinceau Mur/Porte/Fenêtre + bords · clic jeton = déplacer · clic bloc posé = retirer' : '— clique une icône pour l\'utiliser · clique ton jeton puis une case pour te déplacer');

  // catalogue — MJ uniquement (côté joueur, la liste de blocs est masquée)
  const catWrap = document.querySelector('.s-cat-wrap');
  const cols = document.querySelector('.s-cols');
  if(!isMJ){
    if(catWrap) catWrap.style.display = 'none';
    if(cols) cols.classList.add('s-cols-solo');
    document.getElementById('s-cat').innerHTML = '';
  } else {
    if(catWrap) catWrap.style.display = '';
    if(cols) cols.classList.remove('s-cols-solo');
    const isSettlement = site.type === 'settlement';
    document.getElementById('s-cat').innerHTML = (window.BUILD_BLOCKS || []).map(b => {
      const need = matsFor(b);
      const blocked = b.settlementOnly && !isSettlement;
      const ok = skillOk(b) && !blocked;
      const skillsTxt = b.skills && b.skills.length ? (b.skills.map(skillName).join(' / ') + ' ' + b.complexity) : 'aucune comp.';
      return `<button class="cat-item${selBlock===b.id?' sel':''}${ok?'':' locked'}" style="border-left:4px solid ${b.color||'#3a5c3a'}" ${ok?`onclick="selectCat('${b.id}')"`:''} title="${esc(b.desc)}${blocked?' — réservé aux settlements':''}">
        <span class="ci-ic" style="background:${b.color||'#3a5c3a'}22">${b.icon}</span> ${esc(b.name)}${blocked?' 🏘️':''}
        <span class="ci-meta">Requis : ${skillsTxt} · <span class="ci-cost">${costStr(need)}</span>${blocked?' · settlement':''}</span>
      </button>`;
    }).join('');
  }

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
}
function esc(s){ return (''+s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
