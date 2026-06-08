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

document.addEventListener('DOMContentLoaded', () => {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  if (!viewerId) { render(); return; }

  // Mon groupe (temps/data)
  fdb.collection('temps').doc('data').onSnapshot(s => {
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

function subscribePool(){
  if (_poolUnsub){ _poolUnsub(); _poolUnsub = null; }
  if (!myParty){ pool = null; return; }
  _poolUnsub = fdb.collection('poolsEchange').doc(myParty.id).onSnapshot(s => {
    pool = s.exists ? s.data() : null;
    render();
  });
}

function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toast(msg){ const t=document.getElementById('ex-toast'); if(!t)return; t.textContent=msg; t.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',2200); }

const _poolRef = () => fdb.collection('poolsEchange').doc(myParty.id);
const _charRef = () => fdb.collection('joueurs').doc(viewerId);

// ---- Ouvrir / fermer / quitter ----
async function ouvrirPool(){
  if (!myParty) return;
  await _poolRef().set({
    creator: viewerId,
    creatorNom: charData?.nom || viewerId,
    partyId: myParty.id,
    partyName: myParty.name || 'Groupe',
    members: (myParty.players||[]).slice(),
    items: [], ammo: [], caps: 0,
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
        const ex = inv.find(x => x.name===it.name && x.type===it.type && !x.equipped);
        if (ex) ex.qty = (ex.qty||1) + (it.qty||0);
        else inv.push({ name:it.name, type:it.type, w:it.w||0, qty:it.qty||0, equipped:false });
      });
      (pool.ammo||[]).forEach(a => {
        const ex = ammo.find(x => x.cal===a.cal);
        if (ex) ex.qty = (ex.qty||0) + (a.qty||0);
        else ammo.push({ cal:a.cal, qty:a.qty||0 });
      });
      const caps = (cd.caps||0) + (pool.caps||0);
      tx.update(_charRef(), { inventory: inv, ammo, caps, lastUpdate: Date.now() });
    });
  } catch(e){ console.error('fermerPool:', e); }
  await _poolRef().delete().catch(()=>{});
  _leave();
}

function quitterPool(){ _leave(); }
function _leave(){
  if (embed && window.parent) window.parent.postMessage('echange-close','*');
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
      const ex = items.find(x => x.name===it.name && x.type===it.type);
      if (ex) ex.qty = (ex.qty||0) + give; else items.push({ name:it.name, type:it.type, w:it.w||0, qty:give });
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
      const ex = inv.find(x => x.name===loot.name && x.type===loot.type && !x.equipped);
      if (ex) ex.qty = (ex.qty||1) + take; else inv.push({ name:loot.name, type:loot.type, w:loot.w||0, qty:take, equipped:false });
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
  if (!myParty){
    root.innerHTML = '<div class="ex-empty">Tu n\'es pas dans un groupe.<br>Rejoins un groupe (via le MJ ou la carte) pour ouvrir un pool d\'échange.</div>';
    return;
  }
  if (!pool){
    root.innerHTML = '<div class="ex-empty">Aucun pool d\'échange ouvert pour <b style="color:var(--am)">'+esc(myParty.name||'ton groupe')+'</b>.</div>'
      + '<button class="ex-open-btn" onclick="ouvrirPool()">＋ Ouvrir un pool d\'échange</button>';
    return;
  }

  const isCreator = pool.creator === viewerId;
  const inv  = (charData?.inventory||[]).map((it,idx)=>({it,idx})).filter(o => !o.it.equipped && (o.it.qty||0)>0);
  const myAmmo = (charData?.ammo||[]).filter(a => (a.qty||0)>0);
  const myCaps = charData?.caps||0;

  let h = '<div class="ex-head"><div class="ex-ginfo">🔄 '+esc(pool.partyName||'Groupe')
    + '<small>créé par '+esc(pool.creatorNom||'?')+' · '+(pool.members||[]).length+' membres</small></div>'
    + (isCreator
        ? '<button class="ex-act close" onclick="fermerPool()">✕ Fermer le pool</button>'
        : '<button class="ex-act leave" onclick="quitterPool()">↩ Quitter</button>')
    + '</div>';

  h += '<div class="ex-cols">';

  // --- Colonne POOL (zone commune) ---
  h += '<div class="ex-pool"><div class="ex-col-t">Zone commune</div>';
  const pItems = pool.items||[], pAmmo = pool.ammo||[], pCaps = pool.caps||0;
  if (!pItems.length && !pAmmo.length && !pCaps){ h += '<div class="ex-mini">Vide — déposez du butin ➡</div>'; }
  pItems.forEach((it,i) => {
    h += '<div class="ex-line"><span class="nm">'+esc(it.name)+'</span><span class="qt">x'+(it.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(it.qty||1)+'" value="1" id="pi-'+i+'">'
      + '<button onclick="prendreItem('+i+',document.getElementById(\'pi-'+i+'\').value)">Prendre</button></div>';
  });
  if (pAmmo.length){ h += '<div class="ex-sec">Munitions</div>'; }
  pAmmo.forEach((a,i) => {
    h += '<div class="ex-line"><span class="nm">▪ '+esc(a.cal)+'</span><span class="qt">x'+(a.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(a.qty||1)+'" value="1" id="pa-'+i+'">'
      + '<button onclick="prendreAmmo(\''+esc(a.cal)+'\',document.getElementById(\'pa-'+i+'\').value)">Prendre</button></div>';
  });
  if (pCaps>0){
    h += '<div class="ex-caps">💰 <b>'+pCaps+'</b> caps <input type="number" min="1" max="'+pCaps+'" value="'+pCaps+'" id="pc-take" style="width:60px"><button onclick="prendreCaps(document.getElementById(\'pc-take\').value)" style="border:1px solid var(--gd);color:var(--g);background:none;font-family:monospace;font-size:8px;padding:2px 7px;cursor:pointer">Prendre</button></div>';
  }
  h += '</div>';

  // --- Colonne MOI (mon inventaire) ---
  h += '<div class="ex-mine"><div class="ex-col-t">Mon inventaire</div>';
  if (!inv.length && !myAmmo.length && !myCaps){ h += '<div class="ex-mini">Rien à déposer</div>'; }
  inv.forEach(o => {
    h += '<div class="ex-line"><span class="nm">'+esc(o.it.name)+'</span><span class="qt">x'+(o.it.qty||1)+'</span>'
      + '<input type="number" min="1" max="'+(o.it.qty||1)+'" value="1" id="mi-'+o.idx+'">'
      + '<button onclick="deposerItem('+o.idx+',document.getElementById(\'mi-'+o.idx+'\').value)">Déposer</button></div>';
  });
  if (myAmmo.length){ h += '<div class="ex-sec">Munitions</div>'; }
  myAmmo.forEach((a,i) => {
    h += '<div class="ex-line"><span class="nm">▪ '+esc(a.cal)+'</span><span class="qt">x'+(a.qty||0)+'</span>'
      + '<input type="number" min="1" max="'+(a.qty||1)+'" value="1" id="ma-'+i+'">'
      + '<button onclick="deposerAmmo(\''+esc(a.cal)+'\',document.getElementById(\'ma-'+i+'\').value)">Déposer</button></div>';
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
