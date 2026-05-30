const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
const XP_TABLE = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];

const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};

let db;
let joueurs = {};
let combattants = {};
let ennemis = [];
let log = [];
let joueurActif = null;
let armeActive = null;

const WEAPONS_DB = {
  'Ripper':{t:'Melee',dmg:'4D',eff:'Vicious',fr:6,rng:'—',sk:'cac_weapon'},
  'Pipe Wrench':{t:'Melee',dmg:'3D',eff:'—',fr:'—',rng:'—',sk:'cac_weapon'},
  'Combat Knife':{t:'Melee',dmg:'3D',eff:'Piercing 1',fr:'—',rng:'—',sk:'cac_weapon'},
  'Sledgehammer':{t:'Melee',dmg:'5D',eff:'—',fr:'—',rng:'—',sk:'cac_weapon'},
  'Baseball Bat':{t:'Melee',dmg:'3D',eff:'—',fr:'—',rng:'—',sk:'cac_weapon'},
  'Machete':{t:'Melee',dmg:'3D',eff:'Piercing 1',fr:'—',rng:'—',sk:'cac_weapon'},
  '.44 Pistol':{t:'Small Guns',dmg:'6D',eff:'—',fr:1,rng:'M',sk:'light_weapon'},
  '10mm Pistol':{t:'Small Guns',dmg:'4D',eff:'—',fr:2,rng:'M',sk:'light_weapon'},
  'Pipe Gun':{t:'Small Guns',dmg:'3D',eff:'—',fr:2,rng:'C',sk:'light_weapon'},
  'Pipe Revolver':{t:'Small Guns',dmg:'4D',eff:'—',fr:1,rng:'C',sk:'light_weapon'},
  'Pipe Bolt-Action':{t:'Small Guns',dmg:'6D',eff:'Piercing 1',fr:0,rng:'M',sk:'light_weapon'},
  'Hunting Rifle':{t:'Small Guns',dmg:'7D',eff:'—',fr:0,rng:'L',sk:'light_weapon'},
  'Double-Barrel Shotgun':{t:'Small Guns',dmg:'5D',eff:'Spread,Vicious',fr:0,rng:'C',sk:'light_weapon'},
  'Laser Pistol':{t:'Energy',dmg:'4D',eff:'—',fr:2,rng:'M',sk:'en_weapon'},
  'Laser Rifle':{t:'Energy',dmg:'7D',eff:'—',fr:1,rng:'L',sk:'en_weapon'},
  'Flamer':{t:'Big Guns',dmg:'5D',eff:'Persistent,Spread',fr:2,rng:'C',sk:'heavy_weapon'},
  'Minigun':{t:'Big Guns',dmg:'3D',eff:'Spread',fr:6,rng:'M',sk:'heavy_weapon'},
};

const ENNEMIS_DB = {
  'Pillard':          {pvd:'1D+2',atq:'3D',rd:0,xp:25},
  'Pillard Vétéran':  {pvd:'2D+4',atq:'4D',rd:1,xp:50},
  'Goule errante':    {pvd:'2D+2',atq:'3D',rd:0,xp:30},
  'Goule enragée':    {pvd:'2D+4',atq:'4D',rd:1,xp:60},
  'Goule irradiée':   {pvd:'3D+4',atq:'4D',rd:2,xp:80},
  'Chien sauvage':    {pvd:'1D+2',atq:'2D',rd:0,xp:15},
  'Super Mutant':     {pvd:'3D+6',atq:'5D',rd:2,xp:100},
  'Mite de vapeur':   {pvd:'2D+3',atq:'3D',rd:1,xp:45},
  'Radscorpion':      {pvd:'3D+5',atq:'4D+poison',rd:3,xp:90},
  'Mole Rat':         {pvd:'1D+3',atq:'3D',rd:0,xp:20},
  'Mirelurk':         {pvd:'3D+6',atq:'4D',rd:4,xp:110},
  'Robot Protectron': {pvd:'2D+4',atq:'3D laser',rd:3,xp:70},
  'Robot Assaultron': {pvd:'3D+5',atq:'5D laser',rd:4,xp:120},
  'Légion de Fer':    {pvd:'2D+4',atq:'4D',rd:2,xp:75},
  'Saccageur':        {pvd:'2D+3',atq:'3D',rd:1,xp:40},
  'Marchand hostile': {pvd:'1D+4',atq:'3D',rd:0,xp:35},
  'Homme de main':    {pvd:'2D+3',atq:'4D',rd:1,xp:55},
  'Brahmane sauvage': {pvd:'2D+5',atq:'3D',rd:1,xp:25},
  'Radstag':          {pvd:'1D+3',atq:'2D',rd:0,xp:10},
};

const SK_ATTR = {
  en_weapon:'P',cac_weapon:'S',light_weapon:'A',heavy_weapon:'E',
  athletics:'S',lockpick:'P',speech:'C',sneak:'A',explosives:'P',
  barehand:'S',medicine:'I',pilot:'P',throwing:'A',repair:'I',science:'I',survival:'E',barter:'C'
};
const FACES_CD = ['1','2','—','—','★','★'];

// ---- INIT ----
document.getElementById('lock-inp').addEventListener('keydown', e=>{ if(e.key==='Enter') unlock(); });

function init(){
  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();
  // Check session après init Firebase
  if(sessionStorage.getItem('mj_auth')==='1'){
    deverrouiller();
  }
}

function unlock(){
  if(document.getElementById('lock-inp').value===MJ_CODE){
    sessionStorage.setItem('mj_auth','1');
    deverrouiller();
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-inp').value='';
  }
}

function deverrouiller(){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='block';
  chargerJoueurs();
  // Charger ennemis depuis sessionStorage si venant de mj.html
  const stored = sessionStorage.getItem('combat_ennemis');
  if(stored){
    try{
      const data = JSON.parse(stored);
      data.forEach(e => ennemis.push(e));
      sessionStorage.removeItem('combat_ennemis');
      addLog(`⚔ ${ennemis.length} ennemi(s) importés depuis la page MJ`);
    }catch(e){}
  }
  renderCombat();
}

// ---- JOUEURS ----
async function chargerJoueurs(){
  const snap = await db.collection('joueurs').get();
  joueurs = {};
  snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id:doc.id}; });
  renderSelJoueurs();
}

function renderSelJoueurs(){
  const el = document.getElementById('sel-joueurs'); el.innerHTML='';
  Object.values(joueurs).forEach(d => {
    const inCombat = !!combattants[d._id];
    el.innerHTML += `<button class="sel-j-btn${inCombat?' active':''}" onclick="toggleCombattant('${d._id}')">${(d.nom||d._id).toUpperCase()}</button>`;
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
    combattants[id].initiative = (d.special?.A||5) + Math.floor(Math.random()*20)+1;
  });
  ennemis.forEach(e => { e.initiative = Math.floor(Math.random()*20)+1 + 5; });
  renderCombat();
  addLog('🎲 Initiative lancée !');
}

// ---- ENNEMIS ----
function rollDice(expr){
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if(!m) return 10;
  const nb=parseInt(m[1])||1, bonus=parseInt(m[2])||0;
  let total=bonus;
  for(let i=0;i<nb;i++) total+=Math.floor(Math.random()*6)+1;
  return total;
}

function ouvrirModalEnnemi(){
  // Peupler le select
  const sel = document.getElementById('mo-ennemi-nom');
  sel.innerHTML = Object.keys(ENNEMIS_DB).map(n=>`<option value="${n}">${n}</option>`).join('');
  document.getElementById('mo-ennemi').style.display='flex';
}

function fermerModalEnnemi(){
  document.getElementById('mo-ennemi').style.display='none';
}

function ajouterEnnemisModal(){
  const nom = document.getElementById('mo-ennemi-nom').value;
  const nb  = parseInt(document.getElementById('mo-ennemi-nb').value)||1;
  const lvl = parseInt(document.getElementById('mo-ennemi-lvl').value)||1;
  const db2 = ENNEMIS_DB[nom]; if(!db2) return;

  for(let i=0;i<nb;i++){
    const pvMax = Math.round(rollDice(db2.pvd) * (1 + (lvl-1)*0.25));
    const rd = db2.rd + Math.floor((lvl-1)/2);
    const label = nb>1 ? `${nom} ${i+1}` : nom;
    ennemis.push({id:Date.now()+i, nom:label, pvd:db2.pvd, pvMax, pvCur:pvMax, atq:db2.atq, rd, xp:db2.xp*lvl, initiative:null});
    addLog(`➕ ${label} (PV:${pvMax} RD:${rd})`);
  }
  fermerModalEnnemi();
  renderCombat();
}

function dmgEnnemi(id, val){
  const e = ennemis.find(e=>e.id===id); if(!e) return;
  const after = Math.max(0, e.pvCur - val);
  addLog(`⚔ ${e.nom} : ${e.pvCur}→${after} PV (-${val})`);
  e.pvCur = after;
  if(e.pvCur<=0) addLog(`💀 ${e.nom} éliminé !`);
  renderCombat();
}

function supprimerEnnemi(id){
  ennemis = ennemis.filter(e=>e.id!==id);
  renderCombat();
}

// ---- RENDER ----
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
  const map = {S:d.special?.S||5,P:d.special?.P||5,E:d.special?.E||5,C:d.special?.C||5,I:d.special?.I||5,A:d.special?.A||5,L:d.special?.L||5};
  const rang = d.skills?.[skKey]||0;
  const tag = d.taggedSkills?.includes(skKey)?2:0;
  return {total:map[attr]+rang+tag, attrVal:map[attr], rang, tag};
}

function renderJoueursCombat(){
  const el = document.getElementById('joueurs-combat'); el.innerHTML='';
  const ids = Object.keys(combattants);
  if(!ids.length){ el.innerHTML='<div class="empty">Aucun joueur — sélectionner ci-dessus</div>'; return; }
  ids.forEach(id => {
    const {data:d, initiative} = combattants[id];
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const isActif = joueurActif===id;
    const weapsEq = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');
    const rad = d.rad||0;

    el.innerHTML += `<div class="jc-card${isActif?' actif':''}" onclick="setActif('${id}')">
      <div class="jc-top">
        <span class="jc-name">${(d.nom||id).toUpperCase()}</span>
        <span class="jc-init">${initiative!==null?initiative:'—'}</span>
      </div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${barColor}"></div></div>
      <div class="jc-row">
        <div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv${pct<30?' danger':pct<60?' warn':''}">${d.hp||0}/${hpMax}</span></div>
        <div class="jc-stat"><span class="jc-sl">RAD</span><span class="jc-sv${rad>0?' warn':''}">${rad}</span></div>
        <div class="jc-stat"><span class="jc-sl">LVL</span><span class="jc-sv">${d.niveau||1}</span></div>
      </div>
      ${weapsEq.map(inv => {
        const db = WEAPONS_DB[inv.name]||{};
        const tn = db.sk?getTN(d,db.sk):null;
        return `<div class="jc-arme${isActif?' clickable':''}" ${isActif?`onclick="event.stopPropagation();setArme('${id}','${inv.name}')"`:''}">
          <span class="jc-arme-name">${inv.name}${inv.persoBonus?' ★':''}</span>
          <span class="jc-arme-stat">${db.dmg||'?'} · FR${db.fr??'—'}${tn?` · <b>TN${tn.total}</b>`:''}${db.eff&&db.eff!=='—'?` · <span style="color:var(--am)">${db.eff}</span>`:''}</span>
        </div>`;
      }).join('')}
    </div>`;
  });
}

function renderEnnemis(){
  const el = document.getElementById('ennemis-combat'); el.innerHTML='';
  if(!ennemis.length){ el.innerHTML='<div class="empty">Aucun ennemi</div>'; return; }
  ennemis.forEach(e => {
    const pct = Math.round(e.pvCur/e.pvMax*100);
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    el.innerHTML += `<div class="ennemi-card${e.pvCur<=0?' dead':''}">
      <div class="jc-top">
        <span class="ennemi-name">${e.nom}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="jc-init">${e.initiative!==null?e.initiative:'—'}</span>
          <button class="e-del" onclick="supprimerEnnemi(${e.id})">✕</button>
        </div>
      </div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${bc}"></div></div>
      <div class="jc-row">
        <div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv${pct<30?' danger':''}">${e.pvCur}/${e.pvMax}</span></div>
        <div class="jc-stat"><span class="jc-sl">ATQ</span><span class="jc-sv">${e.atq}</span></div>
        <div class="jc-stat"><span class="jc-sl">RD</span><span class="jc-sv">${e.rd}</span></div>
        <div class="jc-stat"><span class="jc-sl">XP</span><span class="jc-sv">${e.xp}</span></div>
      </div>
      <div class="ennemi-dmg">
        <input type="number" class="dmg-inp" id="dmg-${e.id}" value="1" min="0">
        <button class="dmg-btn" onclick="dmgEnnemi(${e.id},parseInt(document.getElementById('dmg-${e.id}').value)||1)">Dégâts</button>
      </div>
    </div>`;
  });
}

function renderInitiative(){
  const el = document.getElementById('initiative-list'); el.innerHTML='';
  const all = [
    ...Object.entries(combattants).map(([id,c])=>({nom:(c.data.nom||id).toUpperCase(),init:c.initiative,type:'joueur'})),
    ...ennemis.map(e=>({nom:e.nom,init:e.initiative,type:'ennemi'}))
  ].filter(x=>x.init!==null).sort((a,b)=>b.init-a.init);
  if(!all.length){ el.innerHTML='<span class="empty">Lance l\'initiative d\'abord</span>'; return; }
  all.forEach(x => {
    el.innerHTML += `<div class="init-item ${x.type}"><span>${x.nom}</span><b>${x.init}</b></div>`;
  });
}

// ---- DÉS ----
function setActif(id){ joueurActif = joueurActif===id?null:id; armeActive=null; renderJoueursCombat(); updateDicePanel(); }
function setArme(id, arme){ joueurActif=id; armeActive=arme; renderJoueursCombat(); updateDicePanel(); }

function updateDicePanel(){
  const panel = document.getElementById('dice-context');
  if(!joueurActif){ panel.innerHTML='<div class="empty">Sélectionne un joueur puis une arme</div>'; return; }
  const d = combattants[joueurActif]?.data; if(!d) return;
  let html = `<div class="ctx-nom">${(d.nom||joueurActif).toUpperCase()}</div>`;
  if(armeActive){
    const db = WEAPONS_DB[armeActive];
    const inv = (d.inventory||[]).find(i=>i.name===armeActive);
    if(db?.sk){
      const tn = getTN(d,db.sk);
      const tnFinal = tn.total + (inv?.persoBonus?2:0);
      html += `<div class="ctx-arme">${armeActive} · <b>${db.dmg}</b>${db.eff&&db.eff!=='—'?` · <span style="color:var(--am)">${db.eff}</span>`:''}</div>`;
      html += `<div class="ctx-tn">TN <b style="color:var(--tb);font-size:14px">${tnFinal}</b> = ${tn.attrVal}+${tn.rang}${tn.tag?'+2(TAG)':''}${inv?.persoBonus?'+2(★)':''}</div>`;
      document.getElementById('tn-val').value = tnFinal;
    }
  } else {
    html += '<div class="empty" style="margin-top:4px">Clique sur une arme</div>';
  }
  panel.innerHTML = html;
}

function lancer2D20(){
  const tn = parseInt(document.getElementById('tn-val').value)||10;
  const d1=Math.floor(Math.random()*20)+1, d2=Math.floor(Math.random()*20)+1;
  const vals=[d1,d2];
  let succes = vals.filter(v=>v<=tn).length;
  const crits = vals.filter(v=>v===1).length;
  succes += crits;
  const col = succes===0?'var(--rd)':succes>=3?'var(--g)':'var(--am)';
  document.getElementById('dice-result').innerHTML =
    `<span style="color:${d1<=tn?'var(--g)':'var(--rd)'};font-family:Oswald,sans-serif;font-size:18px">${d1}</span>
     <span style="color:var(--td)"> / </span>
     <span style="color:${d2<=tn?'var(--g)':'var(--rd)'};font-family:Oswald,sans-serif;font-size:18px">${d2}</span>
     <span style="color:var(--td)"> → </span>
     <b style="color:${col};font-family:Oswald,sans-serif;font-size:16px">${succes} succès</b>
     ${crits?`<span style="color:var(--am)"> +${crits}★</span>`:''}`;
  const nom = joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'?';
  addLog(`🎲 ${nom}${armeActive?' ('+armeActive+')':''} TN${tn}: ${d1}/${d2} = ${succes}s${crits?' +'+crits+'★':''}`);
}

function lancerCD(){
  const nb = parseInt(document.getElementById('nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.filter(v=>v==='1'||v==='2').reduce((a,v)=>a+parseInt(v),0);
  const ef = vals.filter(v=>v==='★').length;
  document.getElementById('cd-result').innerHTML =
    `${vals.map(v=>`<span style="color:${v==='★'?'var(--am)':v==='—'?'var(--td)':'var(--tb)'};font-family:Oswald,sans-serif;font-size:16px">${v}</span>`).join(' ')}
     <span style="color:var(--td)"> → </span>
     <b style="color:var(--am)">${dmg}dmg</b>${ef?` <span style="color:var(--am)">+${ef}⚡</span>`:''}`;
  const nom = joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'?';
  addLog(`💥 ${nom} ${nb}DC: ${dmg}dmg${ef?' +'+ef+'⚡':''}`);
}

// ---- LOG ----
function addLog(msg){
  const ts = new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
  log.unshift(`[${ts}] ${msg}`);
  if(log.length>40) log.pop();
  const el = document.getElementById('combat-log'); if(!el) return;
  el.innerHTML = log.map(l=>`<div class="log-line">${l}</div>`).join('');
}
function clearLog(){ log=[]; document.getElementById('combat-log').innerHTML=''; }
