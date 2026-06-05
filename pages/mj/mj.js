const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
// firebaseConfig, XP_TABLE définis dans common/shared.js
const db = firebase.initializeApp(firebaseConfig).firestore();

let joueurs = {};
let selected = new Set();

// ============================================================
// TABLES DE RENCONTRES
// Zones, variations, occupation, menace, factions → chargés via db.js.
// Moteur (resolveZonePool, rollEncounter, generateFactionUnit) dans zones.js.
// ============================================================
const VARIATION_LABELS = {irradiated:'Irradiée', abandoned:'Abandonnée', occupied:'Occupée', dark:'Sombre', flooded:'Inondée'};
const THREAT_LABELS    = {calme:'Calme', normal:'Normal', eleve:'Élevé', extreme:'Extrême'};
const OCC_LABELS       = {neutral:'Neutre'};
const THREAT_DANGER    = {calme:1, normal:2, eleve:3, extreme:4};

// ENNEMIS_DB / FACTIONS / ZONES_DB… définis via mj_shared.js + common/db.js

const EVENEMENTS_DEPLACEMENT = [
  {pct:40, type:'calme',    label:'Calme',      desc:'Le groupe se déplace sans encombre.'},
  {pct:20, type:'combat',   label:'Combat !',   desc:'Rencontre hostile sur la route.'},
  {pct:15, type:'piege',    label:'Piège',      desc:'Zone piégée. Test PER+Discrétion D2 pour éviter.'},
  {pct:10, type:'ressource',label:'Ressource',  desc:'Le groupe trouve des ressources en chemin.'},
  {pct:10, type:'pnj',      label:'Rencontre PNJ', desc:'Un personnage non-hostile croise la route du groupe.'},
  {pct:5,  type:'danger',   label:'Grand danger !', desc:'Menace majeure. Ennemi puissant ou situation critique.'},
];

// ============================================================
// LOCK
// ============================================================
document.getElementById('lock-inp').addEventListener('keydown', e => { if(e.key==='Enter') unlock(); });
function unlock(){
  if(document.getElementById('lock-inp').value === MJ_CODE){
    sessionStorage.setItem('mj_auth','1');
    document.getElementById('lock').style.display='none';
    document.getElementById('app').style.display='grid';
    window.DB_READY.then(startSync);
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-inp').value='';
  }
}

// Auto-déverrouiller si déjà authentifié
if(sessionStorage.getItem('mj_auth')==='1'){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='grid';
  window.DB_READY.then(startSync);
}

// ============================================================
// SYNC
// ============================================================
// Remplit les sélecteurs zone / occupation / variation / menace depuis les DB
function populateZoneSelectors(){
  const set = (id, html) => { const el=document.getElementById(id); if(el) el.innerHTML=html; };
  set('zone-sel', Object.entries(window.ZONES_DB||{}).map(([k,v])=>`<option value="${k}">${v.label||k}</option>`).join(''));
  set('occ-sel', Object.keys(window.ZONE_OCCUPATION||{}).map(k=>{
    const lbl = window.FACTIONS?.[k]?.label || OCC_LABELS[k] || k;
    return `<option value="${k}"${k==='neutral'?' selected':''}>${lbl}</option>`;
  }).join(''));
  set('var-sel', '<option value="">Aucune variation</option>'+Object.keys(window.ZONE_VARIATIONS||{}).map(k=>`<option value="${k}">${VARIATION_LABELS[k]||k}</option>`).join(''));
  set('threat-sel', Object.keys(window.ZONE_THREAT||{}).map(k=>`<option value="${k}"${k==='normal'?' selected':''}>${THREAT_LABELS[k]||k}</option>`).join(''));
  // Pré-sélection depuis l'URL (depuis la carte : ?zone=metro&occ=republique&var=irradiated&threat=normal)
  const p = new URLSearchParams(location.search);
  const setIf = (id, val, db) => { const el=document.getElementById(id); if(el && val!=null && (val==='' || db?.[val])) el.value = val; };
  const z = p.get('zone');
  if(z && window.ZONES_DB?.[z]){
    setIf('zone-sel', z, window.ZONES_DB);
    if(p.has('occ'))    setIf('occ-sel', p.get('occ'), window.ZONE_OCCUPATION);
    if(p.has('var'))    setIf('var-sel', p.get('var'), window.ZONE_VARIATIONS);
    if(p.has('threat')) setIf('threat-sel', p.get('threat'), window.ZONE_THREAT);
    document.getElementById('rencontre-panel')?.scrollIntoView({behavior:'smooth'});
  }
}

// Lit les 4 sélecteurs → opts pour resolveZonePool
function getRencontreOpts(){
  const g = id => document.getElementById(id)?.value || '';
  return {
    zone: g('zone-sel'),
    occupation: g('occ-sel') || undefined,
    variation: g('var-sel') || undefined,
    threat: g('threat-sel') || undefined,
  };
}

function startSync(){
  db.collection('joueurs').onSnapshot(snap => {
    joueurs = {};
    snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id: doc.id}; });
    renderJoueurs();
  });
  populateZoneSelectors();
  populatePublicSkillSel();
  renderCombatsActifs();
  db.collection('rolls').doc('current').onSnapshot(s => renderPublicRoll(s.exists ? s.data() : null));
  db.collection('temps').doc('data').onSnapshot(s => {
    if(s.exists && typeof s.data().minutes === 'number') tempsMin = s.data().minutes;
    renderClock();
  });
  populateLootCats();
  db.collection('butin').doc('data').onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    butinData = { items: Array.isArray(d.items) ? d.items : [], caps: d.caps || 0, players: Array.isArray(d.players) ? d.players : [] };
    renderButin();
    renderLootAccess();
  });
}

// ============================================================
// BUTIN / FOUILLE (générateur MJ → pool partagé Firebase /butin/data)
// ============================================================
let butinData = { items: [], caps: 0, players: [] };
const LOOT_CATS = [
  {k:'weapons',l:'Armes'},{k:'armor',l:'Armure'},{k:'ammo',l:'Munitions'},
  {k:'food',l:'Nourriture'},{k:'drinks',l:'Boissons'},{k:'drugs',l:'Chems'},
  {k:'stuff',l:'Divers'},{k:'caps',l:'Caps'},
];
const CAT_ICON = {weapons:'🔫',armor:'🛡',ammo:'▪',food:'🍖',drinks:'🥤',drugs:'💊',stuff:'🔧'};

function populateLootCats(){
  const el = document.getElementById('loot-cats'); if(!el) return;
  el.innerHTML = LOOT_CATS.map(c =>
    `<label class="loot-cat"><input type="checkbox" class="loot-cat-cb" value="${c.k}" checked> ${c.l}</label>`
  ).join('');
}
function lootSource(cat){ return ({weapons:DB.weapons,armor:DB.armor,food:DB.food,drinks:DB.drinks,drugs:DB.drugs,stuff:DB.stuff})[cat] || []; }
// Tirage pondéré par rareté (commun r1 = plus fréquent, légendaire r5 = rare)
function weightedPick(list){
  let tot=0; const w=list.map(it=>{ const x=Math.max(1,6-(it.r||3)); tot+=x; return x; });
  let r=Math.random()*tot;
  for(let i=0;i<list.length;i++){ r-=w[i]; if(r<=0) return list[i]; }
  return list[list.length-1];
}
// Munitions : jet 2D20 sur la table officielle AMMO_LOOT → {ammo, qty}
function rollAmmoLoot(){
  const tbl = window.AMMO_LOOT; if(!tbl||!tbl.length) return null;
  const roll = (1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20));
  const e = tbl.find(x => roll>=x.min && roll<=x.max); if(!e) return null;
  let q = e.base||0;
  for(let i=0;i<(e.cd||0);i++) q += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0;
  return { ammo: e.ammo, qty: Math.max(1, q*(e.mult||1)) };
}
function addToPool(item){
  butinData.items = butinData.items || [];
  const ex = butinData.items.find(x => x.name===item.name && x.cat===item.cat);
  if(ex) ex.qty += item.qty;
  else { item.id = 'b'+Date.now().toString(36)+Math.floor(Math.random()*999); butinData.items.push(item); }
}
function saveButin(){ if(db) db.collection('butin').doc('data').set(butinData).catch(e=>console.error('saveButin',e)); }
function genButin(){
  const scale = parseInt(document.getElementById('loot-scale').value)||2;
  const ranges = {1:[1,2],2:[2,4],3:[4,6],4:[6,10]};
  const [mn,mx] = ranges[scale] || [2,4];
  const rolls = mn + Math.floor(Math.random()*(mx-mn+1));
  const cats = [...document.querySelectorAll('.loot-cat-cb:checked')].map(c=>c.value);
  const itemCats = cats.filter(c=>c!=='caps');
  let added = 0;
  for(let i=0;i<rolls && itemCats.length;i++){
    const cat = itemCats[Math.floor(Math.random()*itemCats.length)];
    if(cat==='ammo'){ const a=rollAmmoLoot(); if(a){ addToPool({name:a.ammo,type:'AMMO',cat:'ammo',qty:a.qty}); added++; } continue; }
    const src = lootSource(cat); if(!src.length) continue;
    const it = weightedPick(src);
    addToPool({name:it.n, type:it.t||cat, cat, qty:1, w:it.w||0, r:it.r||3});
    added++;
  }
  if(cats.includes('caps')){
    const caps = scale * ((1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20)));
    butinData.caps = (butinData.caps||0) + caps;
  }
  saveButin();
  showMsg(`🎒 Butin généré — ${added} objet(s)${cats.includes('caps')?' + caps':''}`);
}
function rmButin(i){ butinData.items.splice(i,1); saveButin(); }
function clearButin(){ if(confirm('Vider le pool de butin ?')){ butinData = {items:[],caps:0,players:[]}; saveButin(); } }
function chButinCaps(d){ butinData.caps = Math.max(0,(butinData.caps||0)+d); saveButin(); }

// Accès joueurs au butin (bandeau sur leur fiche)
function renderLootAccess(){
  const el = document.getElementById('loot-access-list'); if(!el) return;
  const ids = Object.keys(joueurs);
  if(!ids.length){ el.innerHTML = '<span class="empty" style="font-size:8px;color:var(--td)">Aucun joueur</span>'; return; }
  el.innerHTML = ids.map(id => {
    const on = (butinData.players||[]).includes(id);
    return `<button class="loot-acc${on?' on':''}" onclick="toggleLootAccess('${id}')">${on?'👁':'∅'} ${joueurs[id]?.nom||id}</button>`;
  }).join('');
}
function toggleLootAccess(id){
  butinData.players = butinData.players || [];
  const i = butinData.players.indexOf(id);
  if(i>=0) butinData.players.splice(i,1); else butinData.players.push(id);
  saveButin(); renderLootAccess();
}
function lootAccessAll(all){ butinData.players = all ? Object.keys(joueurs) : []; saveButin(); renderLootAccess(); }
function renderButin(){
  const el = document.getElementById('butin-pool'); if(!el) return;
  const items = butinData.items||[], caps = butinData.caps||0;
  let h = `<div class="butin-caps">💰 Caps : <b>${caps}</b> <button class="bp-mini" onclick="chButinCaps(-10)">−10</button><button class="bp-mini" onclick="chButinCaps(10)">+10</button><button class="bp-mini" onclick="chButinCaps(-${caps})">0</button></div>`;
  if(!items.length){ h += '<div class="empty" style="font-size:8px;color:var(--td);padding:6px">Pool vide</div>'; }
  else {
    h += items.map((it,i)=>`<div class="bp-row"><span class="bp-cat">${CAT_ICON[it.cat]||'▪'}</span><span class="bp-nom">${it.name}${it.qty>1?' <b>×'+it.qty+'</b>':''}</span><button class="bp-del" onclick="rmButin(${i})">✕</button></div>`).join('');
    h += `<button class="bp-clear" onclick="clearButin()">Vider le pool</button>`;
  }
  el.innerHTML = h;
}

// ============================================================
// HORLOGE DE CAMPAGNE (temps en jeu, partagé Firebase /temps/data)
// minutes = total depuis Jour 1 00:00. Sert d'horodatage au journal.
// ============================================================
let tempsMin = 480;   // défaut : Jour 1 · 08:00
const JOURS_SEM = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
function tempsDecompose(m){
  const jour = Math.floor(m/1440)+1;
  const h = Math.floor((m%1440)/60);
  const min = m%60;
  return { jour, h, min };
}
function periodeJour(h){
  if(h<6) return 'nuit'; if(h<12) return 'matin'; if(h<18) return 'après-midi'; if(h<22) return 'soir'; return 'nuit';
}
function fmtTemps(m){ const {jour,h,min}=tempsDecompose(m); return `Jour ${jour} · ${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }
function saveTemps(){ if(db) db.collection('temps').doc('data').set({minutes:tempsMin, lastUpdate:Date.now()}).catch(e=>console.error('saveTemps',e)); }
function avanceTemps(delta){ tempsMin = Math.max(0, tempsMin + (parseInt(delta)||0)); saveTemps(); renderClock(); }
function reglerHeure(){
  const {jour,h,min}=tempsDecompose(tempsMin);
  const nj = parseInt(prompt('Jour :', jour)); if(!nj || nj<1) return;
  const hhmm = prompt('Heure (HH:MM) :', `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`);
  if(hhmm==null) return;
  const mm = hhmm.match(/^(\d{1,2})[:hH]?(\d{0,2})$/); if(!mm) return;
  const nh = Math.min(23, parseInt(mm[1])||0), nmin = Math.min(59, parseInt(mm[2])||0);
  tempsMin = (nj-1)*1440 + nh*60 + nmin;
  saveTemps(); renderClock();
}
function renderClock(){
  const d = document.getElementById('clock-display'); if(!d) return;
  const {jour,h,min}=tempsDecompose(tempsMin);
  d.textContent = fmtTemps(tempsMin);
  const sub = document.getElementById('clock-sub');
  if(sub) sub.textContent = `${JOURS_SEM[(jour-1)%7]} · ${periodeJour(h)}`;
}

// ============================================================
// LANCER DE DÉS PUBLIC (MJ → joueurs sélectionnés)
// ============================================================
const ATTR3_LETTER = { FOR:'S', PER:'P', END:'E', CHR:'C', INT:'I', AGI:'A', LCK:'L' };
const SPECIAL_LABELS = { S:'FORCE', P:'PERCEPTION', E:'ENDURANCE', C:'CHARISME', I:'INTELLIGENCE', A:'AGILITÉ', L:'CHANCE' };

function populatePublicSkillSel(){
  const sel = document.getElementById('pub-skill-sel'); if(!sel) return;
  const attrs = ['S','P','E','C','I','A','L'].map(k => `<option value="attr:${k}">${SPECIAL_LABELS[k]}</option>`).join('');
  const skills = (typeof SKILLS_DEF!=='undefined'?SKILLS_DEF:[]).map(s => `<option value="sk:${s.key}">${s.name}</option>`).join('');
  sel.innerHTML = `<optgroup label="S.P.E.C.I.A.L">${attrs}</optgroup><optgroup label="Compétences">${skills}</optgroup>`;
}

function lancerPublic(mode){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  const doc = { id: 'r' + Date.now().toString(36), mode, players:[...selected], results:{}, open:true, ts: Date.now() };
  if(mode === 'dice'){
    doc.n = Math.min(20, Math.max(1, parseInt(document.getElementById('pub-dice-nb').value)||1));
    doc.faces = Math.min(100, Math.max(2, parseInt(document.getElementById('pub-dice-faces').value)||6));
    doc.label = `${doc.n}D${doc.faces}`;
  } else {
    const selEl = document.getElementById('pub-skill-sel');
    const [t, k] = selEl.value.split(':');
    doc.isAttr = (t === 'attr');
    doc.skillKey = k;
    doc.label = (selEl.selectedOptions[0]?.textContent || k) + ' — test 2D20';
  }
  db.collection('rolls').doc('current').set(doc);
  showMsg(`📣 Lancer envoyé à ${selected.size} joueur(s)`);
}
function cloreLancer(){ db.collection('rolls').doc('current').set({ open:false, ts: Date.now() }); }

function fmtRollMJ(res, r){
  if(r.mode === 'dice') return `[${res.dice.join(', ')}] = <b style="color:var(--am)">${res.total}</b>`;
  const tags = (res.crit?' <span style="color:var(--g)">✦crit</span>':'') + (res.comp?' <span style="color:var(--rd)">⚠compl.</span>':'');
  return `[${res.dice.join(', ')}] vs TN ${res.tn} → <b style="color:var(--am)">${res.successes} succ.</b>${tags}`;
}
function renderPublicRoll(r){
  const el = document.getElementById('pub-roll-results'); if(!el) return;
  if(!r || !r.open){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='block';
  const rows = (r.players||[]).map(id => {
    const res = r.results?.[id];
    const nom = joueurs[id]?.nom || id;
    return `<div class="pr-row"><span class="pr-nom">${nom}</span><span class="pr-res">${res ? fmtRollMJ(res, r) : '⏳ en attente…'}</span></div>`;
  }).join('');
  el.innerHTML = `<div style="font-size:9px;letter-spacing:1px;color:var(--am);margin-bottom:4px">🎲 ${r.label}</div>${rows}`
    + `<button class="action-btn" onclick="cloreLancer()" style="width:100%;margin-top:5px;font-size:9px">Clore le lancer</button>`;
}

// ============================================================
// RENDER JOUEURS
// ============================================================
function renderJoueurs(){
  const grid = document.getElementById('joueurs-grid');
  const ids = Object.keys(joueurs);
  if(!ids.length){ grid.innerHTML='<div style="font-size:9px;color:var(--td);padding:20px">Aucun personnage</div>'; return; }
  grid.innerHTML = '';
  ids.forEach(id => {
    const d = joueurs[id];
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const statut = pct>=100?'ok':pct<30?'critique':'blesse';
    const statutLbl = pct>=100?'OK':pct<30?'CRITIQUE':'BLESSÉ';
    const sel = selected.has(id);
    const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON').map(it=>it.name).join(', ')||'—';
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const blessures = d.wounds ? Object.entries(d.wounds).filter(([,v])=>v).map(([k])=>k).join(', ') : '';

    grid.innerHTML += `<div class="joueur-card${sel?' selected':''}${statut==='critique'?' critique':''}" onclick="toggleSel('${id}')">
      <div class="sel-indicator"></div>
      <div class="jc-name">${(d.nom||id).toUpperCase()}
        <span class="jc-badge ${statut}">${statutLbl}</span>
      </div>
      <div class="jc-stat"><span class="jc-stat-lbl">PV</span><span class="jc-stat-val${pct<30?' danger':pct<60?' warn':''}">${d.hp||0} / ${hpMax}</span></div>
      <div class="jc-bar"><div class="jc-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="jc-stat"><span class="jc-stat-lbl">RAD</span><span class="jc-stat-val${(d.rad||0)>0?' warn':''}">${d.rad||0}</span></div>
      <div class="jc-stat"><span class="jc-stat-lbl">LVL</span><span class="jc-stat-val">${d.niveau||1} · ${d.xp||0} XP</span></div>
      <div class="jc-stat"><span class="jc-stat-lbl">LUCK</span><span class="jc-stat-val" style="color:var(--am)">${d.luck_points||0}/${d.special?.L||5}</span></div>
      <div class="jc-weap">🔫 ${weaps}${blessures?`<br>🩸 ${blessures}`:''}</div>
      <a class="jc-link-bottom" href="${FICHE_URL}?id=${id}" target="_blank" onclick="event.stopPropagation()">↗ Fiche</a>
    </div>`;
  });
  document.getElementById('sel-count').textContent = selected.size;
}

// ============================================================
// SELECTION
// ============================================================
function toggleSel(id){ selected.has(id)?selected.delete(id):selected.add(id); renderJoueurs(); }
function selTous(){ selected = new Set(Object.keys(joueurs)); renderJoueurs(); }
function selAucun(){ selected.clear(); renderJoueurs(); }

// ============================================================
// ACTIONS JOUEURS
// ============================================================
async function appliquer(action){
  if(!selected.size){ showMsg('Aucun joueur sélectionné !', true); return; }
  const promises = [...selected].map(async id => {
    const d = joueurs[id]; if(!d) return;
    const hpMax = getHpMax(d);
    let upd = {};
    if(action==='dmg')       upd.hp = Math.max(0,(d.hp||0)-parseInt(document.getElementById('val-dmg').value||1));
    else if(action==='heal') upd.hp = Math.min(hpMax,(d.hp||0)+parseInt(document.getElementById('val-heal').value||1));
    else if(action==='fullheal') upd.hp = hpMax;
    else if(action==='rad')  upd.rad = Math.min(hpMax,(d.rad||0)+parseInt(document.getElementById('val-rad').value||1));
    else if(action==='derad') upd.rad = Math.max(0,(d.rad||0)-parseInt(document.getElementById('val-derad').value||4));
    else if(action==='derad-full') upd.rad = 0;
    else if(action==='xp'||action==='xp-500'||action==='xp-1000'){
      const v = action==='xp'?parseInt(document.getElementById('val-xp').value||100):action==='xp-500'?500:1000;
      let xp=(d.xp||0)+v, niv=d.niveau||1;
      while(niv<20&&xp>=XP_TABLE[niv])niv++;
      upd.xp=xp; upd.niveau=niv;
    }
    else if(action==='repos-court') { upd.hp=Math.min(hpMax,(d.hp||0)+(d.special?.E||5)); upd.rad=Math.max(0,(d.rad||0)-2); }
    else if(action==='repos-long')  { upd.hp=hpMax; upd.rad=Math.max(0,Math.floor((d.rad||0)/2)); }
    else if(action==='reset-wounds') upd.wounds={head:false,torso:false,armL:false,armR:false,legL:false,legR:false};
    else if(action==='luck-init')    upd.luck_points = d.special?.L||5;
    else if(action==='luck-recover') upd.luck_points = Math.min(d.special?.L||5, (d.luck_points||0) + parseInt(document.getElementById('val-luck-rec').value||1));
    upd.lastUpdate=Date.now();
    await db.collection('joueurs').doc(id).update(upd);
  });
  await Promise.all(promises);
  const lbls={dmg:'Dégâts',heal:'Soins',fullheal:'Soin complet',rad:'Radiation',derad:'Rad soignée','derad-full':'Rad retirée',xp:'XP','xp-500':'+500 XP','xp-1000':'+1000 XP','repos-court':'Repos court','repos-long':'Repos long','reset-wounds':'Blessures effacées','luck-init':'Luck initialisé','luck-recover':'Luck récupéré'};
  showMsg(`✓ ${lbls[action]||action} — ${selected.size} joueur(s)`);
}

// ============================================================
// GÉNÉRATION DE RENCONTRE (zones pondérées + factions)
// ============================================================
function _ctxTags(opts){
  const t = [];
  if(opts.occupation && opts.occupation!=='neutral') t.push(window.FACTIONS?.[opts.occupation]?.label || opts.occupation);
  if(opts.variation) t.push(VARIATION_LABELS[opts.variation]||opts.variation);
  if(opts.threat && opts.threat!=='normal') t.push('Menace '+(THREAT_LABELS[opts.threat]||opts.threat));
  return t.join(' · ');
}

// Aperçu des probabilités du pool résolu (pour le réglage des poids)
function apercuPool(){
  const opts = getRencontreOpts();
  if(!opts.zone || !window.ZONES_DB?.[opts.zone]) return;
  const probs = zonePoolProbabilities(opts.zone, opts);
  const panel = document.getElementById('rencontre-panel');
  document.getElementById('btn-combat-wrap').style.display='none';
  panel.innerHTML = `<div class="rencontre-header">📊 ${window.ZONES_DB[opts.zone].label}</div>`
    + `<div class="rencontre-sub">${_ctxTags(opts)||'Pool de base'}</div>`
    + probs.map(p=>`<div style="display:flex;justify-content:space-between;font-size:9px;padding:2px 4px;border-bottom:1px solid var(--b)">
        <span style="color:${p.nom==='none'?'var(--td)':'var(--t)'}">${p.nom==='none'?'— pas de rencontre':p.nom}</span>
        <span style="color:var(--am)">${p.pct}%</span></div>`).join('');
}

// Génère une rencontre : N jets sur le pool résolu (none = créneau vide)
function genRencontre(){
  const opts = getRencontreOpts();
  if(!opts.zone || !window.ZONES_DB?.[opts.zone]){ showMsg('Zone invalide', true); return; }
  const slots = Math.max(1, parseInt(document.getElementById('nb-slots')?.value)||4);
  const pool = resolveZonePool(opts.zone, opts);
  const panel = document.getElementById('rencontre-panel');
  const zoneLabel = window.ZONES_DB[opts.zone].label || opts.zone;

  const combatData = [];
  for(let i=0;i<slots;i++){
    const name = rollEncounter(pool);
    if(!name || name==='none') continue;
    let inst = null;
    if(window.ENNEMIS_DB?.[name]){
      inst = enemyInstanceFromDB(name, 1);
    } else if(opts.occupation && opts.occupation!=='neutral' && window.FACTIONS?.[opts.occupation]){
      // nom sans fiche → unité générée de la faction occupante
      inst = generateFactionUnit(opts.occupation, {});
    }
    if(inst){ inst.id = Date.now()+i; combatData.push(inst); }
  }

  if(!combatData.length){
    sessionStorage.removeItem('combat_ennemis');
    document.getElementById('btn-combat-wrap').style.display='none';
    panel.innerHTML = `<div class="rencontre-header">🌿 ${zoneLabel}</div>`
      + (_ctxTags(opts)?`<div class="rencontre-sub">${_ctxTags(opts)}</div>`:'')
      + `<div class="event-calme">✓ AUCUNE RENCONTRE<br><span>La zone est calme.</span></div>`;
    return;
  }

  const totalXP = combatData.reduce((a,e)=>a+(e.xp||0),0);
  sessionStorage.setItem('combat_ennemis', JSON.stringify(combatData));
  sessionStorage.setItem('combat_joueurs', JSON.stringify([...selected]));
  document.getElementById('btn-combat-wrap').style.display='block';

  panel.innerHTML = `
    <div class="rencontre-header">⚔ ${zoneLabel}</div>
    <div class="rencontre-sub">${_ctxTags(opts)?_ctxTags(opts)+' · ':''}${combatData.length} ennemi(s) · XP total : ${totalXP}</div>
    ${combatData.map((e,i)=>{
      const def = window.ENNEMIS_DB?.[e.nom] || {};
      const col = e.factionColor || 'var(--rd)';
      return `
    <div class="ennemi-card" style="border-left:3px solid ${col}">
      <div class="ennemi-name">${i+1}. ${e.nom} <span style="font-size:7px;color:var(--td)">Niv.${e.level||'?'}${e.category&&e.category!=='normal'?' '+e.category:''}</span></div>
      <div class="ennemi-stats">PV : <b>${e.pvMax}</b> · Atq : <b>${e.atq}</b> · RD : <b>${e.rd}</b>${e.eff?` · <span style="color:var(--am)">${e.eff}</span>`:''}</div>
      ${def.desc?`<div class="ennemi-desc">${def.desc}</div>`:''}
      <div class="ennemi-xp">XP : ${e.xp}</div>
    </div>`;}).join('')}
    <div class="rencontre-actions">
      <button class="r-btn" onclick="donnerXPCombat(${totalXP})">✓ Donner ${totalXP} XP aux sélectionnés</button>
    </div>`;
}

async function lancerCombat(){
  const zk = document.getElementById('zone-sel')?.value || '';
  const zone = window.ZONES_DB?.[zk]?.label || zk;
  const joueurIds = JSON.parse(sessionStorage.getItem('combat_joueurs') || '[]');
  const ennemisData = JSON.parse(sessionStorage.getItem('combat_ennemis') || '[]');
  const btn = document.getElementById('btn-vers-combat');
  if(btn){ btn.textContent = '⏳ Création...'; btn.disabled = true; }
  try {
    await createCombatSession(ennemisData, joueurIds, zone);
    window.location.href = 'combat.html';
  } catch(e){
    console.error('lancerCombat:', e);
    if(btn){ btn.textContent = '⚔ Ouvrir l\'écran combat'; btn.disabled = false; }
  }
}

function donnerXPCombat(xp){
  document.getElementById('val-xp').value = xp;
  appliquer('xp');
}

// ============================================================
// DÉPLACEMENT
// ============================================================
function genDeplacement(){
  const unite = parseInt(document.getElementById('nb-unites').value)||1;
  const opts = getRencontreOpts();
  const zoneLabel = window.ZONES_DB?.[opts.zone]?.label || opts.zone;
  const danger = THREAT_DANGER[opts.threat] || 2;
  const panel = document.getElementById('rencontre-panel');

  // Probabilité d'événement augmente avec distance et niveau de menace
  const pctEvent = Math.min(95, 20 + (unite*5) + (danger*8));
  const roll = Math.random()*100;

  let html = `<div class="rencontre-header">🚶 DÉPLACEMENT — ${zoneLabel}</div>
    <div class="rencontre-sub">${unite} unité(s)${opts.threat&&opts.threat!=='normal'?' · '+(THREAT_LABELS[opts.threat]||opts.threat):''} · Risque calculé : <b>${pctEvent}%</b></div>
    <div class="deplacement-roll">Jet : <b>${Math.round(roll)}</b> / 100</div>`;

  if(roll > pctEvent){
    html += `<div class="event-calme">✓ DÉPLACEMENT SANS ENCOMBRE<br><span>Le groupe arrive à destination.</span></div>`;
    document.getElementById('btn-combat-wrap').style.display='none';
  } else {
    const r2 = Math.random()*100;
    let cumul=0, evt=EVENEMENTS_DEPLACEMENT[0];
    for(const e of EVENEMENTS_DEPLACEMENT){
      cumul+=e.pct;
      if(r2<=cumul){ evt=e; break; }
    }

    const color = evt.type==='calme'?'var(--g)':evt.type==='combat'||evt.type==='danger'?'var(--rd)':'var(--am)';
    html += `<div class="event-card" style="border-color:${color}">
      <div class="event-type" style="color:${color}">⚡ ${evt.label.toUpperCase()}</div>
      <div class="event-desc">${evt.desc}</div>
    </div>`;

    if(evt.type==='combat'||evt.type==='danger'){
      html += `<button class="r-btn" onclick="genRencontre()" style="margin-top:8px">⚔ Générer la rencontre</button>`;
    }
  }

  panel.innerHTML = html;
}

// ============================================================
// MSG
// ============================================================
function showMsg(txt, err=false){
  const el=document.getElementById('msg-bar');
  el.textContent=txt;
  el.style.borderColor=err?'var(--rd)':'var(--g)';
  el.style.color=err?'var(--rd)':'var(--g)';
  el.style.display='block';
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.style.display='none',2500);
}

// ============================================================
// LANCEUR DE DÉS
// ============================================================
// Animation « dés qui roulent » : défile des valeurs aléatoires puis se fige
function animateDiceRoll(el, frameFn, finalHtml, dur=520){
  el.style.display='block';
  el.classList.add('rolling');
  const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    if(t < dur){
      el.innerHTML = frameFn();
      setTimeout(tick, 45 + (t/dur)*70);   // ralentit vers la fin
    } else {
      el.classList.remove('rolling');
      el.innerHTML = finalHtml;
      el.classList.add('settled');
      setTimeout(()=>el.classList.remove('settled'), 360);
    }
  };
  tick();
}

function lancerDes(){
  const nb = Math.min(20, parseInt(document.getElementById('dice-nb').value)||2);
  const faces = Math.min(100, parseInt(document.getElementById('dice-faces').value)||20);
  const resultats = Array.from({length:nb}, ()=>Math.floor(Math.random()*faces)+1);
  const total = resultats.reduce((a,b)=>a+b,0);
  const el = document.getElementById('dice-result');
  const finalHtml = `<span style="color:var(--td)">${nb}D${faces} → </span>${resultats.join(' + ')} <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:16px"> = ${total}</span>`;
  animateDiceRoll(el, ()=>{
    const scr = Array.from({length:nb}, ()=>Math.floor(Math.random()*faces)+1);
    return `<span style="color:var(--td)">${nb}D${faces} → </span><span style="color:var(--tb)">${scr.join(' + ')}</span>`;
  }, finalHtml);
}

// Dés de Combat Fallout 2D20 : 1|2dmg, blank, blank, 1dmg+effet, 1dmg+effet
function lancerCD(){
  const nb = Math.min(10, parseInt(document.getElementById('dice-nb').value)||2);
  const resultats = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = resultats.reduce((a,f)=>a+(parseInt(f)||0),0);
  const effets = resultats.filter(f=>f.includes('⚡')).length;
  const el = document.getElementById('dice-result');
  const finalHtml = `<span style="color:var(--td)">${nb}DC → </span>`
    + resultats.map(f=>`<span style="color:${f.includes('⚡')?'var(--am)':f==='—'?'var(--td)':'var(--tb)'}">` + f + '</span>').join(' ')
    + ` <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:14px"> = ${dmg} dmg${effets>0?` + ${effets} Effet(s)`:''}</span>`;
  animateDiceRoll(el, ()=>{
    const scr = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
    return `<span style="color:var(--td)">${nb}DC → </span>` + scr.map(f=>`<span style="color:var(--tb)">${f}</span>`).join(' ');
  }, finalHtml);
}

// rollDice défini dans mj_shared.js

// ============================================================
// GESTION DES SESSIONS COMBAT (multi-room)
// ============================================================

function genCombatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function createCombatSession(combatData, joueurIds, zone) {
  const combatId = genCombatId();
  await db.collection(COMBATS_COLL).doc(combatId).set({
    actif: true, numRound: 0, tourActif: 0,
    ordreInitiative: [], actionsState: {},
    ennemis: combatData, apPool: 0, mjApPool: 0,
    meta: { createdAt: Date.now(), status: 'active', joueurs: joueurIds, round: 0, zone: zone||'' },
    lastUpdate: Date.now(),
  });
  await db.collection(COMBATS_COLL).doc('current').set({combatId, lastUpdate: Date.now()});
  sessionStorage.setItem('currentCombatId', combatId);
  return combatId;
}

function joinCombat(combatId) {
  sessionStorage.setItem('currentCombatId', combatId);
  window.location.href = 'combat.html';
}

async function terminerCombatSession(combatId) {
  await db.collection(COMBATS_COLL).doc(combatId).update({
    actif: false, 'meta.status': 'termine', lastUpdate: Date.now()
  });
  const cur = await db.collection(COMBATS_COLL).doc('current').get();
  if(cur.exists && cur.data()?.combatId === combatId)
    db.collection(COMBATS_COLL).doc('current').set({combatId: null, lastUpdate: Date.now()});
  renderCombatsActifs();
}

function renderCombatsActifs() {
  const el = document.getElementById('combats-actifs-list'); if(!el) return;
  el.innerHTML = '<div class="empty">Chargement...</div>';
  db.collection(COMBATS_COLL).get().then(snap => {
    const actifs = [];
    snap.forEach(doc => {
      if(doc.id === 'current' || doc.id === 'fallout-paris') return;
      const d = doc.data();
      if(!d.meta) return; // ignorer les docs sans meta (ancien format)
      if(d.actif && d.meta.status !== 'termine') actifs.push({id: doc.id, ...d});
    });
    if(!actifs.length){ el.innerHTML = '<div class="empty">Aucun combat actif</div>'; return; }
    el.innerHTML = actifs.map(c => {
      const joueurs = (c.meta?.joueurs||[]).join(', ') || '—';
      const zone   = c.meta?.zone ? ' · ' + c.meta.zone : '';
      return '<div class="combat-item">' +
        '<div class="combat-item-info">' +
          '<span class="combat-id">' + c.id + '</span>' +
          '<span class="combat-meta">R' + (c.numRound||0) + zone + ' · ' + joueurs + '</span>' +
        '</div>' +
        '<div class="combat-item-btns">' +
          '<button class="r-btn" onclick="joinCombat(\'' + c.id + '\')">↗ Rejoindre</button>' +
          '<button class="r-btn" style="border-color:var(--rd);color:var(--rd)" onclick="terminerCombatSession(\'' + c.id + '\')">✕ Terminer</button>' +
        '</div></div>';
    }).join('');
  }).catch(() => { el.innerHTML = '<div class="empty">Erreur</div>'; });
}


