const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
const XP_TABLE = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];

const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};
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

const ENNEMIS_DB = {
  'Pillard':          {pvd:'1D+2',atq:'3D',rd:0,desc:'Humain hostile basique. STR 5, AGI 5.',xp:25},
  'Pillard Vétéran':  {pvd:'2D+4',atq:'4D',rd:1,desc:'Pillard expérimenté. STR 6, AGI 6. Arme améliorée.',xp:50},
  'Goule errante':    {pvd:'2D+2',atq:'3D',rd:0,desc:'Goule lente et prévisible. END 6.',xp:30},
  'Goule enragée':    {pvd:'2D+4',atq:'4D',rd:1,desc:'Goule agressive. AGI 8. Charge dès l\'init.',xp:60},
  'Goule irradiée':   {pvd:'3D+4',atq:'4D+rad',rd:2,desc:'Irradie au contact. RAD 2 par touche.',xp:80},
  'Chien sauvage':    {pvd:'1D+2',atq:'2D',rd:0,desc:'Rapide. AGI 9. Priorité aux membres.',xp:15},
  'Super Mutant':     {pvd:'3D+6',atq:'5D',rd:2,desc:'STR 10, END 8. Arme lourde. Résistant.',xp:100},
  'Mite de vapeur':   {pvd:'2D+3',atq:'3D+brûlure',rd:1,desc:'Crache vapeur brûlante. Zone Courte.',xp:45},
  'Radscorpion':      {pvd:'3D+5',atq:'4D+poison',rd:3,desc:'Venin : 1D rad/tour. Carapace RD 3.',xp:90},
  'Mole Rat':         {pvd:'1D+3',atq:'3D',rd:0,desc:'Attaque en groupe. Peut creuser.',xp:20},
  'Mirelurk':         {pvd:'3D+6',atq:'4D',rd:4,desc:'Carapace très résistante devant. Dos RD 0.',xp:110},
  'Robot Protectron': {pvd:'2D+4',atq:'3D laser',rd:3,desc:'Laser. Explose à mort (4D blast).',xp:70},
  'Robot Assaultron': {pvd:'3D+5',atq:'5D laser',rd:4,desc:'Très rapide. Rayon tête dévastateur.',xp:120},
  'Légion de Fer':    {pvd:'2D+4',atq:'4D',rd:2,desc:'Organisation militaire. Tactique de groupe.',xp:75},
  'Saccageur':        {pvd:'2D+3',atq:'3D',rd:1,desc:'Armure de fortune. Imprévisible.',xp:40},
  'Marchand hostile': {pvd:'1D+4',atq:'3D',rd:0,desc:'Tendu, armé. Peut fuir si blessé.',xp:35},
  'Homme de main':    {pvd:'2D+3',atq:'4D',rd:1,desc:'Mercenaire. STR 6, AGI 7. Bien équipé.',xp:55},
  'Brahmane sauvage': {pvd:'2D+5',atq:'3D',rd:1,desc:'Charge si perturbé. Deux têtes.',xp:25},
  'Radstag':          {pvd:'1D+3',atq:'2D',rd:0,desc:'Fuit en priorité. Attaque si acculé.',xp:10},
};

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
    startSync();
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-inp').value='';
  }
}

// Auto-déverrouiller si déjà authentifié
if(sessionStorage.getItem('mj_auth')==='1'){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='grid';
  startSync();
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
    const hpMax = (d.special?.L||5)+(d.special?.E||5)+Math.max(0,(d.niveau||1)-1)+(d.perks?.['Life Giver']||0)*(d.special?.E||5);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const statut = pct>=100?'ok':pct<30?'critique':'blesse';
    const statutLbl = pct>=100?'OK':pct<30?'CRITIQUE':'BLESSÉ';
    const sel = selected.has(id);
    const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON').map(it=>it.name).join(', ')||'—';
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const blessures = d.wounds ? Object.entries(d.wounds).filter(([,v])=>v).map(([k])=>k).join(', ') : '';

    grid.innerHTML += `<div class="joueur-card${sel?' selected':''}${statut==='critique'?' critique':''}" onclick="toggleSel('${id}')">
      <div class="sel-indicator"></div>
      <a class="jc-link" href="${FICHE_URL}?id=${id}" target="_blank" onclick="event.stopPropagation()">↗ Fiche</a>
      <div class="jc-name" style="margin-left:16px">${(d.nom||id).toUpperCase()}
        <span class="jc-badge ${statut}">${statutLbl}</span>
      </div>
      <div class="jc-stat"><span class="jc-stat-lbl">PV</span><span class="jc-stat-val${pct<30?' danger':pct<60?' warn':''}">${d.hp||0} / ${hpMax}</span></div>
      <div class="jc-bar"><div class="jc-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="jc-stat"><span class="jc-stat-lbl">RAD</span><span class="jc-stat-val${(d.rad||0)>0?' warn':''}">${d.rad||0}</span></div>
      <div class="jc-stat"><span class="jc-stat-lbl">LVL</span><span class="jc-stat-val">${d.niveau||1} · ${d.xp||0} XP</span></div>
      <div class="jc-weap">🔫 ${weaps}${blessures?`<br>🩸 ${blessures}`:''}</div>
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
    const hpMax = (d.special?.L||5)+(d.special?.E||5)+Math.max(0,(d.niveau||1)-1)+(d.perks?.['Life Giver']||0)*(d.special?.E||5);
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
    upd.lastUpdate=Date.now();
    await db.collection('joueurs').doc(id).update(upd);
  });
  await Promise.all(promises);
  const lbls={dmg:'Dégâts',heal:'Soins',fullheal:'Soin complet',rad:'Radiation',derad:'Rad soignée','derad-full':'Rad retirée',xp:'XP',  'xp-500':'+500 XP','xp-1000':'+1000 XP','repos-court':'Repos court','repos-long':'Repos long','reset-wounds':'Blessures effacées'};
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
    pvMax:rollDiceSimple(e.pvd), pvCur:0, atq:e.atq, rd:e.rd, xp:e.xp, initiative:null
  }));
  combatData.forEach(e=>e.pvCur=e.pvMax);
  sessionStorage.setItem('combat_ennemis', JSON.stringify(combatData));
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
  const FACES_CD = ['1','2','—','—','⚡','⚡'];
  const resultats = Array.from({length:nb}, ()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = resultats.filter(f=>f==='1'||f==='2').reduce((a,f)=>a+parseInt(f),0);
  const effets = resultats.filter(f=>f==='⚡').length;
  const el = document.getElementById('dice-result');
  el.style.display='block';
  el.innerHTML = `<span style="color:var(--td)">${nb}DC → </span>${resultats.join(' ')} <span style="color:var(--am);font-family:'Oswald',sans-serif;font-size:14px"> = ${dmg} dmg${effets>0?` + ${effets} Effet(s)`:''}</span>`;
}

function rollDiceSimple(expr){
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if(!m) return 10;
  const nb=parseInt(m[1])||1, bonus=parseInt(m[2])||0;
  let t=bonus; for(let i=0;i<nb;i++) t+=Math.floor(Math.random()*6)+1;
  return t;
}

function rollDiceSimple(expr){
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if(!m) return 10;
  const nb=parseInt(m[1])||1, bonus=parseInt(m[2])||0;
  let t=bonus; for(let i=0;i<nb;i++) t+=Math.floor(Math.random()*6)+1;
  return t;
}
