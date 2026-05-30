// firebaseConfig, COMBAT_DOC, FACES_CD, SK_ATTR, WEAPONS_DB définis dans common/shared.js et mj_shared.js

let db, joueurData = null, joueurId = null;
let combatState = null;
let tousJoueurs = {};
let armeSelectionnee = null;
let nbDCActuel = 2;

function initJoueur(){
  const params = new URLSearchParams(window.location.search);
  joueurId = params.get('id');
  if(!joueurId){ document.getElementById('attente').innerHTML = '<div style="color:var(--rd);padding:40px;text-align:center">⚠ Aucun personnage — accède via ta fiche joueur</div>'; return; }

  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();

  // Mes données
  db.collection('joueurs').doc(joueurId).onSnapshot(snap => {
    if(!snap.exists) return;
    joueurData = {...snap.data(), _id: joueurId};
    document.getElementById('hdr-nom').textContent = joueurData.nom || joueurId;
    document.getElementById('lien-fiche').href = '../fiche_perso/fiche_perso.html?id=' + joueurId;
    renderMaCarte();
  });

  // Tous les joueurs (pour les coéquipiers)
  db.collection('joueurs').onSnapshot(snap => {
    tousJoueurs = {};
    snap.forEach(doc => { tousJoueurs[doc.id] = {...doc.data(), _id: doc.id}; });
    renderCoequipiers();
  });

  // État du combat
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

// getHpMax, getTN définis dans mj_shared.js

// ---- RENDER PRINCIPAL ----
function renderCombatJoueur(){
  if(!combatState) return;
  document.getElementById('j-round').textContent = combatState.numRound||1;
  document.getElementById('hdr-round').textContent = 'Round ' + (combatState.numRound||1);
  renderMaCarte();
  renderActionsJoueur();
  renderCoequipiers();
  renderTrackerJoueur();
  renderEnnemisJoueur();
}

// ---- MA FICHE ----
function renderMaCarte(){
  const el = document.getElementById('ma-carte-content'); if(!el||!joueurData) return;
  const d = joueurData;
  const hpMax = getHpMax(d);
  const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
  const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
  const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;

  let html = '';
  if(isMoTour) html += '<div class="mon-tour-banner">▶ C\'EST TON TOUR !</div>';

  html += '<div class="jc-top"><span class="jc-name">' + (d.nom||joueurId).toUpperCase() + '</span></div>';
  html += '<div class="jc-bar"><div style="width:'+pct+'%;height:100%;background:'+barColor+'"></div></div>';
  html += '<div class="jc-row">';
  html += '<div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv'+(pct<30?' danger':pct<60?' warn':'')+'">'+d.hp+'/'+hpMax+'</span></div>';
  html += '<div class="jc-stat"><span class="jc-sl">RAD</span><span class="jc-sv'+(d.rad>0?' warn':'')+'">'+d.rad+'</span></div>';
  html += '</div>';

  // Armes
  html += '<div style="margin-top:6px">';
  weaps.forEach(inv => {
    const db2 = WEAPONS_DB[inv.name]||{};
    const tn = db2.sk ? getTN(d, db2.sk).total + (inv.persoBonus?2:0) : 0;
    const sel = armeSelectionnee===inv.name;
    html += '<div class="jc-arme clickable'+(sel?' selected-arme':'')+'" onclick="selArme(\''+inv.name+'\','+tn+',\''+(db2.dmg||'2D')+'\')">';
    html += '<span class="jc-arme-name">'+inv.name+(inv.persoBonus?' ★':'')+'</span>';
    html += '<span class="jc-arme-stat">'+(db2.dmg||'?')+' · TN <b>'+tn+'</b>'+(db2.eff&&db2.eff!=='—'?' · '+db2.eff:'')+'</span>';
    html += '</div>';
  });
  const tnUnarmed = getTN(d,'barehand').total;
  html += '<div class="jc-arme clickable'+(armeSelectionnee==='__unarmed__'?' selected-arme':'')+'" onclick="selArme(\'__unarmed__\','+tnUnarmed+',\'2D\')">';
  html += '<span class="jc-arme-name" style="color:var(--td)">👊 Mains nues</span>';
  html += '<span class="jc-arme-stat">2D · TN <b>'+tnUnarmed+'</b></span>';
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}

// ---- GESTIONNAIRE D'ACTIONS ----
function renderActionsJoueur(){
  const el = document.getElementById('j-actions'); if(!el||!combatState) return;
  const s = combatState.actionsState?.[joueurId] || {mineure:1, majeure:1, pa:0};

  const minDots = [0,1].map(i =>
    '<span class="act-dot-j'+(i < s.mineure ? ' on' : '')+'" onclick="depenseActionJoueur(\'min\')" title="Dépenser action mineure"></span>'
  ).join('');
  const majDots = [0,1].map(i =>
    '<span class="act-dot-j maj'+(i < s.majeure ? ' on' : '')+'" onclick="depenseActionJoueur(\'maj\')" title="Dépenser action majeure"></span>'
  ).join('');

  el.innerHTML =
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">MIN</span>' +
      '<div class="act-dots">' + minDots + '</div>' +
      '<button class="act-bonus-btn" onclick="actionBonusJoueur(\'min\')" title="-1 PA">+Min</button>' +
    '</div>' +
    '<div class="act-sep"></div>' +
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">MAJ</span>' +
      '<div class="act-dots">' + majDots + '</div>' +
      '<button class="act-bonus-btn" onclick="actionBonusJoueur(\'maj\')" title="-2 PA">+Maj</button>' +
    '</div>' +
    '<div class="act-sep"></div>' +
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">PA</span>' +
      '<button class="pa-btn-j" onclick="chPAJoueur(-1)">−</button>' +
      '<span class="pa-val-j">' + s.pa + '</span>' +
      '<button class="pa-btn-j" onclick="chPAJoueur(1)">+</button>' +
    '</div>';
}

async function depenseActionJoueur(type){
  if(!db||!combatState) return;
  const s = combatState.actionsState?.[joueurId]; if(!s) return;
  if(type==='min' && s.mineure <= 0) return;
  if(type==='maj' && s.majeure <= 0) return;
  const upd = {};
  upd['actionsState.' + joueurId + (type==='min' ? '.mineure' : '.majeure')] =
    (type==='min' ? s.mineure : s.majeure) - 1;
  try { await db.collection('combat').doc(COMBAT_DOC).update(upd); } catch(e){ console.error(e); }
}

async function actionBonusJoueur(type){
  if(!db||!combatState) return;
  const s = combatState.actionsState?.[joueurId]; if(!s) return;
  const cout = type==='min' ? 1 : 2;
  if((s.pa||0) < cout) return;
  const upd = {};
  upd['actionsState.' + joueurId + '.pa'] = (s.pa||0) - cout;
  upd['actionsState.' + joueurId + (type==='min' ? '.mineure' : '.majeure')] =
    Math.min((type==='min' ? s.mineure : s.majeure) + 1, 2);
  try { await db.collection('combat').doc(COMBAT_DOC).update(upd); } catch(e){ console.error(e); }
}

async function chPAJoueur(delta){
  if(!db||!combatState) return;
  const s = combatState.actionsState?.[joueurId]; if(!s) return;
  const newPA = Math.max(0, (s.pa||0) + delta);
  const upd = {};
  upd['actionsState.' + joueurId + '.pa'] = newPA;
  try { await db.collection('combat').doc(COMBAT_DOC).update(upd); } catch(e){ console.error(e); }
}

// ---- COÉQUIPIERS ----
function renderCoequipiers(){
  const el = document.getElementById('j-coequipiers'); if(!el) return;
  if(!combatState){ el.innerHTML='<span class="empty">Aucun coéquipier</span>'; return; }

  const ordre = combatState.ordreInitiative||[];
  const tourActif = combatState.tourActif||0;
  const coeqs = ordre.filter(c => c.type==='joueur' && c.id !== joueurId);

  if(!coeqs.length){ el.innerHTML='<span class="empty">Aucun coéquipier</span>'; return; }

  el.innerHTML = coeqs.map((c, idx) => {
    const d = tousJoueurs[c.id];
    const isTour = ordre.indexOf(c) === tourActif;
    if(!d) return '<div class="coeq-card"><span class="coeq-nom">' + c.nom + '</span></div>';
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0, d.hp||0) / hpMax * 100);
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const weaps = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');
    const weapsTxt = weaps.map(w=>{
      const db2 = WEAPONS_DB[w.name]||{};
      return w.name + (db2.dmg?' <span style="color:var(--am)">'+db2.dmg+'</span>':'');
    }).join(' · ') || '<span style="color:#2a4a2a">—</span>';
    return '<div class="coeq-card'+(isTour?' tour-actif':'')+'">' +
      '<div class="coeq-top">' +
        '<span class="coeq-nom">'+(isTour?'▶ ':'')+c.nom+'</span>' +
      '</div>' +
      '<div class="coeq-bar"><div style="width:'+pct+'%;height:100%;background:'+bc+'"></div></div>' +
      '<div class="coeq-stats">' +
        '<span>PV <b class="'+(pct<30?'danger':pct<60?'warn':'')+'">'+d.hp+'/'+hpMax+'</b></span>' +
        (d.rad>0 ? '<span>RAD <b class="warn">'+d.rad+'</b></span>' : '') +
      '</div>' +
      '<div style="font-size:7px;color:var(--td);margin-top:3px">'+weapsTxt+'</div>' +
    '</div>';
  }).join('');
}

// ---- TRACKER ----
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
      +'<span class="tracker-nom">'+(isActif?'▶ ':'')+c.nom+(isMe?' ◀':'')+' </span>'
      +'<span class="tracker-init">'+c.init+'</span>'
      +'</div></div>';
  }).join('');
}

// ---- ENNEMIS ----
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

// ---- SÉLECTION ARME + DÉS ----
function selArme(nom, tn, dmg){
  armeSelectionnee = nom;
  nbDCActuel = parseInt(dmg)||2;
  document.getElementById('j-tn-val').value = tn;
  renderMaCarte();
  const nomAff = nom==='__unarmed__'?'Mains nues':nom;
  document.getElementById('mes-des-context').innerHTML = '<b style="color:var(--tb)">'+nomAff+'</b> · '+dmg+' · TN <b style="color:var(--am)">'+tn+'</b>';
  document.getElementById('j-nb-cd').value = nbDCActuel;
}

function jLancer2D20(){
  const tn = parseInt(document.getElementById('j-tn-val').value)||10;
  const d1=Math.floor(Math.random()*20)+1, d2=Math.floor(Math.random()*20)+1;
  let succes = [d1,d2].filter(v=>v<=tn).length + [d1,d2].filter(v=>v===1).length;
  const crits = [d1,d2].filter(v=>v===1).length;
  const echec = succes < 1;
  const dcTotal = echec ? 0 : nbDCActuel + Math.max(0, succes-1);
  if(!echec) document.getElementById('j-nb-cd').value = dcTotal;

  const col = succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  let r = '<span style="color:'+(d1<=tn?'var(--g)':'var(--rd)')+';font-size:16px;font-family:Oswald,sans-serif">'+d1+'</span>';
  r += '/<span style="color:'+(d2<=tn?'var(--g)':'var(--rd)')+';font-size:16px;font-family:Oswald,sans-serif">'+d2+'</span>';
  r += ' <b style="color:'+col+'">'+succes+'s</b>';
  if(crits) r += '<span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r += ' <span style="color:var(--rd)">ÉCHEC</span>';
  else r += '→<b style="color:var(--am)">'+dcTotal+'DC</b>';
  document.getElementById('j-dice-result').innerHTML = r;
}

function jLancerCD(){
  const nb = parseInt(document.getElementById('j-nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.filter(v=>v==='1'||v==='2').reduce((a,v)=>a+parseInt(v),0);
  const ef = vals.filter(v=>v==='★').length;
  document.getElementById('j-cd-result').innerHTML =
    vals.map(v=>'<span style="color:'+(v==='★'?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-size:14px;font-family:Oswald,sans-serif">'+v+'</span>').join(' ')
    +' <b style="color:var(--am)">'+dmg+'dmg</b>'+(ef?' <span style="color:var(--am)">+'+ef+'⚡</span>':'');
}
