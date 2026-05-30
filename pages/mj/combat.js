const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
const XP_TABLE = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];

const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};
const db = firebase.initializeApp(firebaseConfig).firestore();

// ---- BASE ARMES ----
const WEAPONS_DB = {
  'Ripper':{t:'Melee Weapon',dmg:'4D',eff:'Vicious',fr:6,rng:'—',sk:'cac_weapon'},
  'Pipe Wrench':{t:'Melee Weapon',dmg:'3D',eff:'—',fr:'—',rng:'—',sk:'cac_weapon'},
  'Combat Knife':{t:'Melee Weapon',dmg:'3D',eff:'Piercing 1',fr:'—',rng:'—',sk:'cac_weapon'},
  'Sledgehammer':{t:'Melee Weapon',dmg:'5D',eff:'—',fr:'—',rng:'—',sk:'cac_weapon'},
  '.44 Pistol':{t:'Small Guns',dmg:'6D',eff:'—',fr:1,rng:'M',sk:'light_weapon'},
  '10mm Pistol':{t:'Small Guns',dmg:'4D',eff:'—',fr:2,rng:'M',sk:'light_weapon'},
  'Pipe Gun':{t:'Small Guns',dmg:'3D',eff:'—',fr:2,rng:'C',sk:'light_weapon'},
  'Pipe Revolver':{t:'Small Guns',dmg:'4D',eff:'—',fr:1,rng:'C',sk:'light_weapon'},
  'Pipe Bolt-Action':{t:'Small Guns',dmg:'6D',eff:'Piercing 1',fr:0,rng:'M',sk:'light_weapon'},
  'Hunting Rifle':{t:'Small Guns',dmg:'7D',eff:'—',fr:0,rng:'L',sk:'light_weapon'},
  'Double-Barrel Shotgun':{t:'Small Guns',dmg:'5D',eff:'Spread,Vicious',fr:0,rng:'C',sk:'light_weapon'},
  'Laser Pistol':{t:'Energy Weapon',dmg:'4D',eff:'—',fr:2,rng:'M',sk:'en_weapon'},
  'Laser Rifle':{t:'Energy Weapon',dmg:'7D',eff:'—',fr:1,rng:'L',sk:'en_weapon'},
  'Flamer':{t:'Big Guns',dmg:'5D',eff:'Persistent,Spread',fr:2,rng:'C',sk:'heavy_weapon'},
  'Minigun':{t:'Big Guns',dmg:'3D',eff:'Spread',fr:6,rng:'M',sk:'heavy_weapon'},
};

const SK_ATTR = {
  en_weapon:'P',cac_weapon:'S',light_weapon:'A',heavy_weapon:'E',
  athletics:'S',lockpick:'P',speech:'C',sneak:'A',explosives:'P',
  barehand:'S',medicine:'I',pilot:'P',throwing:'A',repair:'I',science:'I',survival:'E',barter:'C'
};

const FACES_CD = ['1','2','—','—','★','★'];

let joueurs = {};
let combattants = {}; // id -> {data, initiative, selected}
let ennemis = [];     // [{nom, pvMax, pvCur, atq, rd, eff}]
let log = [];
let joueurActif = null;

// ---- LOCK ----
document.getElementById('lock-inp').addEventListener('keydown', e=>{ if(e.key==='Enter') unlock(); });
function unlock(){
  if(document.getElementById('lock-inp').value===MJ_CODE){
    sessionStorage.setItem('mj_auth','1');
    document.getElementById('lock').style.display='none';
    document.getElementById('app').style.display='block';
    chargerJoueurs();
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-inp').value='';
  }
}

if(sessionStorage.getItem('mj_auth')==='1'){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='block';
  chargerJoueurs();
}

// ---- CHARGEMENT ----
async function chargerJoueurs(){
  const snap = await db.collection('joueurs').get();
  joueurs = {};
  snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id:doc.id}; });
  renderSelJoueurs();
}

// ---- SÉLECTION JOUEURS POUR CE COMBAT ----
function renderSelJoueurs(){
  const el = document.getElementById('sel-joueurs');
  el.innerHTML = '';
  Object.values(joueurs).forEach(d => {
    const inCombat = !!combattants[d._id];
    el.innerHTML += `<button class="sel-j-btn${inCombat?' active':''}" onclick="toggleCombattant('${d._id}')">
      ${(d.nom||d._id).toUpperCase()}
    </button>`;
  });
}

function toggleCombattant(id){
  if(combattants[id]) delete combattants[id];
  else combattants[id] = {data: joueurs[id], initiative: null};
  renderSelJoueurs();
  renderCombat();
}

// ---- INITIATIVE ----
function lancerInitiative(){
  Object.keys(combattants).forEach(id => {
    const d = combattants[id].data;
    const agi = d.special?.A || 5;
    const roll = Math.floor(Math.random()*20)+1;
    combattants[id].initiative = agi + roll;
  });
  ennemis.forEach(e => {
    e.initiative = Math.floor(Math.random()*20)+1 + (e.agi||5);
  });
  renderCombat();
  addLog('🎲 Initiative lancée !');
}

// ---- ENNEMIS ----
function ajouterEnnemi(){
  const nom = document.getElementById('ennemi-nom').value.trim() || 'Ennemi';
  const pvd = document.getElementById('ennemi-pv').value.trim() || '2D+4';
  const atq = document.getElementById('ennemi-atq').value.trim() || '3D';
  const rd  = parseInt(document.getElementById('ennemi-rd').value) || 0;
  const pvMax = rollDice(pvd);
  ennemis.push({id: Date.now(), nom, pvd, pvMax, pvCur:pvMax, atq, rd, initiative:null, eff:''});
  document.getElementById('ennemi-nom').value='';
  renderCombat();
  addLog(`➕ ${nom} ajouté (PV: ${pvMax})`);
}

function rollDice(expr){
  // ex: "2D+4" ou "1D+2" ou "3D+6"
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if(!m) return 10;
  const nb=parseInt(m[1])||1, bonus=parseInt(m[2])||0;
  let total=bonus;
  for(let i=0;i<nb;i++) total+=Math.floor(Math.random()*6)+1;
  return total;
}

function dmgEnnemi(id, val){
  const e = ennemis.find(e=>e.id===id); if(!e) return;
  const after = Math.max(0, e.pvCur - val);
  addLog(`⚔ ${e.nom} : ${e.pvCur} → ${after} PV (-${val})`);
  e.pvCur = after;
  if(e.pvCur<=0) addLog(`💀 ${e.nom} est éliminé !`);
  renderCombat();
}

function supprimerEnnemi(id){
  ennemis = ennemis.filter(e=>e.id!==id);
  renderCombat();
}

// ---- RENDER PRINCIPAL ----
function renderCombat(){
  renderJoueursCombat();
  renderEnnemis();
  renderInitiative();
}

function getHpMax(d){
  return (d.special?.L||5)+(d.special?.E||5)+Math.max(0,(d.niveau||1)-1)+(d.perks?.['Life Giver']||0)*(d.special?.E||5);
}

function getTN(d, skKey){
  const attr = SK_ATTR[skKey]||'A';
  const attrMap = {S:d.special?.S||5,P:d.special?.P||5,E:d.special?.E||5,C:d.special?.C||5,I:d.special?.I||5,A:d.special?.A||5,L:d.special?.L||5};
  const rang = d.skills?.[skKey]||0;
  const tag = d.taggedSkills?.includes(skKey)?2:0;
  return {total: attrMap[attr]+rang+tag, attr, attrVal: attrMap[attr], rang, tag};
}

function getRD(d, zone){
  const zm={head:'Head',torso:'Torso',armL:'Arm',armR:'Arm',legL:'Leg',legR:'Leg'};
  let ph=(d.perks?.Toughness||0), en=(d.perks?.Refractor||0), rad=(d.perks?.['Rad Resistance']||0);
  (d.inventory||[]).forEach(it=>{
    if(!it.equipped) return;
    // Simplified armor lookup
    const armors = {'Casque en métal lourd':{ph:4,en:3,rad:0,z:'Head'},'Plastron de combat renforcé':{ph:3,en:3,rad:0,z:'Torso'},'Vault 74 Jumpsuit':{ph:0,en:0,rad:2,z:'Body'},'Vault Jumpsuit':{ph:0,en:0,rad:2,z:'Body'}};
    const db = armors[it.name];
    if(!db) return;
    if(db.z===zm[zone]||db.z==='Body'&&zone!=='head'||db.z==='All') { ph+=db.ph; en+=db.en; rad+=db.rad; }
  });
  return {ph, en, rad};
}

function renderJoueursCombat(){
  const el = document.getElementById('joueurs-combat'); el.innerHTML='';
  const ids = Object.keys(combattants);
  if(!ids.length){ el.innerHTML='<div style="font-size:9px;color:var(--td);padding:12px">Aucun joueur sélectionné ci-dessus</div>'; return; }

  ids.forEach(id => {
    const {data:d, initiative} = combattants[id];
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const isActif = joueurActif===id;
    const weapsEq = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');
    const rdTorso = getRD(d,'torso');

    el.innerHTML += `<div class="jc-card${isActif?' actif':''}" onclick="setActif('${id}')">
      <div class="jc-header">
        <span class="jc-name">${(d.nom||id).toUpperCase()}</span>
        <span class="jc-init">${initiative!==null?'Init '+initiative:'—'}</span>
      </div>
      <div class="jc-stats-row">
        <div class="jc-stat-b"><span class="jc-sl">PV</span><span class="jc-sv${pct<30?' danger':pct<60?' warn':''}">${d.hp||0}/${hpMax}</span></div>
        <div class="jc-stat-b"><span class="jc-sl">PA</span><span class="jc-sv">${d.momentum||0}</span></div>
        <div class="jc-stat-b"><span class="jc-sl">RAD</span><span class="jc-sv${(d.rad||0)>0?' warn':''}">${d.rad||0}</span></div>
        <div class="jc-stat-b"><span class="jc-sl">RD Torse</span><span class="jc-sv">Ph:${rdTorso.ph} En:${rdTorso.en}</span></div>
      </div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${barColor}"></div></div>

      ${weapsEq.map(inv => {
        const db = WEAPONS_DB[inv.name]||{};
        const tn = db.sk ? getTN(d, db.sk) : null;
        return `<div class="jc-arme${isActif?' clickable':''}" ${isActif?`onclick="event.stopPropagation();setArme('${id}','${inv.name}')"`:''}">
          <div class="jc-arme-name">${inv.name}${inv.persoBonus?' ★':''}</div>
          <div class="jc-arme-stats">${db.dmg||'?'} · FR ${db.fr??'—'} · ${db.rng||'—'}${db.eff&&db.eff!=='—'?` · <span style="color:var(--am)">${db.eff}</span>`:''}
          ${tn?`· TN <b>${tn.total}</b> <span style="color:var(--td)">(${tn.attrVal}+${tn.rang}${tn.tag?'+2 TAG':''})</span>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  });
}

function renderEnnemis(){
  const el = document.getElementById('ennemis-combat'); el.innerHTML='';
  if(!ennemis.length){ el.innerHTML='<div style="font-size:9px;color:var(--td);padding:8px">Aucun ennemi ajouté</div>'; return; }
  ennemis.forEach(e => {
    const pct = Math.round(e.pvCur/e.pvMax*100);
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    el.innerHTML += `<div class="ennemi-card">
      <div class="ennemi-header">
        <span class="ennemi-name">${e.nom}</span>
        <span class="ennemi-init">${e.initiative!==null?'Init '+e.initiative:'—'}</span>
        <button class="e-del" onclick="supprimerEnnemi(${e.id})">✕</button>
      </div>
      <div class="ennemi-pvline">PV : <b style="color:var(--${pct<30?'rd':pct<60?'am':'g'})">${e.pvCur}</b> / ${e.pvMax}</div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${barColor}"></div></div>
      <div class="ennemi-stats">ATQ : <b>${e.atq}</b> · RD : <b>${e.rd}</b></div>
      <div class="ennemi-dmg-row">
        <input type="number" class="e-dmg-inp" id="dmg-${e.id}" value="1" min="0">
        <button class="e-dmg-btn" onclick="dmgEnnemi(${e.id}, parseInt(document.getElementById('dmg-${e.id}').value)||1)">Infliger dégâts</button>
      </div>
    </div>`;
  });
}

function renderInitiative(){
  const el = document.getElementById('initiative-list'); el.innerHTML='';
  const all = [
    ...Object.entries(combattants).map(([id,c])=>({nom:(c.data.nom||id).toUpperCase(), init:c.initiative, type:'joueur'})),
    ...ennemis.map(e=>({nom:e.nom, init:e.initiative, type:'ennemi'}))
  ].filter(x=>x.init!==null).sort((a,b)=>b.init-a.init);
  if(!all.length){ el.innerHTML='<span style="font-size:9px;color:var(--td)">Lancer l\'initiative d\'abord</span>'; return; }
  all.forEach(x => {
    el.innerHTML += `<div class="init-item ${x.type}"><span class="init-nom">${x.nom}</span><span class="init-val">${x.init}</span></div>`;
  });
}

// ---- DÉS ----
let armeActive = null;
function setActif(id){ joueurActif = joueurActif===id?null:id; armeActive=null; renderJoueursCombat(); updateDicePanel(); }
function setArme(id, arme){ joueurActif=id; armeActive=arme; renderJoueursCombat(); updateDicePanel(); }

function updateDicePanel(){
  const panel = document.getElementById('dice-context');
  if(!joueurActif){ panel.innerHTML='<div style="font-size:9px;color:var(--td)">Sélectionne un joueur pour voir ses conditions de succès</div>'; return; }
  const d = combattants[joueurActif]?.data; if(!d) return;
  let html = `<div class="ctx-joueur">${(d.nom||joueurActif).toUpperCase()}</div>`;

  if(armeActive){
    const db = WEAPONS_DB[armeActive];
    const inv = (d.inventory||[]).find(i=>i.name===armeActive);
    if(db&&db.sk){
      const tn = getTN(d, db.sk);
      html += `<div class="ctx-arme">${armeActive} · ${db.dmg}</div>`;
      html += `<div class="ctx-tn">TN <b>${tn.total}</b> = ${tn.attrVal} (attr) + ${tn.rang} (rang)${tn.tag?' + 2 (TAG)':''}</div>`;
      if(db.eff&&db.eff!=='—') html += `<div class="ctx-eff">Effets : <span style="color:var(--am)">${db.eff}</span></div>`;
      if(inv?.persoBonus) html += `<div class="ctx-eff" style="color:var(--g)">★ Atout perso : TN +2 inclus</div>`;
    }
  } else {
    html += `<div style="font-size:8px;color:var(--td);margin-top:4px">Clique sur une arme pour voir le TN</div>`;
  }
  panel.innerHTML = html;
}

function lancer2D20(){
  const tn = parseInt(document.getElementById('tn-val').value)||10;
  const d1=Math.floor(Math.random()*20)+1, d2=Math.floor(Math.random()*20)+1;
  const succes = [d1,d2].filter(v=>v<=tn).length + [d1,d2].filter(v=>v===1).length;
  const crits = [d1,d2].filter(v=>v===1).length;
  const el = document.getElementById('dice-result');
  const col = succes===0?'var(--rd)':succes>=2?'var(--g)':'var(--am)';
  el.innerHTML = `<span style="color:var(--td)">TN ${tn} → </span>
    <span style="color:${d1<=tn?'var(--g)':'var(--rd)'}">${d1}</span> /
    <span style="color:${d2<=tn?'var(--g)':'var(--rd)'}">${d2}</span>
    → <b style="color:${col}">${succes} succès</b>${crits?` <span style="color:var(--am)">+ ${crits} critique(s)</span>`:''}`;

  const nom = joueurActif ? (combattants[joueurActif]?.data?.nom||joueurActif) : 'Inconnu';
  const arme = armeActive||'action';
  addLog(`🎲 ${nom} (${arme}) TN${tn}: ${d1}/${d2} = ${succes} succès${crits?' +'+crits+'crit':''}`);
}

function lancerCD(){
  const nb = parseInt(document.getElementById('nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.filter(v=>v==='1'||v==='2').reduce((a,v)=>a+parseInt(v),0);
  const ef = vals.filter(v=>v==='★').length;
  const el = document.getElementById('cd-result');
  el.innerHTML = `${vals.join(' ')} = <b>${dmg} dmg</b>${ef?` + <span style="color:var(--am)">${ef}⚡</span>`:''}`;
  const nom = joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'Dés';
  addLog(`💥 ${nom} ${nb}DC: ${dmg} dégâts${ef?' +'+ef+'⚡':''}`);
}

// ---- LOG ----
function addLog(msg){
  const now = new Date();
  const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  log.unshift(`[${ts}] ${msg}`);
  if(log.length>30) log.pop();
  const el = document.getElementById('combat-log'); if(!el) return;
  el.innerHTML = log.map(l=>`<div class="log-line">${l}</div>`).join('');
}

function clearLog(){ log=[]; document.getElementById('combat-log').innerHTML=''; }
