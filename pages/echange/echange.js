// ============================================================
// ÉCHANGE DE GROUPE — pool partagé entre membres d'un même groupe
// (Firebase /poolsEchange/{partyId}). Chaque membre dépose / prend.
// Créateur : ferme (récupère le reste). Autres : quitte la vue.
// ============================================================
const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const embed    = _params.get('embed') === '1';

let fdb;
let myParty = null;     // groupe (party) du joueur, ou null
let pool = null;        // doc du pool, ou null
let charData = null;    // fiche du joueur
let _poolUnsub = null;
let poolId = null;      // id du doc poolsEchange où je suis membre

document.addEventListener('DOMContentLoaded', () => {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  if (!viewerId) { render(); return; }

  // Mon groupe (temps/data)
  fdb.collection('temps').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    const parties = Array.isArray(d.parties) ? d.parties : [];
    myParty = parties.find(p => !p.solo && (p.players||[]).includes(viewerId) && (p.players||[]).length >= 2) || null;
    subscribePool();
    render();
  });
  // Ma fiche (inventaire / munitions / caps)
  fdb.collection('joueurs').doc(viewerId).onSnapshot(s => { charData = s.exists ? s.data() : null; render(); });
  window.addEventListener('message', e => { if (e.data === 'echange-refresh') render(); });
});

// Le pool n'est PLUS indexé par groupe : c'est un doc ad-hoc dont `members` liste
// les joueurs concernés (échange à 2 depuis la carte, ou tout le groupe).
function subscribePool(){
  if (_poolUnsub){ _poolUnsub(); _poolUnsub = null; }
  if (!viewerId){ pool = null; poolId = null; return; }
  _poolUnsub = fdb.collection('poolsEchange').where('members','array-contains',viewerId).limit(1)
    .onSnapshot(s => {
      if (s.empty){ pool = null; poolId = null; }
      else { const d = s.docs[0]; poolId = d.id; pool = d.data(); }
      render();
    }, e => { console.warn('poolsEchange:', e && e.code); pool = null; poolId = null; render(); });
}

function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toast(msg){ const t=document.getElementById('ex-toast'); if(!t)return; t.textContent=msg; t.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',2200); }

const _poolRef = () => fdb.collection('poolsEchange').doc(poolId);
const _charRef = () => fdb.collection('joueurs').doc(viewerId);

// ---- Ouvrir / fermer / quitter ----
// Ouvre un pool ad-hoc : avec mon groupe si j'en ai un, sinon juste moi
// (d'autres joueurs peuvent m'y rejoindre via « Proposer un échange » sur la carte).
async function ouvrirPool(){
  if (!viewerId) return;
  const members = (myParty && Array.isArray(myParty.players) && myParty.players.length)
    ? myParty.players.slice() : [viewerId];
  const id = 'ex' + Date.now().toString(36) + Math.floor(Math.random()*999);
  await fdb.collection('poolsEchange').doc(id).set({
    creator: viewerId,
    creatorNom: charData?.nom || viewerId,
    partyName: (myParty && myParty.name) || 'Échange',
    members,
    items: [], ammo: [], caps: 0, cards: [],
    createdAt: Date.now()
  });
}

async function fermerPool(){
  if (!pool || pool.creator !== viewerId) return;
  // Récupérer le butin restant vers le créateur
  try {
    await fdb.runTransaction(async tx => {
      const cS = await tx.get(_charRef());
      const cd = cS.exists ? cS.data() : {};
      const inv = Array.isArray(cd.inventory) ? cd.inventory : [];
      const ammo = Array.isArray(cd.ammo) ? cd.ammo : [];
      (pool.items||[]).forEach(it => {
        if (_isCont(it.name)) {
          for(let k=0;k<(it.qty||0);k++) inv.push({ name:it.name, type:it.type, w:it.w||0, qty:1, water:it.water||0, equipped:false });
          return;
        }
        const ex = inv.find(x => x.name===it.name && x.type===it.type && !x.equipped);
        if (ex) ex.qty = (ex.qty||1) + (it.qty||0);
        else inv.push({ name:it.name, type:it.type, w:it.w||0, qty:it.qty||0, equipped:false });
      });
      (pool.ammo||[]).forEach(a => {
        const ex = ammo.find(x => x.cal===a.cal);
        if (ex) ex.qty = (ex.qty||0) + (a.qty||0);
        else ammo.push({ cal:a.cal, qty:a.qty||0 });
      });
      // Cartes restantes → dans la collection du créateur (sinon elles seraient perdues)
      const pc = pool.cards||[];
      if (pc.length){
        let col = inv.find(it => it && it.collection === MTG_COL);
        if (!col){ col = { name:'Collection de cartes', type:'STUFF', qty:1, w:0, equipped:false, collection:MTG_COL, cards:{} }; inv.push(col); }
        if (!col.cards) col.cards = {};
        pc.forEach(c => { if(c && c.id) col.cards[c.id] = (col.cards[c.id]||0) + (c.qty||0); });
      }
      const caps = (cd.caps||0) + (pool.caps||0);
      tx.update(_charRef(), { inventory: inv, ammo, caps, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('fermerPool:', e); }
  await _poolRef().delete().catch(()=>{});
  _leave();
}

// Quitter : je me retire des membres (le pool disparaît de ma vue). S'il ne reste
// plus personne, le doc est supprimé (sinon il resterait orphelin).
async function quitterPool(){
  if (poolId && pool){
    try {
      const rest = (pool.members||[]).filter(m => m !== viewerId);
      if (rest.length) await _poolRef().update({ members: rest });
      else await _poolRef().delete();
    } catch(e){ console.warn('quitterPool:', e); }
  }
  _leave();
}
function _leave(){
  if (embed && window.parent) window.parent.postMessage('echange-close','*');
}

// Contenant d'eau (a une capacité) : l'eau est portée par EXEMPLAIRE → ne pas fusionner les piles
function _isCont(name){ return (window.DB?.stuff||[]).some(s => s.n === name && s.cap != null); }

// ---- CARTES MTG : elles vivent dans l'objet « Collection de cartes » (collection:'mtg',
// cards:{id:qty}), pas en objets isolés. Le pool a sa propre section `cards:[{id,qty}]`. ----
const MTG_COL = 'mtg';
const _RAR_COL = { common:'#cfcfcf', uncommon:'#8fb4dd', rare:'#e0bd5e', mythic:'#f0813c' };
function _mtgCard(id){ return (window.MTG_CARDS||[]).find(c => c.id === id) || null; }
function _colItem(inv){ return (inv||[]).find(it => it && it.collection === MTG_COL) || null; }
function _myCards(){
  const col = _colItem(charData && charData.inventory);
  return Object.entries((col && col.cards) || {})
    .map(([id,q]) => { const c = _mtgCard(id); return c ? { ...c, q } : null; })
    .filter(Boolean).sort((a,b) => a.name.localeCompare(b.name,'fr'));
}
async function deposerCarte(id, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const inv = cd.inventory||[];
      const col = _colItem(inv);
      if (!col || !col.cards || !col.cards[id]) return;
      const give = Math.min(n, col.cards[id]); if(give<=0) return;
      col.cards[id] -= give;
      if (col.cards[id] <= 0) delete col.cards[id];
      const cards = pd.cards||[];
      const ex = cards.find(x => x.id === id);
      if (ex) ex.qty = (ex.qty||0) + give; else cards.push({ id, qty:give });
      tx.update(_poolRef(), { cards });
      tx.update(_charRef(), { inventory: inv, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('deposerCarte:', e); toast('Dépôt impossible.'); }
}
async function prendreCarte(id, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const cards = pd.cards||[];
      const src = cards.find(x => x.id === id); if(!src) return;
      const take = Math.min(n, src.qty||0); if(take<=0) return;
      src.qty -= take;
      const inv = cd.inventory||[];
      let col = _colItem(inv);
      if (!col){ col = { name:'Collection de cartes', type:'STUFF', qty:1, w:0, equipped:false, collection:MTG_COL, cards:{} }; inv.push(col); }
      if (!col.cards) col.cards = {};
      col.cards[id] = (col.cards[id]||0) + take;
      tx.update(_poolRef(), { cards: cards.filter(x => (x.qty||0) > 0) });
      tx.update(_charRef(), { inventory: inv, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('prendreCarte:', e); toast('Retrait impossible.'); }
}

// ---- Dépôt (ma fiche → pool) ----
async function deposerItem(invIdx, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const inv = cd.inventory||[]; const it = inv[invIdx];
      if (!it || it.equipped) return;
      const give = Math.min(n, it.qty||1); if(give<=0) return;
      it.qty = (it.qty||1) - give;
      const items = pd.items||[];
      if (_isCont(it.name)) {
        for(let k=0;k<give;k++) items.push({ name:it.name, type:it.type, w:it.w||0, qty:1, water:it.water||0 });
      } else {
        const ex = items.find(x => x.name===it.name && x.type===it.type);
        if (ex) ex.qty = (ex.qty||0) + give; else items.push({ name:it.name, type:it.type, w:it.w||0, qty:give });
      }
      tx.update(_poolRef(), { items });
      tx.update(_charRef(), { inventory: inv.filter(x=>(x.qty||0)>0), lastUpdate: Date.now() });
    });
  } catch(e){ console.error('deposerItem:', e); toast('Dépôt impossible.'); }
}
async function deposerAmmo(cal, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const ammo = cd.ammo||[]; const src = ammo.find(a => a.cal===cal);
      if (!src) return;
      const give = Math.min(n, src.qty||0); if(give<=0) return;
      src.qty = (src.qty||0) - give;
      const pa = pd.ammo||[]; const ex = pa.find(a => a.cal===cal);
      if (ex) ex.qty = (ex.qty||0) + give; else pa.push({ cal, qty:give });
      tx.update(_poolRef(), { ammo: pa });
      tx.update(_charRef(), { ammo: ammo.filter(a=>(a.qty||0)>0), lastUpdate: Date.now() });
    });
  } catch(e){ console.error('deposerAmmo:', e); toast('Dépôt impossible.'); }
}
async function deposerCaps(n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const give = Math.min(n, cd.caps||0); if(give<=0) return;
      tx.update(_poolRef(), { caps: (pd.caps||0) + give });
      tx.update(_charRef(), { caps: (cd.caps||0) - give, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('deposerCaps:', e); toast('Dépôt impossible.'); }
}

// ---- Retrait (pool → ma fiche) ----
async function prendreItem(poolIdx, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const items = pd.items||[]; const loot = items[poolIdx]; if(!loot) return;
      const take = Math.min(n, loot.qty||1); if(take<=0) return;
      loot.qty = (loot.qty||1) - take;
      const inv = cd.inventory||[];
      if (_isCont(loot.name)) {
        for(let k=0;k<take;k++) inv.push({ name:loot.name, type:loot.type, w:loot.w||0, qty:1, water:loot.water||0, equipped:false });
      } else {
        const ex = inv.find(x => x.name===loot.name && x.type===loot.type && !x.equipped);
        if (ex) ex.qty = (ex.qty||1) + take; else inv.push({ name:loot.name, type:loot.type, w:loot.w||0, qty:take, equipped:false });
      }
      tx.update(_poolRef(), { items: items.filter(x=>(x.qty||0)>0) });
      tx.update(_charRef(), { inventory: inv, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('prendreItem:', e); toast('Retrait impossible.'); }
}
async function prendreAmmo(cal, n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const pa = pd.ammo||[]; const src = pa.find(a => a.cal===cal); if(!src) return;
      const take = Math.min(n, src.qty||0); if(take<=0) return;
      src.qty = (src.qty||0) - take;
      const ammo = cd.ammo||[]; const ex = ammo.find(a => a.cal===cal);
      if (ex) ex.qty = (ex.qty||0) + take; else ammo.push({ cal, qty:take });
      tx.update(_poolRef(), { ammo: pa.filter(a=>(a.qty||0)>0) });
      tx.update(_charRef(), { ammo, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('prendreAmmo:', e); toast('Retrait impossible.'); }
}
async function prendreCaps(n){
  n = Math.max(0, parseInt(n)||0); if(!n) return;
  try {
    await fdb.runTransaction(async tx => {
      const [pS, cS] = await Promise.all([tx.get(_poolRef()), tx.get(_charRef())]);
      if (!pS.exists) throw 'no-pool';
      const pd = pS.data(), cd = cS.data();
      const take = Math.min(n, pd.caps||0); if(take<=0) return;
      tx.update(_poolRef(), { caps: (pd.caps||0) - take });
      tx.update(_charRef(), { caps: (cd.caps||0) + take, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('prendreCaps:', e); toast('Retrait impossible.'); }
}

// ---- Rendu ----
function render(){
  const root = document.getElementById('ex-root'); if(!root) return;
  if (!viewerId){ root.innerHTML = '<div class="ex-empty">Vue joueur requise.</div>'; return; }
  if (!pool){
    root.innerHTML = '<div class="ex-empty">Aucun échange en cours.<br>'
      + 'Sur la carte, clique le jeton d\'un joueur proche → <b style="color:var(--am)">🔄 Proposer un échange</b>.'
      + (myParty ? '<br>Ou ouvre un pool avec tout ton groupe :' : '') + '</div>'
      + '<button class="ex-open-btn" onclick="ouvrirPool()">＋ Ouvrir un pool d\'échange'+(myParty?' (groupe)':'')+'</button>';
    return;
  }

  const isCreator = pool.creator === viewerId;
  // L'objet « Collection de cartes » est exclu : ses cartes s'échangent une par une (section Cartes)
  const inv  = (charData?.inventory||[]).map((it,idx)=>({it,idx})).filter(o => !o.it.equipped && (o.it.qty||0)>0 && o.it.collection !== MTG_COL);
  const myAmmo = (charData?.ammo||[]).filter(a => (a.qty||0)>0);
  const myCaps = charData?.caps||0;
  const myCards = _myCards();

  let h = '<div class="ex-head"><div class="ex-ginfo">🔄 '+esc(pool.partyName||'Groupe')
    + '<small>créé par '+esc(pool.creatorNom||'?')+' · '+(pool.members||[]).length+' membres</small></div>'
    + (isCreator
        ? '<button class="ex-act close" onclick="fermerPool()">✕ Fermer le pool</button>'
        : '<button class="ex-act leave" onclick="quitterPool()">↩ Quitter</button>')
    + '</div>';

  h += '<div class="ex-cols">';

  // --- Colonne POOL (zone commune) ---
  h += '<div class="ex-pool"><div class="ex-col-t">Zone commune</div>';
  const pItems = pool.items||[], pAmmo = pool.ammo||[], pCaps = pool.caps||0, pCards = pool.cards||[];
  if (!pItems.length && !pAmmo.length && !pCaps && !pCards.length){ h += '<div class="ex-mini">Vide — déposez du butin ➡</div>'; }
  pItems.forEach((it,i) => {
    const wc = _isCont(it.name) ? ' <span class="qt" style="color:#2a9d8f">💧'+(it.water||0)+'</span>' : '';
    h += '<div class="ex-line"><span class="nm">'+esc(it.name)+wc+'</span><span class="qt">x'+(it.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(it.qty||1)+'" value="1" id="pi-'+i+'">'
      + '<button onclick="prendreItem('+i+',document.getElementById(\'pi-'+i+'\').value)">Prendre</button></div>';
  });
  if (pAmmo.length){ h += '<div class="ex-sec">Munitions</div>'; }
  pAmmo.forEach((a,i) => {
    h += '<div class="ex-line"><span class="nm">▪ '+esc(a.cal)+'</span><span class="qt">x'+(a.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(a.qty||1)+'" value="1" id="pa-'+i+'">'
      + '<button onclick="prendreAmmo(\''+esc(a.cal)+'\',document.getElementById(\'pa-'+i+'\').value)">Prendre</button></div>';
  });
  if (pCards.length){ h += '<div class="ex-sec">🃏 Cartes</div>'; }
  pCards.forEach((c,i) => {
    const card = _mtgCard(c.id); if(!card) return;
    h += '<div class="ex-line"><span class="nm" style="color:'+(_RAR_COL[card.rarity]||'#ccc')+'" title="'+esc(card.name)+'">🃏 '+esc(card.name)+'</span><span class="qt">x'+(c.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(c.qty||1)+'" value="1" id="pcd-'+i+'">'
      + '<button onclick="prendreCarte(\''+c.id+'\',document.getElementById(\'pcd-'+i+'\').value)">Prendre</button></div>';
  });
  if (pCaps>0){
    h += '<div class="ex-caps">💰 <b>'+pCaps+'</b> caps <input type="number" min="1" max="'+pCaps+'" value="'+pCaps+'" id="pc-take" style="width:60px"><button onclick="prendreCaps(document.getElementById(\'pc-take\').value)" style="border:1px solid var(--gd);color:var(--g);background:none;font-family:monospace;font-size:8px;padding:2px 7px;cursor:pointer">Prendre</button></div>';
  }
  h += '</div>';

  // --- Colonne MOI (mon inventaire) ---
  h += '<div class="ex-mine"><div class="ex-col-t">Mon inventaire</div>';
  if (!inv.length && !myAmmo.length && !myCaps && !myCards.length){ h += '<div class="ex-mini">Rien à déposer</div>'; }
  inv.forEach(o => {
    const wc = _isCont(o.it.name) ? ' <span class="qt" style="color:#2a9d8f">💧'+(o.it.water||0)+'</span>' : '';
    h += '<div class="ex-line"><span class="nm">'+esc(o.it.name)+wc+'</span><span class="qt">x'+(o.it.qty||1)+'</span>'
      + '<input type="number" min="1" max="'+(o.it.qty||1)+'" value="1" id="mi-'+o.idx+'">'
      + '<button onclick="deposerItem('+o.idx+',document.getElementById(\'mi-'+o.idx+'\').value)">Déposer</button></div>';
  });
  if (myAmmo.length){ h += '<div class="ex-sec">Munitions</div>'; }
  myAmmo.forEach((a,i) => {
    h += '<div class="ex-line"><span class="nm">▪ '+esc(a.cal)+'</span><span class="qt">x'+(a.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(a.qty||1)+'" value="1" id="ma-'+i+'">'
      + '<button onclick="deposerAmmo(\''+esc(a.cal)+'\',document.getElementById(\'ma-'+i+'\').value)">Déposer</button></div>';
  });
  if (myCards.length){ h += '<div class="ex-sec">🃏 Ma collection ('+myCards.reduce((a,c)=>a+c.q,0)+')</div>'; }
  myCards.forEach((c,i) => {
    h += '<div class="ex-line"><span class="nm" style="color:'+(_RAR_COL[c.rarity]||'#ccc')+'" title="'+esc(c.name)+'">🃏 '+esc(c.name)+'</span><span class="qt">x'+c.q+'</span>'
      + '<input type="number" min="1" max="'+c.q+'" value="1" id="mcd-'+i+'">'
      + '<button onclick="deposerCarte(\''+c.id+'\',document.getElementById(\'mcd-'+i+'\').value)">Déposer</button></div>';
  });
  if (myCaps>0){
    h += '<div class="ex-caps">💰 <b>'+myCaps+'</b> caps <input type="number" min="1" max="'+myCaps+'" value="'+myCaps+'" id="mc-dep" style="width:60px"><button onclick="deposerCaps(document.getElementById(\'mc-dep\').value)" style="border:1px solid var(--gd);color:var(--g);background:none;font-family:monospace;font-size:8px;padding:2px 7px;cursor:pointer">Déposer</button></div>';
  }
  h += '</div>';

  h += '</div>';  // ex-cols
  if (isCreator) h += '<div class="ex-mini" style="margin-top:6px">À la fermeture, le butin restant te revient automatiquement.</div>';
  h += '<div id="ex-toast"></div>';
  root.innerHTML = h;
}
