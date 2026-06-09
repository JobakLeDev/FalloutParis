// ============================================================
// BOUTIQUE / MARCHAND — Firebase /boutiques/data { shops:{ [id]:shop } }
// shop = { id, name, markup, items:[{id,name,type,cat,r,w,qty,base,unit?}], openFor:[] }
// Joueur (?id=&shop=) : achète (−caps, +inventaire) / vend (+caps, −inventaire).
// Prix modulés par Charisme + compétence Troc (barter). Stock auto par rareté (MJ).
// ============================================================
const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');
const shopId   = _params.get('shop') || 'mj';
const embed    = _params.get('embed') === '1';

let fdb, shop = null, me = null, curTab = 'buy';

const RARITY_BASE = { 1:8, 2:20, 3:55, 4:150, 5:420 };
const CAT_FACTOR  = { WEAPON:3, ARMOR:2.5, POWERARMOR:6, CLOTHING:1.4, OUTFIT:1.8, FOOD:0.5, DRINK:0.5, DRINKS:0.5, DRUGS:1.3, AMMO:0.4, STUFF:1, MISC:1 };
const CAT_ICON    = { weapons:'🔫', armor:'🛡', ammo:'▪', food:'🍖', drinks:'🥤', drugs:'💊', stuff:'🔧',
                      WEAPON:'🔫', ARMOR:'🛡', POWERARMOR:'🛡', CLOTHING:'👕', OUTFIT:'👕', AMMO:'▪', FOOD:'🍖', DRINK:'🥤', DRUGS:'💊', STUFF:'🔧' };

function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// Info-bulle flottante au survol (échappe au clipping de .sh-pane, gère le zoom du body)
let _shTip;
function _shTipShow(row){
  const tip = row.getAttribute('data-tip'); if(!tip) return;
  if(!_shTip){ _shTip = document.createElement('div'); _shTip.id = 'sh-tip'; document.body.appendChild(_shTip); }
  _shTip.textContent = tip;
  const z = window.__fpZoom || 1;
  const r = row.getBoundingClientRect();   // coords visuelles → /zoom pour le position:fixed
  _shTip.style.display = 'block';
  _shTip.style.left = (r.left / z + 8) + 'px';
  _shTip.style.top  = (r.bottom / z + 3) + 'px';
}
function _shTipHide(){ if(_shTip) _shTip.style.display = 'none'; }
document.addEventListener('mouseover', e => { const row = e.target.closest?.('.sh-row[data-tip]'); if(row) _shTipShow(row); });
document.addEventListener('mouseout',  e => { if(e.target.closest?.('.sh-row[data-tip]')) _shTipHide(); });

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
let _toastT;
function toast(msg, err){ const el=document.getElementById('sh-toast'); if(!el) return; el.textContent=msg; el.className='on'+(err?' err':''); clearTimeout(_toastT); _toastT=setTimeout(()=>el.className='',2600); }

// ---- Prix ----
function factorFor(item){ return CAT_FACTOR[item.type] || CAT_FACTOR[(item.cat||'').toUpperCase()] || 1; }
function rarityOf(item){
  if(item.r) return item.r;
  const DBs = window.DB || {};
  const all = [...(DBs.weapons||[]),...(DBs.armor||[]),...(DBs.food||[]),...(DBs.drinks||[]),...(DBs.drugs||[]),...(DBs.stuff||[])];
  const f = all.find(d => d.n === item.name); return (f && f.r) || 3;
}
function baseOf(item){ return (item.base != null) ? item.base : Math.round((RARITY_BASE[rarityOf(item)]||50) * factorFor(item)); }
function barterScore(){ return ((me?.special?.C)||5) + ((me?.skills?.barter)||0); }
function buyMult(){ return Math.max(0.70, Math.min(1.25, 1.25 - 0.03 * barterScore())); }
function sellMult(){ return Math.max(0.30, Math.min(0.70, 0.30 + 0.03 * barterScore())); }
function buyPrice(item){ return Math.max(1, Math.round(baseOf(item) * (shop?.markup||1) * buyMult())); }
function sellPrice(item){ return Math.max(1, Math.round(baseOf(item) * sellMult())); }

// ---- Reconstruit un objet d'inventaire (cf. butin.js) ----
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

document.addEventListener('DOMContentLoaded', () => {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  (window.DB_READY || Promise.resolve()).then(start);
});
function start(){
  fdb.collection('boutiques').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    shop = (d.shops && d.shops[shopId]) || null;
    render();
  }, e => console.warn('boutiques:', e && e.code));
  if (viewerId) fdb.collection('joueurs').doc(viewerId).onSnapshot(s => { me = s.exists ? s.data() : null; render(); });
}

function swShop(tab){
  curTab = tab;
  document.getElementById('tab-buy').classList.toggle('on', tab==='buy');
  document.getElementById('tab-sell').classList.toggle('on', tab==='sell');
  document.getElementById('sh-buy').style.display  = tab==='buy' ? 'flex' : 'none';
  document.getElementById('sh-sell').style.display = tab==='sell' ? 'flex' : 'none';
}

function render(){
  const nm = document.getElementById('sh-name'); if (nm) nm.textContent = shop?.name || 'Boutique';
  const cp = document.getElementById('sh-caps'); if (cp) cp.textContent = (me?.caps||0).toLocaleString('fr-FR');
  const bt = document.getElementById('sh-barter');
  if (bt) bt.innerHTML = `Marchandage — Charisme <b>${(me?.special?.C)||5}</b> + Troc <b>${(me?.skills?.barter)||0}</b> · achat ×<b>${buyMult().toFixed(2)}</b>, revente <b>${Math.round(sellMult()*100)}%</b> de la valeur`;
  renderBuy(); renderSell();
}

function renderBuy(){
  const el = document.getElementById('sh-buy'); if (!el) return;
  if (!shop){ el.innerHTML = '<div class="sh-empty">Boutique introuvable ou fermée.</div>'; return; }
  const items = (shop.items||[]).filter(it => (it.qty||0) > 0);
  if (!items.length){ el.innerHTML = '<div class="sh-empty">Le marchand n\'a plus rien à vendre.</div>'; return; }
  const caps = me?.caps || 0;
  el.innerHTML = items.map(it => {
    const price = buyPrice(it);
    const can = !!viewerId && caps >= price;
    const unit = (it.cat==='ammo'||it.type==='AMMO') && it.unit>1 ? ` <small>(×${it.unit})</small>` : '';
    const tip = esc(itemTip(it.name)||'');
    return `<div class="sh-row"${tip?` data-tip="${tip}"`:''}>
      <span class="sh-ic">${CAT_ICON[it.cat]||CAT_ICON[it.type]||'▪'}</span>
      <span class="sh-nom">${esc(it.name)}${unit}<small> · r${rarityOf(it)}</small></span>
      <span class="sh-qty">stock ${it.qty}</span>
      <span class="sh-price">${price}</span>
      ${viewerId ? `<button class="sh-act" onclick="buy('${it.id}')" ${can?'':'disabled'}>Acheter</button>` : '<span class="sh-qty">—</span>'}
    </div>`;
  }).join('');
}

function renderSell(){
  const el = document.getElementById('sh-sell'); if (!el) return;
  if (!viewerId){ el.innerHTML = '<div class="sh-empty">—</div>'; return; }
  const inv = (me?.inventory||[]).filter(it => !it.equipped && (it.qty||1) > 0);
  if (!inv.length){ el.innerHTML = '<div class="sh-empty">Rien à vendre (les objets équipés ne sont pas vendables).</div>'; return; }
  el.innerHTML = inv.map((it, idx) => {
    const i = me.inventory.indexOf(it);
    const price = sellPrice(it);
    const tip = esc(itemTip(it.name)||'');
    return `<div class="sh-row"${tip?` data-tip="${tip}"`:''}>
      <span class="sh-ic">${CAT_ICON[it.type]||'🔧'}</span>
      <span class="sh-nom">${esc(it.name)}${it.qty>1?` <small>×${it.qty}</small>`:''}</span>
      <span class="sh-price">${price}</span>
      <button class="sh-act sell" onclick="sell(${i})">Vendre</button>
    </div>`;
  }).join('');
}

// ---- Achat ----
async function buy(itemId){
  if (!viewerId || !shop) return;
  const pref = fdb.collection('joueurs').doc(viewerId);
  const bref = fdb.collection('boutiques').doc('data');
  let ps, bs;
  try { [ps, bs] = await Promise.all([pref.get(), bref.get()]); } catch(e){ toast('Erreur réseau', true); return; }
  const pd = ps.exists ? ps.data() : {};
  const bd = bs.exists ? bs.data() : { shops:{} };
  const sh = bd.shops && bd.shops[shopId]; if (!sh){ toast('Boutique fermée', true); return; }
  const sit = (sh.items||[]).find(x => x.id === itemId);
  if (!sit || (sit.qty||0) <= 0){ toast('Article épuisé', true); return; }
  const price = buyPrice(sit);
  const caps = pd.caps || 0;
  if (caps < price){ toast('Pas assez de caps', true); return; }
  // débit stock
  sit.qty = (sit.qty||1) - 1;
  sh.items = (sh.items||[]).filter(x => (x.qty||0) > 0);
  // crédit joueur
  const upd = { caps: caps - price, lastUpdate: Date.now() };
  if (sit.cat==='ammo' || sit.type==='AMMO'){
    const ammo = Array.isArray(pd.ammo) ? pd.ammo : [];
    const n = sit.unit || 1;
    const ex = ammo.find(a => a.cal === sit.name); if (ex) ex.qty = (ex.qty||0)+n; else ammo.push({ cal: sit.name, qty: n });
    upd.ammo = ammo;
  } else {
    const inv = Array.isArray(pd.inventory) ? pd.inventory : [];
    const it = buildInvItem(sit.name) || { name: sit.name, type: sit.type||'STUFF', qty:0, w: sit.w||0, equipped:false };
    const ex = inv.find(x => x.name===it.name && x.type===it.type); if (ex) ex.qty = (ex.qty||1)+1; else { it.qty=1; inv.push(it); }
    upd.inventory = inv;
  }
  try { await pref.update(upd); await bref.set(bd); toast('Acheté : ' + sit.name + ' (−' + price + ' caps)'); }
  catch(e){ console.error(e); toast('Échec de l\'achat', true); }
}

// ---- Vente ----
async function sell(invIdx){
  if (!viewerId) return;
  const pref = fdb.collection('joueurs').doc(viewerId);
  const bref = fdb.collection('boutiques').doc('data');
  let ps, bs;
  try { [ps, bs] = await Promise.all([pref.get(), bref.get()]); } catch(e){ toast('Erreur réseau', true); return; }
  const pd = ps.exists ? ps.data() : {};
  const inv = Array.isArray(pd.inventory) ? pd.inventory : [];
  const it = inv[invIdx];
  if (!it || it.equipped || (it.qty||0) <= 0){ toast('Objet indisponible', true); return; }
  const price = sellPrice(it);
  it.qty = (it.qty||1) - 1;
  const sold = { name: it.name, type: it.type, w: it.w||0 };
  const cleanInv = inv.filter(x => (x.qty||0) > 0);
  // crédit caps
  const upd = { inventory: cleanInv, caps: (pd.caps||0) + price, lastUpdate: Date.now() };
  // l'objet rejoint le stock du marchand
  const bd = bs.exists ? bs.data() : { shops:{} };
  const sh = bd.shops && bd.shops[shopId];
  if (sh){
    sh.items = sh.items || [];
    const ex = sh.items.find(x => x.name===sold.name && x.type===sold.type);
    if (ex) ex.qty = (ex.qty||0)+1;
    else sh.items.push({ id:'s'+Date.now().toString(36)+Math.floor(Math.random()*999), name:sold.name, type:sold.type, cat:'stuff', w:sold.w, qty:1, base:baseOf({name:sold.name,type:sold.type}) });
  }
  try {
    await pref.update(upd);
    if (sh) await bref.set(bd);
    toast('Vendu : ' + sold.name + ' (+' + price + ' caps)');
  } catch(e){ console.error(e); toast('Échec de la vente', true); }
}
