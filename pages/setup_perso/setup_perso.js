const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};
const db=firebase.initializeApp(firebaseConfig).firestore();

const JOUEUR_ID=new URLSearchParams(window.location.search).get('id')||'';
const BASE_URL='https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';

const SKILLS_DEF=[
  {name:'Armes énergie',attr:'PER',key:'en_weapon'},{name:'Armes de CàC',attr:'FOR',key:'cac_weapon'},
  {name:'Armes légères',attr:'AGI',key:'light_weapon'},{name:'Armes lourdes',attr:'END',key:'heavy_weapon'},
  {name:'Athlétisme',attr:'FOR',key:'athletics'},{name:'Crochetage',attr:'PER',key:'lockpick'},
  {name:'Discours',attr:'CHR',key:'speech'},{name:'Discrétion',attr:'AGI',key:'sneak'},
  {name:'Explosifs',attr:'PER',key:'explosives'},{name:'Mains nues',attr:'FOR',key:'barehand'},
  {name:'Médecine',attr:'INT',key:'medicine'},{name:'Pilotage',attr:'PER',key:'pilot'},
  {name:'Projectiles',attr:'AGI',key:'throwing'},{name:'Réparation',attr:'INT',key:'repair'},
  {name:'Sciences',attr:'INT',key:'science'},{name:'Survie',attr:'END',key:'survival'},
  {name:'Troc',attr:'CHR',key:'barter'},
];
const PERKS_DEF={
  'Life Giver':{max:3,desc:'PV max +END par rang'},
  'Adrenalin Rush':{max:1,desc:'Si PV < max : FOR = 10'},
  'Nerd Rage!':{max:3,desc:'Si PV < 40% : +rang RD & Dmg'},
  'Barbarian':{max:1,desc:'RD phys selon FOR (sans PA)'},
  'Toughness':{max:3,desc:'+1 RD physique par rang'},
  'Snake Eater':{max:1,desc:'+2 RD Poison'},
  'Refractor':{max:3,desc:'+1 RD Énergie par rang'},
  'Rad Resistance':{max:3,desc:'+1 RD Radiation par rang'},
  'Gunslinger':{max:2,desc:'+1 Dmg armes 1 main par rang'},
  'Rifleman':{max:2,desc:'+1 Dmg armes 2 mains par rang'},
  'Iron Fist':{max:2,desc:'+1 Dmg mains nues / Vicious rang 2'},
  'Better Criticals':{max:1,desc:'Dépenser 1 Chance = critique auto'},
  'Action Boy/Girl':{max:1,desc:'2e action majeure sans malus'},
  'Awareness':{max:1,desc:'Viser courte portée = Piercing +1'},
};

// ÉTAT
let charData = {};
let sp = {S:5,P:5,E:5,C:5,I:5,A:5,L:5};
let skills = {};
let perks = {};
let tagged = [];
SKILLS_DEF.forEach(s=>skills[s.key]=0);
Object.keys(PERKS_DEF).forEach(k=>perks[k]=0);

// INIT
async function init(){
  if(!JOUEUR_ID){
    document.getElementById('hdr-name').textContent='ERREUR';
    document.getElementById('hdr-meta').textContent='Aucun ID dans l\'URL';
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

// RENDER
function render(){
  renderSpecial();
  renderSkills();
  renderPerks();
  renderSummary();
}

function renderSpecial(){
  const NAMES={S:'STRENGTH',P:'PERCEPTION',E:'ENDURANCE',C:'CHARISMA',I:'INTELLIGENCE',A:'AGILITY',L:'LUCK'};
  const DESC={S:'Force · Charge',P:'Perception · Précision',E:'Endurance · PV',C:'Charisme · Social',I:'Intelligence · Compét.',A:'Agilité · Initiative',L:'Chance · Critique'};
  const g=document.getElementById('sp-grid');g.innerHTML='';
  ['S','P','E','C','I','A','L'].forEach(k=>{
    g.innerHTML+=`<div class="sp-row">
      <span class="sp-key">${k}</span>
      <div style="flex:1">
        <span class="sp-name">${NAMES[k]}</span>
        <span class="sp-desc">${DESC[k]}</span>
      </div>
      <div class="sp-ctrl">
        <button class="sp-btn" onclick="chSP('${k}',-1)">−</button>
        <span class="sp-val">${sp[k]}</span>
        <button class="sp-btn" onclick="chSP('${k}',1)">+</button>
      </div>
    </div>`;
  });
  const total=Object.values(sp).reduce((a,b)=>a+b,0);
  const restants=40-total;document.getElementById('sp-grid').innerHTML+=`<div class="sp-total">Points restants : <span class="${restants<0?'over':''}">${restants}</span></div>`;
}

function renderSkills(){
  const g=document.getElementById('sk-grid');g.innerHTML='';
  const ATTR={S:'FOR',P:'PER',E:'END',C:'CHR',I:'INT',A:'AGI',L:'LCK'};
  const attrMap={en_weapon:'P',cac_weapon:'S',light_weapon:'A',heavy_weapon:'E',athletics:'S',lockpick:'P',speech:'C',sneak:'A',explosives:'P',barehand:'S',medicine:'I',pilot:'P',throwing:'A',repair:'I',science:'I',survival:'E',barter:'C'};
  SKILLS_DEF.forEach(sk=>{
    const r=skills[sk.key]||0;
    const tg=tagged.includes(sk.key);
    const attrKey=attrMap[sk.key]||'A';
    const attrVal={S:sp.S,P:sp.P,E:sp.E,C:sp.C,I:sp.I,A:sp.A,L:sp.L}[attrKey]||5;
    const tn=attrVal+r+(tg?2:0);
    g.innerHTML+=`<div class="sk-row">
      <span class="sk-name">${sk.name}</span>
      <button class="sk-tag${tg?' on':''}" onclick="toggleTag('${sk.key}')">${tg?'★':'TAG'}</button>
      <div class="sk-ctrl">
        <button class="sk-btn" onclick="chSk('${sk.key}',-1)">−</button>
        <span class="sk-val">${r}</span>
        <button class="sk-btn" onclick="chSk('${sk.key}',1)">+</button>
      </div>
      <span class="sk-tn">TN ${tn}</span>
    </div>`;
  });
}

function renderPerks(){
  const g=document.getElementById('pk-grid');g.innerHTML='';
  Object.entries(PERKS_DEF).forEach(([name,def])=>{
    const r=perks[name]||0;
    g.innerHTML+=`<div class="pk-row">
      <div class="pk-left">
        <div class="pk-name${r>0?' active':''}">${name}</div>
        <div class="pk-desc">${def.desc}</div>
      </div>
      <div class="pk-ctrl">
        <button class="pk-btn" onclick="chPk('${name}',-1)">−</button>
        <span class="pk-val${r>0?' active':''}">${r}/${def.max}</span>
        <button class="pk-btn" onclick="chPk('${name}',1)">+</button>
      </div>
    </div>`;
  });
}

function renderSummary(){
  const total=Object.values(sp).reduce((a,b)=>a+b,0);
  const elSp=document.getElementById('pts-special');
  const restants=40-total;
  elSp.textContent=restants;
  elSp.className='pts-val'+(restants<0?' over':restants===0?' warn':'');

  const tagCount=tagged.length;
  const elTag=document.getElementById('pts-tag');
  elTag.textContent=`${tagCount} / 3`;
  elTag.className='pts-val'+(tagCount===3?' warn':'');

  const skillTotal=Object.values(skills).reduce((a,b)=>a+b,0);
  document.getElementById('pts-skills').textContent=skillTotal;

  const perkTotal=Object.values(perks).reduce((a,b)=>a+b,0);
  document.getElementById('pts-perks').textContent=perkTotal;

  const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
  document.getElementById('pts-hp').textContent=hpMax;
}

// ACTIONS
function chSP(k,n){
  const total=Object.values(sp).reduce((a,b)=>a+b,0);
  if(n>0 && total>=40) return; // plus de points disponibles
  sp[k]=Math.max(4,Math.min(10,sp[k]+n));
  render();autoSave();
}
function chSk(k,n){skills[k]=Math.max(0,Math.min(6,(skills[k]||0)+n));render();autoSave();}
function toggleTag(k){
  if(tagged.includes(k)){tagged=tagged.filter(t=>t!==k);}
  else if(tagged.length<3){tagged.push(k);}
  else{showMsg('Maximum 3 compétences TAG !','err');return;}
  render();autoSave();
}
function chPk(n,v){perks[n]=Math.max(0,Math.min(PERKS_DEF[n]?.max||1,(perks[n]||0)+v));render();autoSave();}

// AUTO SAVE
let saveTimer=null;
function autoSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
    await db.collection('joueurs').doc(JOUEUR_ID).update({
      special:sp, skills, perks, taggedSkills:tagged,
      hp:hpMax, lastUpdate:Date.now()
    });
  },800);
}

// TERMINER
async function terminer(){
  const tagCount=tagged.length;
  if(tagCount<3){showMsg('Sélectionne 3 compétences TAG avant de continuer !','err');return;}
  const hpMax=sp.L+sp.E+Math.max(0,(charData.niveau||1)-1);
  await db.collection('joueurs').doc(JOUEUR_ID).update({
    special:sp, skills, perks, taggedSkills:tagged,
    hp:hpMax, lastUpdate:Date.now()
  });
  showMsg('✓ Personnage prêt ! Redirection...','ok');
  setTimeout(()=>window.location.href=`${BASE_URL}?id=${JOUEUR_ID}`,1200);
}

function showMsg(t,c){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}

init();
