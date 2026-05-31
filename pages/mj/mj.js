const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
// firebaseConfig, XP_TABLE définis dans common/shared.js
const db = firebase.initializeApp(firebaseConfig).firestore();

let joueurs = {};
let selected = new Set();

// ============================================================
// TABLES DE RENCONTRES
// ============================================================
const ZONES = {
  'Paris Centre':     {danger:2, nbMin:1, nbMax:3, ennemis:['Pillard','Pillard Vétéran','Goule errante','Chien sauvage','Marchand hostile']},
  'Paris Banlieue':   {danger:3, nbMin:2, nbMax:4, ennemis:['Pillard Vétéran','Goule enragée','Super Mutant','Chien sauvage','Légion de Fer']},
  'Métro':            {danger:4, nbMin:3, nbMax:5, ennemis:['Goule enragée','Goule irradiée','Mite de vapeur','Pillard','Homme de main']},
  'Zone Industrielle':{danger:3, nbMin:2, nbMax:4, ennemis:['Robot Protectron','Robot Assaultron','Pillard Vétéran','Super Mutant','Saccageur']},
  'Égouts':           {danger:4, nbMin:3, nbMax:5, ennemis:['Radscorpion','Mole Rat','Goule errante','Goule enragée','Mirelurk']},
  'Zone Verte':       {danger:2, nbMin:1, nbMax:2, ennemis:['Radstag','Brahmane sauvage','Chien sauvage','Pillard','Pillard Vétéran']},
};

// ENNEMIS_DB défini dans mj_shared.js (fusionné avec body+mind+desc, 'Légion de Fer' corrigé)

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
function updateNbEnnemis(){
  const zone = document.getElementById('zone-sel').value;
  const zoneData = ZONES[zone]; if(!zoneData) return;
  const nb = Math.floor(Math.random()*(zoneData.nbMax-zoneData.nbMin+1))+zoneData.nbMin;
  document.getElementById('nb-ennemis').value = nb;
}

function startSync(){
  db.collection('joueurs').onSnapshot(snap => {
    joueurs = {};
    snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id: doc.id}; });
    renderJoueurs();
  });
  renderCombatsActifs();
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
// GÉNÉRATION DE COMBAT
// ============================================================
function genCombat(){
  const zone = document.getElementById('zone-sel').value;
  const zoneData = ZONES[zone];
  const nbMin = zoneData.nbMin||1, nbMax = zoneData.nbMax||3;
  const nb = Math.floor(Math.random()*(nbMax-nbMin+1))+nbMin;
  document.getElementById('nb-ennemis').value = nb;
  const panel = document.getElementById('rencontre-panel');

  const ennemisGeneres = [];
  for(let i=0;i<nb;i++){
    const nom = zoneData.ennemis[Math.floor(Math.random()*zoneData.ennemis.length)];
    const db = ENNEMIS_DB[nom]||{pvd:'2D',atq:'3D',rd:0,desc:'Ennemi inconnu.',xp:50};
    ennemisGeneres.push({nom, ...db});
  }

  const totalXP = ennemisGeneres.reduce((a,e)=>a+e.xp,0);

  // Stocker pour l'écran combat
  const combatData = ennemisGeneres.map((e,i)=>({
    id: Date.now()+i, nom:e.nom, pvd:e.pvd,
    pvMax:rollDice(e.pvd), pvCur:0, atq:e.atq, rd:e.rd, xp:e.xp, initiative:null
  }));
  combatData.forEach(e=>e.pvCur=e.pvMax);
  sessionStorage.setItem('combat_ennemis', JSON.stringify(combatData));
  sessionStorage.setItem('combat_joueurs', JSON.stringify([...selected]));
  document.getElementById('btn-combat-wrap').style.display='block';

  document.getElementById('btn-combat-wrap').style.display='block';
  panel.innerHTML = `
    <div class="rencontre-header">⚔ COMBAT — ${zone.toUpperCase()}</div>
    <div class="rencontre-sub">Danger : ${'▮'.repeat(zoneData.danger)}${'▯'.repeat(5-zoneData.danger)} · XP total : ${totalXP}</div>
    ${ennemisGeneres.map((e,i)=>`
    <div class="ennemi-card">
      <div class="ennemi-name">${i+1}. ${e.nom}</div>
      <div class="ennemi-stats">PV : <b>${e.pvd}</b> · Atq : <b>${e.atq}</b> · RD : <b>${e.rd}</b></div>
      <div class="ennemi-desc">${e.desc}</div>
      <div class="ennemi-xp">XP : ${e.xp}</div>
    </div>`).join('')}
    <div class="rencontre-actions">
      <button class="r-btn" onclick="donnerXPCombat(${totalXP})">✓ Donner ${totalXP} XP aux sélectionnés</button>
    </div>`;
}

async function lancerCombat(){
  const zone = document.getElementById('zone-sel')?.value || '';
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
  const zone = document.getElementById('zone-sel').value;
  const danger = ZONES[zone]?.danger||2;
  const panel = document.getElementById('rencontre-panel');

  // Probabilité d'événement augmente avec distance et danger
  const pctEvent = Math.min(95, 20 + (unite*5) + (danger*5));
  const roll = Math.random()*100;

  let html = `<div class="rencontre-header">🚶 DÉPLACEMENT — ${zone.toUpperCase()}</div>
    <div class="rencontre-sub">${unite} unité(s) · Risque calculé : <b>${pctEvent}%</b></div>
    <div class="deplacement-roll">Jet : <b>${Math.round(roll)}</b> / 100</div>`;

  if(roll > pctEvent){
    html += `<div class="event-calme">✓ DÉPLACEMENT SANS ENCOMBRE<br><span>Le groupe arrive à destination.</span></div>`;
  } else {
    // Choisir un événement selon les probabilités
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
      const nb = evt.type==='danger'?Math.floor(Math.random()*2)+3:Math.floor(Math.random()*2)+1;
      document.getElementById('nb-ennemis').value = nb + (evt.type==='danger'?1:0);
      html += `<button class="r-btn" onclick="genCombat()" style="margin-top:8px">⚔ Générer le combat (${nb} ennemis)</button>`;
      document.getElementById('btn-combat-wrap').style.display='block';
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
function lancerDes(){
  const nb = Math.min(20, parseInt(document.getElementById('dice-nb').value)||2);
  const faces = Math.min(100, parseInt(document.getElementById('dice-faces').value)||20);
  const resultats = Array.from({length:nb}, ()=>Math.floor(Math.random()*faces)+1);
  const total = resultats.reduce((a,b)=>a+b,0);
  const el = document.getElementById('dice-result');
  el.style.display='block';
  el.innerHTML = `<span style="color:var(--td)">${nb}D${faces} → </span>${resultats.join(' + ')} <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:16px"> = ${total}</span>`;
}

// Dés de Combat Fallout 2D20 : faces = 1,2,blank,blank,Effect,Effect
function lancerCD(){
  const nb = Math.min(10, parseInt(document.getElementById('dice-nb').value)||2);
  const resultats = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = resultats.filter(f=>f==='1'||f==='2').reduce((a,f)=>a+parseInt(f),0);
  const effets = resultats.filter(f=>f==='★').length;
  const el = document.getElementById('dice-result');
  el.style.display='block';
  el.innerHTML = `<span style="color:var(--td)">${nb}DC → </span>${resultats.join(' ')} <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:14px"> = ${dmg} dmg${effets>0?` + ${effets} Effet(s)`:''}</span>`;
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
      if(doc.id === 'current') return;
      const d = doc.data();
      if(d.actif && d.meta?.status !== 'termine') actifs.push({id: doc.id, ...d});
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


