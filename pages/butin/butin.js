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
  if (type==='POWERARMOR_FRAME') { item.slots={head:null,torso:null,armL:null,armR:null,legL:null,legR:null}; item.core=false; }
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

// Reconnaît un objet du pool sans dépendre de sa position ni de l'ordre de ses champs.
function _lootKey(l){ return [l.cat,l.name,l.type,l.postcard,l.mtgcard,l.booster].join('|'); }

// Ajoute un objet du pool à l'inventaire ou aux munitions (tableaux modifiés sur place).
function _ajouterLoot(inv, ammo, loot){
  const n = loot.qty || 1;
  if (loot.cat === 'ammo'){
    const ex = ammo.find(a => a.cal === loot.name);
    if (ex) ex.qty = (ex.qty||0) + n; else ammo.push({ cal: loot.name, qty: n });
    return;
  }
  const item = buildInvItem(loot.name) || { name: loot.name, type: loot.type||'STUFF', qty:0, w: loot.w||0, equipped:false };
  if(loot.postcard) item.postcard = loot.postcard;   // carte postale → image affichable
  if(loot.mtgcard) item.mtgcard = loot.mtgcard;      // carte MTG → image affichable
  if(loot.booster) item.booster = loot.booster;      // booster scellé → ouvrable par le joueur
  if(item.type==='POWERARMOR_FRAME'){
    // On entre dans la frame, pas dans la poche
    inv.forEach(it=>{ if(it.type==='POWERARMOR_FRAME') it.equipped=false; });
    item.qty=1; item.equipped=true; inv.push(item);
  } else {
    const ex = inv.find(it => it.name === item.name && it.type === item.type);
    if (ex) ex.qty = (ex.qty||1) + n; else { item.qty = n; inv.push(item); }
  }
}

// Transfert pool → fiche en UNE transaction : deux joueurs qui cliquent en même temps
// ne peuvent plus obtenir le même objet (Firestore rejoue la fonction sur les données
// à jour). choisir(pool, caps) renvoie { pris:[objets du pool], caps:n }.
async function _transfererButin(choisir){
  const butinRef = fdb.collection('butin').doc(fpCampId());
  const joueurRef = fdb.collection('joueurs').doc(viewerId);
  let refus = null;
  try {
    await fdb.runTransaction(async tx => {
      refus = null;   // la fonction peut être rejouée
      const [bS, jS] = await Promise.all([tx.get(butinRef), tx.get(joueurRef)]);
      if (!jS.exists) { refus = 'Fiche joueur introuvable.'; return; }
      const b = bS.exists ? bS.data() : {};
      if (!(b.players||[]).includes(viewerId)) { refus = 'Ce butin ne t\'est plus accessible.'; return; }
      const pool = Array.isArray(b.items) ? b.items : [];
      const { pris, caps } = choisir(pool, b.caps||0);
      if (!pris.length && !caps) { refus = 'Déjà pris par un autre joueur.'; return; }
      const d = jS.data();
      const upd = { lastUpdate: Date.now() };
      if (pris.length){
        upd.inventory = Array.isArray(d.inventory) ? d.inventory : [];
        upd.ammo = Array.isArray(d.ammo) ? d.ammo : [];
        pris.forEach(l => _ajouterLoot(upd.inventory, upd.ammo, l));
      }
      if (caps) upd.caps = (d.caps||0) + caps;
      tx.update(joueurRef, upd);
      tx.update(butinRef, { items: pool.filter(l => !pris.includes(l)), caps: (b.caps||0) - caps });
    });
  } catch(e){ console.error('butin:', e); alert('Erreur Firebase'); return; }
  if (refus) alert(refus);
}

const _enCours = new Set();   // un double-clic ne lance pas deux transactions sur le même objet

async function prendre(i){
  const vise = bData.items[i];
  if (!viewerId || !vise) return;
  const cle = _lootKey(vise);
  if (_enCours.has(cle)) return;
  _enCours.add(cle);
  try {
    await _transfererButin(pool => {
      // L'index a pu glisser si un autre joueur a pris un objet entre-temps.
      const l = (pool[i] && _lootKey(pool[i]) === cle) ? pool[i] : pool.find(x => _lootKey(x) === cle);
      return { pris: l ? [l] : [], caps: 0 };
    });
  } finally { _enCours.delete(cle); }
}

// Le joueur réclame la totalité des caps du pool
async function prendreCaps(){
  if (!viewerId || !(bData.caps>0)) return;
  await _transfererButin((pool, caps) => ({ pris: [], caps }));
}

// Le joueur récupère TOUT le pool (objets + munitions + caps) en une fois
async function prendreTout(){
  if (!viewerId) return;
  if (!(bData.players||[]).includes(viewerId)) return;
  if (!(bData.items||[]).length && !(bData.caps>0)) return;
  if (!await fpConfirm('Tout récupérer (objets, munitions et caps) ?')) return;
  await _transfererButin((pool, caps) => ({ pris: pool.slice(), caps }));
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
