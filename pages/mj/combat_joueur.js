const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};
const COMBAT_DOC = 'fallout-paris';
const FACES_CD = ['1','2','—','—','★','★'];
const SK_ATTR = {en_weapon:'P',cac_weapon:'S',light_weapon:'A',heavy_weapon:'E',athletics:'S',lockpick:'P',speech:'C',sneak:'A',explosives:'P',barehand:'S',medicine:'I',pilot:'P',throwing:'A',repair:'I',science:'I',survival:'E',barter:'C'};
const WEAPONS_DB = {
  'Ripper':{dmg:'4D',eff:'Vicious',sk:'cac_weapon'},'Pipe Wrench':{dmg:'3D',eff:'—',sk:'cac_weapon'},
  'Combat Knife':{dmg:'3D',eff:'Piercing 1',sk:'cac_weapon'},'Sledgehammer':{dmg:'5D',eff:'—',sk:'cac_weapon'},
  'Baseball Bat':{dmg:'3D',eff:'—',sk:'cac_weapon'},'Machete':{dmg:'3D',eff:'Piercing 1',sk:'cac_weapon'},
  '.44 Pistol':{dmg:'6D',eff:'—',sk:'light_weapon'},'10mm Pistol':{dmg:'4D',eff:'—',sk:'light_weapon'},
  'Pipe Gun':{dmg:'3D',eff:'—',sk:'light_weapon'},'Pipe Revolver':{dmg:'4D',eff:'—',sk:'light_weapon'},
  'Pipe Bolt-Action':{dmg:'6D',eff:'Piercing 1',sk:'light_weapon'},'Hunting Rifle':{dmg:'7D',eff:'—',sk:'light_weapon'},
  'Double-Barrel Shotgun':{dmg:'5D',eff:'Spread,Vicious',sk:'light_weapon'},
  'Laser Pistol':{dmg:'4D',eff:'—',sk:'en_weapon'},'Laser Rifle':{dmg:'7D',eff:'—',sk:'en_weapon'},
  'Mains nues':{dmg:'2D',eff:'—',sk:'barehand'},'Knuckles':{dmg:'3D',eff:'—',sk:'barehand'},
};

let db, joueurData = null, joueurId = null;
let combatState = null;
let armeSelectionnee = null;
let nbDCActuel = 2;

function initJoueur(){
  // Récupérer l'ID depuis l'URL (?id=xxx)
  const params = new URLSearchParams(window.location.search);
  joueurId = params.get('id');
  if(!joueurId){ document.getElementById('attente').innerHTML = '<div style="color:var(--rd);padding:40px;text-align:center">⚠ Aucun personnage — accède via ta fiche joueur</div>'; return; }

  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();

  // Charger données joueur
  db.collection('joueurs').doc(joueurId).onSnapshot(snap => {
    if(!snap.exists){ return; }
    joueurData = {...snap.data(), _id: joueurId};
    document.getElementById('hdr-nom').textContent = joueurData.nom || joueurId;
    document.getElementById('lien-fiche').href = '../fiche_perso/fiche_perso.html?id=' + joueurId;
    renderMaCarte();
  });

  // Écouter l'état du combat en temps réel
  db.collection('combat').doc(COMBAT_DOC).onSnapshot(snap => {
    if(!snap.exists || !snap.data().actif){
      document.getElementById('attente').style.display='block';
      document.getElementById('combat-actif').style.display='none';
      return;
    }
    combatState = snap.data();
    document.getElementById('attente').style.display='none';
    document.getElementById('combat-actif').style.display='block';
    renderCombatJoueur();
  });
}

function getHpMax(d){
  return (d.special?.L||5)+(d.special?.E||5)+Math.max(0,(d.niveau||1)-1)+(d.perks?.['Life Giver']||0)*(d.special?.E||5);
}

function getTN(d, skKey){
  const attr = SK_ATTR[skKey]||'A';
  const map = {S:d.special?.S||5,P:d.special?.P||5,E:d.special?.E||5,C:d.special?.C||5,I:d.special?.I||5,A:d.special?.A||5,L:d.special?.L||5};
  const rang = d.skills?.[skKey]||0;
  const tag = d.taggedSkills?.includes(skKey)?2:0;
  return map[attr]+rang+tag;
}

function renderMaCarte(){
  const el = document.getElementById('ma-carte-content'); if(!el||!joueurData) return;
  const d = joueurData;
  const hpMax = getHpMax(d);
  const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
  const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
  const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');

  // Actions depuis combatState si dispo
  const myState = combatState?.actionsState?.[joueurId] || {mineure:1,majeure:1,pa:0};
  const isMoTour = combatState && combatState.ordreInitiative?.[combatState.tourActif]?.id === joueurId;

  let html = '';
  if(isMoTour) html += '<div class="mon-tour-banner">▶ C\'EST TON TOUR !</div>';

  html += '<div class="jc-top"><span class="jc-name">' + (d.nom||joueurId).toUpperCase() + '</span></div>';
  html += '<div class="jc-bar"><div style="width:'+pct+'%;height:100%;background:'+barColor+'"></div></div>';
  html += '<div class="jc-row">';
  html += '<div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv'+(pct<30?' danger':pct<60?' warn':'')+'">'+d.hp+'/'+hpMax+'</span></div>';
  html += '<div class="jc-stat"><span class="jc-sl">RAD</span><span class="jc-sv'+(d.rad>0?' warn':'')+'">'+d.rad+'</span></div>';
  html += '<div class="jc-stat"><span class="jc-sl">PA</span><span class="jc-sv" style="color:var(--am)">'+myState.pa+'</span></div>';
  html += '</div>';

  // Actions
  html += '<div class="tracker-actions" style="margin:6px 0">';
  html += '<div class="act-group"><span class="act-lbl">Min</span>';
  html += [0,1].map(i=>'<span class="act-dot'+(i<myState.mineure?' on':'')+'"></span>').join('');
  html += '</div><div class="act-group"><span class="act-lbl">Maj</span>';
  html += [0,1].map(i=>'<span class="act-dot maj'+(i<myState.majeure?' on':'')+'"></span>').join('');
  html += '</div></div>';

  // Armes
  html += '<div style="margin-top:6px">';
  weaps.forEach(inv => {
    const db2 = WEAPONS_DB[inv.name]||{};
    const tn = db2.sk ? getTN(d, db2.sk) + (inv.persoBonus?2:0) : 0;
    const sel = armeSelectionnee===inv.name;
    html += '<div class="jc-arme clickable'+(sel?' selected-arme':'')+'" onclick="selArme(\''+inv.name+'\','+tn+',\''+(db2.dmg||'2D')+'\')">';
    html += '<span class="jc-arme-name">'+inv.name+(inv.persoBonus?' ★':'')+'</span>';
    html += '<span class="jc-arme-stat">'+(db2.dmg||'?')+' · TN <b>'+tn+'</b>'+(db2.eff&&db2.eff!=='—'?' · '+db2.eff:'')+'</span>';
    html += '</div>';
  });
  // Mains nues
  const tnUnarmed = getTN(d,'barehand');
  html += '<div class="jc-arme clickable'+(armeSelectionnee==='__unarmed__'?' selected-arme':'')+'" onclick="selArme(\'__unarmed__\','+tnUnarmed+',\'2D\')">';
  html += '<span class="jc-arme-name" style="color:var(--td)">👊 Mains nues</span>';
  html += '<span class="jc-arme-stat">2D · TN <b>'+tnUnarmed+'</b></span>';
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}

function selArme(nom, tn, dmg){
  armeSelectionnee = nom;
  nbDCActuel = parseInt(dmg)||2;
  document.getElementById('j-tn-val').value = tn;
  renderMaCarte();
  // Mettre à jour contexte dés
  const ctx = document.getElementById('mes-des-context');
  const nomAff = nom==='__unarmed__'?'Mains nues':nom;
  ctx.innerHTML = '<b style="color:var(--tb)">'+nomAff+'</b> · '+dmg+' · TN <b style="color:var(--am)">'+tn+'</b>';
  document.getElementById('j-nb-cd').value = nbDCActuel;
}

function renderCombatJoueur(){
  if(!combatState) return;
  document.getElementById('j-round').textContent = combatState.numRound||1;
  document.getElementById('hdr-round').textContent = 'Round ' + (combatState.numRound||1);
  renderMaCarte();
  renderTrackerJoueur();
  renderEnnemisJoueur();
}

function renderTrackerJoueur(){
  const el = document.getElementById('j-tracker'); if(!el||!combatState) return;
  const ordre = combatState.ordreInitiative||[];
  const tourActif = combatState.tourActif||0;
  if(!ordre.length){ el.innerHTML='<span class="empty">En attente...</span>'; return; }

  el.innerHTML = ordre.map((c,i) => {
    const isActif = i===tourActif;
    const isMe = c.id===joueurId;
    return '<div class="tracker-item'+(isActif?' actif':'')+(c.type==='ennemi'?' ennemi':'')+(isMe?' c-est-moi':'')+'">'
      +'<div class="tracker-top">'
      +'<span class="tracker-nom">'+(isActif?'▶ ':'')+c.nom+(isMe?' ◀ TOI':'')+' </span>'
      +'<span class="tracker-init">'+c.init+'</span>'
      +'</div></div>';
  }).join('');
}

function renderEnnemisJoueur(){
  const el = document.getElementById('j-ennemis'); if(!el||!combatState) return;
  const ennemis = combatState.ennemis||[];
  if(!ennemis.length){ el.innerHTML='<span class="empty">Aucun ennemi</span>'; return; }
  el.innerHTML = ennemis.map(e => {
    const pct = Math.round(e.pvCur/e.pvMax*100);
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    return '<div class="ennemi-card'+(e.pvCur<=0?' dead':'')+'">'
      +'<div class="jc-top"><span class="ennemi-name">'+e.nom+'</span><span class="jc-init">'+(e.initiative||'—')+'</span></div>'
      +'<div class="jc-bar"><div style="width:'+pct+'%;height:100%;background:'+bc+'"></div></div>'
      +'<div class="jc-row">'
      +'<div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv'+(pct<30?' danger':'')+'">'+e.pvCur+'/'+e.pvMax+'</span></div>'
      +'<div class="jc-stat"><span class="jc-sl">ATQ</span><span class="jc-sv">'+e.atq+'</span></div>'
      +'<div class="jc-stat"><span class="jc-sl">RD</span><span class="jc-sv">'+e.rd+'</span></div>'
      +'</div></div>';
  }).join('');
}

// ---- DÉS ----
function jLancer2D20(){
  const tn = parseInt(document.getElementById('j-tn-val').value)||10;
  const d1=Math.floor(Math.random()*20)+1, d2=Math.floor(Math.random()*20)+1;
  let succes = [d1,d2].filter(v=>v<=tn).length + [d1,d2].filter(v=>v===1).length;
  const crits = [d1,d2].filter(v=>v===1).length;
  const diff = 1;
  const echec = succes < diff;
  const succesBonus = Math.max(0, succes-diff);
  const dcTotal = echec ? 0 : nbDCActuel + succesBonus;
  if(!echec) document.getElementById('j-nb-cd').value = dcTotal;

  let r = '';
  r += '<span style="color:'+(d1<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:18px">'+d1+'</span>';
  r += ' / ';
  r += '<span style="color:'+(d2<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:18px">'+d2+'</span>';
  r += ' → ';
  const col = succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  r += '<b style="color:'+col+';font-family:Oswald,sans-serif;font-size:16px">'+succes+' succès</b>';
  if(crits) r += ' <span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r += ' <span style="color:var(--rd)">— ÉCHEC</span>';
  else r += ' → <b style="color:var(--am)">'+dcTotal+'DC</b>';
  document.getElementById('j-dice-result').innerHTML = r;
}

function jLancerCD(){
  const nb = parseInt(document.getElementById('j-nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.filter(v=>v==='1'||v==='2').reduce((a,v)=>a+parseInt(v),0);
  const ef = vals.filter(v=>v==='★').length;
  document.getElementById('j-cd-result').innerHTML =
    vals.map(v=>'<span style="color:'+(v==='★'?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-family:Oswald,sans-serif;font-size:16px">'+v+'</span>').join(' ')
    +' → <b style="color:var(--am)">'+dmg+'dmg</b>'+(ef?' <span style="color:var(--am)">+'+ef+'⚡</span>':'');
}
