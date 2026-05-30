// ---- CONFIG ----
const MJ_CODE = '1234'; // ← CHANGE CE CODE !
const BASE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';

// firebaseConfig défini dans common/shared.js
const db=firebase.initializeApp(firebaseConfig).firestore();

// ---- LOCK ----
document.getElementById('lock-input').addEventListener('keydown',e=>{if(e.key==='Enter')unlock();});
function unlock(){
  const v=document.getElementById('lock-input').value;
  if(v===MJ_CODE){
    document.getElementById('lock').style.display='none';
    document.getElementById('app').style.display='block';
    chargerListe().then(()=>{
      // Si un id est dans l'URL, charger ce perso automatiquement
      const urlId=new URLSearchParams(window.location.search).get('id');
      if(urlId) charger(urlId);
    });
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-input').value='';
  }
}

// ---- DONNÉES ----
// SKILLS_DEF défini dans common/shared.js
// PERKS_DEF chargé depuis /data/perks.json via common/db.js
const ALL_ITEMS=[
  // Armes
  {n:'Pipe Wrench',t:'WEAPON',w:0.9},{n:'.44 Pistol',t:'WEAPON',w:1.8},
  {n:'10mm Pistol',t:'WEAPON',w:1.4},{n:'Hunting Rifle',t:'WEAPON',w:4.5},
  {n:'Laser Pistol',t:'WEAPON',w:1.8},{n:'Combat Knife',t:'WEAPON',w:0.5},
  {n:'Sledgehammer',t:'WEAPON',w:5.4},{n:'Minigun',t:'WEAPON',w:18.6},
  // Armures
  {n:'Casque en métal lourd',t:'ARMOR',w:5.44,z:'Head'},{n:'Casque de combat',t:'ARMOR',w:1.81,z:'Head'},
  {n:'Plastron de combat renforcé',t:'ARMOR',w:5.44,z:'Torso'},{n:'Plastron en métal lourd',t:'ARMOR',w:10.43,z:'Torso'},
  {n:'Jambières de combat',t:'ARMOR',w:0.91,z:'Leg'},{n:'Brassard de combat',t:'ARMOR',w:0.91,z:'Arm'},
  {n:'Plastron T-51',t:'POWERARMOR',w:82,z:'Torso'},{n:'Casque T-51',t:'POWERARMOR',w:27.2,z:'Head'},
  // Aide
  {n:'Stimpak',t:'DRUGS',w:0.05},{n:'Super Stimpak',t:'DRUGS',w:0.05},
  {n:'RadAway',t:'DRUGS',w:0.05},{n:'Rad-X',t:'DRUGS',w:0.05},
  {n:'Med-X',t:'DRUGS',w:0.05},{n:'Jet',t:'DRUGS',w:0.05},
  {n:'Nuka-Cola',t:'DRINK',w:0.45},{n:'Purified Water',t:'DRINK',w:0.09},
  {n:'Bloodbug Steak',t:'FOOD',w:0.09},{n:'Grilled Radstag',t:'FOOD',w:0.45},
  // Divers
  {n:'Bobby Pin',t:'STUFF',w:0.01},{n:'First Aid Kit',t:'STUFF',w:0},
  {n:'Lock Pick Set',t:'STUFF',w:0},
];

// ---- ÉTAT ÉDITEUR ----
let currentId = null;
let editData = {};
let editSkills = {};
let editPerks = {};
let editInventory = [];
let editAmmo = [];
let editTagged = [];

// ---- LISTE ----
async function chargerListe(){
  const el=document.getElementById('perso-list');
  try{
    const snap=await db.collection('joueurs').get();
    el.innerHTML='';
    if(snap.empty){el.innerHTML='<div style="font-size:9px;color:var(--td)">Aucun personnage</div>';return;}
    snap.forEach(doc=>{
      const d=doc.data();
      const hpMax=(d.special?.L||5)+(d.special?.E||5)+Math.max(0,(d.niveau||1)-1);
      el.innerHTML+=`<div class="perso-item${currentId===doc.id?' selected':''}" onclick="charger('${doc.id}')">
        <div class="pi-name">${d.nom||doc.id}</div>
        <div class="pi-info">${d.origine||'—'} · LVL ${d.niveau||1} · PV ${d.hp||0}/${hpMax}</div>
      </div>`;
    });
  }catch(e){el.innerHTML=`<div style="color:var(--rd);font-size:9px">${e.message}</div>`;}
}

// ---- CHARGER ----
async function charger(id){
  currentId=id;
  const snap=await db.collection('joueurs').doc(id).get();
  if(!snap.exists)return;
  const d=snap.data();
  editData={...d};
  editSkills={...d.skills}||{};
  editPerks={...d.perks}||{};
  editInventory=[...(d.inventory||[])];
  editAmmo=[...(d.ammo||[])];
  editTagged=[...(d.taggedSkills||[])];

  // Remplir infos
  document.getElementById('e-id').value=id;
  document.getElementById('e-code').value=d.code||'';
  document.getElementById('e-nom').value=d.nom||'';
  document.getElementById('e-origine').value=d.origine||'';
  document.getElementById('e-niveau').value=d.niveau||1;
  document.getElementById('e-xp').value=d.xp||0;
  document.getElementById('e-hp').value=d.hp||0;
  document.getElementById('e-rad').value=d.rad||0;
  document.getElementById('e-pa').value=String(d.powerArmor||false);
  document.getElementById('e-link').href=`${BASE_URL}?id=${id}`;
  document.getElementById('editor-title').textContent=`Édition — ${d.nom||id}`;

  renderSpecial(d.special||{S:5,P:5,E:5,C:5,I:5,A:5,L:5});
  renderSkills();
  renderPerks();
  renderInventory();
  renderAmmo();
  populateInvSelect();

  document.getElementById('editor').style.display='block';
  document.getElementById('placeholder').style.display='none';
  chargerListe();
}

// ---- SPECIAL ----
function renderSpecial(sp){
  const g=document.getElementById('sp-grid');
  const NAMES={S:'STRENGTH',P:'PERCEPTION',E:'ENDURANCE',C:'CHARISMA',I:'INTELLIGENCE',A:'AGILITY',L:'LUCK'};
  g.innerHTML='';
  ['S','P','E','C','I','A','L'].forEach(k=>{
    g.innerHTML+=`<div class="sp-row">
      <span class="sp-key">${k}</span>
      <span class="sp-name">${NAMES[k]}</span>
      <input class="sp-input" type="number" id="sp-${k}" value="${sp[k]||5}" min="1" max="10">
    </div>`;
  });
}

// ---- SKILLS ----
function renderSkills(){
  const g=document.getElementById('sk-grid');g.innerHTML='';
  SKILLS_DEF.forEach(sk=>{
    const r=editSkills[sk.key]||0;
    const tg=editTagged.includes(sk.key);
    g.innerHTML+=`<div class="sk-row">
      <span class="sk-name">${sk.name}</span>
      <span class="sk-tag${tg?' on':''}" onclick="toggleTag('${sk.key}')">${tg?'★ TAG':'TAG'}</span>
      <div class="sk-rank">
        <button onclick="chSkill('${sk.key}',-1)">−</button>
        <span class="sk-val">${r}</span>
        <button onclick="chSkill('${sk.key}',1)">+</button>
      </div>
    </div>`;
  });
}
function chSkill(k,n){editSkills[k]=Math.max(0,Math.min(6,(editSkills[k]||0)+n));renderSkills();}
function toggleTag(k){
  if(editTagged.includes(k))editTagged=editTagged.filter(t=>t!==k);
  else editTagged.push(k);
  renderSkills();
}

// ---- PERKS ----
function renderPerks(){
  const g=document.getElementById('pk-grid');g.innerHTML='';
  Object.entries(PERKS_DEF).forEach(([name,def])=>{
    const r=editPerks[name]||0;
    g.innerHTML+=`<div class="perk-row">
      <span class="perk-name">${name}</span>
      <div class="perk-rank">
        <button onclick="chPerk('${name}',-1)">−</button>
        <span class="perk-val${r>0?' active':''}">${r}/${def.max}</span>
        <button onclick="chPerk('${name}',1)">+</button>
      </div>
    </div>`;
  });
}
function chPerk(n,v){editPerks[n]=Math.max(0,Math.min(PERKS_DEF[n]?.max||1,(editPerks[n]||0)+v));renderPerks();}

// ---- INVENTAIRE ----
function renderInventory(){
  const g=document.getElementById('inv-grid');g.innerHTML='';
  editInventory.forEach((it,i)=>{
    g.innerHTML+=`<div class="inv-row">
      <span class="inv-name">${it.name}</span>
      <span style="font-size:7px;color:var(--td);min-width:50px">${it.type}</span>
      <button class="inv-btn" onclick="chInvQty(${i},-1)">−</button>
      <span class="inv-qty">${it.qty}</span>
      <button class="inv-btn" onclick="chInvQty(${i},1)">+</button>
      <button class="inv-btn" style="color:var(--rd)" onclick="rmInvItem(${i})">✕</button>
    </div>`;
  });
}
function chInvQty(i,n){editInventory[i].qty=Math.max(0,editInventory[i].qty+n);renderInventory();}
function rmInvItem(i){editInventory.splice(i,1);renderInventory();}
function populateInvSelect(){
  const sel=document.getElementById('inv-add-sel');
  sel.innerHTML='<option value="">+ Ajouter un objet...</option>';
  ALL_ITEMS.forEach(it=>sel.innerHTML+=`<option value="${it.n}">${it.n} (${it.t})</option>`);
}
function addInvItem(){
  const name=document.getElementById('inv-add-sel').value;
  if(!name)return;
  const db2=ALL_ITEMS.find(i=>i.n===name);if(!db2)return;
  const exist=editInventory.find(i=>i.name===name);
  if(exist){exist.qty++;renderInventory();return;}
  const item={name,type:db2.t,qty:1,w:db2.w||0,equipped:false};
  if(db2.z)item.zone=db2.z;
  if(db2.t==='WEAPON')item.persoBonus=false;
  editInventory.push(item);
  document.getElementById('inv-add-sel').value='';
  renderInventory();
}

// ---- AMMO ----
function renderAmmo(){
  const g=document.getElementById('ammo-grid');g.innerHTML='';
  editAmmo.forEach((a,i)=>{
    g.innerHTML+=`<div class="inv-row">
      <span class="inv-name">${a.cal}</span>
      <button class="inv-btn" onclick="chAmmoQty(${i},-10)">−10</button>
      <button class="inv-btn" onclick="chAmmoQty(${i},-1)">−</button>
      <span class="inv-qty">${a.qty}</span>
      <button class="inv-btn" onclick="chAmmoQty(${i},1)">+</button>
      <button class="inv-btn" onclick="chAmmoQty(${i},10)">+10</button>
      <button class="inv-btn" style="color:var(--rd)" onclick="rmAmmo(${i})">✕</button>
    </div>`;
  });
}
function chAmmoQty(i,n){editAmmo[i].qty=Math.max(0,editAmmo[i].qty+n);renderAmmo();}
function rmAmmo(i){editAmmo.splice(i,1);renderAmmo();}
function addAmmo(){
  const cal=document.getElementById('ammo-cal').value.trim();
  if(!cal)return;
  editAmmo.push({cal,qty:0});
  document.getElementById('ammo-cal').value='';
  renderAmmo();
}

// ---- TABS ----
function swTab(tab){
  document.querySelectorAll('.etab').forEach((el,i)=>{
    el.classList.toggle('on',['infos','special','skills','perks','inventaire'][i]===tab);
  });
  document.querySelectorAll('.etcontent').forEach(el=>el.classList.remove('on'));
  document.getElementById('et-'+tab).classList.add('on');
}

// ---- SAUVEGARDER ----
async function sauvegarder(){
  if(!currentId)return;
  const special={};
  ['S','P','E','C','I','A','L'].forEach(k=>{
    special[k]=Math.min(10,Math.max(1,parseInt(document.getElementById('sp-'+k)?.value)||5));
  });
  const niveau=parseInt(document.getElementById('e-niveau').value)||1;
  const data={
    nom:document.getElementById('e-nom').value.trim(),
    origine:document.getElementById('e-origine').value.trim(),
    code:document.getElementById('e-code').value.trim()||editData.code||'0000',
    niveau,
    xp:parseInt(document.getElementById('e-xp').value)||0,
    hp:parseInt(document.getElementById('e-hp').value)||0,
    rad:parseInt(document.getElementById('e-rad').value)||0,
    powerArmor:document.getElementById('e-pa').value==='true',
    special,
    skills:editSkills,
    perks:editPerks,
    taggedSkills:editTagged,
    inventory:editInventory,
    ammo:editAmmo,
    wounds:editData.wounds||{head:false,torso:false,armL:false,armR:false,legL:false,legR:false},
    lastUpdate:Date.now(),
  };
  try{
    await db.collection('joueurs').doc(currentId).set(data,{merge:false});
    showMsg('✓ Sauvegardé !','ok');
    chargerListe();
    document.getElementById('editor-title').textContent=`Édition — ${data.nom}`;
  }catch(e){showMsg('Erreur : '+e.message,'err');}
}

// ---- SUPPRIMER ----
async function supprimer(){
  if(!currentId)return;
  if(!confirm(`Supprimer ${currentId} définitivement ?`))return;
  await db.collection('joueurs').doc(currentId).delete();
  currentId=null;
  document.getElementById('editor').style.display='none';
  document.getElementById('placeholder').style.display='block';
  chargerListe();
}

// ---- NOUVEAU ----
function nouveauPerso(){
  currentId='nouveau_'+Date.now();
  editData={};editSkills={};editPerks={};editInventory=[];editAmmo=[];editTagged=[];
  document.getElementById('e-id').value=currentId;
  document.getElementById('e-code').value='';
  document.getElementById('e-nom').value='';
  document.getElementById('e-origine').value='';
  document.getElementById('e-niveau').value=1;
  document.getElementById('e-xp').value=0;
  document.getElementById('e-hp').value=10;
  document.getElementById('e-rad').value=0;
  document.getElementById('e-pa').value='false';
  document.getElementById('e-link').href='#';
  document.getElementById('editor-title').textContent='Nouveau personnage';
  renderSpecial({S:5,P:5,E:5,C:5,I:5,A:5,L:5});
  renderSkills();renderPerks();renderInventory();renderAmmo();populateInvSelect();
  document.getElementById('editor').style.display='block';
  document.getElementById('placeholder').style.display='none';
  // Laisser l'ID modifiable pour un nouveau perso
  document.getElementById('e-id').removeAttribute('readonly');
  document.getElementById('e-id').style.opacity='1';
}

function showMsg(t,c){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}