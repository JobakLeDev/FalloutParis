// ---- char.js ----
// ============================================================
// CHAR — État du personnage
// ============================================================

const char = {
  name:'',niveau:1,xp:0,origine:'',
  hp:3,rad:0,momentum:0,powerArmor:false,
  special:{S:9,P:5,E:8,C:5,I:5,A:5,L:5},
  perks:{},
  skills:{en_weapon:0,cac_weapon:0,light_weapon:3,heavy_weapon:0,athletics:0,lockpick:0,speech:0,sneak:0,explosives:0,barehand:0,medicine:0,pilot:0,throwing:0,repair:0,science:0,survival:0,barter:0},
  taggedSkills:['light_weapon'],
  // Inventaire unifié : chaque objet a name, type, qty, weight, equipped, zone (pour armures), persoBonus (pour armes)
  inventory:[],
  ammo:[],
  wounds:{head:false,torso:false,armL:false,armR:false,legL:false,legR:false},
};
Object.keys(PERKS_DEF).forEach(k=>char.perks[k]=0);

// ============================================================
// CALCULS
// ============================================================
const SP = () => char.special;

// Init perks
Object.keys(PERKS_DEF).forEach(k=>char.perks[k]=0);

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
  let ph=rdP('phys'),en=rdP('en'),rad=rdP('rad');
  char.inventory.forEach(it=>{
    if(!it.equipped)return;
    const db=[...DB.armor].find(a=>a.n===it.name);
    if(!db)return;
    // Body = bras/jambes/torse (pas la tête), All = tout
    const coversZone = db.z===zm[zone]
      || (db.t==='POWERARMOR'&&char.powerArmor)
      || (db.z==='Body'&&zone!=='head')
      || db.z==='All';
    if(coversZone){ph+=db.ph;en+=db.en;rad+=(db.rad===999?999:db.rad||0);}
  });
  return{phys:ph,en,rad};
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
    el.classList.toggle('on',['general','inventaire','perks','carte','journal'][i]===tab);
  });
  document.querySelectorAll('.tc').forEach(el=>el.classList.remove('on'));
  const tc=document.getElementById('tc-'+tab);
  if(tc)tc.classList.add('on');
  curTab=tab; rAll();
}
function swInv(sub){
  document.querySelectorAll('.inv-tab').forEach((el,i)=>{
    el.classList.toggle('on',['all','weap','armor','aid','misc'][i]===sub);
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
  if(db.hp>0){char.hp=Math.min(hpMax(),char.hp+(db.hp||0));}
  if(it.name==='RadAway')char.rad=Math.max(0,char.rad-4);
  if(it.name==='RadAway Diluted')char.rad=Math.max(0,char.rad-2);
  it.qty--;
  if(it.qty<=0)char.inventory.splice(i,1);
  rAll();
}


function rCharge2(){
  const cur=chargeActuelle(),max=chargeMax();
  const pct=Math.min(100,Math.round(cur/max*100));
  const el=document.getElementById('ch-txt2');
  if(el)el.textContent=`${cur} / ${max} kg`;
  const cf=document.getElementById('ch-f2');
  if(cf){cf.style.width=pct+'%';cf.style.background=`var(--${pct>90?'rd':pct>70?'am':'g'})`;}
}
function rAll(){rSpecial();rGenWeap();rHP();rMeta();rStatus();rWeapEq();rAmmo();rPerkRD();rLocs();rLocsGen();rInventory();rSkills();rPerks();rPerkEff();rCharge();rCharge2();}

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


function rGenWeap(){
  const el=document.getElementById('gen-weap');if(!el)return;
  const weaps=char.inventory.filter(it=>it.type==='WEAPON'&&it.equipped);
  if(!weaps.length){
    el.innerHTML='<div style="font-size:9px;color:var(--td);padding:6px">Aucune arme équipée</div>';
    return;
  }
  el.innerHTML='';
  weaps.forEach(inv=>{
    const db=DB.weapons.find(w=>w.n===inv.name)||{};
    const tn=getWeaponTN(inv);
    // Trouver les munitions correspondantes
    const ammoFound=db.a&&db.a!=='-'?char.ammo.find(a=>a.cal===db.a):null;
    const ammoQty=ammoFound?ammoFound.qty:null;
    el.innerHTML+=`<div class="gen-weap-card eq">
      <div class="gwc-row">
        <div>
          <div class="gwc-name">${inv.name}${inv.persoBonus?' <span style="color:var(--am);font-size:8px">★</span>':''}</div>
          <div class="gwc-stats">${db.t||''} · TN <b style="color:var(--tb)">${tn}</b> · FR ${db.fr??'—'} · ${db.rng||'—'}</div>
        </div>
        <div style="text-align:right">
          <div class="gwc-dmg">${db.dmg||'?'}</div>
          <div class="gwc-stats">${db.eff||''}</div>
        </div>
      </div>
      ${ammoQty!==null?`<div class="gwc-ammo"><span>${db.a}</span><span class="gwc-ammo-qty">${ammoQty}</span><span>cartouches</span></div>`:''}
    </div>`;
  });
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
    // Chercher armure spécifique à la zone OU tenue Body (sauf tête)
    const arm=char.inventory.find(it=>{
      if(!it.equipped)return false;
      const db=DB.armor.find(a=>a.n===it.name);if(!db)return false;
      if(db.z===ZM[k])return true;
      if(db.z==='Body'&&k!=='head')return true;
      if(db.z==='All')return true;
      return false;
    });
    const center=k==='torso';
    el.innerHTML=`<div class="loc-card-cross${char.wounds[k]?' hurt':''}${center?' center-loc':''}">
      <span class="lcc-name">${loc.l}</span>
      <span class="lcc-arm">${arm?arm.name:'—'}</span>
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
  char.ammo.forEach((a,i)=>{
    el.innerHTML+=`<div class="amrow"><span class="amcal">${a.cal}</span>
      <div class="row"><div class="row" style="gap:2px"><button class="ambtn" onclick="chAmmo(${i},-10)">−10</button><button class="ambtn" onclick="chAmmo(${i},-1)">−</button></div>
      <span class="amqty">${a.qty}</span>
      <div class="row" style="gap:2px"><button class="ambtn" onclick="chAmmo(${i},1)">+</button><button class="ambtn" onclick="chAmmo(${i},10)">+10</button></div>
      <button class="ambtn" onclick="rmAmmo(${i})" style="color:var(--td);font-size:8px">✕</button></div></div>`;
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
    const arm=char.inventory.find(it=>it.equipped&&DB.armor.find(a=>a.n===it.name&&a.z===ZM[loc.k]));
    el.innerHTML+=`<div class="lcard"><div class="lname">${loc.l}<div class="wdot${char.wounds[loc.k]?' hurt':''}" onclick="tWound('${loc.k}')"></div></div><div class="larm">${arm?arm.name:'—'}</div><div class="lrds"><div class="rdi"><span class="rdl">Ph:</span><span class="rdv${rd.phys>0?' nz':''}">${rd.phys}</span></div><div class="rdi"><span class="rdl">En:</span><span class="rdv${rd.en>0?' nz':''}">${rd.en}</span></div><div class="rdi"><span class="rdl">Ra:</span><span class="rdv${rd.rad>0?' nz':''}">${rd.rad}</span></div></div></div>`;
  });
}

// --- INVENTAIRE ---
function rInventory(){
  populateSelects();
  rInvAll();rInvWeap();rInvArmor();rInvAid();rInvMisc();rCharge();
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
      <span class="iname${it.equipped?' eq':''}">${it.name}</span>
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
  if(char.xp>=xpNext()&&char.niveau<20){char.niveau++;const b=SP().E;char.hp=Math.min(char.hp+b,hpMax());alert(`✦ Niveau ${char.niveau} ! +${b} PV`);}
  rAll();
}
function setMom(i){char.momentum=(i<char.momentum)?i:i+1;rMom();}
function tWound(k){char.wounds[k]=!char.wounds[k];rLocs();}
function cyclePerk(n){char.perks[n]=((char.perks[n]||0)+1)%((PERKS_DEF[n]?.max||1)+1);rAll();}
function chAmmo(i,n){char.ammo[i].qty=Math.max(0,char.ammo[i].qty+n);rAmmo();}
function rmAmmo(i){char.ammo.splice(i,1);rAmmo();}
function addAmmo(){const inp=document.getElementById('am-new');if(!inp?.value.trim())return;char.ammo.push({cal:inp.value.trim(),qty:0});inp.value='';rAmmo();}
function togglePA(){char.powerArmor=!char.powerArmor;document.getElementById('pa-btn').textContent=`Power Armor : ${char.powerArmor?'ON':'OFF'}`;rAll();}
function toggleAtout(name){const it=char.inventory.find(i=>i.name===name&&i.type==='WEAPON');if(it)it.persoBonus=!it.persoBonus;rAll();}

function tEquip(i){
  const it=char.inventory[i];
  if(!it.equipped){
    // Si c'est une armure/tenue, déséquiper la même zone d'abord
    if(['ARMOR','POWERARMOR','CLOTHING','OUTFIT'].includes(it.type)){
      const zone=it.zone||null;
      char.inventory.forEach((other,j)=>{
        if(j===i||!other.equipped)return;
        if(!['ARMOR','POWERARMOR','CLOTHING','OUTFIT'].includes(other.type))return;
        // CLOTHING/OUTFIT : une seule tenue à la fois (zone Body)
        if(['CLOTHING','OUTFIT'].includes(it.type)&&['CLOTHING','OUTFIT'].includes(other.type)){
          other.equipped=false;
        }
        // ARMOR/POWERARMOR : une seule pièce par zone
        else if(zone&&other.zone===zone){
          other.equipped=false;
        }
      });
    }
  }
  it.equipped=!it.equipped;
  rAll();
}
function chQty(i,n){char.inventory[i].qty=Math.max(0,char.inventory[i].qty+n);rAll();}
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

rAll();

// ============================================================
//
