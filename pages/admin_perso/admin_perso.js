// ---- CONFIG ----
const MJ_CODE = '1234'; // ← CHANGE CE CODE !
const BASE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';

// firebaseConfig défini dans common/shared.js
const db=firebase.initializeApp(firebaseConfig).firestore();

// ---- LOCK ----
document.getElementById('lock-input').addEventListener('keydown',e=>{if(e.key==='Enter')unlock();});
function enterApp(){
  document.getElementById('lock').style.display='none';
  document.getElementById('app').style.display='block';
  chargerListe().then(()=>{
    // Si un id est dans l'URL, charger ce perso automatiquement
    const urlId=new URLSearchParams(window.location.search).get('id');
    if(urlId) charger(urlId);
  });
}
function unlock(){
  const v=document.getElementById('lock-input').value;
  if(v===MJ_CODE){
    sessionStorage.setItem('mj_auth','1');   // partagé avec l'écran MJ
    enterApp();
  } else {
    document.getElementById('lock-err').style.display='block';
    document.getElementById('lock-input').value='';
  }
}
// Déjà authentifié sur l'écran MJ → pas de mot de passe
if(sessionStorage.getItem('mj_auth')==='1') enterApp();

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
let editCompanions = [];

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
  editCompanions=JSON.parse(JSON.stringify(d.companions||[]));

  // Remplir infos
  document.getElementById('e-id').value=id;
  document.getElementById('e-code').value=d.code||'';
  document.getElementById('e-nom').value=d.nom||'';
  document.getElementById('e-origine').value=d.origine||'';
  document.getElementById('e-faction').value=d.faction||'';
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
  populateCompBaseSel();
  renderCompanions();

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
let _modsOpen = -1;
const _MODDABLE = { weapon:['WEAPON'], armor:['ARMOR','POWERARMOR','CLOTHING','OUTFIT'] };
function _itemModKind(it){
  if(it.type==='WEAPON') return 'weapon';
  if(_MODDABLE.armor.includes(it.type)) return 'armor';
  return null;
}
function renderInventory(){
  const g=document.getElementById('inv-grid');g.innerHTML='';
  editInventory.forEach((it,i)=>{
    const kind=_itemModKind(it);
    const nbMods = it.mods ? Object.values(it.mods).filter(Boolean).length : 0;
    g.innerHTML+=`<div class="inv-row">
      <span class="inv-name">${it.name}${nbMods?` <span style="color:var(--am);font-size:7px">🔧${nbMods}</span>`:''}</span>
      <span style="font-size:7px;color:var(--td);min-width:50px">${it.type}</span>
      ${kind?`<button class="inv-btn" title="Mods" onclick="toggleMods(${i})">🔧</button>`:''}
      <button class="inv-btn" onclick="chInvQty(${i},-1)">−</button>
      <span class="inv-qty">${it.qty}</span>
      <button class="inv-btn" onclick="chInvQty(${i},1)">+</button>
      <button class="inv-btn" style="color:var(--rd)" onclick="rmInvItem(${i})">✕</button>
    </div>`;
    if(_modsOpen===i && kind) g.innerHTML+=renderModsPanel(i, kind);
  });
}
function toggleMods(i){ _modsOpen = (_modsOpen===i? -1 : i); renderInventory(); }
function renderModsPanel(i, kind){
  const it=editInventory[i];
  const MODS = kind==='weapon' ? (window.WEAPON_MODS||{}) : (window.ARMOR_MODS||{});
  const slots = MODS.slots||[]; const labels = MODS.slotLabels||{};
  it.mods = it.mods || {};
  let rows = slots.map(slot=>{
    const list = MODS[slot]||[];
    const cur = it.mods[slot]||'';
    const opts = '<option value="">— aucun —</option>' + list.map(m=>{
      const fx = _modSummary(m, kind);
      return `<option value="${m.id}"${m.id===cur?' selected':''}>${m.name}${fx?' — '+fx:''}</option>`;
    }).join('');
    return `<div class="mods-row"><span class="mods-lbl">${labels[slot]||slot}</span>
      <select class="mods-sel" onchange="setItemMod(${i},'${slot}',this.value)">${opts}</select></div>`;
  }).join('');
  // Aperçu des stats modifiées
  let preview='';
  if(kind==='weapon'){
    const base=(window.DB?.weapons||[]).find(w=>w.n===it.name);
    if(base){ const e=fpApplyWeaponMods(base, it.mods);
      preview=`<div class="mods-prev">→ ${e.dmg} · ${e.eff} · cadence ${e.fr} · ${e.a&&e.a!=='-'?e.a:'—'}${e._rangeStep?` · portée ${e._rangeStep>0?'+':''}${e._rangeStep}`:''} · ${e.w}kg</div>`; }
  } else {
    const base=(window.DB?.armor||[]).find(a=>a.n===it.name);
    if(base){ const e=fpApplyArmorMods(base, it.mods);
      preview=`<div class="mods-prev">→ Ph ${e.ph} / Én ${e.en} / Rad ${e.rad} · ${e.w}kg</div>`; }
  }
  return `<div class="mods-panel">${rows}${preview}</div>`;
}
function _modSummary(m, kind){
  const p=[];
  if(m.setDmgCD!=null) p.push('='+m.setDmgCD+'DC');
  if(m.dmgCD) p.push((m.dmgCD>0?'+':'')+m.dmgCD+'DC');
  if(m.fr) p.push((m.fr>0?'+':'')+m.fr+' cad.');
  if(m.range) p.push('portée '+(m.range>0?'+':'')+m.range);
  if(m.ammo) p.push(m.ammo);
  (m.add||[]).forEach(e=>p.push('+'+e));
  (m.remove||[]).forEach(e=>p.push('−'+e));
  if(m.rd){ if(m.rd.phys)p.push('+'+m.rd.phys+' Ph'); if(m.rd.energy)p.push('+'+m.rd.energy+' Én'); if(m.rd.rad)p.push('+'+m.rd.rad+' Rad'); }
  if(m.perk) p.push('('+m.perk+')');
  return p.join(', ');
}
function setItemMod(i, slot, val){
  const it=editInventory[i]; it.mods=it.mods||{};
  if(val) it.mods[slot]=val; else delete it.mods[slot];
  if(!Object.keys(it.mods).length) delete it.mods;
  renderInventory();
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
function populateAmmoSelect(){
  const sel=document.getElementById('ammo-cal');if(!sel)return;
  const used=new Set(editAmmo.map(a=>a.cal));
  sel.innerHTML='<option value="">Calibre...</option>';
  (window.DB?.ammo||[]).filter(c=>!used.has(c)).forEach(c=>sel.innerHTML+=`<option value="${c}">${c}</option>`);
}
function renderAmmo(){
  populateAmmoSelect();
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
  if(editAmmo.some(a=>a.cal===cal))return; // déjà présent
  editAmmo.push({cal,qty:0});
  renderAmmo();
}

// ---- COMPAGNONS (PNJ alliés, schéma enemies.json) ----
function populateCompBaseSel(){
  const sel=document.getElementById('comp-base-sel'); if(!sel) return;
  const db2=window.ENNEMIS_DB||{};
  const opts=Object.keys(db2).sort().map(k=>`<option value="${k}">${k}</option>`).join('');
  sel.innerHTML='<option value="">— Bestiaire —</option>'+opts;
}
function _drNum(dr){ dr=dr||{}; const n=v=>parseInt(v)||0; return {phys:n(dr.phys),energy:n(dr.energy),rad:n(dr.rad),poison:n(dr.poison)}; }
function compFromFiche(nom,f){
  return { id:'c'+Date.now().toString(36)+Math.floor(Math.random()*99), nom, type:f.type||'', level:f.level||1,
    attrs:{body:f.attrs?.body??5, mind:f.attrs?.mind??4, melee:f.attrs?.melee??null, guns:f.attrs?.guns??null, other:f.attrs?.other??null},
    hpMax:f.hp||6, hpCur:f.hp||6, initiative:(f.initiative==null?null:f.initiative), defense:f.defense??1,
    dr:_drNum(f.dr), attacks:JSON.parse(JSON.stringify(f.attacks||[])), abilities:JSON.parse(JSON.stringify(f.abilities||[])), desc:f.desc||'' };
}
function blankCompanion(){
  return { id:'c'+Date.now().toString(36)+Math.floor(Math.random()*99), nom:'Compagnon', type:'Mammifère', level:1,
    attrs:{body:5,mind:4,melee:2,guns:null,other:1}, hpMax:6, hpCur:6, initiative:null, defense:1,
    dr:{phys:0,energy:0,rad:0,poison:0}, attacks:[], abilities:[], desc:'' };
}
function addCompFromBase(){
  const k=document.getElementById('comp-base-sel').value;
  const src=(window.ENNEMIS_DB||{})[k];
  editCompanions.push(src?compFromFiche(k,src):blankCompanion());
  renderCompanions();
}
function addBlankCompanion(){ editCompanions.push(blankCompanion()); renderCompanions(); }
function rmComp(i){ if(confirm('Supprimer ce compagnon ?')){ editCompanions.splice(i,1); renderCompanions(); } }
function setComp(i,k,v){
  const c=editCompanions[i]; if(!c) return;
  if(k==='level'||k==='hpMax'||k==='defense'){ c[k]=parseInt(v)||0; if(k==='hpMax') c.hpCur=Math.min(c.hpCur??c.hpMax,c.hpMax); }
  else if(k==='initiative') c.initiative = (v.trim()===''?null:(parseInt(v)||0));
  else c[k]=v;
}
function setCompAttr(i,k,v){ editCompanions[i].attrs[k] = (v.trim()===''?null:(parseInt(v)||0)); }
function setCompDr(i,k,v){ editCompanions[i].dr[k] = parseInt(v)||0; }
function setCompAtk(i,j,k,v){ const a=editCompanions[i].attacks[j]; a[k]=(k==='tn'||k==='dmg')?(parseInt(v)||0):v; }
function setCompAbil(i,j,k,v){ editCompanions[i].abilities[j][k]=v; }
function addCompAtk(i){ editCompanions[i].attacks.push({name:'Attaque',attr:'body',skill:'melee',tn:8,dmg:3,eff:'',dmgType:'physical'}); renderCompanions(); }
function rmCompAtk(i,j){ editCompanions[i].attacks.splice(j,1); renderCompanions(); }
function addCompAbil(i){ editCompanions[i].abilities.push({name:'Capacité',desc:''}); renderCompanions(); }
function rmCompAbil(i,j){ editCompanions[i].abilities.splice(j,1); renderCompanions(); }
function renderCompanions(){
  const el=document.getElementById('comp-grid'); if(!el) return;
  if(!editCompanions.length){ el.innerHTML='<div class="empty" style="font-size:9px;color:var(--td);padding:8px">Aucun compagnon</div>'; return; }
  const ni=(v)=>v==null?'':v;
  el.innerHTML=editCompanions.map((c,i)=>{
    const atks=(c.attacks||[]).map((a,j)=>`<div class="ceditrow">
      <input class="ci" style="flex:2" value="${a.name||''}" onchange="setCompAtk(${i},${j},'name',this.value)" placeholder="nom">
      <input class="ci" style="width:42px" value="${a.attr||''}" onchange="setCompAtk(${i},${j},'attr',this.value)" placeholder="attr" title="body/mind...">
      <input class="ci" style="width:36px" type="number" value="${ni(a.tn)}" onchange="setCompAtk(${i},${j},'tn',this.value)" placeholder="TN">
      <input class="ci" style="width:36px" type="number" value="${ni(a.dmg)}" onchange="setCompAtk(${i},${j},'dmg',this.value)" placeholder="DC">
      <input class="ci" style="flex:1" value="${a.dmgType||''}" onchange="setCompAtk(${i},${j},'dmgType',this.value)" placeholder="type">
      <input class="ci" style="flex:1" value="${a.eff||''}" onchange="setCompAtk(${i},${j},'eff',this.value)" placeholder="effet">
      <button class="inv-btn" style="color:var(--rd)" onclick="rmCompAtk(${i},${j})">✕</button></div>`).join('');
    const abil=(c.abilities||[]).map((a,j)=>`<div class="ceditrow">
      <input class="ci" style="flex:1" value="${a.name||''}" onchange="setCompAbil(${i},${j},'name',this.value)" placeholder="nom">
      <input class="ci" style="flex:3" value="${(a.desc||'').replace(/"/g,'&quot;')}" onchange="setCompAbil(${i},${j},'desc',this.value)" placeholder="description">
      <button class="inv-btn" style="color:var(--rd)" onclick="rmCompAbil(${i},${j})">✕</button></div>`).join('');
    return `<div class="cedit">
      <div class="cedit-head">
        <input class="ci" style="flex:2;font-size:11px" value="${c.nom||''}" onchange="setComp(${i},'nom',this.value)" placeholder="Nom">
        <input class="ci" style="flex:1" value="${c.type||''}" onchange="setComp(${i},'type',this.value)" placeholder="Type/espèce">
        <button class="inv-btn" style="color:var(--rd)" onclick="rmComp(${i})">✕ Suppr.</button>
      </div>
      <div class="cedit-row">
        <label>Niv.</label><input class="ci" style="width:40px" type="number" value="${ni(c.level)}" onchange="setComp(${i},'level',this.value)">
        <label>PV max</label><input class="ci" style="width:46px" type="number" value="${ni(c.hpMax)}" onchange="setComp(${i},'hpMax',this.value)">
        <label>Déf.</label><input class="ci" style="width:40px" type="number" value="${ni(c.defense)}" onchange="setComp(${i},'defense',this.value)">
        <label>Init.</label><input class="ci" style="width:50px" value="${ni(c.initiative)}" onchange="setComp(${i},'initiative',this.value)" placeholder="vide=PC">
      </div>
      <div class="cedit-row">
        <label>COR</label><input class="ci" style="width:38px" type="number" value="${ni(c.attrs?.body)}" onchange="setCompAttr(${i},'body',this.value)">
        <label>ESP</label><input class="ci" style="width:38px" type="number" value="${ni(c.attrs?.mind)}" onchange="setCompAttr(${i},'mind',this.value)">
        <label>MÊL</label><input class="ci" style="width:38px" type="number" value="${ni(c.attrs?.melee)}" onchange="setCompAttr(${i},'melee',this.value)">
        <label>ARM</label><input class="ci" style="width:38px" type="number" value="${ni(c.attrs?.guns)}" onchange="setCompAttr(${i},'guns',this.value)">
        <label>AUT</label><input class="ci" style="width:38px" type="number" value="${ni(c.attrs?.other)}" onchange="setCompAttr(${i},'other',this.value)">
      </div>
      <div class="cedit-row">
        <label>RD Phys</label><input class="ci" style="width:38px" type="number" value="${ni(c.dr?.phys)}" onchange="setCompDr(${i},'phys',this.value)">
        <label>Én</label><input class="ci" style="width:38px" type="number" value="${ni(c.dr?.energy)}" onchange="setCompDr(${i},'energy',this.value)">
        <label>Rad</label><input class="ci" style="width:38px" type="number" value="${ni(c.dr?.rad)}" onchange="setCompDr(${i},'rad',this.value)">
        <label>Poison</label><input class="ci" style="width:38px" type="number" value="${ni(c.dr?.poison)}" onchange="setCompDr(${i},'poison',this.value)">
      </div>
      <div class="cedit-sub">Attaques <button class="inv-btn" onclick="addCompAtk(${i})">+ attaque</button></div>
      ${atks||'<div style="font-size:8px;color:var(--td);padding:2px">—</div>'}
      <div class="cedit-sub">Capacités <button class="inv-btn" onclick="addCompAbil(${i})">+ capacité</button></div>
      ${abil||'<div style="font-size:8px;color:var(--td);padding:2px">—</div>'}
    </div>`;
  }).join('');
}

// ---- TABS ----
function swTab(tab){
  document.querySelectorAll('.etab').forEach((el,i)=>{
    el.classList.toggle('on',['infos','special','skills','perks','inventaire','compagnons'][i]===tab);
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
    faction:document.getElementById('e-faction').value||editData.faction||'',
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
    companions:editCompanions,
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