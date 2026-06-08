// ---- char.js ----
// ============================================================
// CHAR — État du personnage
// ============================================================

const char = {
  name:'',niveau:1,xp:0,origine:'',allocatedLevel:null,
  hp:3,rad:0,momentum:0,powerArmor:false,
  special:{S:9,P:5,E:8,C:5,I:5,A:5,L:5},
  perks:{},
  skills:{en_weapon:0,cac_weapon:0,light_weapon:3,heavy_weapon:0,athletics:0,lockpick:0,speech:0,sneak:0,explosives:0,barehand:0,medicine:0,pilot:0,throwing:0,repair:0,science:0,survival:0,barter:0},
  taggedSkills:['light_weapon'],
  inventory:[],
  ammo:[],
  wounds:{head:false,torso:false,armL:false,armR:false,legL:false,legR:false},
  luck_points:0,
  caps:0,          // capsules (argent)
  companions:[],   // PNJ alliés (schéma enemies.json) — créés par le MJ
};

// ============================================================
// CALCULS
// ============================================================
const SP = () => char.special;

// ---- calculs.js ----
// ============================================================
// CALCULS — Fonctions de calcul dérivées des stats
// ============================================================

function hpMax(){return SP().L+SP().E+Math.max(0,char.niveau-1)+(char.perks['Life Giver']||0)*SP().E;}
function forEff(){return (char.perks['Adrenalin Rush']>0&&char.hp<hpMax())?10:SP().S;}
function chargeMax(){const f=forEff(),b=(150+f*10)/2.2046;return Math.round((b*(char.powerArmor?1.5:1)+(char.powerArmor?200:0))*10)/10;}
function chargeActuelle(){let t=0;char.inventory.forEach(it=>t+=(it.qty||1)*(it.w||0));char.ammo.forEach(a=>t+=a.qty*0.02);return Math.round(t*100)/100;}
function xpNext(){return XP_TABLE[Math.min(char.niveau,20)]||21000;}
function rdP(type){
  const p=char.perks,s=SP();
  const nerd=p['Nerd Rage!']>0&&char.hp<hpMax()*0.4;
  if(type==='phys'){let r=(p['Toughness']||0);if(p['Barbarian']>0&&!char.powerArmor)r+=s.S>=11?3:s.S>=9?2:s.S>=7?1:0;if(nerd)r+=p['Nerd Rage!'];return r;}
  if(type==='en'){let r=(p['Refractor']||0);if(nerd)r+=p['Nerd Rage!'];return r;}
  if(type==='rad')return p['Rad Resistance']||0;
  if(type==='poison')return (p['Snake Eater']||0)*2;
  return 0;
}
function getLocRD(zone){
  const zm={head:'Head',torso:'Torso',armL:'Arm',armR:'Arm',legL:'Leg',legR:'Leg'};
  // RAW p.123 : pour chaque emplacement, prendre la RD la PLUS ÉLEVÉE par type
  // entre le vêtement et l'armure (PAS la somme). Les perks s'ajoutent ensuite.
  let aPh=0,aEn=0,aRad=0;
  char.inventory.forEach(it=>{
    if(!it.equipped)return;
    const db=[...DB.armor].find(a=>a.n===it.name);
    if(!db)return;
    // Body = bras/jambes/torse (pas la tête), All = tout
    const coversZone = db.z===zm[zone]
      || (db.t==='POWERARMOR'&&char.powerArmor)
      || (db.z==='Body'&&zone!=='head')
      || db.z==='All';
    if(coversZone){
      aPh=Math.max(aPh,db.ph||0);
      aEn=Math.max(aEn,db.en||0);
      aRad=(db.rad===999||aRad===999)?999:Math.max(aRad,db.rad||0);
    }
  });
  return{phys:aPh+rdP('phys'), en:aEn+rdP('en'), rad:aRad===999?999:aRad+rdP('rad')};
}
function getWeaponTN(inv){
  const db=DB.weapons.find(w=>w.n===inv.name);if(!db)return 0;
  const am={light_weapon:'A',heavy_weapon:'E',en_weapon:'P',cac_weapon:'S',barehand:'S',explosives:'P',throwing:'A'};
  const av={S:SP().S,P:SP().P,E:SP().E,C:SP().C,I:SP().I,A:SP().A,L:SP().L};
  return (av[am[db.sk||'light_weapon']]||5)+(char.skills[db.sk||'light_weapon']||0)+(inv.persoBonus?2:0);
}

// ============================================================
// NAVIGATION
// ============================================================
let curTab='general', curInv='all';

// ---- render.js ----
// ============================================================
// RENDER — Affichage et navigation entre onglets
// ============================================================

function sw(tab){
  document.querySelectorAll('.tab').forEach((el,i)=>{
    el.classList.toggle('on',['general','inventaire','perks','carte','quetes','journal','radio'][i]===tab);
  });
  document.querySelectorAll('.tc').forEach(el=>el.classList.remove('on'));
  const tc=document.getElementById('tc-'+tab);
  if(tc)tc.classList.add('on');
  const id=new URLSearchParams(location.search).get('id')||'';
  // Charger la carte (iframe) à la première ouverture de l'onglet ; sinon recentrer sur le joueur
  if(tab==='carte'){
    const f=document.getElementById('carte-frame');
    if(f && !f.src){
      f.src='../carte/carte.html?id='+encodeURIComponent(id)+'&embed=1';
    } else if(f && f.contentWindow){
      f.contentWindow.postMessage('carte-recenter','*');   // déjà chargée → recentrer
    }
  }
  // Charger les quêtes (iframe) ; sinon rafraîchir
  if(tab==='quetes'){
    const f=document.getElementById('quetes-frame');
    if(f && !f.src){
      f.src='../quetes/quetes.html?id='+encodeURIComponent(id)+'&embed=1';
    } else if(f && f.contentWindow){
      f.contentWindow.postMessage('quetes-refresh','*');
    }
  }
  // Charger le journal (iframe) ; sinon rafraîchir
  if(tab==='journal'){
    const f=document.getElementById('journal-frame');
    if(f && !f.src){
      f.src='../journal/journal.html?id='+encodeURIComponent(id)+'&embed=1';
    } else if(f && f.contentWindow){
      f.contentWindow.postMessage('journal-refresh','*');
    }
  }
  curTab=tab; rAll();
}
// Radio : diffusion synchronisée pilotée par le MJ — suiveur défini dans firebase.js (header)

function swInv(sub){
  document.querySelectorAll('.inv-tab').forEach((el,i)=>{
    el.classList.toggle('on',['all','weap','armor','aid','misc','ammo'][i]===sub);
  });
  document.querySelectorAll('.inv-content').forEach(el=>el.classList.remove('on'));
  document.getElementById('inv-'+sub).classList.add('on');
  curInv=sub; rAll();
}

// ============================================================
// RENDER
// ============================================================

function jetItem(i){
  const it=char.inventory[i];
  if(!it)return;
  if(it.qty>1){it.qty--;}
  else{char.inventory.splice(i,1);}
  rAll();
}

function utiliserItem(i){
  const it=char.inventory[i];
  if(!it||it.qty<=0)return;
  const db=[...DB.food,...DB.drinks,...DB.drugs].find(d=>d.n===it.name)||{};
  if(db.hp>0) char.hp=Math.min(hpMax(),char.hp+db.hp);
  if(db.rad&&typeof db.rad==='number'&&db.rad<0) char.rad=Math.max(0,char.rad+db.rad);
  if(it.name==='RadAway') char.rad=Math.max(0,char.rad-4);
  if(it.name==='RadAway Diluted') char.rad=Math.max(0,char.rad-2);
  it.qty--;
  if(it.qty<=0)char.inventory.splice(i,1);
  rAll();
}


function rAll(){rSpecial();rCaps();rGenWeap();rHP();rMeta();rStatus();rWeapEq();rAmmo();rPerkRD();rLocs();rLocsGen();rInventory();rSkills();rPerks();rPerkEff();rCharge();rLevelUp();rCompanions();}
function rCaps(){const el=document.getElementById('caps-val');if(el)el.textContent=(char.caps||0).toLocaleString('fr-FR');}

function rSpecial(){
  const ORDER=['S','P','E','C','I','A','L'];
  const N={S:'STRENGTH',P:'PERCEPTION',E:'ENDURANCE',C:'CHARISMA',I:'INTELLIGENCE',A:'AGILITY',L:'LUCK'};
  const g=document.getElementById('sg');if(!g)return;
  const fe=forEff();g.innerHTML='';
  ORDER.forEach(k=>{
    const v=char.special[k];
    const disp=k==='S'?fe:v,m=k==='S'&&fe!==v;
    g.innerHTML+=`<div class="srow">
      <span class="sk">${k}</span>
      <span class="sn">${N[k]}</span>
      <span class="sv${m?' m':''}">${disp}</span>
    </div>`;
  });
}


function rGeneralSkills(){
  const el=document.getElementById('sg-skills');if(!el)return;
  el.innerHTML='';
  SKILLS_DEF.forEach(sk=>{
    const rg=char.skills[sk.key]||0,tg=char.taggedSkills.includes(sk.key);
    const av={S:SP().S,P:SP().P,E:SP().E,C:SP().C,I:SP().I,A:SP().A,L:SP().L}[sk.attr]||5;
    el.innerHTML+=`<div class="skrow" style="cursor:default"><span class="sk-star">${tg?'★':''}</span><span class="sk-nm">${sk.name}</span><span class="sk-rg${tg?' tg':rg===0?' z':''}">${rg||'—'}</span><span class="sk-tn">TN ${av+rg}</span></div>`;
  });
}


function toggleWeapCollapse(){
  const p=document.getElementById('pnl-gen-weap'); if(!p)return;
  p.classList.toggle('collapsed');
  const col=p.classList.contains('collapsed');
  const c=document.getElementById('weap-chev'); if(c) c.textContent=col?'▸':'▾';
  try{localStorage.setItem('fp_weapCollapsed', col?'1':'0');}catch(e){}
}
function rGenWeap(){
  const el=document.getElementById('gen-weap');if(!el)return;
  // restaure l'état réduit
  try{
    const p=document.getElementById('pnl-gen-weap');
    if(p && localStorage.getItem('fp_weapCollapsed')==='1'){ p.classList.add('collapsed'); const c=document.getElementById('weap-chev'); if(c)c.textContent='▸'; }
  }catch(e){}
  const equipped=char.inventory.filter(it=>it.type==='WEAPON'&&it.equipped);
  const isExpl=it=>{ const db=DB.weapons.find(w=>w.n===it.name); return !!db && (db.t==='Explosive'||db.sk==='explosives'); };
  const explosifs=equipped.filter(isExpl);
  const armes=equipped.filter(it=>!isExpl(it));
  // 2 slots d'armes + 1 slot d'explosif
  const slots=[
    {lbl:'ARME 1',  inv:armes[0]||null,     empty:'Aucune arme'},
    {lbl:'ARME 2',  inv:armes[1]||null,     empty:'Aucune arme'},
    {lbl:'EXPLOSIF',inv:explosifs[0]||null, empty:'Aucun explosif'},
  ];
  el.innerHTML=slots.map(s=>{
    if(!s.inv){
      return `<div class="gen-weap-card empty-slot"><div class="gwc-slot">${s.lbl}</div><div class="gwc-empty">${s.empty}</div></div>`;
    }
    const inv=s.inv, db=DB.weapons.find(w=>w.n===inv.name)||{};
    const tn=getWeaponTN(inv);
    const ammoFound=db.a&&db.a!=='-'?char.ammo.find(a=>a.cal===db.a):null;
    const ammoQty=ammoFound?ammoFound.qty:null;
    return `<div class="gen-weap-card eq">
      <div class="gwc-slot">${s.lbl}</div>
      <div class="gwc-row">
        <div>
          <div class="gwc-name">${inv.name}${inv.persoBonus?' <span style="color:var(--am);font-size:8px">★</span>':''}</div>
          <div class="gwc-stats">${db.t||''} · TN <b style="color:var(--tb)">${tn}</b></div>
        </div>
        <div style="text-align:right">
          <div class="gwc-dmg">${db.dmg||'?'}</div>
          <div class="gwc-stats">${db.eff||''}</div>
        </div>
      </div>
      ${ammoQty!==null?`<div class="gwc-ammo"><span>${db.a}</span><span class="gwc-ammo-qty">${ammoQty}</span><span>cartouches</span></div>`:''}
    </div>`;
  }).join('');
}
// Noms de TOUTES les pièces équipées couvrant une zone (tenue Body/All + armure spécifique).
// Pièce spécifique à la zone affichée en premier (couche externe la plus pertinente).
function armorNamesFor(k){
  const ZM={head:'Head',torso:'Torso',armL:'Arm',armR:'Arm',legL:'Leg',legR:'Leg'};
  const arms=char.inventory.filter(it=>{
    if(!it.equipped)return false;
    const db=DB.armor.find(a=>a.n===it.name);if(!db)return false;
    return db.z===ZM[k] || (db.z==='Body'&&k!=='head') || db.z==='All';
  });
  arms.sort((a,b)=>{
    const za=DB.armor.find(x=>x.n===a.name)?.z, zb=DB.armor.find(x=>x.n===b.name)?.z;
    return ((za===ZM[k])?0:1)-((zb===ZM[k])?0:1);
  });
  return arms.map(a=>a.name);
}
function rLocsGen(){
  const ZM={head:'Head',torso:'Torso',armL:'Arm',armR:'Arm',legL:'Leg',legR:'Leg'};
  const LOCS={
    head:{l:'TÊTE',el:'loc-head'},
    torso:{l:'BUSTE',el:'loc-torso'},
    armL:{l:'BRAS G.',el:'loc-armL'},
    armR:{l:'BRAS D.',el:'loc-armR'},
    legL:{l:'JAMBE G.',el:'loc-legL'},
    legR:{l:'JAMBE D.',el:'loc-legR'},
  };
  Object.entries(LOCS).forEach(([k,loc])=>{
    const el=document.getElementById(loc.el);if(!el)return;
    const rd=getLocRD(k);
    const center=k==='torso';
    const names=armorNamesFor(k);
    el.innerHTML=`<div class="loc-card-cross${char.wounds[k]?' hurt':''}${center?' center-loc':''}">
      <span class="lcc-name">${loc.l}</span>
      <span class="lcc-arm">${names.length?names.join(' + '):'—'}</span>
      <div class="lcc-rds">
        <span class="lcc-rd">Ph:<b class="${rd.phys>0?'nz':''}">${rd.phys}</b></span>
        <span class="lcc-rd">En:<b class="${rd.en>0?'nz':''}">${rd.en}</b></span>
        <span class="lcc-rd">Ra:<b class="${rd.rad>0?'nz':''}">${rd.rad}</b></span>
      </div>
    </div>`;
  });
}
function rHP(){
  const max=hpMax();
  const pct=Math.round(Math.max(0,char.hp)/max*100);
  const f=document.getElementById('hp-f');
  if(f){f.style.width=pct+'%';f.className='bf '+(pct<30?'hp-lo':pct<60?'hp-md':'hp-ok');}
  ['hp-t'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=char.hp+'/'+max;});
  document.getElementById('mini-hp').textContent=char.hp+'/'+max;
  const rpct=Math.round(Math.min(char.rad,max)/max*100);
  const rf=document.getElementById('rad-f');if(rf)rf.style.width=rpct+'%';
  const rt=document.getElementById('rad-t');if(rt)rt.textContent=char.rad+'/'+max;
  const mr=document.getElementById('mini-rad');if(mr)mr.textContent=char.rad;
  const ml=document.getElementById('mini-luck');if(ml)ml.textContent=char.luck_points||0;
  const mlm=document.getElementById('mini-luck-max');if(mlm)mlm.textContent=SP().L;
  const xn=xpNext(),xpct=Math.round(char.xp/xn*100);
  const xf=document.getElementById('xp-f');if(xf)xf.style.width=Math.min(100,xpct)+'%';
  const xt=document.getElementById('xp-t');if(xt)xt.textContent=char.xp+'/'+xn;
}

function rMeta(){
  const ni=document.getElementById('name-inp');
  if(ni && char.name) ni.textContent=char.name.toUpperCase();
  const m=document.getElementById('meta');
  if(m) m.textContent=`LVL ${char.niveau} · ${char.origine||'—'} · ${char.xp}/${xpNext()} XP`;
  const ld=document.getElementById('lvl-display');
  if(ld) ld.textContent=`Niveau ${char.niveau} · ${char.origine||'—'}`;
}

function rMom(){
  const el=document.getElementById('mds');if(!el)return;
  el.innerHTML='';
  for(let i=0;i<6;i++)el.innerHTML+=`<div class="md${i<char.momentum?' on':''}" onclick="setMom(${i})">${i<char.momentum?'●':''}</div>`;
}

function rStatus(){
  const max=hpMax();
  const nerd=char.perks['Nerd Rage!']>0&&char.hp<max*0.4;
  const adr=char.perks['Adrenalin Rush']>0&&char.hp<max;
  const lines=[];
  if(nerd)lines.push(`⚡ Nerd Rage : +${char.perks['Nerd Rage!']} RD & Dmg`);
  if(adr)lines.push('💪 Adrenalin Rush : FOR = 10');
  if(char.powerArmor)lines.push('🦾 Power Armor actif');
  if(char.rad>0)lines.push(`☢ ${char.rad} pts radiation`);
  const el=document.getElementById('statuts');if(el)el.innerHTML=lines.join('<br>')||'<span style="opacity:0.4">Aucun statut actif</span>';
  const b=document.getElementById('bdgs');if(!b)return;
  const pct=Math.round(char.hp/max*100);
  b.innerHTML=`<span class="bdg ${pct>=100?'ok':pct<30?'d':'w'}">${pct>=100?'OK':pct<30?'CRITIQUE':'BLESSÉ'}</span>`;
  if(nerd)b.innerHTML+=`<span class="bdg d">NERD RAGE</span>`;
  if(char.powerArmor)b.innerHTML+=`<span class="bdg ok">PA</span>`;
}

function rWeapEq(){
  const el=document.getElementById('weap-eq');if(!el)return;
  const weaps=char.inventory.filter(it=>it.type==='WEAPON'&&it.equipped);
  if(!weaps.length){el.innerHTML='<div style="font-size:9px;color:var(--td);padding:8px">Aucune arme équipée — aller dans Inventaire > Armes</div>';return;}
  el.innerHTML='';
  weaps.forEach(inv=>{
    const db=DB.weapons.find(w=>w.n===inv.name)||{};
    const tn=getWeaponTN(inv);
    el.innerHTML+=`<div class="wcard eq">
      <div class="wt">
        <div><div class="wname">${inv.name}${inv.persoBonus?` <span class="wtag">★ ATOUT</span>`:''}</div>
        <div class="wstats">${db.t||''} · FR ${db.fr??'—'} · Portée ${db.rng||'—'} · Cal. ${db.a||'—'}<br>TN : <b style="color:var(--tb)">${tn}</b> · ${db.dt||''}</div></div>
        <div style="text-align:right"><div class="wdmg">${db.dmg||'?'}</div><div class="wstats">${db.eff||''}</div></div>
      </div>
      <div class="row" style="margin-top:5px">
        <button class="btn sm f1" onclick="toggleAtout('${inv.name}')">${inv.persoBonus?'Retirer atout':'+ Atout perso'}</button>
      </div>
    </div>`;
  });
}

function rAmmo(){
  const el=document.getElementById('ammo-list');if(!el)return;
  el.innerHTML='';
  if(!char.ammo.length){ el.innerHTML='<div style="font-size:9px;color:var(--td);padding:6px">Aucune munition</div>'; return; }
  char.ammo.forEach((a)=>{
    el.innerHTML+=`<div class="amrow"><span class="amcal">${a.cal}</span>
      <span class="amqty" style="color:${a.qty>0?'var(--am)':'var(--rd)'}">${a.qty}</span></div>`;
  });
}

function rPerkRD(){
  const el=document.getElementById('perk-rd');if(!el)return;
  el.innerHTML=`<div>RD Phys (perks) : <b style="color:var(--g)">${rdP('phys')}</b></div><div>RD Énergie (perks) : <b style="color:var(--g)">${rdP('en')}</b></div><div>RD Radiation (perks) : <b style="color:var(--g)">${rdP('rad')}</b></div><div>RD Poison (perks) : <b style="color:var(--g)">${rdP('poison')}</b></div><hr class="fo"><div>Charge max : <b style="color:var(--tb)">${chargeMax()} kg</b></div>`;
}

function rLocs(){
  const el=document.getElementById('locs');if(!el)return;
  const LOCS=[{k:'head',l:'Tête (1-2)'},{k:'torso',l:'Buste (3-8)'},{k:'armL',l:'Bras G.'},{k:'armR',l:'Bras D.'},{k:'legL',l:'Jambe G.'},{k:'legR',l:'Jambe D.'}];
  const ZM={head:'Head',torso:'Torso',armL:'Arm',armR:'Arm',legL:'Leg',legR:'Leg'};
  el.innerHTML='';
  LOCS.forEach(loc=>{
    const rd=getLocRD(loc.k);
    const names=armorNamesFor(loc.k);
    el.innerHTML+=`<div class="lcard"><div class="lname">${loc.l}<div class="wdot${char.wounds[loc.k]?' hurt':''}" onclick="tWound('${loc.k}')"></div></div><div class="larm">${names.length?names.join(' + '):'—'}</div><div class="lrds"><div class="rdi"><span class="rdl">Ph:</span><span class="rdv${rd.phys>0?' nz':''}">${rd.phys}</span></div><div class="rdi"><span class="rdl">En:</span><span class="rdv${rd.en>0?' nz':''}">${rd.en}</span></div><div class="rdi"><span class="rdl">Ra:</span><span class="rdv${rd.rad>0?' nz':''}">${rd.rad}</span></div></div></div>`;
  });
}

// --- INVENTAIRE ---
function rInventory(){
  populateSelects();
  rInvAll();rInvWeap();rInvArmor();rInvAid();rInvMisc();rInvAmmo();rCharge();
}

function populateSelects(){
  const sels={
    'add-sel-all': [...DB.weapons,...DB.armor,...DB.food,...DB.drinks,...DB.drugs,...DB.stuff],
    'add-sel-weap': DB.weapons,
    'add-sel-armor': [...DB.armor],
    'add-sel-aid': [...DB.food,...DB.drinks,...DB.drugs],
    'add-sel-misc': DB.stuff,
  };
  Object.entries(sels).forEach(([id,items])=>{
    const el=document.getElementById(id);if(!el)return;
    const cur=el.value;
    el.innerHTML='<option value="">+ Ajouter...</option>';
    items.forEach(it=>el.innerHTML+=`<option value="${it.n}">${it.n}</option>`);
    el.value=cur;
  });
}

function invRow(it,i,cols,cells){
  const eq=it.equipped;
  return `<div class="irow ${cols}${eq?' equipped-row':''}">${cells}</div>`;
}

function qtyCtrl(i){
  return `<div class="iqty-ctrl"><button class="iqbtn" onclick="chQty(${i},-1)">−</button><span class="iqval">${char.inventory[i].qty}</span><button class="iqbtn" onclick="chQty(${i},1)">+</button></div>`;
}

function rInvAll(){
  const el=document.getElementById('inv-all-list');if(!el)return;
  el.innerHTML='';
  char.inventory.forEach((it,i)=>{
    el.innerHTML+=`<div class="irow" style="grid-template-columns:44px 1fr 40px 42px 20px;gap:4px;${it.equipped?'border-color:var(--gd);background:#0a140a;':''}">
      <span class="itag ${it.type}">${it.type}</span>
      <span class="iname${it.equipped?' eq':''}">${it.name}${it.equipped?' ●':''}</span>
      <span class="iqval">${it.qty}</span>
      <span class="ipw">${((it.qty||1)*(it.w||0)).toFixed(2)}kg</span>
      <span></span>
    </div>`;
  });
}

function rInvWeap(){
  const el=document.getElementById('inv-weap-list');if(!el)return;
  el.innerHTML='';
  char.inventory.filter(it=>it.type==='WEAPON').forEach((it)=>{
    const i=char.inventory.indexOf(it);
    const db=DB.weapons.find(w=>w.n===it.name)||{};
    const tn=getWeaponTN(it);
    el.innerHTML+=`<div class="irow weap-cols${it.equipped?' equipped-row':''}">
      <span class="itag ARMOR" style="border-color:var(--am);color:var(--am)">${db.t||'WEAPON'}</span>
      <span class="iname${it.equipped?' eq':''}">${it.name}${db.a&&db.a!=='-'?` <span class="iname-cal">${db.a}</span>`:''}</span>
      <span style="font-family:'Oswald',sans-serif;color:var(--am);font-size:13px">${db.dmg||'?'}</span>
      <span class="ieff">${db.eff||'—'}</span>
      <span style="font-size:9px;color:var(--td)">${db.fr??'—'}</span>
      <span style="font-size:9px;color:var(--tb)">${tn}</span>
      <span class="iqval">${it.qty}</span>
      <span class="ipw">${((it.qty||1)*(it.w||0)).toFixed(2)}kg</span>
      <button class="ieq-btn ${it.equipped?'on':'off'}" onclick="tEquip(${i})">${it.equipped?'● ÉQUIPÉ':'○ Équiper'}</button>
      <button class="idel-btn" onclick="jetItem(${i})" title="Jeter">🗑</button>
    </div>`;
  });
}

function rInvArmor(){
  const el=document.getElementById('inv-armor-list');if(!el)return;
  el.innerHTML='';
  char.inventory.filter(it=>['ARMOR','POWERARMOR','CLOTHING','OUTFIT'].includes(it.type)).forEach((it)=>{
    const i=char.inventory.indexOf(it);
    const db=[...DB.armor].find(a=>a.n===it.name)||{};
    el.innerHTML+=`<div class="irow armor-cols${it.equipped?' equipped-row':''}">
      <span class="itag ${it.type}">${it.type}</span>
      <span class="iname${it.equipped?' eq':''}">${it.name}</span>
      <span class="iqval">${it.qty}</span>
      <span class="ipw">${((it.qty||1)*(it.w||0)).toFixed(2)}kg</span>
      <span style="font-size:8px;color:var(--td)">${db.z||'—'} Ph:${db.ph||0} En:${db.en||0}</span>
      <button class="ieq-btn ${it.equipped?'on':'off'}" onclick="tEquip(${i})">${it.equipped?'● ÉQUIPÉ':'○ Équiper'}</button>
      <button class="idel-btn" onclick="jetItem(${i})" title="Jeter">🗑</button>
    </div>`;
  });
}

function rInvAid(){
  const el=document.getElementById('inv-aid-list');if(!el)return;
  el.innerHTML='';
  char.inventory.filter(it=>it.type==='FOOD'||it.type==='DRINK'||it.type==='DRUGS').forEach((it)=>{
    const i=char.inventory.indexOf(it);
    const db=[...DB.food,...DB.drinks,...DB.drugs].find(d=>d.n===it.name)||{};
    el.innerHTML+=`<div class="irow food-cols">
      <span class="itag ${it.type}">${it.type}</span>
      <span class="iname">${it.name}</span>
      <span style="font-size:9px;color:var(--g)">${db.hp!=null?'+'+db.hp+' PV':db.eff?.slice(0,14)||'—'}</span>
      <span class="ieff">${db.eff?.slice(0,28)||db.dur||'—'}</span>
      <span style="font-size:8px;color:var(--am)">${db.rad||db.add||'—'}</span>
      <span class="iqval">${it.qty}</span>
      <span class="ipw">${((it.qty||1)*(it.w||0)).toFixed(2)}kg</span>
      <button class="qu-btn" style="flex:none;padding:2px 6px;font-size:8px" onclick="utiliserItem(${i})">UTILISER</button>
      <button class="idel-btn" onclick="jetItem(${i})" title="Jeter">🗑</button>
    </div>`;
  });
}

function rInvMisc(){
  const el=document.getElementById('inv-misc-list');if(!el)return;
  el.innerHTML='';
  char.inventory.filter(it=>it.type==='STUFF').forEach((it)=>{
    const i=char.inventory.indexOf(it);
    const db=DB.stuff.find(d=>d.n===it.name)||{};
    el.innerHTML+=`<div class="irow stuff-cols">
      <span class="itag STUFF">DIVERS</span>
      <span class="iname">${it.name}</span>
      <span class="ieff">${db.eff?.slice(0,38)||'—'}</span>
      <span class="iqval">${it.qty}</span>
      <span class="ipw">${((it.qty||1)*(it.w||0)).toFixed(2)}kg</span>
      <button class="idel-btn" onclick="jetItem(${i})" title="Jeter">🗑</button>
    </div>`;
  });
}

function rInvAmmo(){
  const el=document.getElementById('inv-ammo-list');if(!el)return;
  el.innerHTML='';
  if(!char.ammo.length){ el.innerHTML='<div style="font-size:9px;color:var(--td);padding:12px;text-align:center">Aucune munition</div>'; return; }
  char.ammo.forEach((a)=>{
    el.innerHTML+=`<div class="amrow"><span class="amcal">${a.cal}</span>
      <span class="amqty" style="color:${a.qty>0?'var(--am)':'var(--rd)'}">${a.qty}</span></div>`;
  });
}

function rCharge(){
  const cur=chargeActuelle(),max=chargeMax();
  const pct=Math.min(100,Math.round(cur/max*100));
  const el=document.getElementById('ch-txt');
  if(el)el.innerHTML=`<span style="color:var(--${pct>90?'rd':pct>70?'am':'tb'})">${cur} / ${max} kg</span>`;
  const cf=document.getElementById('ch-f');
  if(cf){cf.style.width=pct+'%';cf.style.background=`var(--${pct>90?'rd':pct>70?'am':'g'})`;}
}

function rSkills(){
  const half=Math.ceil(SKILLS_DEF.length/2);
  ['sk-a','sk-b'].forEach((id,side)=>{
    const el=document.getElementById(id);if(!el)return;
    el.innerHTML='';
    SKILLS_DEF.slice(side*half,(side+1)*half).forEach(sk=>{
      const rg=char.skills[sk.key]||0,tg=char.taggedSkills.includes(sk.key);
      const av={S:SP().S,P:SP().P,E:SP().E,C:SP().C,I:SP().I,A:SP().A,L:SP().L}[sk.attr]||5;
      el.innerHTML+=`<div class="skrow" style="cursor:default"><span class="sk-star">${tg?'★':''}</span><span class="sk-nm">${sk.name}</span><span class="sk-at">[${sk.attr}]</span><span class="sk-rg${tg?' tg':rg===0?' z':''}">${rg||'—'}</span><span class="sk-tn">TN ${av+rg+(tg?2:0)}</span></div>`;
    });
  });
}

function rPerks(){
  const el=document.getElementById('perks-list');if(!el)return;
  const nerd=char.perks['Nerd Rage!']>0&&char.hp<hpMax()*0.4;
  const adr=char.perks['Adrenalin Rush']>0&&char.hp<hpMax();
  el.innerHTML='';
  Object.entries(PERKS_DEF).forEach(([name,def])=>{
    const rk=char.perks[name]||0,act=rk>0;
    const trig=(name==='Nerd Rage!'&&nerd)||(name==='Adrenalin Rush'&&adr);
    if(!act) return; // n'afficher que les perks actives
    el.innerHTML+=`<div class="pkcard${trig?' trig':act?' act':''}"><div class="row" style="justify-content:space-between"><span class="pkname${trig?' trig':act?' act':''}">${name}</span><span class="pkrk${act?' act':''}">${rk}/${def.max}</span></div><div class="pkdesc">${def.desc}</div></div>`;
  });
  if(!el.innerHTML) el.innerHTML='<div style="font-size:9px;color:var(--td);padding:6px">Aucune perk active</div>';
}

function rPerkEff(){
  const el=document.getElementById('perk-eff');if(!el)return;
  const max=hpMax(),fe=forEff();
  const nerd=char.perks['Nerd Rage!']>0&&char.hp<max*0.4;
  el.innerHTML=[
    `PV max : <b style="color:var(--tb)">${max}</b>`,
    `FOR effective : <b style="color:var(--${fe!==SP().S?'am':'tb'})">${fe}</b>`,
    `RD Phys (perks) : <b style="color:var(--g)">${rdP('phys')}</b>`,
    `RD Énerg (perks) : <b style="color:var(--g)">${rdP('en')}</b>`,
    `RD Rad (perks) : <b style="color:var(--g)">${rdP('rad')}</b>`,
    `RD Poison : <b style="color:var(--g)">${rdP('poison')}</b>`,
    `Charge max : <b style="color:var(--tb)">${chargeMax()} kg</b>`,
    nerd?`<span style="color:var(--rd)">⚡ Nerd Rage actif !</span>`:'',
  ].filter(Boolean).join('<br>');
}

// ============================================================
// ACTIONS
// ============================================================

// ---- actions.js ----
// ============================================================
// ACTIONS — Interactions utilisateur
// ============================================================

function chHP(n){char.hp=Math.max(0,Math.min(hpMax(),char.hp+n));rAll();}
function chHPd(add){const d=parseInt(document.getElementById('hpd')?.value)||1;chHP(add?d:-d);}
function chRad(n){char.rad=Math.max(0,Math.min(hpMax(),char.rad+n));rAll();}
function addXP(n){
  char.xp+=n;
  // Montée de niveau : +1 PV max (via formule hpMax), PAS de soin. La répartition
  // rang+perk se fait via la modale (écart niveau / allocatedLevel → alerte).
  while(char.niveau<20&&char.xp>=xpNext())char.niveau++;
  rAll();
}
function setMom(i){char.momentum=(i<char.momentum)?i:i+1;rMom();}
function tWound(k){char.wounds[k]=!char.wounds[k];rLocs();}
function cyclePerk(n){char.perks[n]=((char.perks[n]||0)+1)%((PERKS_DEF[n]?.max||1)+1);rAll();}
function togglePA(){char.powerArmor=!char.powerArmor;document.getElementById('pa-btn').textContent=`Power Armor : ${char.powerArmor?'ON':'OFF'}`;rAll();}
function toggleAtout(name){const it=char.inventory.find(i=>i.name===name&&i.type==='WEAPON');if(it)it.persoBonus=!it.persoBonus;rAll();}

function tEquip(i){
  const it=char.inventory[i];
  const APP=['ARMOR','POWERARMOR','CLOTHING','OUTFIT'];
  if(!it.equipped && APP.includes(it.type)){
    // Règles de superposition (RAW p.123) :
    // - vêtement (CLOTHING) = couche de base ; l'armure se porte PAR-DESSUS
    // - tenue (OUTFIT) = ne se combine PAS avec une armure de corps
    // - 1 seule pièce d'armure par emplacement ; 1 seule base (vêtement/tenue)
    const zone=it.zone||DB.armor.find(a=>a.n===it.name)?.z||null;
    const isHead=zone==='Head';
    char.inventory.forEach((other,j)=>{
      if(j===i||!other.equipped||!APP.includes(other.type))return;
      const oZone=other.zone||DB.armor.find(a=>a.n===other.name)?.z||null;
      const oHead=oZone==='Head';
      const oBase=['CLOTHING','OUTFIT'].includes(other.type);
      if(it.type==='OUTFIT'){
        if(oBase) other.equipped=false;            // une seule base
        else if(!oHead) other.equipped=false;      // tenue → retire l'armure de corps
      } else if(it.type==='CLOTHING'){
        if(oBase) other.equipped=false;            // une seule base ; l'armure reste superposée
      } else { // ARMOR / POWERARMOR
        if(other.type==='OUTFIT' && !isHead) other.equipped=false;  // pas d'armure sur une tenue
        else if(zone && oZone===zone) other.equipped=false;          // 1 pièce / emplacement
      }
    });
  }
  // Slots d'armes : 2 armes + 1 explosif
  if(!it.equipped && it.type==='WEAPON'){
    const dbw=DB.weapons.find(w=>w.n===it.name)||{};
    const isE=x=>{ const d=DB.weapons.find(w=>w.n===x.name); return !!d && (d.t==='Explosive'||d.sk==='explosives'); };
    const equippedW=char.inventory.filter(x=>x!==it && x.type==='WEAPON' && x.equipped);
    if(dbw.t==='Explosive'||dbw.sk==='explosives'){
      // Explosif : remplace celui déjà équipé, sans confirmation
      equippedW.filter(isE).forEach(x=>x.equipped=false);
    } else {
      const armes=equippedW.filter(x=>!isE(x));
      if(armes.length>=2){
        openWeaponSwap(i, armes);   // slots pleins → on clique l'arme à remplacer dans la modale
        return;                     // ne pas équiper tout de suite
      }
    }
  }
  it.equipped=!it.equipped;
  rAll();
}
function chQty(i,n){char.inventory[i].qty=Math.max(0,char.inventory[i].qty+n);rAll();}

// Remplacement d'arme (slots pleins) : on clique l'arme à remplacer
let _wslotNew=-1;
function openWeaponSwap(newI, armes){
  _wslotNew=newI;
  const nv=document.getElementById('wslot-new'); if(nv) nv.textContent=char.inventory[newI]?.name||'';
  const list=document.getElementById('wslot-list');
  if(list) list.innerHTML=armes.map(a=>{
    const idx=char.inventory.indexOf(a); const db=DB.weapons.find(w=>w.n===a.name)||{};
    return `<button class="wslot-btn" onclick="weaponSwapPick(${idx})"><b>${a.name}</b><span class="wslot-stat">${db.dmg||''}${db.t?' · '+db.t:''}</span></button>`;
  }).join('');
  document.getElementById('mo-wslot')?.classList.add('on');
}
function weaponSwapPick(replI){
  if(_wslotNew<0) return;
  if(char.inventory[replI]) char.inventory[replI].equipped=false;
  if(char.inventory[_wslotNew]) char.inventory[_wslotNew].equipped=true;
  _wslotNew=-1;
  closeMo('mo-wslot');
  rAll();
}
function rmItem(i){char.inventory.splice(i,1);rAll();}

function addItemFromSel(name){
  if(!name)return;
  const existing=char.inventory.find(it=>it.name===name);
  if(existing){existing.qty++;rAll();return;}
  // Find in all DBs
  const dbAll=[...DB.weapons,...DB.armor,...DB.food,...DB.drinks,...DB.drugs,...DB.stuff];
  const db=dbAll.find(d=>d.n===name);if(!db)return;
  let type='STUFF';
  if(DB.weapons.find(d=>d.n===name))type='WEAPON';
  else if(DB.armor.find(d=>d.n===name))type=db.t||'ARMOR';
  else if(DB.food.find(d=>d.n===name))type='FOOD';
  else if(DB.drinks.find(d=>d.n===name))type='DRINK';
  else if(DB.drugs.find(d=>d.n===name))type='DRUGS';
  else if(DB.stuff.find(d=>d.n===name))type='STUFF';
  const item={name,type,qty:1,w:db.w||0,equipped:false};
  if(type==='ARMOR'||type==='POWERARMOR')item.zone=db.z||'';
  if(type==='WEAPON')item.persoBonus=false;
  char.inventory.push(item);
  // Reset selects
  ['add-sel-all','add-sel-weap','add-sel-armor','add-sel-aid','add-sel-misc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  rAll();
}

// MODALS
let _moSpKey=null,_moSkKey=null;
const N_NAMES={S:'STRENGTH',P:'PERCEPTION',E:'ENDURANCE',C:'CHARISMA',I:'INTELLIGENCE',A:'AGILITY',L:'LUCK'};
function openMoSp(k){_moSpKey=k;document.getElementById('mo-sp-t').textContent='MODIFIER '+N_NAMES[k];document.getElementById('mo-sp-l').textContent=N_NAMES[k];document.getElementById('mo-sp-v').value=char.special[k];document.getElementById('mo-sp').classList.add('on');}
function saveSpec(){const v=Math.min(10,Math.max(1,parseInt(document.getElementById('mo-sp-v').value)||1));char.special[_moSpKey]=v;char.hp=Math.min(char.hp,hpMax());closeMo('mo-sp');rAll();}
function openMoSk(key,name){_moSkKey=key;document.getElementById('mo-sk-t').textContent='COMPÉTENCE : '+name.toUpperCase();document.getElementById('mo-sk-v').value=char.skills[key]||0;document.getElementById('mo-sk-tag').value=char.taggedSkills.includes(key)?'1':'0';document.getElementById('mo-sk').classList.add('on');}
function saveSkill(){const v=Math.min(6,Math.max(0,parseInt(document.getElementById('mo-sk-v').value)||0));char.skills[_moSkKey]=v;const tg=document.getElementById('mo-sk-tag').value==='1';if(tg&&!char.taggedSkills.includes(_moSkKey))char.taggedSkills.push(_moSkKey);if(!tg)char.taggedSkills=char.taggedSkills.filter(k=>k!==_moSkKey);closeMo('mo-sk');rAll();}
function closeMo(id){document.getElementById(id).classList.remove('on');}

// Boutique : ouvre la modale sur une boutique donnée ('mj' itinérante, ou id d'un POI marchand)
function openShop(shopId){
  shopId = shopId || 'mj';
  const f=document.getElementById('shop-frame');
  const id=new URLSearchParams(location.search).get('id')||'';
  if(f && f.getAttribute('data-shop')!==shopId){
    f.src='../boutique/boutique.html?id='+encodeURIComponent(id)+'&shop='+encodeURIComponent(shopId)+'&embed=1';
    f.setAttribute('data-shop',shopId);
  }
  document.getElementById('mo-shop').classList.add('on');
}
// La carte (iframe) demande l'ouverture d'une boutique de POI marchand
window.addEventListener('message', e=>{ const d=e.data; if(d && d.type==='open-shop' && d.shop) openShop(d.shop); });

// Butin : ouvre la modale (charge l'iframe paresseusement) ; le bandeau est piloté par firebase.js
function openLoot(){
  const f=document.getElementById('loot-frame');
  const id=new URLSearchParams(location.search).get('id')||'';
  if(f && !f.src) f.src='../butin/butin.html?id='+encodeURIComponent(id)+'&embed=1';
  else if(f && f.contentWindow) f.contentWindow.postMessage('butin-refresh','*');
  document.getElementById('mo-loot').classList.add('on');
}

// Échange de groupe : pool partagé entre membres du groupe
function openEchange(){
  const f=document.getElementById('echange-frame');
  const id=new URLSearchParams(location.search).get('id')||'';
  if(f && !f.src) f.src='../echange/echange.html?id='+encodeURIComponent(id)+'&embed=1';
  else if(f && f.contentWindow) f.contentWindow.postMessage('echange-refresh','*');
  document.getElementById('mo-echange').classList.add('on');
}
// La page d'échange demande la fermeture (créateur a fermé / membre a quitté)
window.addEventListener('message', e=>{ if(e.data==='echange-close') closeMo('mo-echange'); });

// ============================================================
// COMPAGNONS — PNJ alliés (créés par le MJ, schéma enemies.json)
// ============================================================
const COMP_ATTR_LBL = { body:'COR', mind:'ESP', melee:'MÊL', guns:'ARM', other:'AUT' };
// Compagnons réduits (une ligne : nom + PV) — mémorisé en localStorage
const _compCollapsed = new Set((()=>{ try{ return JSON.parse(localStorage.getItem('fp_compCollapsed')||'[]'); }catch(e){ return []; } })());
function toggleCompCollapse(cid){
  cid = String(cid);
  if(_compCollapsed.has(cid)) _compCollapsed.delete(cid); else _compCollapsed.add(cid);
  try{ localStorage.setItem('fp_compCollapsed', JSON.stringify([..._compCollapsed])); }catch(e){}
  rCompanions();
}
function chCompHP(i,n){
  const c=char.companions?.[i]; if(!c) return;
  c.hpCur=Math.max(0,Math.min(c.hpMax||0,(c.hpCur ?? (c.hpMax||0))+n));
  rAll();
}
function compMaxHP(i){ const c=char.companions?.[i]; if(!c) return; c.hpCur=c.hpMax; rAll(); }
function rCompanions(){
  const pnl=document.getElementById('pnl-companions');
  const el=document.getElementById('companions-list');
  if(!el||!pnl) return;
  const list=char.companions||[];
  pnl.style.display = list.length ? 'block' : 'none';
  el.innerHTML = list.map((c,i)=>{
    const cur=c.hpCur??c.hpMax??0, max=c.hpMax||0;
    const pct=max?Math.round(cur/max*100):0;
    const attrs=Object.entries(c.attrs||{}).filter(([k,v])=>v!=null&&v!=='').map(([k,v])=>`<span class="cmp-at">${COMP_ATTR_LBL[k]||k} <b>${v}</b></span>`).join('');
    const dr=c.dr||{};
    const drTxt=[['Phys',dr.phys],['Én',dr.energy],['Rad',dr.rad],['Poison',dr.poison]].filter(([l,v])=>v).map(([l,v])=>`${l} ${v}`).join(' · ')||'—';
    const atks=(c.attacks||[]).map(a=>`<div class="cmp-atk">⚔ <b>${a.name}</b> — ${(a.attr||'').toUpperCase()}${a.skill?'+'+a.skill:''} · TN ${a.tn} · <span style="color:var(--am)">${a.dmg} DC</span> ${a.dmgType||''}${a.eff?' · '+a.eff:''}</div>`).join('');
    const abil=(c.abilities||[]).map(a=>`<div class="cmp-abil"><b>${a.name}</b>${a.desc?' — '+a.desc:''}</div>`).join('');
    const init=(c.initiative==null||c.initiative==='')?'comme toi':c.initiative;
    const cid=String(c.id ?? i);
    const col=_compCollapsed.has(cid);
    return `<div class="cmp-card${col?' collapsed':''}">
      <div class="cmp-head">
        <button class="cmp-toggle" onclick="toggleCompCollapse('${cid}')" title="${col?'Déplier':'Réduire'}">${col?'▸':'▾'}</button>
        <span class="cmp-nom">${c.nom||'Compagnon'}</span>
        <span class="cmp-hpmini" style="color:${pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)'}">${cur}/${max} PV</span>
        <span class="cmp-meta">${c.type||''}${c.level?' · Niv. '+c.level:''}</span>
      </div>
      <div class="cmp-hpbar"><div class="cmp-hpfill" style="width:${pct}%"></div></div>
      <div class="cmp-hprow">PV
        <button onclick="chCompHP(${i},-1)">−</button>
        <b>${cur}/${max}</b>
        <button onclick="chCompHP(${i},1)">+</button>
        <button onclick="compMaxHP(${i})" title="PV max" style="margin-left:auto">↺</button>
      </div>
      <div class="cmp-stats">${attrs}<span class="cmp-at">DÉF <b>${c.defense??1}</b></span><span class="cmp-at">INIT <b>${init}</b></span></div>
      <div class="cmp-dr">RD : ${drTxt}</div>
      ${atks?`<div class="cmp-sec">${atks}</div>`:''}
      ${abil?`<div class="cmp-sec">${abil}</div>`:''}
    </div>`;
  }).join('');
}

// ============================================================
// MONTÉE DE NIVEAU — répartition rang + perk
// ============================================================
// Niveaux en attente = écart entre le niveau atteint (piloté par le MJ ou l'XP)
// et allocatedLevel (dernier niveau dont le joueur a réparti rang+perk).
function pendingLU(){
  const al = (char.allocatedLevel==null) ? (char.niveau||1) : char.allocatedLevel;
  return Math.max(0,(char.niveau||1)-al);
}
let _luSkill=null, _luSkillDone=false, _luPerk=null, _luPerks=[];

// Une perk est éligible si : niveau requis atteint, prérequis remplis, rang max non atteint.
// req: {s:'S',min} = prérequis SPECIAL ; {sk:'cle',min} = prérequis compétence (futur).
// stagedSkills = surcouche de compétences déjà validées dans la modale (avant écriture char).
function perkEligible(name, stagedSkills){
  const def=PERKS_DEF[name]; if(!def) return false;
  if((def.lvl||1)>char.niveau) return false;
  for(const r of (def.req||[])){
    if(r.s){ if((SP()[r.s]||0)<r.min) return false; }
    else if(r.sk){ const v=(stagedSkills&&stagedSkills[r.sk]!=null?stagedSkills[r.sk]:char.skills[r.sk])||0; if(v<r.min) return false; }
  }
  return (char.perks[name]||0)<(def.max||1);
}

// Bandeau d'alerte sur l'écran joueur
function rLevelUp(){
  const a=document.getElementById('lvlup-alert'); if(!a) return;
  const n=pendingLU();
  a.style.display = n>0 ? 'flex' : 'none';
  if(n>0){ const c=document.getElementById('lvlup-count'); if(c) c.textContent = n>1?`(${n} niveaux)`:''; }
}

function openLevelUp(){
  if(pendingLU()<=0) return;
  _luSkill=null; _luSkillDone=false; _luPerk=null;
  document.getElementById('mo-lvl-t').textContent='MONTÉE DE NIVEAU '+char.niveau;
  // compétences (+1, max 6)
  document.getElementById('lvl-skills').innerHTML = SKILLS_DEF.map(s=>{
    const r=char.skills[s.key]||0, dis=r>=6;
    return `<button class="lvl-opt${dis?' dis':''}" id="luS-${s.key}" ${dis?'disabled':''} onclick="selLuSkill('${s.key}')"><span class="lo-n">${s.name}</span><span class="lo-r">${dis?r+' (max)':r+'→'+(r+1)}</span></button>`;
  }).join('');
  renderLuPerks();
  _luSync();
  document.getElementById('mo-lvl').classList.add('on');
}
// Rendu des perks éligibles — tient compte de la compétence validée (staged)
function renderLuPerks(){
  const staged = (_luSkillDone&&_luSkill) ? {[_luSkill]:(char.skills[_luSkill]||0)+1} : null;
  _luPerks = Object.keys(PERKS_DEF).filter(n=>perkEligible(n,staged)).sort();
  const el=document.getElementById('lvl-perks');
  el.innerHTML = _luPerks.length ? _luPerks.map((n,i)=>{
    const def=PERKS_DEF[n], cur=char.perks[n]||0;
    const reqTxt=(def.req||[]).map(r=>(r.s||r.sk)+'≥'+r.min).join(' ');
    return `<button class="lvl-perk" id="luP-${i}" onclick="selLuPerk(${i})"><div class="lp-h"><span class="lp-n">${n}${def.max>1?` (${cur}→${cur+1}/${def.max})`:''}</span>${reqTxt?`<span class="lp-req">${reqTxt}</span>`:''}</div><div class="lp-d">${def.desc}</div></button>`;
  }).join('') : '<div class="lvl-empty">Aucune perk éligible (prérequis SPECIAL/niveau non remplis).</div>';
  if(_luPerk && !_luPerks.includes(_luPerk)) _luPerk=null; // sélection devenue invalide
}
function selLuSkill(key){
  if(_luSkillDone) return; // compétence déjà verrouillée
  _luSkill=key;
  document.querySelectorAll('#lvl-skills .lvl-opt').forEach(b=>b.classList.toggle('sel', b.id==='luS-'+key));
  _luSync();
}
// Étape 1 : valider la compétence → débloque + rafraîchit la liste des perks
function confirmLuSkill(){
  if(!_luSkill||_luSkillDone) return;
  _luSkillDone=true;
  document.querySelectorAll('#lvl-skills .lvl-opt').forEach(b=>{ b.disabled=true; b.classList.add('locked'); });
  renderLuPerks();
  _luSync();
}
function selLuPerk(i){
  if(!_luSkillDone) return; // perk verrouillée tant que la compétence n'est pas validée
  _luPerk=_luPerks[i];
  document.querySelectorAll('#lvl-perks .lvl-perk').forEach((b,j)=>b.classList.toggle('sel', j===i));
  _luSync();
}
function _luSync(){
  // bouton « valider la compétence »
  const sb=document.getElementById('lvl-skill-ok');
  if(sb){ sb.disabled = !_luSkill || _luSkillDone; sb.textContent = _luSkillDone ? '✓ Compétence validée' : '✓ Valider la compétence'; }
  // section perk grisée tant que la compétence n'est pas validée
  document.getElementById('lvl-perks').classList.toggle('locked', !_luSkillDone);
  document.getElementById('lvl-perk-sec').classList.toggle('dim', !_luSkillDone);
  // bouton final (la perk est facultative s'il n'y en a aucune d'éligible)
  const ok=document.getElementById('lvl-ok');
  const perkOk = _luPerks.length===0 || !!_luPerk;
  if(ok) ok.disabled = !(_luSkillDone && perkOk);
}
function applyLevelUp(){
  if(pendingLU()<=0){ closeMo('mo-lvl'); return; }
  if(!_luSkillDone||!_luSkill) return;
  char.skills[_luSkill]=Math.min(6,(char.skills[_luSkill]||0)+1);
  if(_luPerk) char.perks[_luPerk]=(char.perks[_luPerk]||0)+1;
  char.allocatedLevel = ((char.allocatedLevel==null)?(char.niveau-pendingLU()):char.allocatedLevel) + 1;
  closeMo('mo-lvl');
  rAll(); // sauvegarde Firebase + maj affichage
  if(pendingLU()>0) setTimeout(openLevelUp,180); // niveaux restants à répartir
}

window.DB_READY.then(() => {
  Object.keys(PERKS_DEF).forEach(k => { if (!char.perks[k]) char.perks[k] = 0; });
  rAll();
});

// ============================================================
// SFX d'interface — bruitages de navigation (manifeste data/sfx.json + dossier audio/sfx/)
// Le joueur peut couper via le bouton flottant (🔈, bas-gauche).
// ============================================================
let _sfx = { vol:0.5, folder:'audio/sfx', map:{}, buf:{}, muted: localStorage.getItem('fp_sfxMuted')==='1' };
const _SFX_ON  = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6"/></svg>';
const _SFX_OFF = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
function _sfxSrc(f){ return '../../' + _sfx.folder + '/' + f.split('/').map(encodeURIComponent).join('/'); }
function fpSfx(name){
  if(_sfx.muted) return;
  const a = _sfx.buf[name]; if(!a) return;
  try{ const n = a.cloneNode(); n.volume = _sfx.vol; n.play().catch(()=>{}); }catch(e){}
}
function _sfxUpdateBtn(){ const b=document.getElementById('sfx-toggle'); if(b){ b.innerHTML = _sfx.muted ? _SFX_OFF : _SFX_ON; b.classList.toggle('off', _sfx.muted); } }
function toggleSfx(){ _sfx.muted = !_sfx.muted; try{ localStorage.setItem('fp_sfxMuted', _sfx.muted?'1':'0'); }catch(e){} _sfxUpdateBtn(); if(!_sfx.muted) fpSfx('click'); }
function initSfx(){
  const btn = document.createElement('button'); btn.id='sfx-toggle'; btn.title='Sons interface'; btn.onclick=toggleSfx;
  document.body.appendChild(btn); _sfxUpdateBtn();
  fetch('../../data/sfx.json?ts=' + Date.now()).then(r=>r.json()).then(d=>{
    _sfx.folder = d.folder || 'audio/sfx';
    _sfx.vol = (d.volume != null) ? d.volume : 0.5;
    _sfx.map = d.sounds || {};
    Object.entries(_sfx.map).forEach(([k,f]) => { if(f){ const a=new Audio(_sfxSrc(f)); a.preload='auto'; a.volume=_sfx.vol; _sfx.buf[k]=a; } });
  }).catch(e=>console.warn('sfx.json', e));
  document.addEventListener('click', e => {
    const t = e.target; if(!t || !t.closest) return;
    if(t.closest('#sfx-toggle')) return;
    // Onglets principaux : CARTE et INVENTAIRE ont un son dédié ; les autres → 'onglet'
    const tab = t.closest('.tab');
    if(tab){
      const oc = tab.getAttribute('onclick') || '';
      if(oc.indexOf("'carte'") >= 0)      return fpSfx('map');
      if(oc.indexOf("'inventaire'") >= 0) return fpSfx('inventaire');
      return fpSfx('onglet');
    }
    // Tout autre élément cliquable (boutons, sous-onglets, alertes…) → 'bouton'
    if(t.closest('button,.btn,.sel-btn,.gen-btn,.hbtn,.jbtn,.iqbtn,.idel-btn,.mf-die-btn,.hr-btn,.md,.inv-tab,.ieq-btn,.wslot-btn,#loot-alert,#shop-alert,#prop-alert,#lvlup-alert'))
      return fpSfx('bouton');
  }, true);
}
initSfx();

// ============================================================
//
