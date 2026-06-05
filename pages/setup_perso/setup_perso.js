// firebaseConfig défini dans common/shared.js
const db=firebase.initializeApp(firebaseConfig).firestore();
  if(typeof fpActivateAppCheck==="function") fpActivateAppCheck();

const JOUEUR_ID=new URLSearchParams(window.location.search).get('id')||'';
const BASE_URL='https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';

// SKILLS_DEF défini dans common/shared.js
// PERKS_DEF chargé depuis /data/perks.json via common/db.js

// ÉTAT
let charData = {};
let sp = {S:5,P:5,E:5,C:5,I:5,A:5,L:5};
let skills = {};
let perks = {};
let tagged = [];

function skillBudget(){ return 9 + sp.I; }
function skillSpent(){ return Object.values(skills).reduce((a,b)=>a+b,0); }
function skillRestants(){ return skillBudget() - skillSpent(); }
function perkChoisi(){ return Object.values(perks).some(v=>v>0); }

// Vérifie si les requirements d'un perk sont remplis
function reqOk(perkName){
  const def=PERKS_DEF[perkName];
  if(!def.req||def.req.length===0) return true;
  const attrMap={S:sp.S,P:sp.P,E:sp.E,C:sp.C,I:sp.I,A:sp.A,L:sp.L};
  return def.req.every(r=>attrMap[r.s]>=r.min);
}

// INIT
async function init(){
  if(!JOUEUR_ID){
    document.getElementById('hdr-name').textContent='ERREUR';
    document.getElementById('hdr-meta').textContent="Aucun ID dans l'URL";
    return;
  }
  const snap=await db.collection('joueurs').doc(JOUEUR_ID).get();
  if(!snap.exists){window.location.href='/FalloutParis/pages/creation_perso/creation_perso.html';return;}
  charData=snap.data();
  sp={...charData.special}||{S:5,P:5,E:5,C:5,I:5,A:5,L:5};
  skills={...charData.skills}||{};
  perks={...charData.perks}||{};
  tagged=[...(charData.taggedSkills||[])];
  document.getElementById('hdr-name').textContent=(charData.nom||JOUEUR_ID).toUpperCase();
  document.getElementById('hdr-meta').textContent=`${charData.origine||'—'} · LVL ${charData.niveau||1}`;
  render();
}

function render(){ renderSpecial(); renderSkills(); renderPerks(); renderSummary(); }

function renderSpecial(){
  const NAMES={S:'STRENGTH',P:'PERCEPTION',E:'ENDURANCE',C:'CHARISMA',I:'INTELLIGENCE',A:'AGILITY',L:'LUCK'};
  const DESC={S:'Force · Charge',P:'Perception · Précision',E:'Endurance · PV',C:'Charisme · Social',I:'Intelligence · Compét.',A:'Agilité · Initiative',L:'Chance · Critique'};
  const g=document.getElementById('sp-grid');g.innerHTML='';
  ['S','P','E','C','I','A','L'].forEach(k=>{
    g.innerHTML+=`<div class="sp-row">
      <span class="sp-key">${k}</span>
      <div style="flex:1"><span class="sp-name">${NAMES[k]}</span><span class="sp-desc">${DESC[k]}</span></div>
      <div class="sp-ctrl">
        <button class="sp-btn" onclick="chSP('${k}',-1)">−</button>
        <span class="sp-val">${sp[k]}</span>
        <button class="sp-btn" onclick="chSP('${k}',1)">+</button>
      </div>
    </div>`;
  });
  const restants=40-Object.values(sp).reduce((a,b)=>a+b,0);
  g.innerHTML+=`<div class="sp-total">Points restants : <span>${restants}</span></div>`;
}

function renderSkills(){
  const g=document.getElementById('sk-grid');g.innerHTML='';
  const attrMap={en_weapon:'P',cac_weapon:'S',light_weapon:'A',heavy_weapon:'E',athletics:'S',lockpick:'P',speech:'C',sneak:'A',explosives:'P',barehand:'S',medicine:'I',pilot:'P',throwing:'A',repair:'I',science:'I',survival:'E',barter:'C'};
  const restants=skillRestants();
  SKILLS_DEF.forEach(sk=>{
    const r=skills[sk.key]||0;
    const tg=tagged.includes(sk.key);
    const attrKey=attrMap[sk.key]||'A';
    const attrVal={S:sp.S,P:sp.P,E:sp.E,C:sp.C,I:sp.I,A:sp.A,L:sp.L}[attrKey]||5;
    const tn=attrVal+r+(tg?2:0);
    const canAdd=restants>0&&r<3;
    g.innerHTML+=`<div class="sk-row">
      <span class="sk-name">${sk.name}</span>
      <button class="sk-tag${tg?' on':''}" onclick="toggleTag('${sk.key}')">${tg?'★':'TAG'}</button>
      <div class="sk-ctrl">
        <button class="sk-btn" onclick="chSk('${sk.key}',-1)" ${r===0?'disabled':''}>−</button>
        <span class="sk-val">${r}</span>
        <button class="sk-btn" onclick="chSk('${sk.key}',1)" ${!canAdd?'disabled':''}>+</button>
      </div>
      <span class="sk-tn">TN ${tn}</span>
    </div>`;
  });
}

function renderPerks(){
  const g=document.getElementById('pk-grid');
  g.innerHTML='<div class="tag-info">Choisis <span>1 seule perk</span> parmi celles disponibles à ton niveau.<br>Les prérequis SPECIAL doivent être remplis.</div>';
  const dejaChoisi=perkChoisi();
  Object.entries(PERKS_DEF).forEach(([name,def])=>{
    // Uniquement perks LVL 1
    if(def.lvl>1) return;
    const r=perks[name]||0;
    const ok=reqOk(name);
    const reqTxt=def.req&&def.req.length>0?def.req.map(r=>`${r.s}≥${r.min}`).join(', '):'Aucun';
    const disabled=!ok||(dejaChoisi&&r===0);
    g.innerHTML+=`<div class="pk-row${!ok?' pk-disabled':''}${r>0?' pk-active':''}">
      <div class="pk-left">
        <div class="pk-name${r>0?' active':''}">${name} ${r>0?'✓':''}</div>
        <div class="pk-desc">${def.desc}</div>
        <div style="font-size:7px;color:${ok?'var(--gd)':'var(--rd)'};margin-top:2px">Prérequis : ${reqTxt}</div>
      </div>
      <div class="pk-ctrl">
        ${r>0?`<button class="pk-btn" onclick="chPk('${name}',0)">✕</button>`
             :`<button class="pk-btn" onclick="chPk('${name}',1)" ${disabled?'disabled':''}>+</button>`}
      </div>
    </div>`;
  });
}

function renderSummary(){
  const total=Object.values(sp).reduce((a,b)=>a+b,0);
  const spRestants=40-total;
  const elSp=document.getElementById('pts-special');
  elSp.textContent=spRestants;
  elSp.className='pts-val'+(spRestants===0?' warn':'');

  const tagCount=tagged.length;
  const elTag=document.getElementById('pts-tag');
  elTag.textContent=`${tagCount} / 3`;
  elTag.className='pts-val'+(tagCount===3?' warn':'');

  const skRest=skillRestants();
  const elSk=document.getElementById('pts-skills');
  elSk.textContent=skRest;
  elSk.className='pts-val'+(skRest===0?' warn':skRest<0?' over':'');

  const perkCount=Object.values(perks).filter(v=>v>0).length;
  const elPk=document.getElementById('pts-perks');
  elPk.textContent=`${perkCount} / 1`;
  elPk.className='pts-val'+(perkCount===1?' warn':'');

  const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
  document.getElementById('pts-hp').textContent=hpMax;
}

// ACTIONS
function chSP(k,n){
  const total=Object.values(sp).reduce((a,b)=>a+b,0);
  if(n>0&&total>=40) return;
  sp[k]=Math.max(4,Math.min(10,sp[k]+n));
  render();autoSave();
}
function chSk(k,n){
  if(n>0){
    if(skillRestants()<=0){showMsg('Plus de points de compétence !','err');return;}
    if((skills[k]||0)>=3){showMsg('Maximum 3 rangs à la création !','err');return;}
  }
  skills[k]=Math.max(0,Math.min(3,skills[k]+n));
  render();autoSave();
}
function toggleTag(k){
  if(tagged.includes(k)){tagged=tagged.filter(t=>t!==k);}
  else if(tagged.length<3){tagged.push(k);}
  else{showMsg('Maximum 3 compétences TAG !','err');return;}
  render();autoSave();
}
function chPk(name,val){
  // Remettre toutes les perks à 0 d'abord (1 seule autorisée)
  Object.keys(perks).forEach(k=>perks[k]=0);
  if(val>0&&reqOk(name)) perks[name]=1;
  render();autoSave();
}

let saveTimer=null;
function autoSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
    await db.collection('joueurs').doc(JOUEUR_ID).update({
      special:sp,skills,perks,taggedSkills:tagged,hp:hpMax,lastUpdate:Date.now()
    });
  },800);
}

async function terminer(){
  if(tagged.length<3){showMsg('Sélectionne 3 compétences TAG !','err');return;}
  const spTotal=Object.values(sp).reduce((a,b)=>a+b,0);
  if(spTotal<40){showMsg(`Il reste ${40-spTotal} point(s) SPECIAL à dépenser !`,'err');return;}
  if(skillRestants()>0){showMsg(`Il reste ${skillRestants()} point(s) de compétence à dépenser !`,'err');return;}
  const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
  await db.collection('joueurs').doc(JOUEUR_ID).update({
    special:sp,skills,perks,taggedSkills:tagged,hp:hpMax,lastUpdate:Date.now()
  });
  showMsg('✓ Personnage prêt ! Redirection...','ok');
  setTimeout(()=>window.location.href=`${BASE_URL}?id=${JOUEUR_ID}`,1200);
}

function showMsg(t,c){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}

window.DB_READY.then(() => {
  SKILLS_DEF.forEach(s => skills[s.key] = 0);
  Object.keys(PERKS_DEF).forEach(k => perks[k] = 0);
  init();
});
