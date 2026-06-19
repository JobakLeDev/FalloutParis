// ============================================================
// BUTIN PARTAGÉ — vue + réclamation (Firebase /butin/data)
// MJ génère le pool depuis l'écran MJ. Joueur (?id) prend un objet → va
// dans son inventaire (ou ses munitions) et quitte le pool.
// ============================================================

const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const embed    = _params.get('embed') === '1';

let fdb;
let bData = { items: [], caps: 0 };
const CAT_ICON = { weapons:'🔫', armor:'🛡', ammo:'▪', food:'🍖', drinks:'🥤', drugs:'💊', stuff:'🔧' };

document.addEventListener('DOMContentLoaded', () => {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  const m = document.getElementById('bhdr-mode'); if (m) m.textContent = viewerId ? 'Vue joueur' : 'Vue MJ (lecture)';
  fdb.collection('butin').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    bData = { items: Array.isArray(d.items) ? d.items : [], caps: d.caps || 0, players: Array.isArray(d.players) ? d.players : [] };
    render();
  });
  window.addEventListener('message', e => { if (e.data === 'butin-refresh') render(); });
});

function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Reconstruit un objet d'inventaire au format fiche (cf. fiche_perso addItemFromSel)
function buildInvItem(name){
  const DBs = window.DB || {};
  const all = [...(DBs.weapons||[]),...(DBs.armor||[]),...(DBs.food||[]),...(DBs.drinks||[]),...(DBs.drugs||[]),...(DBs.stuff||[])];
  const db = all.find(d => d.n === name);
  if (!db) return null;
  let type = 'STUFF';
  if ((DBs.weapons||[]).find(d=>d.n===name)) type='WEAPON';
  else if ((DBs.armor||[]).find(d=>d.n===name)) type = db.t || 'ARMOR';
  else if ((DBs.food||[]).find(d=>d.n===name)) type='FOOD';
  else if ((DBs.drinks||[]).find(d=>d.n===name)) type='DRINK';
  else if ((DBs.drugs||[]).find(d=>d.n===name)) type='DRUGS';
  const item = { name, type, qty:1, w: db.w||0, equipped:false };
  if (type==='ARMOR'||type==='POWERARMOR') item.zone = db.z||'';
  if (type==='WEAPON') item.persoBonus = false;
  return item;
}

// Texte d'info (survol) décrivant ce que fait un objet, d'après les DB
function itemTip(name){
  const DBs = window.DB || {}; let d;
  const fx = e => (e && e!=='—' && e!=='–') ? e : '';
  if ((d=(DBs.weapons||[]).find(x=>x.n===name))) return `${d.t||'Arme'} · ${d.dmg||''} dégâts${fx(d.eff)?' · '+fx(d.eff):''}${d.a&&d.a!=='-'?' · munition '+d.a:''}`;
  if ((d=(DBs.armor||[]).find(x=>x.n===name)))  return `Armure ${d.z||''} · Phys ${d.ph||0} / Énergie ${d.en||0}${d.rad?' / Rad '+d.rad:''}`;
  if ((d=(DBs.food||[]).find(x=>x.n===name)))   return `Nourriture · +${d.hp||0} PV${fx(d.eff)?' · '+fx(d.eff):''}${d.rad?' · irradié '+d.rad:''}`;
  if ((d=(DBs.drinks||[]).find(x=>x.n===name))) return `Boisson · +${d.hp||0} PV${fx(d.eff)?' · '+fx(d.eff):''}${d.rad?' · irradié '+d.rad:''}`;
  if ((d=(DBs.drugs||[]).find(x=>x.n===name)))  return `Chem · ${fx(d.eff)||''}${d.dur?' ('+d.dur+')':''}${d.add?' · addictif':''}`;
  if ((d=(DBs.stuff||[]).find(x=>x.n===name)))  return fx(d.eff);
  return '';
}

async function prendre(i){
  if (!viewerId) return;
  const loot = bData.items[i]; if (!loot) return;
  const ref = fdb.collection('joueurs').doc(viewerId);
  let snap;
  try { snap = await ref.get(); } catch(e){ alert('Erreur Firebase'); return; }
  if (!snap.exists) { alert('Fiche joueur introuvable.'); return; }
  const d = snap.data();
  const n = loot.qty || 1;
  if (loot.cat === 'ammo'){
    const ammo = Array.isArray(d.ammo) ? d.ammo : [];
    const ex = ammo.find(a => a.cal === loot.name);
    if (ex) ex.qty = (ex.qty||0) + n; else ammo.push({ cal: loot.name, qty: n });
    await ref.update({ ammo, lastUpdate: Date.now() });
  } else {
    const inv = Array.isArray(d.inventory) ? d.inventory : [];
    const item = buildInvItem(loot.name) || { name: loot.name, type: loot.type||'STUFF', qty:0, w: loot.w||0, equipped:false };
    const ex = inv.find(it => it.name === item.name && it.type === item.type);
    if (ex) ex.qty = (ex.qty||1) + n; else { item.qty = n; inv.push(item); }
    await ref.update({ inventory: inv, lastUpdate: Date.now() });
  }
  // retirer du pool
  bData.items.splice(i, 1);
  await fdb.collection('butin').doc(fpCampId()).set(bData);
}

// Le joueur réclame la totalité des caps du pool
async function prendreCaps(){
  if (!viewerId || !(bData.caps>0)) return;
  const ref = fdb.collection('joueurs').doc(viewerId);
  let snap;
  try { snap = await ref.get(); } catch(e){ alert('Erreur Firebase'); return; }
  if (!snap.exists) { alert('Fiche joueur introuvable.'); return; }
  const d = snap.data();
  const gain = bData.caps||0;
  await ref.update({ caps: (d.caps||0) + gain, lastUpdate: Date.now() });
  bData.caps = 0;
  await fdb.collection('butin').doc(fpCampId()).set(bData);
}

// Le joueur récupère TOUT le pool (objets + munitions + caps) en une fois
async function prendreTout(){
  if (!viewerId) return;
  if (!(bData.players||[]).includes(viewerId)) return;
  const items = bData.items || [];
  if (!items.length && !(bData.caps>0)) return;
  if (!confirm('Tout récupérer (objets, munitions et caps) ?')) return;
  const ref = fdb.collection('joueurs').doc(viewerId);
  let snap;
  try { snap = await ref.get(); } catch(e){ alert('Erreur Firebase'); return; }
  if (!snap.exists) { alert('Fiche joueur introuvable.'); return; }
  const d = snap.data();
  const ammo = Array.isArray(d.ammo) ? d.ammo : [];
  const inv  = Array.isArray(d.inventory) ? d.inventory : [];
  items.forEach(loot => {
    const n = loot.qty || 1;
    if (loot.cat === 'ammo'){
      const ex = ammo.find(a => a.cal === loot.name);
      if (ex) ex.qty = (ex.qty||0) + n; else ammo.push({ cal: loot.name, qty: n });
    } else {
      const item = buildInvItem(loot.name) || { name: loot.name, type: loot.type||'STUFF', qty:0, w: loot.w||0, equipped:false };
      const ex = inv.find(it => it.name === item.name && it.type === item.type);
      if (ex) ex.qty = (ex.qty||1) + n; else { item.qty = n; inv.push(item); }
    }
  });
  await ref.update({ ammo, inventory: inv, caps: (d.caps||0) + (bData.caps||0), lastUpdate: Date.now() });
  bData.items = []; bData.caps = 0;
  await fdb.collection('butin').doc(fpCampId()).set(bData);
}

function render(){
  const caps = document.getElementById('b-caps');
  if (caps){
    const access = viewerId && (bData.players||[]).includes(viewerId);
    caps.innerHTML = `💰 <b>${bData.caps||0}</b> caps`
      + ((access && bData.caps>0) ? ' <button class="b-take" onclick="prendreCaps()">Prendre</button>' : '');
  }
  const el = document.getElementById('butin-list'); if (!el) return;
  // Gate d'accès : un joueur ne voit le pool que s'il est autorisé (players)
  if (viewerId && !(bData.players||[]).includes(viewerId)){ el.innerHTML = '<div class="b-empty">Aucun butin accessible pour l\'instant.</div>'; return; }
  const items = bData.items || [];
  if (!items.length){ el.innerHTML = '<div class="b-empty">Le pool de butin est vide. Le MJ le remplit en fouillant.</div>'; return; }
  // Bouton « Tout prendre » (joueur autorisé, s'il reste qqch)
  const toutBtn = (viewerId && (items.length || bData.caps>0))
    ? `<div class="b-tout-row"><button class="b-take b-tout" onclick="prendreTout()">⤓ Tout prendre</button></div>` : '';
  el.innerHTML = toutBtn + items.map((it,i) =>
    `<div class="b-row">
      <span class="b-cat">${CAT_ICON[it.cat]||'▪'}</span>
      <span class="b-nom" title="${esc(itemTip(it.name)||'')}">${esc(it.name)}${it.qty>1?` <b>×${it.qty}</b>`:''}</span>
      ${viewerId ? `<button class="b-take" onclick="prendre(${i})">Prendre</button>` : '<span class="b-mjnote">— MJ —</span>'}
    </div>`
  ).join('') + (viewerId ? '' : '<div class="b-empty" style="padding:10px">Gère le pool depuis l\'écran MJ (panneau Butin / Fouille).</div>');
}
