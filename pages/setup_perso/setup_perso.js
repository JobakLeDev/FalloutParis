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

// Perks disponibles à la création (LVL 1) avec requirements
// req: tableau de conditions {stat, min} — toutes doivent être remplies
const PERKS_DEF={
  'Adrenalin Rush':    {max:1,lvl:1,req:[{s:'S',min:7}],         desc:'Si PV < max : FOR = 10 pour tests FOR et mêlée.'},
  'Action Boy/Girl':   {max:1,lvl:1,req:[],                       desc:'2e action majeure sans malus de difficulté.'},
  'Awareness':         {max:1,lvl:1,req:[{s:'P',min:7}],          desc:'Viser portée Courte = Perforant 1 sur la prochaine attaque.'},
  'Basher':            {max:1,lvl:1,req:[{s:'S',min:6}],          desc:'Attaque coup de crosse gagne Vicious.'},
  'Better Criticals':  {max:1,lvl:1,req:[{s:'L',min:9}],          desc:'Dépenser 1 Chance = critique automatique.'},
  'Big Leagues':       {max:1,lvl:1,req:[{s:'S',min:8}],          desc:'Attaque mêlée 2 mains gagne Vicious.'},
  'Black Widow':       {max:1,lvl:1,req:[{s:'C',min:6}],          desc:'Relancer 1d20 tests CHA sur genre choisi. +1 dmg contre ce genre.'},
  'Bloody Mess':       {max:1,lvl:1,req:[{s:'L',min:6}],          desc:'Coup critique : lancer 1 CD supplémentaire.'},
  'Can Do!':           {max:1,lvl:1,req:[{s:'L',min:5}],          desc:'Fouiller un lieu avec nourriture = 1 item sup gratuit.'},
  'Cap Collector':     {max:1,lvl:1,req:[{s:'C',min:5}],          desc:'±10% sur achats/ventes.'},
  'Entomologist':      {max:1,lvl:1,req:[{s:'I',min:7}],          desc:'Attaque vs Insecte gagne Perforant 1.'},
  'Faster Healing':    {max:1,lvl:1,req:[{s:'E',min:6}],          desc:'1er d20 sup gratuit pour soigner ses propres blessures.'},
  'Finesse':           {max:1,lvl:1,req:[{s:'A',min:9}],          desc:'1x/rencontre relancer tous les CD d\'un jet de dégâts.'},
  'Ghost':             {max:1,lvl:1,req:[{s:'P',min:5},{s:'A',min:6}], desc:'Dans l\'ombre : 1er d20 sup gratuit pour Discrétion.'},
  'Grim Reaper\'s Sprint':{max:1,lvl:1,req:[{s:'L',min:8}],      desc:'Tuer un ennemi : lancer 1 CD, sur Effet +2 PA groupe.'},
  'Gunslinger':        {max:2,lvl:2,req:[{s:'A',min:7}],          desc:'+1 dmg armes 1 main (FR≤2) par rang. Relancer localisation.'},
  'Hacker':            {max:1,lvl:1,req:[{s:'I',min:8}],          desc:'Difficulté piratage -1.'},
  'Heave Ho!':         {max:1,lvl:1,req:[{s:'S',min:8}],          desc:'1 PA = portée arme de jet +1 cran.'},
  'Hunter':            {max:1,lvl:1,req:[{s:'E',min:6}],          desc:'Attaque vs Mammifère/Lézard/Insecte Mutant gagne Vicious.'},
  'Infiltrator':       {max:1,lvl:1,req:[{s:'P',min:8}],          desc:'Relancer 1d20 lors du crochetage.'},
  'Inspirational':     {max:1,lvl:1,req:[{s:'C',min:8}],          desc:'Réserve PA max groupe +1.'},
  'Iron Fist':         {max:2,lvl:1,req:[{s:'S',min:6}],          desc:'Rang 1 : +1 dmg mains nues. Rang 2 : gagne Vicious.'},
  'Junktown Jerky Vendor':{max:1,lvl:1,req:[{s:'C',min:8}],      desc:'Difficulté Baratin achat/vente -1.'},
  'Jury Rigging':      {max:1,lvl:1,req:[],                        desc:'Réparer sans composants (temporaire, complication +1).'},
  'Laser Commander':   {max:2,lvl:2,req:[{s:'P',min:8}],          desc:'+1 dmg armes énergie à distance par rang.'},
  'Lead Belly':        {max:2,lvl:1,req:[{s:'E',min:6}],          desc:'Rang 1 : relancer CD radiation nourriture. Rang 2 : immunité.'},
  'Light Step':        {max:1,lvl:1,req:[],                        desc:'Ignorer 1 complication AGI/PA. Relancer d20 évitement pièges.'},
  'Master Thief':      {max:1,lvl:1,req:[{s:'P',min:8},{s:'A',min:9}], desc:'Difficulté détection lors vol/crochetage +1.'},
  'Medic':             {max:1,lvl:1,req:[{s:'I',min:8}],          desc:'Relancer 1d20 lors de Premiers Secours.'},
  'Moving Target':     {max:1,lvl:1,req:[{s:'A',min:6}],          desc:'Sprint : Défense +1 jusqu\'au prochain tour.'},
  'Mysterious Stranger':{max:1,lvl:1,req:[{s:'L',min:7}],         desc:'Début de combat : dépenser 1 Chance, l\'Étranger peut intervenir.'},
  'Nerd Rage!':        {max:3,lvl:2,req:[{s:'I',min:8}],          desc:'Si PV < 40% : +rang RD phys/én et +rang dmg.'},
  'Night Person':      {max:1,lvl:1,req:[{s:'P',min:7}],          desc:'Pénalité obscurité -1.'},
  'Ninja':             {max:1,lvl:1,req:[{s:'A',min:8}],          desc:'Attaque furtive mêlée/mains nues : +2 dmg (pas PA).'},
  'Nuclear Physicist': {max:1,lvl:1,req:[{s:'I',min:9}],          desc:'Armes rad/Radioactif : +1 dmg rad par Effet. Cœurs fusion +3 charges.'},
  'Paralyzing Palm':   {max:1,lvl:1,req:[{s:'S',min:8}],          desc:'Attaque mains nues ciblée gagne Étourdissement.'},
  'Party Boy/Girl':    {max:1,lvl:1,req:[{s:'E',min:6},{s:'C',min:7}], desc:'Immunité dépendance alcool. Alcool : +2 PV.'},
  'Pathfinder':        {max:1,lvl:1,req:[{s:'P',min:6},{s:'E',min:6}], desc:'Test PER+Survie réussi : temps trajet wilderness /2.'},
  'Pharma Farma':      {max:1,lvl:1,req:[{s:'L',min:6}],          desc:'Fouiller lieu médical : 1 item sup gratuit.'},
  'Piercing Strike':   {max:1,lvl:1,req:[{s:'S',min:7}],          desc:'Attaques mains nues/mêlée tranchantes gagnent Perforant 1.'},
  'Pyromaniac':        {max:3,lvl:2,req:[{s:'E',min:6}],          desc:'+1 dmg armes feu par rang.'},
  'Quick Draw':        {max:1,lvl:1,req:[{s:'A',min:6}],          desc:'Dégainer sans action mineure.'},
  'Quick Hands':       {max:1,lvl:1,req:[{s:'A',min:8}],          desc:'2 PA = Cadence de Tir ×2 pour cette attaque.'},
  'Rad Resistance':    {max:2,lvl:1,req:[{s:'E',min:8}],          desc:'+1 RD radiation sur toutes localisations par rang.'},
  'Refractor':         {max:2,lvl:1,req:[{s:'P',min:6},{s:'L',min:7}], desc:'+1 RD énergie sur toutes localisations par rang.'},
  'Rifleman':          {max:2,lvl:2,req:[{s:'A',min:7}],          desc:'+1 dmg armes 2 mains (FR≤2) par rang.'},
  'Scoundrel':         {max:1,lvl:1,req:[{s:'C',min:7}],          desc:'Ignorer 1ère complication test CHA+Discours pour mentir.'},
  'Shotgun Surgeon':   {max:1,lvl:1,req:[{s:'S',min:5},{s:'A',min:7}], desc:'Fusils à pompe gagnent Perforant 1.'},
  'Size Matters':      {max:3,lvl:1,req:[{s:'E',min:7},{s:'A',min:6}], desc:'+1 dmg armes lourdes par rang.'},
  'Slayer':            {max:1,lvl:1,req:[{s:'S',min:8}],          desc:'1 Chance = critique immédiat avec mains nues/mêlée.'},
  'Smooth Talker':     {max:1,lvl:1,req:[{s:'C',min:6}],          desc:'Relancer 1d20 test opposé Baratin/Discours.'},
  'Snake Eater':       {max:1,lvl:1,req:[{s:'E',min:7}],          desc:'+2 RD poison.'},
  'Sniper':            {max:1,lvl:1,req:[{s:'P',min:8},{s:'A',min:6}], desc:'Viser + arme 2 mains Précise : choisir localisation sans malus.'},
  'Solar Powered':     {max:1,lvl:1,req:[{s:'E',min:7}],          desc:'1h plein soleil : -1 rad.'},
  'Steady Aim':        {max:1,lvl:1,req:[{s:'S',min:8},{s:'A',min:7}], desc:'Viser : relancer 1 d20 sur 1ère attaque ou tous les jets ce tour.'},
  'Toughness':         {max:2,lvl:1,req:[{s:'E',min:6},{s:'L',min:6}], desc:'+1 RD physique sur toutes localisations par rang.'},
};

// ÉTAT
let charData = {};
let sp = {S:5,P:5,E:5,C:5,I:5,A:5,L:5};
let skills = {};
let perks = {};
let tagged = [];
SKILLS_DEF.forEach(s=>skills[s.key]=0);
Object.keys(PERKS_DEF).forEach(k=>perks[k]=0);

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

init();
