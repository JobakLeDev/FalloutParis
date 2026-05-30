const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
// firebaseConfig, XP_TABLE définis dans common/shared.js

let db;
let joueurs = {};
let combattants = {};
let ennemis = [];
let log = [];
let joueurActif = null;
let armeActive = null;

// ---- TRACKER DE TOUR ----
let tourActif = null;       // index dans ordreInitiative
let ordreInitiative = [];   // [{id, nom, type:'joueur'|'ennemi', init}]
let numRound = 0;
// État des actions par combattant ce tour : {mineure:0-2, majeure:0-2, pa:X}
let actionsState = {};

// WEAPONS_DB défini dans mj_shared.js

// ENNEMIS_DB défini dans mj_shared.js (fusionné + accent 'Légion de Fer' corrigé)

// SK_ATTR, FACES_CD définis dans mj_shared.js

// ---- INIT ----
function init(){
  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();
  deverrouiller();
}

function deverrouiller(){
  chargerJoueurs();
  // Auto-sélectionner les joueurs transmis depuis mj.html
  const storedJoueurs = sessionStorage.getItem('combat_joueurs');
  if(storedJoueurs){
    try{
      const ids = JSON.parse(storedJoueurs);
      ids.forEach(id => {
        // On attend que joueurs soit chargé — on stocke les IDs pour après
        combattants[id] = {data: null, initiative: null, _pending: true};
      });
      sessionStorage.removeItem('combat_joueurs');
    }catch(e){}
  }
  const stored = sessionStorage.getItem('combat_ennemis');
  if(stored){
    try{
      const data = JSON.parse(stored);
      data.forEach(e => ennemis.push(e));
      sessionStorage.removeItem('combat_ennemis');
      addLog('⚔ ' + ennemis.length + ' ennemi(s) importés depuis la page MJ');
    }catch(e){}
  }
  renderCombat();
}

// ---- JOUEURS ----
async function chargerJoueurs(){
  const snap = await db.collection('joueurs').get();
  joueurs = {};
  snap.forEach(doc => { joueurs[doc.id] = {...doc.data(), _id:doc.id}; });
  // Résoudre les combattants en attente (transmis depuis mj.html)
  Object.keys(combattants).forEach(id => {
    if(combattants[id]._pending && joueurs[id]){
      combattants[id] = {data: joueurs[id], initiative: null};
    } else if(combattants[id]._pending){
      delete combattants[id]; // joueur introuvable
    }
  });
  renderSelJoueurs();
  renderCombat();
}

function renderSelJoueurs(){
  const el = document.getElementById('sel-joueurs'); el.innerHTML='';
  Object.values(joueurs).forEach(d => {
    const inCombat = !!combattants[d._id];
    el.innerHTML += '<button class="sel-j-btn' + (inCombat?' active':'') + '" onclick="toggleCombattant(\'' + d._id + '\')">' + (d.nom||d._id).toUpperCase() + '</button>';
  });
}

function toggleCombattant(id){
  if(combattants[id]) delete combattants[id];
  else combattants[id] = {data: joueurs[id], initiative: null};
  renderSelJoueurs();
  renderCombat();
}

// ============================================================
// INITIATIVE & TRACKER DE TOUR
// ============================================================
function getPA(d){
  // PA de base = momentum stocké, sinon 0 (géré manuellement)
  return actionsState[d._id]?.pa ?? 0;
}

function initActionsState(key, isJoueur, d){
  // Initialise l'état d'actions pour un combattant
  const paMax = isJoueur ? (d.special?.L||5) : 3; // LCK pour joueurs, 3 pour ennemis
  actionsState[key] = {mineure:1, majeure:1, pa: isJoueur ? (d.momentum||0) : 0, paMax};
}

function lancerInitiative(){
  ordreInitiative = [];
  actionsState = {};

  // Joueurs : PER + AGI + Action Boy/Girl
  Object.entries(combattants).forEach(([id, c]) => {
    const d = c.data;
    const per = d.special?.P||5;
    const agi = d.special?.A||5;
    const bonus = (d.perks?.['Action Boy/Girl']||0)*2;
    const init = per + agi + bonus;
    c.initiative = init;
    ordreInitiative.push({id, nom:(d.nom||id).toUpperCase(), type:'joueur', init});
    initActionsState(id, true, d);
    addLog('🎲 ' + (d.nom||id) + ' init ' + per + '+' + agi + (bonus?'+'+bonus:'') + ' = ' + init);
  });

  // Ennemis : Body + Mind
  ennemis.forEach(e => {
    const db2 = ENNEMIS_DB[e.nom] || ENNEMIS_DB[Object.keys(ENNEMIS_DB).find(k=>e.nom.startsWith(k))] || {};
    e.initiative = (db2.body||6) + (db2.mind||4);
    ordreInitiative.push({id:'e_'+e.id, nom:e.nom, type:'ennemi', init:e.initiative, eid:e.id});
    initActionsState('e_'+e.id, false, {});
  });

  // Trier par initiative décroissante
  ordreInitiative.sort((a,b) => b.init - a.init);
  tourActif = 0;
  numRound = 1;

  addLog('⚔ Round ' + numRound + ' — ' + ordreInitiative[0].nom + ' commence !');
  renderCombat();
  renderTracker();
  syncCombatToFirebase();
}

function finDeTour(){
  if(!ordreInitiative.length) return;
  const current = ordreInitiative[tourActif];

  // Réinitialiser actions du combattant suivant
  tourActif = (tourActif + 1) % ordreInitiative.length;

  // Nouveau round si on revient au début
  if(tourActif === 0){
    numRound++;
    addLog('⚔ ─── Round ' + numRound + ' ───');
    // Réinitialiser toutes les actions
    ordreInitiative.forEach(c => {
      const isJ = c.type === 'joueur';
      const d = isJ ? combattants[c.id]?.data : {};
      initActionsState(c.id, isJ, d);
    });
  }

  const next = ordreInitiative[tourActif];
  addLog('➤ Tour de ' + next.nom);

  // Si c'est un joueur, le sélectionner automatiquement
  if(next.type === 'joueur'){
    joueurActif = next.id;
    armeActive = null;
    updateDicePanel();
  }

  renderCombat();
  renderTracker();
  syncCombatToFirebase();
}

function depensePA(key, cout){
  const s = actionsState[key]; if(!s) return false;
  if(s.pa < cout){ addLog('⚠ Pas assez de PA !'); return false; }
  s.pa -= cout;
  renderTracker();
  return true;
}

function depenseLuck(id){
  // Dépenser 1 point de Chance pour agir maintenant
  const c = combattants[id]; if(!c) return;
  const d = c.data;
  const luck = d.special?.L||5;
  if(luck <= 0){ addLog('⚠ Plus de Chance !'); return; }
  // Insérer le joueur juste après le combattant actif dans l'ordre
  const idx = ordreInitiative.findIndex(x=>x.id===id);
  if(idx !== -1) ordreInitiative.splice(idx, 1);
  ordreInitiative.splice(tourActif + 1, 0, {id, nom:(d.nom||id).toUpperCase(), type:'joueur', init:c.initiative, luck:true});
  addLog('🍀 ' + (d.nom||id) + ' dépense 1 Chance pour agir maintenant !');
  renderTracker();
}

function useMajeure(key, withPA){
  const s = actionsState[key]; if(!s) return;
  if(withPA){
    if(!depensePA(key, 2)) return;
    s.majeure = Math.min(s.majeure+1, 2);
    addLog('⚡ Action majeure bonus (-2 PA, difficulté +1)');
  } else {
    if(s.majeure <= 0){ addLog('⚠ Plus d\'actions majeures !'); return; }
    s.majeure--;
  }
  renderTracker();
}

function useMineure(key, withPA){
  const s = actionsState[key]; if(!s) return;
  if(withPA){
    if(!depensePA(key, 1)) return;
    s.mineure = Math.min(s.mineure+1, 2);
    addLog('⚡ Action mineure bonus (-1 PA)');
  } else {
    if(s.mineure <= 0){ addLog('⚠ Plus d\'actions mineures !'); return; }
    s.mineure--;
  }
  renderTracker();
  syncCombatToFirebase();
}

function chPA(key, delta){
  const s = actionsState[key]; if(!s) return;
  s.pa = Math.max(0, s.pa + delta);
  renderTracker();
  syncCombatToFirebase();
}

function renderTracker(){
  const el = document.getElementById('tracker-tour'); if(!el) return;
  if(!ordreInitiative.length){
    el.innerHTML = '<span class="empty">Lance l\'initiative pour démarrer</span>';
    return;
  }

  let html = '<div class="tracker-round">ROUND <b>' + numRound + '</b></div>';

  ordreInitiative.forEach((c, idx) => {
    const isActif = idx === tourActif;
    const s = actionsState[c.id] || {mineure:1,majeure:1,pa:0};
    const key = c.id;

    // Pastilles actions
    const minDots = [0,1].map(i =>
      '<span class="act-dot' + (i < s.mineure ? ' on' : '') + '" onclick="useMineure(\'' + key + '\',false)" title="Action mineure"></span>'
    ).join('');
    const majDots = [0,1].map(i =>
      '<span class="act-dot maj' + (i < s.majeure ? ' on' : '') + '" onclick="useMajeure(\'' + key + '\',false)" title="Action majeure"></span>'
    ).join('');

    html += '<div class="tracker-item' + (isActif?' actif':'') + (c.type==='ennemi'?' ennemi':'') + '">';
    html += '<div class="tracker-top">';
    html += '<span class="tracker-nom">' + (isActif?'▶ ':'') + c.nom + '</span>';
    html += '<span class="tracker-init">' + c.init + '</span>';
    html += '</div>';
    html += '<div class="tracker-actions">';
    html += '<div class="act-group"><span class="act-lbl">Min</span>' + minDots + '</div>';
    html += '<div class="act-group"><span class="act-lbl">Maj</span>' + majDots + '</div>';
    html += '<div class="act-group pa-group"><span class="act-lbl">PA</span>';
    html += '<button class="pa-btn" onclick="chPA(\'' + key + '\',-1)">−</button>';
    html += '<b class="pa-val">' + s.pa + '</b>';
    html += '<button class="pa-btn" onclick="chPA(\'' + key + '\',1)">+</button>';
    html += '</div>';
    if(c.type==='joueur'){
      html += '<button class="luck-btn" onclick="depenseLuck(\'' + c.id + '\')" title="Dépenser Chance pour agir maintenant">🍀</button>';
    }
    html += '</div>';
    // Boutons actions bonus
    if(isActif){
      html += '<div class="tracker-extra">';
      html += '<button class="xbtn" onclick="useMineure(\'' + key + '\',true)">+Min (-1PA)</button>';
      html += '<button class="xbtn" onclick="useMajeure(\'' + key + '\',true)">+Maj (-2PA)</button>';
      html += '</div>';
    }
    html += '</div>';
  });

  html += '<button class="fin-tour-btn" onclick="finDeTour()">➤ Fin de tour</button>';
  html += '<button class="fin-tour-btn" style="background:var(--rdk);border-color:var(--rd);color:var(--rd);margin-top:3px" onclick="finCombat()">✕ Fin du combat</button>';
  el.innerHTML = html;
}

// ---- ENNEMIS ----
// rollDice défini dans mj_shared.js

function ouvrirModalEnnemi(){
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
    const pvMax = Math.round(rollDice(db2.pvd) * (1+(lvl-1)*0.25));
    const rd = db2.rd + Math.floor((lvl-1)/2);
    const label = nb>1 ? nom+' '+(i+1) : nom;
    ennemis.push({id:Date.now()+i, nom:label, pvd:db2.pvd, pvMax, pvCur:pvMax, atq:db2.atq, rd, xp:db2.xp*lvl, initiative:null, body:db2.body||6, mind:db2.mind||4});
    addLog('➕ '+label+' (PV:'+pvMax+' RD:'+rd+')');
  }
  fermerModalEnnemi();
  renderCombat();
}

function dmgEnnemi(id, val){
  const e = ennemis.find(e=>e.id===id); if(!e) return;
  const after = Math.max(0, e.pvCur - val);
  addLog('⚔ '+e.nom+' : '+e.pvCur+'→'+after+' PV (-'+val+')');
  e.pvCur = after;
  if(e.pvCur<=0) addLog('💀 '+e.nom+' éliminé !');
  renderCombat();
}

function supprimerEnnemi(id){
  ennemis = ennemis.filter(e=>e.id!==id);
  // Retirer de l'ordre d'initiative
  ordreInitiative = ordreInitiative.filter(x=>x.eid!==id);
  if(tourActif >= ordreInitiative.length) tourActif = 0;
  renderCombat();
  renderTracker();
}

// ---- RENDER ----
function renderCombat(){
  renderJoueursCombat();
  renderEnnemis();
  renderTracker();
}

// getHpMax, getTN définis dans mj_shared.js

function renderJoueursCombat(){
  const el = document.getElementById('joueurs-combat'); el.innerHTML='';
  const ids = Object.keys(combattants);
  if(!ids.length){ el.innerHTML='<div class="empty">Aucun joueur — sélectionner ci-dessus</div>'; return; }
  ids.forEach(id => {
    const {data:d, initiative} = combattants[id];
    if(!d) return;
    const hpMax = getHpMax(d);
    const pct = Math.round(Math.max(0,d.hp||0)/hpMax*100);
    const barColor = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const isActif = joueurActif===id;
    const isTourActif = ordreInitiative.length && ordreInitiative[tourActif]?.id===id;
    const weapsEq = (d.inventory||[]).filter(it=>it.equipped&&it.type==='WEAPON');
    const rad = d.rad||0;

    el.innerHTML += `<div class="jc-card${isActif?' actif':''}${isTourActif?' tour-actif':''}" onclick="setActif('${id}')">
      <div class="jc-top">
        <span class="jc-name">${isTourActif?'▶ ':''}${(d.nom||id).toUpperCase()}</span>
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
      <div class="jc-arme${isActif?' clickable':''}" ${isActif?`onclick="event.stopPropagation();setArme('${id}','__unarmed__')"`:''}">
        <span class="jc-arme-name" style="color:var(--td)">👊 Mains nues</span>
        <span class="jc-arme-stat">2D · TN ${getTN(d,'barehand').total}</span>
      </div>
      <div class="ennemi-dmg" style="margin-top:5px">
        <input type="number" class="dmg-inp" id="jdmg-${id}" value="1" min="0">
        <button class="dmg-btn" onclick="event.stopPropagation();dmgJoueur('${id}',parseInt(document.getElementById('jdmg-${id}').value)||1)">Dégâts</button>
        <button class="dmg-btn" style="border-color:var(--gd);color:var(--g)" onclick="event.stopPropagation();soignJoueur('${id}',parseInt(document.getElementById('jdmg-${id}').value)||1)">Soins</button>
      </div>
    </div>`;
  });
}

function renderEnnemis(){
  const el = document.getElementById('ennemis-combat'); el.innerHTML='';
  if(!ennemis.length){ el.innerHTML='<div class="empty">Aucun ennemi</div>'; return; }
  ennemis.forEach(e => {
    const pct = Math.round(e.pvCur/e.pvMax*100);
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const isTourActif = ordreInitiative.length && ordreInitiative[tourActif]?.eid===e.id;
    el.innerHTML += `<div class="ennemi-card${e.pvCur<=0?' dead':''}${isTourActif?' tour-actif':''}">
      <div class="jc-top">
        <span class="ennemi-name">${isTourActif?'▶ ':''}${e.nom}</span>
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
        <button class="atq-btn" onclick="setAttaqueEnnemi(${e.id})">⚔ Attaquer</button>
      </div>
    </div>`;
  });
}

// ---- DÉS ----
function setActif(id){ joueurActif = joueurActif===id?null:id; armeActive=null; renderJoueursCombat(); updateDicePanel(); }

function setAttaqueEnnemi(eid){
  const e = ennemis.find(e=>e.id===eid); if(!e) return;
  const panel = document.getElementById('dice-context');
  const nbDC = parseInt(e.atq)||2;
  panel._nbDC = nbDC;
  panel._modeEnnemi = true;
  panel._ennemNom = e.nom;
  const cibles = Object.values(combattants);
  let html = '<div class="ctx-nom" style="color:var(--rd)">' + e.nom.toUpperCase() + ' attaque</div>';
  html += '<div class="ctx-arme">ATQ : <b>' + e.atq + '</b> · RD : <b>' + e.rd + '</b></div>';
  html += '<div class="ctx-diff" style="margin-top:4px">Cible :';
  html += '<select id="cible-sel" onchange="majTNCible()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none;margin-left:6px">';
  html += '<option value="">— Choisir —</option>';
  cibles.forEach(c => {
    const agi = c.data.special?.A||5;
    html += '<option value="' + c.data._id + '">' + (c.data.nom||c.data._id).toUpperCase() + ' (AGI ' + agi + ')</option>';
  });
  html += '</select></div>';
  html += '<div class="ctx-diff">Difficulté : <select id="diff-sel" onchange="majDC()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none"><option value="0">D0</option><option value="1" selected>D1</option><option value="2">D2</option><option value="3">D3</option></select></div>';
  html += '<div id="dc-suggest" class="ctx-dc">DC : <b style="color:var(--rd)" id="dc-nb">' + nbDC + '</b> (' + e.atq + ')</div>';
  document.getElementById('tn-val').value = 10;
  panel.innerHTML = html;
}

function majTNCible(){
  const sel = document.getElementById('cible-sel'); if(!sel) return;
  const id = sel.value; if(!id) return;
  const d = combattants[id]?.data; if(!d) return;
  document.getElementById('tn-val').value = d.special?.A||5;
}

function setArme(id, arme){ joueurActif=id; armeActive=arme==='__unarmed__'?null:arme; renderJoueursCombat(); updateDicePanel(); }

function updateDicePanel(){
  const panel = document.getElementById('dice-context');
  if(!joueurActif){ panel.innerHTML='<div class="empty">Sélectionne un joueur puis une arme</div>'; return; }
  const d = combattants[joueurActif]?.data; if(!d) return;
  let html = `<div class="ctx-nom">${(d.nom||joueurActif).toUpperCase()}</div>`;
  if(armeActive){
    const dbw = WEAPONS_DB[armeActive];
    const inv = (d.inventory||[]).find(i=>i.name===armeActive);
    if(dbw?.sk){
      const tn = getTN(d,dbw.sk);
      const tnFinal = tn.total + (inv?.persoBonus?2:0);
      const nbDC = parseInt(dbw.dmg)||2;
      html += `<div class="ctx-arme">${armeActive} · <b>${dbw.dmg}</b>${dbw.eff&&dbw.eff!=='—'?` · <span style="color:var(--am)">${dbw.eff}</span>`:''}</div>`;
      html += `<div class="ctx-tn">TN <b style="color:var(--tb);font-size:14px">${tnFinal}</b> = ${tn.attrVal}+${tn.rang}${tn.tag?'+2(TAG)':''}${inv?.persoBonus?'+2(★)':''}</div>`;
      html += `<div class="ctx-diff">Difficulté :<select id="diff-sel" onchange="majDC()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none"><option value="0">D0</option><option value="1" selected>D1</option><option value="2">D2</option><option value="3">D3</option></select></div>`;
      html += `<div id="dc-suggest" class="ctx-dc">DC : <b style="color:var(--am)" id="dc-nb">${nbDC}</b> (${dbw.dmg})</div>`;
      document.getElementById('tn-val').value = tnFinal;
      panel._nbDC = nbDC;
    }
  } else {
    const for_ = d.special?.S||5;
    const rang = d.skills?.barehand||0;
    const tag = d.taggedSkills?.includes('barehand')?2:0;
    const tnUnarmed = for_+rang+tag;
    html += `<div class="ctx-arme">Mains nues · <b>2D</b></div>`;
    html += `<div class="ctx-tn">TN <b style="color:var(--tb);font-size:14px">${tnUnarmed}</b> = ${for_}(FOR)+${rang}${tag?'+2(TAG)':''}</div>`;
    html += `<div class="ctx-diff">Difficulté :<select id="diff-sel" onchange="majDC()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none"><option value="0">D0</option><option value="1" selected>D1</option><option value="2">D2</option><option value="3">D3</option></select></div>`;
    html += `<div id="dc-suggest" class="ctx-dc">DC : <b style="color:var(--am)" id="dc-nb">2</b> (2D)</div>`;
    document.getElementById('tn-val').value = tnUnarmed;
    panel._nbDC = 2;
  }
  panel.innerHTML = html;
}

function majDC(){
  const diff = parseInt(document.getElementById('diff-sel')?.value)||1;
  const panel = document.getElementById('dice-context');
  const base = panel._nbDC||2;
  const bonus = Math.max(0, 2-diff);
  const suggest = base+bonus;
  const el = document.getElementById('dc-nb');
  if(el) el.textContent = suggest + (bonus>0?' (+'+bonus+')':'');
  document.getElementById('nb-cd').value = suggest;
}

function lancer2D20(){
  const tn = parseInt(document.getElementById('tn-val').value)||10;
  const diff = parseInt(document.getElementById('diff-sel')?.value)||1;
  const panel = document.getElementById('dice-context');
  const basedc = panel._nbDC||2;
  const d1=Math.floor(Math.random()*20)+1, d2=Math.floor(Math.random()*20)+1;
  let succes = [d1,d2].filter(v=>v<=tn).length + [d1,d2].filter(v=>v===1).length;
  const crits = [d1,d2].filter(v=>v===1).length;
  const echec = succes < diff;
  const succesBonus = Math.max(0, succes-diff);
  const dcTotal = echec ? 0 : basedc+succesBonus;
  if(!echec) document.getElementById('nb-cd').value = dcTotal;

  const col = succes===0?'var(--rd)':succes>diff?'var(--g)':'var(--am)';
  let r = '';
  r += '<span style="color:'+(d1<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:18px">'+d1+'</span>';
  r += '<span style="color:var(--td)"> / </span>';
  r += '<span style="color:'+(d2<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:18px">'+d2+'</span>';
  r += '<span style="color:var(--td)"> → </span>';
  r += '<b style="color:'+col+';font-family:Oswald,sans-serif;font-size:16px">'+succes+' succès</b>';
  if(crits) r += ' <span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r += ' <span style="color:var(--rd)">— ÉCHEC</span>';
  else { r += ' → <b style="color:var(--am)">'+dcTotal+'DC</b>'; if(succesBonus>0) r += ' <span style="color:var(--td)">(+'+succesBonus+')</span>'; }
  document.getElementById('dice-result').innerHTML = r;

  const nomLog = panel._modeEnnemi?(panel._ennemNom||'Ennemi'):(joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'?');
  const armeLog = panel._modeEnnemi?'':(armeActive?' ('+armeActive+')':'');
  addLog('🎲 '+nomLog+armeLog+' TN'+tn+' D'+diff+': '+d1+'/'+d2+' = '+succes+'s → '+(echec?'ÉCHEC':dcTotal+'DC'));
  panel._modeEnnemi = false;
}

function lancerCD(){
  const nb = parseInt(document.getElementById('nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.filter(v=>v==='1'||v==='2').reduce((a,v)=>a+parseInt(v),0);
  const ef = vals.filter(v=>v==='★').length;
  document.getElementById('cd-result').innerHTML =
    vals.map(v=>'<span style="color:'+(v==='★'?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-family:Oswald,sans-serif;font-size:16px">'+v+'</span>').join(' ')
    +' <span style="color:var(--td)">→</span> <b style="color:var(--am)">'+dmg+'dmg</b>'+(ef?' <span style="color:var(--am)">+'+ef+'⚡</span>':'');
  const nom = joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'?';
  addLog('💥 '+nom+' '+nb+'DC: '+dmg+'dmg'+(ef?' +'+ef+'⚡':''));
}

// ---- DÉGÂTS JOUEURS ----
async function dmgJoueur(id, val){
  const d = combattants[id]?.data; if(!d) return;
  const newHp = Math.max(0, (d.hp||0)-val);
  await db.collection('joueurs').doc(id).update({hp:newHp, lastUpdate:Date.now()});
  combattants[id].data.hp = newHp;
  addLog('💥 '+(d.nom||id)+' : '+(d.hp||0)+'→'+newHp+' PV (-'+val+')');
  renderJoueursCombat();
}

async function soignJoueur(id, val){
  const d = combattants[id]?.data; if(!d) return;
  const newHp = Math.min(getHpMax(d), (d.hp||0)+val);
  await db.collection('joueurs').doc(id).update({hp:newHp, lastUpdate:Date.now()});
  combattants[id].data.hp = newHp;
  addLog('✚ '+(d.nom||id)+' : '+(d.hp||0)+'→'+newHp+' PV (+'+val+')');
  renderJoueursCombat();
}

// ---- LOG ----
function addLog(msg){
  const ts = new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
  log.unshift('['+ts+'] '+msg);
  if(log.length>40) log.pop();
  const el = document.getElementById('combat-log'); if(!el) return;
  el.innerHTML = log.map(l=>'<div class="log-line">'+l+'</div>').join('');
}
function clearLog(){ log=[]; document.getElementById('combat-log').innerHTML=''; }

function finCombat(){
  ordreInitiative = [];
  actionsState = {};
  tourActif = 0;
  numRound = 0;
  stopCombat();
  addLog('🏁 Combat terminé.');
  renderTracker();
}
