const MJ_CODE = '1234';
const FICHE_URL = 'https://jobakledev.github.io/FalloutParis/pages/fiche_perso/fiche_perso.html';
// firebaseConfig, XP_TABLE définis dans common/shared.js

let db;
let joueurs = {};
let combattants = {};
let ennemis = [];
let allies = [];      // compagnons en combat (PNJ alliés des joueurs)
let log = [];
let joueurActif = null;
let armeActive = null;

// ---- TRACKER DE TOUR ----
let tourActif = null;
let ordreInitiative = [];
let numRound = 0;
let actionsState = {};

// ---- AP POOLS ----
let apPool = 0;     // Pool groupe partagé (max 6)
let mjApPool = 0;   // Pool MJ (masqué des joueurs)
let defenseBonus = {};  // {joueurId: n} — bonus de Défense (action Defend), jusqu'au prochain tour du joueur
let _assistDie = {};    // {allyId: {...}} — dé d'assistance en attente (action Assist) pour compagnons
let nbDiceMJ = 2;   // Nombre de d20 sélectionnés
let lastExcessMJ = 0;
let lastSkKeyMJ = '';
let lastInfoRequestTs = 0;
let lastLuckyTimingTs = 0;
let lastLuckDrawTs = 0;
let lastAttackResultTs = 0;
let lastTurnDoneTs = {};        // {joueurId: ts} — dernier "Terminer mon tour" traité (avance auto sans validation MJ)
let _turnDoneSeeded = false;    // au 1er snapshot, on enregistre les turnDone existants sans avancer
let lastActionResultTs = 0;     // dernier résultat d'action à effet (Defend/Rally/First Aid…) journalisé

// WEAPONS_DB défini dans mj_shared.js

// ENNEMIS_DB défini dans mj_shared.js (fusionné + accent 'Légion de Fer' corrigé)

// SK_ATTR, FACES_CD définis dans mj_shared.js

// ---- COMBAT ID (multi-sessions) ----
let currentCombatId = sessionStorage.getItem('currentCombatId') || null;

// ---- ACTIONS DÉCLARÉES (subcollection) ----
let actionsJoueurs = {}; // {joueurId: {mineure:{used,pending}, majeure:{used,pending}, mouvement_used}}

// ---- INIT ----
function init(){
  if(!currentCombatId){
    document.getElementById('app').innerHTML =
      '<div style="padding:60px;text-align:center;color:var(--rd);font-family:\'Share Tech Mono\',monospace;font-size:10px;letter-spacing:2px">' +
      '⚠ Aucun combat actif.<br><br>' +
      '<a href="mj.html" style="color:var(--g);border:1px solid var(--g);padding:6px 18px;text-decoration:none">← Retour au MJ</a>' +
      '</div>';
    return;
  }
  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();
  deverrouiller();
}

function deverrouiller(){
  chargerJoueurs();
  // Listener pour apPool (mis à jour par les joueurs)
  db.collection(COMBATS_COLL).doc(currentCombatId).onSnapshot(snap => {
    if(!snap.exists) return;
    const data = snap.data();
    if(data.apPool !== undefined && data.apPool !== apPool) {
      apPool = data.apPool; renderAPPool();
    }
    if(data.mjApPool !== undefined && data.mjApPool !== mjApPool) {
      mjApPool = data.mjApPool; renderAPPool();
    }
    if(data.assistDie) _assistDie = data.assistDie;
    if(data.defenseBonus) defenseBonus = data.defenseBonus;
    // Notification info joueur
    if(data.infoRequest && data.infoRequest.ts > lastInfoRequestTs) {
      lastInfoRequestTs = data.infoRequest.ts;
      const banner = document.getElementById('ap-info-banner');
      const txt = document.getElementById('ap-info-text');
      if(banner && txt) {
        txt.textContent = (data.infoRequest.joueur||'?') + ' demande une information !';
        banner.style.display = 'flex';
      }
      addLog('❓ ' + (data.infoRequest.joueur||'?') + ' demande une information !');
    }
    // Lucky Timing (déclenché par le joueur)
    if(data.luckyTimingReq && data.luckyTimingReq.ts > lastLuckyTimingTs) {
      lastLuckyTimingTs = data.luckyTimingReq.ts;
      executeLuckyTiming(data.luckyTimingReq.id, data.luckyTimingReq.nom);
      db.collection(COMBATS_COLL).doc(currentCombatId).update({luckyTimingReq:null}).catch(()=>{});
    }
    // Luck of the Draw
    if(data.luckRequest && data.luckRequest.ts > lastLuckDrawTs) {
      lastLuckDrawTs = data.luckRequest.ts;
      addLog('🍀 '+data.luckRequest.joueur+' [Luck of the Draw] : "'+data.luckRequest.detail+'"');
      const banner = document.getElementById('ap-info-banner');
      const txt = document.getElementById('ap-info-text');
      if(banner && txt) {
        txt.textContent = data.luckRequest.joueur+' : Luck of the Draw — "'+data.luckRequest.detail+'"';
        banner.style.display='flex';
      }
    }
    // Actions déclarées (champ dans le doc principal, pas de subcollection)
    if(data.actionsDeclarees){
      actionsJoueurs = data.actionsDeclarees;
      renderActionsMJ();
      // 1er snapshot : mémoriser les turnDone existants sans déclencher d'avance
      if(!_turnDoneSeeded){
        Object.entries(data.actionsDeclarees).forEach(([id,a]) => { if(a?.turnDone) lastTurnDoneTs[id] = a.turnDone; });
        _turnDoneSeeded = true;
      } else {
        // Le joueur ACTIF a cliqué « Terminer mon tour » → avancer automatiquement (sans validation MJ)
        const cur = ordreInitiative[tourActif];
        if(cur && cur.type === 'joueur'){
          const td = data.actionsDeclarees?.[cur.id]?.turnDone;
          if(td && td > (lastTurnDoneTs[cur.id] || 0)){
            lastTurnDoneTs[cur.id] = td;
            addLog('✔ ' + cur.nom + ' a terminé son tour');
            finDeTour();
          }
        }
      }
    }
    // Résultat d'attaque envoyé par un joueur
    if(data.attackResult && data.attackResult.ts > lastAttackResultTs){
      lastAttackResultTs = data.attackResult.ts;
      const r = data.attackResult;
      if(r.miss){ addLog('✗ ' + (r.nom||r.joueur) + ' rate son attaque' + (r.cible?' sur '+r.cible:'')); }
      else { const brk=(r.base!=null && r.dmg>r.base)?' ('+r.base+'+'+(r.dmg-r.base)+' effet)':''; let msg = (r.nom||r.joueur)+' inflige '+r.dmg+'dmg'+brk+(r.ef?' +'+r.ef+'⚡':'')+(r.cible?' à '+r.cible:'')+(r.zone?' ['+r.zone+(r.zoneAimee?' visé':'')+']':'');
        if(r.effetNote) msg += ' ['+r.effetNom+' : '+r.effetNote+']';
        if(r.rad>0) msg += ' +'+r.rad+' RAD';
        addLog('⚔ ' + msg);
        // Appliquer les dégâts automatiquement à l'ennemi ciblé (par ID — les noms peuvent être en double)
        if(r.dmg > 0){
          const cible = (r.cibleId != null && ennemis.find(e => String(e.id) === String(r.cibleId)))
                     || ennemis.find(e => e.nom === r.cible && e.pvCur > 0);   // fallback (ancien format / par nom)
          if(cible && cible.pvCur > 0){
            const avant = cible.pvCur;
            cible.pvCur = Math.max(0, cible.pvCur - r.dmg);
            addLog('💥 '+cible.nom+' : '+avant+' → '+cible.pvCur+' PV (−'+r.dmg+')');
            if(cible.pvCur <= 0) addLog('💀 '+cible.nom+' éliminé !');
            renderCombat();
            syncCombatToFirebase();
          }
        }
      }
    }
    // Résultat d'une action à effet (Defend / Rally / First Aid / Test / Assist / Command NPC / Pass…)
    if(data.actionResult && data.actionResult.ts > lastActionResultTs){
      lastActionResultTs = data.actionResult.ts;
      const a = data.actionResult;
      addLog('🎯 '+(a.nom||a.joueur)+' — '+a.action+(a.detail?' : '+a.detail:''));
      // Les soins/AP/défense sont déjà écrits dans le doc par le joueur → resync l'affichage local
      if(data.apPool !== undefined) apPool = data.apPool;
      if(data.defenseBonus) defenseBonus = data.defenseBonus;
      if(Array.isArray(data.allies)) allies = data.allies.map(x=>({...x}));
      renderCombat(); renderAPPool();
    }
  });

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
      data.forEach((e,i) => { if(e.id == null) e.id = Date.now()+'_'+i; ennemis.push(e); });
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

  // Rejoin : si aucun joueur n'a été transmis depuis mj.html, restaurer l'état depuis Firebase
  if(Object.keys(combattants).length === 0 && currentCombatId){
    restaurerEtatCombat();
  }
}

async function restaurerEtatCombat(){
  try {
    const snap = await db.collection(COMBATS_COLL).doc(currentCombatId).get();
    if(!snap.exists) return;
    const d = snap.data();
    ordreInitiative = d.ordreInitiative || [];
    actionsState    = d.actionsState   || {};
    tourActif       = d.tourActif      || 0;
    numRound        = d.numRound       || 0;
    apPool          = d.apPool         || 0;
    mjApPool        = d.mjApPool       || 0;
    defenseBonus    = d.defenseBonus   || {};
    _assistDie      = d.assistDie       || {};
    ennemis         = (d.ennemis       || []).map(e => ({...e}));
    allies          = (d.allies        || []).map(a => ({...a}));
    combatMap       = d.grid || null;
    // Reconstruire combattants depuis l'ordre d'initiative
    ordreInitiative.forEach(c => {
      if(c.type === 'joueur' && joueurs[c.id]){
        combattants[c.id] = {data: joueurs[c.id], initiative: c.init};
      }
    });
    // Sélectionner le joueur actif
    const actif = ordreInitiative[tourActif];
    if(actif?.type === 'joueur') { joueurActif = actif.id; updateDicePanel(); }
    addLog('↺ Combat restauré (round ' + numRound + ')');
    renderCombat();
    renderTracker();
    renderAPPool();
    renderSelJoueurs();
  } catch(e){ console.error('restaurerEtatCombat:', e); }
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

  // Joueurs : initiative = PER + AGI (RAW p.45). Action Boy/Girl ne joue PAS sur l'initiative
  // (son effet : pas de malus de difficulté sur la 2e action majeure payée en AP — RAW p.59).
  Object.entries(combattants).forEach(([id, c]) => {
    const d = c.data;
    const per = d.special?.P||5;
    const agi = d.special?.A||5;
    const init = per + agi;
    c.initiative = init;
    ordreInitiative.push({id, nom:(d.nom||id).toUpperCase(), type:'joueur', init});
    initActionsState(id, true, d);
    addLog('🎲 ' + (d.nom||id) + ' init ' + per + '+' + agi + ' = ' + init);
  });

  // Ennemis : initiative déjà calculée à la création (Body + Mind du schéma)
  ennemis.forEach(e => {
    if(!e.initiative) e.initiative = (e.body||6) + (e.mind||4);
    ordreInitiative.push({id:'e_'+e.id, nom:e.nom, type:'ennemi', init:e.initiative, eid:e.id});
    initActionsState('e_'+e.id, false, {});
  });

  // Trier par initiative décroissante
  ordreInitiative.sort((a,b) => b.init - a.init);

  // Compagnons (alliés) : agissent juste après leur PC — RAW p.45 (pas d'init propre)
  buildAlliesFromCompanions();
  allies.forEach(a => {
    const ownerIdx = ordreInitiative.findIndex(x => x.id === a.owner);
    const ownerInit = ownerIdx !== -1 ? ordreInitiative[ownerIdx].init : 0;
    const entry = { id:'a_'+a.id, nom:a.nom, type:'allie', init: ownerInit, aid:a.id, owner:a.owner, ownerNom:a.ownerNom };
    if(ownerIdx !== -1) ordreInitiative.splice(ownerIdx+1, 0, entry); else ordreInitiative.push(entry);
    initActionsState('a_'+a.id, false, {});
  });
  if(allies.length) addLog('🐾 ' + allies.length + ' compagnon(s) en soutien');

  tourActif = 0;
  numRound = 1;

  addLog('⚔ Round ' + numRound + ' — ' + ordreInitiative[0].nom + ' commence !');

  // Notifier chaque joueur de son combatId (banneau fiche_perso — multi-room safe)
  Object.keys(combattants).forEach(id => {
    db.collection('joueurs').doc(id).update({ combatId: currentCombatId }).catch(()=>{});
  });

  // Initialiser actionsDeclarees pour chaque joueur dans le doc principal
  const adInit = {};
  Object.keys(combattants).forEach(id => {
    adInit['actionsDeclarees.' + id] = { mineure:{used:[],pending:null}, majeure:{used:[],pending:null}, mouvement_used:false };
  });
  if(Object.keys(adInit).length) db.collection(COMBATS_COLL).doc(currentCombatId).update(adInit).catch(()=>{});

  renderCombat();
  renderTracker();
  syncCombatToFirebase();
}

function finDeTour(){
  if(!ordreInitiative.length) return;
  const current = ordreInitiative[tourActif];

  // Reset déclarations d'actions du combattant qui vient de jouer
  if(current.type === 'joueur' && db && currentCombatId){
    const upd = {};
    upd['actionsDeclarees.' + current.id] = { mineure:{used:[],pending:null}, majeure:{used:[],pending:null}, mouvement_used:false };
    db.collection(COMBATS_COLL).doc(currentCombatId).update(upd).catch(()=>{});
  }

  // Avancer le tour en sautant les combattants éliminés
  let steps = 0;
  do {
    tourActif = (tourActif + 1) % ordreInitiative.length;
    steps++;
    // Nouveau round si on revient au début
    if(tourActif === 0){
      numRound++;
      addLog('⚔ ─── Round ' + numRound + ' ───');
      ordreInitiative.forEach(c => {
        const isJ = c.type === 'joueur';
        const d = isJ ? combattants[c.id]?.data : {};
        initActionsState(c.id, isJ, d || {});
      });
    }
    if(estElimine(ordreInitiative[tourActif])){
      addLog('💀 ' + ordreInitiative[tourActif].nom + ' — tour sauté');
    }
  } while(estElimine(ordreInitiative[tourActif]) && steps < ordreInitiative.length);

  const next = ordreInitiative[tourActif];
  if(estElimine(next)){
    addLog('⚠ Tous les combattants sont éliminés');
    renderCombat(); renderTracker(); syncCombatToFirebase();
    return;
  }

  addLog('➤ Tour de ' + next.nom);
  if(next.type === 'joueur'){
    joueurActif = next.id;
    armeActive = null;
    updateDicePanel();
    // Le bonus de Défense (action Defend) expire au début du tour du joueur
    if(defenseBonus[next.id]){
      delete defenseBonus[next.id];
      if(db && currentCombatId) db.collection(COMBATS_COLL).doc(currentCombatId).update({ ['defenseBonus.'+next.id]: 0 }).catch(()=>{});
    }
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

async function depenseLuck(id){
  const c = combattants[id]; if(!c) return;
  const d = c.data;
  const luckPts = d.luck_points||0;
  if(luckPts <= 0){ addLog('⚠ Plus de points de Luck !'); return; }
  const newPts = luckPts-1;
  await db.collection('joueurs').doc(id).update({luck_points:newPts, lastUpdate:Date.now()});
  combattants[id].data.luck_points = newPts;
  executeLuckyTiming(id, d.nom||id);
}

function executeLuckyTiming(id, nom){
  const c = combattants[id];
  const idx = ordreInitiative.findIndex(x=>x.id===id);
  if(idx !== -1) ordreInitiative.splice(idx, 1);
  ordreInitiative.splice(tourActif+1, 0, {id, nom:nom.toUpperCase(), type:'joueur', init:c?.initiative||0, luck:true});
  addLog('🍀 '+nom+' : Lucky Timing ! (−1 Luck)');
  renderTracker();
  syncCombatToFirebase();
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

function estElimine(c){
  if(c.type === 'ennemi'){
    const e = ennemis.find(x => x.id === c.eid);
    return !!e && (e.pvCur||0) <= 0;
  }
  if(c.type === 'allie'){
    const a = allies.find(x => x.id === c.aid);
    return !!a && (a.pvCur||0) <= 0;
  }
  return (combattants[c.id]?.data?.hp ?? 1) <= 0;
}

// Construit les instances de compagnons depuis les fiches des joueurs en combat
function buildAlliesFromCompanions(){
  allies = [];
  Object.keys(combattants).forEach(id => {
    const d = combattants[id]?.data; if(!d) return;
    const ownerNom = (d.nom||id);
    (d.companions||[]).forEach((c, idx) => {
      const atk = (c.attacks && c.attacks[0]) || {};
      allies.push({
        id: c.id || (id+'_c'+idx), nom: (c.nom||'Compagnon'),
        owner: id, ownerNom,
        pvMax: c.hpMax||c.hpCur||6, pvCur: c.hpCur??c.hpMax??6,
        atq: String(atk.dmg||2), rd: (c.dr?.phys)||0, defense: c.defense||1,
        body: c.attrs?.body||5, mind: c.attrs?.mind||4,
        attacks: c.attacks||[], abilities: c.abilities||[],
      });
    });
  });
}

function dmgAllie(id, val){
  const a = allies.find(x => x.id === id); if(!a) return;
  a.pvCur = Math.max(0, a.pvCur - val);
  addLog('⚔ ' + a.nom + ' subit ' + val + ' (' + a.pvCur + '/' + a.pvMax + ' PV)');
  if(a.pvCur <= 0) addLog('💀 ' + a.nom + ' est à terre !');
  renderCombat(); renderTracker(); syncCombatToFirebase();
}
function soignAllie(id, val){
  const a = allies.find(x => x.id === id); if(!a) return;
  a.pvCur = Math.min(a.pvMax, a.pvCur + val);
  renderCombat(); syncCombatToFirebase();
}
// Ouvre le panneau d'attaque d'un compagnon (comme les ennemis) : cible parmi les ennemis + jet
function attaqueAllie(id){
  const a = allies.find(x => x.id === id); if(!a) return;
  const panel = document.getElementById('dice-context'); if(!panel) return;
  const nbDC = parseInt(a.atq) || 2;
  const atk = (a.attacks && a.attacks[0]) || {};
  const tn = atk.tn || a.tn || 10;
  panel._nbDC = nbDC;
  panel._modeEnnemi = true;            // attaque PNJ : log via _ennemNom, pas de dés bonus AP
  panel._ennemNom = '🐾 ' + a.nom;
  panel._atkMode = 'ally';             // dégâts auto sur l'ennemi ciblé après le CD
  panel._allyId = a.id;                // pour consommer un éventuel dé d'assistance
  panel._lastHit = true;
  const vivants = ennemis.filter(e => (e.pvCur||0) > 0);
  let html = '<div class="ctx-nom" style="color:var(--g)">🐾 ' + a.nom.toUpperCase() + ' attaque</div>';
  html += '<div class="ctx-arme">' + (atk.name||'Attaque') + ' · ATQ <b>' + a.atq + ' DC</b>'
        + (atk.eff && atk.eff!=='—' && atk.eff!=='–' ? ' · <span style="color:var(--am)">' + atk.eff + '</span>' : '') + '</div>';
  html += '<div class="ctx-diff" style="margin-top:4px">Cible :';
  html += '<select id="cible-sel" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none;margin-left:6px">';
  if(!vivants.length){
    html += '<option value="">Aucun ennemi vivant</option>';
  } else {
    html += '<option value="">— Choisir —</option>';
    vivants.forEach(e => { html += '<option value="' + e.id + '">' + e.nom.toUpperCase() + ' (RD ' + e.rd + ' · ' + e.pvCur + '/' + e.pvMax + ' PV)</option>'; });
  }
  html += '</select></div>';
  html += '<div class="ctx-diff">Difficulté : <select id="diff-sel" onchange="majDC()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none"><option value="0">D0</option><option value="1" selected>D1</option><option value="2">D2</option><option value="3">D3</option></select></div>';
  html += '<div id="dc-suggest" class="ctx-dc">DC : <b style="color:var(--g)" id="dc-nb">' + nbDC + '</b> (' + a.atq + ' DC)</div>';
  const tnEl = document.getElementById('tn-val'); if(tnEl) tnEl.value = tn;
  panel.innerHTML = html;
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
    const elimine = estElimine(c);
    const s = actionsState[c.id] || {mineure:1,majeure:1,pa:0};
    const key = c.id;

    // Compagnon : agit avec son PC (RAW) — ligne compacte, pas d'actions propres
    if(c.type === 'allie'){
      html += '<div class="tracker-item allie' + (isActif?' actif':'') + '"' + (elimine?' style="opacity:0.35"':'') + '>'
        + '<div class="tracker-top">'
        + '<span class="tracker-nom"' + (elimine?' style="text-decoration:line-through"':'') + '>' + (elimine?'💀 ':(isActif?'▶ ':'')) + '🐾 ' + c.nom + '</span>'
        + '<span class="tracker-init" style="font-size:7px;color:var(--td)" title="agit avec ' + (c.ownerNom||'') + '">avec PC</span>'
        + '</div></div>';
      return;
    }

    // Combattant éliminé : entrée grisée, aucun contrôle
    if(elimine){
      html += '<div class="tracker-item' + (c.type==='ennemi'?' ennemi':'') + '" style="opacity:0.35">'
        + '<div class="tracker-top">'
        + '<span class="tracker-nom" style="text-decoration:line-through">💀 ' + c.nom + '</span>'
        + '<span class="tracker-init">' + c.init + '</span>'
        + '</div></div>';
      return;
    }

    // Entrée simple : nom + initiative (plus de contrôles par combattant)
    html += '<div class="tracker-item' + (isActif?' actif':'') + (c.type==='ennemi'?' ennemi':'') + '">'
      + '<div class="tracker-top">'
      + '<span class="tracker-nom">' + (isActif?'▶ ':'') + c.nom + '</span>'
      + '<span class="tracker-init">' + c.init + '</span>'
      + '</div></div>';
  });

  // Boutons de flux de combat (en bout de bandeau)
  html += '<div class="trk-flow">'
    + '<button class="fin-tour-btn" onclick="finDeTour()">➤ Fin de tour</button>'
    + '<button class="fin-tour-btn" style="background:#1a1a0a;border-color:var(--am);color:var(--am)" onclick="genButinCombat()">🎒 Butin</button>'
    + '<button class="fin-tour-btn" style="background:var(--rdk);border-color:var(--rd);color:var(--rd)" onclick="finCombat()">✕ Fin</button>'
    + '</div>';
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
  if(!ENNEMIS_DB[nom]) return;
  for(let i=0;i<nb;i++){
    const inst = enemyInstanceFromDB(nom, lvl); if(!inst) continue;
    inst.id = Date.now()+i;
    inst.nom = nb>1 ? nom+' '+(i+1) : nom;
    ennemis.push(inst);
    addLog('➕ '+inst.nom+' (PV:'+inst.pvMax+' RD:'+inst.rd+')');
  }
  fermerModalEnnemi();
  renderCombat();
}

// Localisation aléatoire (torse plus fréquent) — RAW simplifié
function rollLocation(){
  const locs = [
    {label:'Tête', z:'Head'},
    {label:'Torse', z:'Torso'}, {label:'Torse', z:'Torso'}, {label:'Torse', z:'Torso'},
    {label:'Bras gauche', z:'Arm'}, {label:'Bras droit', z:'Arm'},
    {label:'Jambe gauche', z:'Leg'}, {label:'Jambe droite', z:'Leg'},
  ];
  return locs[Math.floor(Math.random()*locs.length)];
}
// RD apportée par les perks (réplique de fiche_perso rdP)
function playerPerkRD(d, type){
  const p = d.perks || {}, s = d.special || {};
  const hpMx = (typeof getHpMax==='function') ? getHpMax(d) : ((s.L||5)+(s.E||5)+Math.max(0,(d.niveau||1)-1));
  const nerd = (p['Nerd Rage!']||0) > 0 && (d.hp||0) < hpMx*0.4;
  if(type==='phys'){ let r=(p['Toughness']||0); if((p['Barbarian']||0)>0 && !d.powerArmor){ const S=s.S||5; r += S>=11?3:S>=9?2:S>=7?1:0; } if(nerd) r+=(p['Nerd Rage!']||0); return r; }
  if(type==='en'){ let r=(p['Refractor']||0); if(nerd) r+=(p['Nerd Rage!']||0); return r; }
  if(type==='rad')  return p['Rad Resistance']||0;
  if(type==='poison') return (p['Snake Eater']||0)*2;
  return 0;
}
// RD localisée d'un joueur : armure (la plus élevée par type sur la zone) + perks
function playerLocRD(d, loc){
  let ph=0, en=0, rad=0;
  const isHead = loc.z === 'Head';
  (d.inventory||[]).forEach(it => {
    if(!it.equipped) return;
    const a = (window.DB?.armor||[]).find(x => x.n === it.name); if(!a) return;
    const covers = a.z===loc.z || (a.z==='Body' && !isHead) || a.z==='All' || (a.t==='POWERARMOR' && d.powerArmor);
    if(covers){ ph=Math.max(ph,a.ph||0); en=Math.max(en,a.en||0); rad=(a.rad===999||rad===999)?999:Math.max(rad,a.rad||0); }
  });
  ph += playerPerkRD(d,'phys'); en += playerPerkRD(d,'en'); if(rad!==999) rad += playerPerkRD(d,'rad');
  return { phys:ph, en, rad };
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
  renderAllies();
  renderEnnemis();
  renderTracker();
  renderCombatMap();
}

// ============================================================
// MINI-CARTE DE COMBAT (grille de cases) — MJ
// combatMap = { w, h, obstacles:[{x,y}], pos:{ [tokenId]:{x,y} } }
// tokenId : joueurId | 'E'+enemyId | 'A'+allyId
// ============================================================
let combatMap = null, _mapSel = null, _blockSel = null, _edgeSel = null;
function _mapTokens(){
  // Liste des combattants à placer : {id, nom, kind:'joueur'|'ennemi'|'allie', color, dead}
  const list = [];
  Object.keys(combattants).forEach(id => list.push({ id, nom: (joueurs[id]?.nom||id), kind:'joueur' }));
  (allies||[]).forEach(a => list.push({ id:'A'+a.id, nom:a.nom, kind:'allie' }));
  (ennemis||[]).forEach(e => list.push({ id:'E'+e.id, nom:e.nom, kind:'ennemi', dead:(e.pvCur||0)<=0, hidden:e.hidden }));
  return list;
}
function genCombatMap(){
  const w = 14, h = 8;
  const map = { w, h, terrain: {}, pos: {} };
  const toks = _mapTokens();
  const amis = toks.filter(t => t.kind!=='ennemi');
  const foes = toks.filter(t => t.kind==='ennemi');
  let y = 1;
  amis.forEach(t => { map.pos[t.id] = { x: 1, y: Math.min(h-1, y) }; y += 1; });
  foes.forEach((t,i) => { map.pos[t.id] = { x: w-2-(i%2), y: 1 + (i % (h-1)) }; });
  // décor aléatoire au centre : murs / débris / couverture
  const deco = ['wall','rubble','cover','wall','cover'];
  const n = 5 + Math.floor(Math.random()*5);
  for(let k=0;k<n;k++){
    const ox = 3 + Math.floor(Math.random()*(w-6));
    const oy = Math.floor(Math.random()*h);
    if(!Object.values(map.pos).some(p=>p.x===ox&&p.y===oy)) map.terrain[ox+','+oy] = deco[Math.floor(Math.random()*deco.length)];
  }
  combatMap = map;
  recomputeBandsFromMap();
  renderCombat();
  syncCombatToFirebase();
  addLog('🗺 Carte de combat générée');
}
function clearCombatMap(){ combatMap = null; _mapSel = null; _blockSel = null; _edgeSel = null; renderCombat(); syncCombatToFirebase(); }
function setBlockBrush(id){ _blockSel = (_blockSel===id ? null : id); _mapSel = null; _edgeSel = null; renderCombatMap(); }
function setEdgeBrush(id){ _edgeSel = (_edgeSel===id ? null : id); _mapSel = null; _blockSel = null; renderCombatMap(); }
function edgeClick(o, x, y){
  if(!combatMap || !_edgeSel) return;
  combatMap.edges = combatMap.edges || {};
  const key = o + ',' + x + ',' + y;
  if(_edgeSel === 'erase' || combatMap.edges[key] === _edgeSel) delete combatMap.edges[key];
  else combatMap.edges[key] = _edgeSel;
  renderCombatMap(); syncCombatToFirebase();
}
// Ouvrir / fermer une porte (MJ) — pivote de 90°, persiste
function openDoorMJ(key){
  if(!combatMap || !combatMap.edges) return;
  const cur = combatMap.edges[key];
  if(cur !== 'door' && cur !== 'doorOpen') return;
  combatMap.edges[key] = cur === 'door' ? 'doorOpen' : 'door';
  recomputeBandsFromMap();
  renderCombatMap(); syncCombatToFirebase();
}
// Zones cliquables sur les arêtes (uniquement quand un pinceau d'arête est actif)
function edgeHotspots(grid, cs){
  const pad = 5, gap = 1, pitch = cs + gap; let h = '';
  for(let y=0;y<grid.h;y++) for(let x=0;x<=grid.w;x++)
    h += '<div class="cedge-hot" style="left:'+(pad+x*pitch-gap-3)+'px;top:'+(pad+y*pitch+2)+'px;height:'+(cs-4)+'px;width:8px" onclick="edgeClick(\'V\','+x+','+y+')"></div>';
  for(let x=0;x<grid.w;x++) for(let y=0;y<=grid.h;y++)
    h += '<div class="cedge-hot" style="top:'+(pad+y*pitch-gap-3)+'px;left:'+(pad+x*pitch+2)+'px;width:'+(cs-4)+'px;height:8px" onclick="edgeClick(\'H\','+x+','+y+')"></div>';
  return h;
}
// Recalcule la bande de distance de chaque ennemi = distance (cases) au joueur/allié le plus proche
function recomputeBandsFromMap(){
  if(!combatMap || !combatMap.pos) return;
  const allyPos = [];
  Object.keys(combatMap.pos).forEach(id => { if(id[0] !== 'E') allyPos.push(combatMap.pos[id]); });
  ennemis.forEach(e => {
    const p = combatMap.pos['E'+e.id]; if(!p || !allyPos.length) return;
    const d = Math.min(...allyPos.map(a => gridChebyshev(p, a)));
    e.dist = gridBand(d);
  });
}
function mapPickToken(id){ _mapSel = (_mapSel===id ? null : id); _blockSel = null; renderCombatMap(); }
function mapCellClick(x, y){
  if(!combatMap) return;
  combatMap.terrain = combatMap.terrain || {};
  const key = x+','+y;
  if(_blockSel){   // pinceau de terrain actif : peindre / effacer
    if(Object.values(combatMap.pos).some(p=>p.x===x&&p.y===y)) return;   // pas sur un jeton
    if(_blockSel === 'erase' || combatMap.terrain[key] === _blockSel) delete combatMap.terrain[key];
    else combatMap.terrain[key] = _blockSel;
    recomputeBandsFromMap(); renderCombatMap(); syncCombatToFirebase(); return;
  }
  if(_mapSel){
    if(gridOccupied(combatMap, x, y)) return;   // case prise / bloc solide / hors grille
    combatMap.pos[_mapSel] = { x, y };
    _mapSel = null;
    recomputeBandsFromMap();
    renderCombat();
    syncCombatToFirebase();
  }
}
// Place automatiquement les jetons manquants (ex. compagnon ajouté après génération) et nettoie les disparus
function _freeMapCell(grid, rightSide){
  const cols = rightSide ? [grid.w-2, grid.w-3, grid.w-1] : [1, 2, 0];
  for(const x of cols) for(let y=0;y<grid.h;y++) if(!gridOccupied(grid, x, y)) return { x, y };
  for(let x=0;x<grid.w;x++) for(let y=0;y<grid.h;y++) if(!gridOccupied(grid, x, y)) return { x, y };
  return null;
}
function ensureMapPositions(){
  if(!combatMap) return;
  combatMap.pos = combatMap.pos || {};
  let changed = false;
  const toks = _mapTokens();
  toks.forEach(t => {
    if(!combatMap.pos[t.id]){ const p = _freeMapCell(combatMap, t.kind==='ennemi'); if(p){ combatMap.pos[t.id] = p; changed = true; } }
  });
  const ids = new Set(toks.map(t => t.id));
  Object.keys(combatMap.pos).forEach(id => { if(!ids.has(id)){ delete combatMap.pos[id]; changed = true; } });
  if(changed){ recomputeBandsFromMap(); syncCombatToFirebase(); }
}
function renderCombatMap(){
  const el = document.getElementById('combat-map'); if(!el) return;
  if(!combatMap){ el.innerHTML = '<span class="empty" style="font-size:8px;color:var(--td)">Pas de carte — clique « Générer ».</span>'; return; }
  ensureMapPositions();
  const { w, h } = combatMap;
  const toks = _mapTokens();
  const byPos = {}; Object.keys(combatMap.pos).forEach(id => { const p=combatMap.pos[id]; byPos[p.x+','+p.y]=id; });
  // Palette de blocs (MJ)
  let pal = '<div class="cmap-palette">'
    + '<button class="cmap-brush'+(!_blockSel&&!_mapSel?' on':'')+'" onclick="setBlockBrush(null)" title="Déplacer les jetons">✋</button>';
  BLOCK_TYPES.forEach(b => pal += '<button class="cmap-brush b-'+b.id+(_blockSel===b.id?' on':'')+'" onclick="setBlockBrush(\''+b.id+'\')" title="'+b.label+'">'+b.icon+'</button>');
  pal += '<button class="cmap-brush'+(_blockSel==='erase'?' on':'')+'" onclick="setBlockBrush(\'erase\')" title="Effacer le terrain">⌫</button>';
  pal += '</div>';
  // Palette 2 : lignes d'arête (murs/portes/fenêtres)
  pal += '<div class="cmap-palette">';
  EDGE_TYPES.forEach(b => pal += '<button class="cmap-brush ce-'+b.id+(_edgeSel===b.id?' on':'')+'" onclick="setEdgeBrush(\''+b.id+'\')" title="Ligne : '+b.label+'">'+b.icon+'</button>');
  pal += '<button class="cmap-brush'+(_edgeSel==='erase'?' on':'')+'" onclick="setEdgeBrush(\'erase\')" title="Effacer une ligne">⌫</button>';
  pal += '</div>';
  const cs = 32;   // taille de case MJ (= --cs)
  let html = pal + `<div class="cmap" style="grid-template-columns:repeat(${w},var(--cs,22px))">`;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const key = x+','+y;
    const tid = byPos[key];
    const t = tid ? toks.find(z=>z.id===tid) : null;
    const terr = gridTerrainAt(combatMap, x, y);
    let cls = 'cmap-cell';
    if(terr) cls += ' b-' + terr;
    if(t && tid===_mapSel) cls += ' sel';
    const bt = BLOCK_TYPES.find(b=>b.id===terr);
    let inner;
    if(t){
      if(t.kind==='ennemi') inner = '<span class="cen'+(t.dead?' dead':'')+(t.hidden?' hidden':'')+'">'+(t.hidden?'🙈':'☠')+'</span>';
      else inner = '<span class="ctok '+(t.kind==='joueur'?'ctok-j':'ctok-a')+(t.dead?' dead':'')+'">'+((t.nom||'?').charAt(0).toUpperCase())+'</span>';
    } else inner = (bt?bt.icon:'');
    const eAttr = (t && t.kind==='ennemi') ? ` data-eid="${t.id.slice(1)}"` : '';
    const onclick = t ? `mapPickToken('${tid}')` : `mapCellClick(${x},${y})`;
    html += `<div class="${cls}" onclick="${onclick}"${eAttr} title="${t?(t.nom+(t.hidden?' (masqué)':'')):(bt?bt.label:'')}">${inner}</div>`;
  }
  // Overlay des lignes d'arête (+ zones cliquables si pinceau d'arête actif ; sinon, portes ouvrables)
  const doorHot = (!_edgeSel && !_blockSel && !_mapSel) ? gridAllDoorHotspots(combatMap, cs, 'openDoorMJ') : '';
  html += '<div class="cmap-edges">' + gridEdgesHtml(combatMap, cs) + (_edgeSel ? edgeHotspots(combatMap, cs) : doorHot) + '</div>';
  html += '</div>';
  if(_mapSel) html += '<div class="cmap-tip">Jeton sélectionné — clique une case libre pour le déplacer.</div>';
  else if(_blockSel) html += '<div class="cmap-tip">Pinceau « '+(_blockSel==='erase'?'Effacer':(BLOCK_TYPES.find(b=>b.id===_blockSel)?.label||''))+' » — clique les cases.</div>';
  else if(_edgeSel) html += '<div class="cmap-tip">Ligne « '+(_edgeSel==='erase'?'Effacer':(EDGE_TYPES.find(b=>b.id===_edgeSel)?.label||''))+' » — clique les bords entre cases.</div>';
  el.innerHTML = html;
}

// Compagnons en combat — cartes vertes appendues sous les joueurs
function renderAllies(){
  const el = document.getElementById('allies-combat'); if(!el) return;
  el.innerHTML = '';
  allies.forEach(a => {
    const pct = a.pvMax ? Math.round(a.pvCur/a.pvMax*100) : 0;
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    const isTourActif = ordreInitiative.length && ordreInitiative[tourActif]?.aid===a.id;
    el.innerHTML += `<div class="jc-card allie${a.pvCur<=0?' dead':''}${isTourActif?' tour-actif':''}">
      <div class="jc-top">
        <span class="jc-name">🐾 ${isTourActif?'▶ ':''}${a.nom}</span>
        <span class="jc-init" title="Agit avec ${a.ownerNom}" style="font-size:8px;color:var(--td)">↳ ${a.ownerNom}</span>
      </div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${bc}"></div></div>
      <div class="jc-row">
        <div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv${pct<30?' danger':''}">${a.pvCur}/${a.pvMax}</span></div>
        <div class="jc-stat"><span class="jc-sl">ATQ</span><span class="jc-sv">${a.atq} DC</span></div>
        <div class="jc-stat"><span class="jc-sl">RD</span><span class="jc-sv">${a.rd}</span></div>
        <div class="jc-stat"><span class="jc-sl">DÉF</span><span class="jc-sv">${a.defense}</span></div>
      </div>
      <div class="ennemi-dmg">
        <input type="number" class="dmg-inp" id="admg-${a.id}" value="1" min="0">
        <button class="dmg-btn" onclick="dmgAllie('${a.id}',parseInt(document.getElementById('admg-${a.id}').value)||1)">Dégâts</button>
        <button class="dmg-btn" style="border-color:var(--gd);color:var(--g)" onclick="soignAllie('${a.id}',parseInt(document.getElementById('admg-${a.id}').value)||1)">Soins</button>
        <button class="atq-btn" onclick="attaqueAllie('${a.id}')">⚔</button>
      </div>
    </div>`;
  });
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
        <span class="jc-name">${isTourActif?'▶ ':''}${(d.nom||id).toUpperCase()}${defenseBonus[id]>0?` <span style="color:var(--g);font-size:9px" title="Bonus de Défense (Defend)">🛡+${defenseBonus[id]}</span>`:''}</span>
        <span class="jc-init">${initiative!==null?initiative:'—'}</span>
      </div>
      <div class="jc-bar"><div style="width:${pct}%;height:100%;background:${barColor}"></div></div>
      <div class="jc-row">
        <div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv${pct<30?' danger':pct<60?' warn':''}">${d.hp||0}/${hpMax}</span></div>
        <div class="jc-stat"><span class="jc-sl">RAD</span><span class="jc-sv${rad>0?' warn':''}">${rad}</span></div>
        <div class="jc-stat"><span class="jc-sl">LVL</span><span class="jc-sv">${d.niveau||1}</span></div>
        <div class="jc-stat"><span class="jc-sl">LUCK</span><span class="jc-sv" style="color:var(--am)">${d.luck_points||0}/${d.special?.L||5}</span></div>
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
      <div class="ennemi-dmg" style="margin-top:5px" onclick="event.stopPropagation()">
        <input type="number" class="dmg-inp" id="jdmg-${id}" value="1" min="0" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
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
          <button class="e-del" style="border-color:${e.hidden?'var(--am)':'var(--b2)'};color:${e.hidden?'var(--am)':'var(--td)'}" onclick="toggleEnemyHidden(${e.id})" title="${e.hidden?'Masqué aux joueurs — cliquer pour révéler':'Visible — cliquer pour masquer'}">${e.hidden?'🙈':'👁'}</button>
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
      <div class="ennemi-dist" style="display:flex;align-items:center;gap:5px;justify-content:center;margin:4px 0;font-size:9px">
        <span class="jc-sl">📏 Distance</span>
        <button class="dmg-btn" style="padding:1px 7px" onclick="chEnemyDist(${e.id},-1)" title="Rapprocher">−</button>
        <b style="color:var(--am);min-width:4.5rem;text-align:center">${RANGE_LABELS[e.dist??1]||'Moyenne'}</b>
        <button class="dmg-btn" style="padding:1px 7px" onclick="chEnemyDist(${e.id},1)" title="Éloigner">+</button>
      </div>
      <div class="ennemi-dmg">
        <input type="number" class="dmg-inp" id="dmg-${e.id}" value="1" min="0">
        <button class="dmg-btn" onclick="dmgEnnemi(${e.id},parseInt(document.getElementById('dmg-${e.id}').value)||1)">Dégâts</button>
        <button class="atq-btn" onclick="setAttaqueEnnemi(${e.id})">⚔ Attaquer</button>
      </div>
    </div>`;
  });
}
function toggleEnemyHidden(id){
  const e = ennemis.find(x => x.id === id); if(!e) return;
  e.hidden = !e.hidden;
  addLog(e.hidden ? '🙈 '+e.nom+' masqué aux joueurs' : '👁 '+e.nom+' révélé');
  renderCombat();
  syncCombatToFirebase();
}
function chEnemyDist(id, delta){
  const e = ennemis.find(x => x.id === id); if(!e) return;
  e.dist = Math.max(0, Math.min(3, (e.dist ?? 1) + delta));
  renderEnnemis();
  if(typeof syncCombatToFirebase === 'function') syncCombatToFirebase();
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
  panel._atkMode = 'enemy';                       // ennemi → joueur : dégâts auto (RD localisée, zone aléatoire)
  panel._dmgType = e.dmgType || 'physical';
  panel._lastHit = true;
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
  // Compagnons (alliés) ciblables
  (allies||[]).filter(a => (a.pvCur||0) > 0).forEach(a => {
    html += '<option value="A' + a.id + '">🐾 ' + (a.nom||'').toUpperCase() + ' (PV ' + a.pvCur + '/' + a.pvMax + ')</option>';
  });
  html += '</select></div>';
  html += '<div class="ctx-diff">Difficulté : <select id="diff-sel" onchange="majDC()" style="background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:9px;padding:2px 4px;outline:none"><option value="0">D0</option><option value="1" selected>D1</option><option value="2">D2</option><option value="3">D3</option></select><span id="cible-def-note" style="color:var(--g);font-size:8px;margin-left:6px"></span></div>';
  html += '<div id="dc-suggest" class="ctx-dc">DC : <b style="color:var(--rd)" id="dc-nb">' + nbDC + '</b> (' + e.atq + ')</div>';
  document.getElementById('tn-val').value = 10;
  panel.innerHTML = html;
}

function majTNCible(){
  const sel = document.getElementById('cible-sel'); if(!sel) return;
  const id = sel.value;
  const note = document.getElementById('cible-def-note');
  if(!id){ if(note) note.textContent=''; return; }
  if(id[0]==='A'){   // cible = compagnon (allié)
    const a = (allies||[]).find(x => String(x.id) === String(id.slice(1)));
    document.getElementById('tn-val').value = 8;   // TN par défaut (créature : pas d'AGI)
    const diffSel = document.getElementById('diff-sel'); if(diffSel) diffSel.value = '1';
    if(note) note.textContent = a ? ('🐾 ' + a.nom) : '';
    if(typeof majDC === 'function') majDC();
    return;
  }
  const d = combattants[id]?.data; if(!d) return;
  document.getElementById('tn-val').value = d.special?.A||5;
  // La Défense de la cible (bonus Defend) augmente la difficulté de l'attaque
  const defB = defenseBonus[id]||0;
  const diffSel = document.getElementById('diff-sel');
  if(diffSel) diffSel.value = String(Math.min(3, 1 + defB));
  if(note) note.textContent = defB>0 ? '🛡 Défense +'+defB : '';
  if(typeof majDC === 'function') majDC();
}

function setArme(id, arme){
  joueurActif=id;
  armeActive=arme==='__unarmed__'?null:arme;
  lastSkKeyMJ = arme==='__unarmed__' ? 'barehand' : (WEAPONS_DB[arme]?.sk||'');
  renderJoueursCombat(); updateDicePanel();
}

// ---- GESTION AP POOL ----
function renderAPPool(){
  const el=document.getElementById('ap-pool-val'); if(el) el.textContent=apPool;
  const mj=document.getElementById('mj-ap-val'); if(mj) mj.textContent=mjApPool;
  const dots=document.getElementById('ap-pool-dots');
  if(dots){ dots.innerHTML=''; for(let i=0;i<6;i++) dots.innerHTML+=`<span class="ap-dot${i<apPool?' on':''}"></span>`; }
}

async function _writeAP(){
  if(!db) return;
  try { await db.collection(COMBATS_COLL).doc(currentCombatId).update({apPool, mjApPool}); }
  catch(e){ console.error(e); }
}

function chAPPool(delta){
  apPool = Math.max(0, Math.min(6, apPool+delta));
  renderAPPool(); _writeAP();
}
function chMJAP(delta){
  mjApPool = Math.max(0, mjApPool+delta);
  renderAPPool(); _writeAP();
}
function initMJPool(){
  const nbJ = Object.keys(combattants).length;
  mjApPool = Math.max(1, nbJ);
  renderAPPool(); _writeAP();
  addLog('🎯 Pool AP MJ initialisé à '+mjApPool);
}
function mjBonusAction(type){
  const cout = type==='min'?1:2;
  if(mjApPool<cout){ addLog('⚠ AP MJ insuffisants'); return; }
  mjApPool-=cout; renderAPPool(); _writeAP();
  addLog('⚡ MJ +action '+(type==='min'?'mineure (-1AP MJ)':'majeure (-2AP MJ)'));
}
function clearInfoRequest(){
  const b=document.getElementById('ap-info-banner'); if(b) b.style.display='none';
  if(db) db.collection(COMBATS_COLL).doc(currentCombatId).update({infoRequest:null}).catch(()=>{});
}

// ---- SÉLECTEUR D20 ----
function setNbDiceMJ(n){
  nbDiceMJ=n;
  [2,3,4,5].forEach(i=>{ const b=document.getElementById('d20-btn-'+i); if(b) b.classList.toggle('on',i===n); });
  const lb=document.getElementById('lance-btn'); if(lb) lb.textContent=n+'D20';
}

function convertExcessToAPMJ(){
  if(lastExcessMJ<=0) return;
  const toAdd=Math.min(lastExcessMJ,6-apPool);
  if(toAdd<=0){ addLog('⚠ Pool AP groupe plein !'); return; }
  chAPPool(toAdd);
  addLog('✦ '+toAdd+' succès excéd. → AP groupe (total: '+apPool+')');
  lastExcessMJ=0;
  const el=document.getElementById('convert-ap-mj'); if(el) el.style.display='none';
}

function bonusDmgMJ(n){
  const panel = document.getElementById('dice-context');
  const mjDriven = panel && (panel._atkMode === 'ally' || panel._atkMode === 'enemy');
  if(mjDriven){
    if(mjApPool<n){ addLog('⚠ AP MJ insuffisants'); return; }
    chMJAP(-n);
  } else {
    if(apPool<n){ addLog('⚠ AP groupe insuffisants'); return; }
    chAPPool(-n);
  }
  const vals=Array.from({length:n},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg=vals.reduce((a,v)=>a+(parseInt(v)||0),0);
  const ef=vals.filter(v=>v.includes('⚡')).length;
  const extra=vals.map(v=>'<span style="color:'+(v.includes('⚡')?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-size:14px;font-family:Oswald,sans-serif">'+v+'</span>').join(' ');
  const cd=document.getElementById('cd-result');
  if(cd) cd.innerHTML+=' <span style="color:var(--am)">+['+extra+'] ='+dmg+'dmg'+(ef?' +'+ef+'⚡':'')+'</span>';
  addLog('⚡ +'+n+'DC bonus (-'+n+' AP '+(mjDriven?'MJ':'groupe')+'): '+dmg+'dmg'+(ef?' +'+ef+'⚡':''));
  const el=document.getElementById('bonus-dmg-mj'); if(el) el.style.display='none';
}

function updateDicePanel(){
  const panel = document.getElementById('dice-context');
  if(panel) panel._atkMode = null;   // attaque joueur : pas d'auto-dégâts ici
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
  const modeEnnemi = panel._modeEnnemi;

  // Dépenser des AP pour les dés bonus — attaque MJ (compagnon/ennemi) → pool MJ ; attaque joueur → pool groupe
  const mjDriven = panel._atkMode === 'ally' || panel._atkMode === 'enemy';
  const apCost = [0,0,0,1,3,6][nbDiceMJ]||0;
  if(apCost>0){
    if(mjDriven){
      if(mjApPool<apCost){ addLog('⚠ AP MJ insuffisants (besoin '+apCost+')'); return; }
      chMJAP(-apCost);
    } else {
      if(apPool<apCost){ addLog('⚠ AP groupe insuffisants (besoin '+apCost+')'); return; }
      chAPPool(-apCost);
    }
  }

  // Dé bonus d'assistance pour un compagnon (action Assist) → +1 dé, consommé
  let assistBonus = 0;
  const _aid = panel._allyId != null ? String(panel._allyId) : null;
  if(panel._atkMode === 'ally' && _aid && _assistDie[_aid]){
    assistBonus = 1;
    delete _assistDie[_aid];
    if(db && currentCombatId) db.collection(COMBATS_COLL).doc(currentCombatId).update({ ['assistDie.'+_aid]: null }).catch(()=>{});
    addLog('🤝 Dé d\'assistance utilisé pour '+(panel._ennemNom||'le compagnon'));
  }
  const nbDiceRoll = nbDiceMJ + assistBonus;
  const dés = Array.from({length:nbDiceRoll},()=>Math.floor(Math.random()*20)+1);
  let succes = dés.filter(v=>v<=tn).length + dés.filter(v=>v===1).length;
  const crits = dés.filter(v=>v===1).length;
  const echec = succes<diff;
  const succesBonus = Math.max(0,succes-diff);
  const dcTotal = echec?0:basedc+succesBonus;
  if(!echec) document.getElementById('nb-cd').value = dcTotal;

  const col=succes===0?'var(--rd)':succes>diff?'var(--g)':'var(--am)';
  let r=dés.map(d=>'<span style="color:'+(d<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:18px">'+d+'</span>').join('<span style="color:var(--td)"> / </span>');
  r+='<span style="color:var(--td)"> → </span>';
  r+='<b style="color:'+col+';font-family:Oswald,sans-serif;font-size:16px">'+succes+' succès</b>';
  if(crits) r+=' <span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r+=' <span style="color:var(--rd)">— ÉCHEC</span>';
  else { r+=' → <b style="color:var(--am)">'+dcTotal+'DC</b>'; if(succesBonus>0) r+=' <span style="color:var(--td)">(+'+succesBonus+')</span>'; }
  document.getElementById('dice-result').innerHTML = r;
  panel._lastHit = !echec;   // mémorise le toucher pour l'application auto des dégâts (CD)

  const nomLog=modeEnnemi?(panel._ennemNom||'Ennemi'):(joueurActif?(combattants[joueurActif]?.data?.nom||joueurActif):'?');
  const armeLog=modeEnnemi?'':(armeActive?' ('+armeActive+')':'');
  addLog('🎲 '+nomLog+armeLog+' '+nbDiceRoll+'D20 TN'+tn+' D'+diff+': '+dés.join('/')+' = '+succes+'s → '+(echec?'ÉCHEC':dcTotal+'DC'));
  panel._modeEnnemi=false;

  // Réinitialiser sélecteur
  setNbDiceMJ(2);

  // Proposer conversion succès → AP groupe
  lastExcessMJ = succesBonus;
  const cvEl=document.getElementById('convert-ap-mj');
  if(cvEl){
    const toAdd=Math.min(succesBonus,6-apPool);
    if(!echec && toAdd>0){
      cvEl.style.display='block';
      cvEl.innerHTML='<button class="ap-convert-btn" onclick="convertExcessToAPMJ()">+'+toAdd+' AP groupe ('+succesBonus+' succès excéd.)</button>';
    } else { cvEl.style.display='none'; }
  }

  // Proposer dégâts bonus si attaque mêlée/jet réussie
  const bdEl=document.getElementById('bonus-dmg-mj');
  if(bdEl){
    const isMeleeThrow=['cac_weapon','barehand','throwing'].includes(lastSkKeyMJ);
    // Attaque compagnon → pool MJ ; attaque joueur → pool groupe (pas pour les ennemis)
    const allyAtk = panel._atkMode === 'ally';
    const poolAvail = allyAtk ? mjApPool : apPool;
    if(!echec && isMeleeThrow && poolAvail>0 && !modeEnnemi){
      const lbl = allyAtk ? 'AP MJ' : 'AP';
      let btns='<span style="font-size:7px;color:var(--td)">Dégâts bonus: </span>';
      for(let n=1;n<=Math.min(3,poolAvail);n++) btns+='<button class="ap-dmg-btn" onclick="bonusDmgMJ('+n+')">+'+n+'D (−'+n+' '+lbl+')</button>';
      bdEl.style.display='block'; bdEl.innerHTML=btns;
    } else { bdEl.style.display='none'; }
  }
}

function lancerCD(){
  const nb = parseInt(document.getElementById('nb-cd').value)||2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg = vals.reduce((a,v)=>a+(parseInt(v)||0),0);
  const ef = vals.filter(v=>v.includes('⚡')).length;
  document.getElementById('cd-result').innerHTML =
    vals.map(v=>'<span style="color:'+(v.includes('⚡')?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-family:Oswald,sans-serif;font-size:16px">'+v+'</span>').join(' ')
    +' <span style="color:var(--td)">→</span> <b style="color:var(--am)">'+dmg+'dmg</b>'+(ef?' <span style="color:var(--am)">+'+ef+'⚡</span>':'');
  const panel = document.getElementById('dice-context');
  // Attaque d'un ennemi → dégâts auto sur le joueur ciblé (zone aléatoire, − RD localisée)
  if(panel && panel._atkMode === 'enemy'){
    const sel = document.getElementById('cible-sel');
    const pid = sel ? sel.value : '';
    // Cible = compagnon (allié)
    if(pid && pid[0]==='A'){
      const a = (allies||[]).find(x => String(x.id) === String(pid.slice(1)));
      if(!a){ addLog('💥 '+(panel._ennemNom||'Ennemi')+' '+nb+'DC: '+dmg+'dmg — aucune cible sélectionnée'); return; }
      if(panel._lastHit === false){ addLog('🗡 '+(panel._ennemNom||'Ennemi')+' rate '+a.nom+' (pas de dégâts)'); panel._atkMode=null; return; }
      const dt = panel._dmgType || 'physical';
      const rdObj = a.dr || {};
      const rd = (dt==='energy') ? (rdObj.energy ?? a.rd ?? 0) : (dt==='radiation'||dt==='rad') ? (rdObj.rad ?? a.rd ?? 0) : (rdObj.phys ?? a.rd ?? 0);
      const net = rd===999 ? 0 : Math.max(0, dmg - rd);
      addLog('🗡 '+(panel._ennemNom||'Ennemi')+' touche 🐾 '+a.nom+' : '+net+' ('+dmg+'dmg − RD '+(rd===999?'∞':rd)+(ef?' · +'+ef+'⚡':'')+')');
      panel._atkMode = null;
      dmgAllie(a.id, net);
      return;
    }
    const c = pid ? combattants[pid] : null;
    if(!c){ addLog('💥 '+(panel._ennemNom||'Ennemi')+' '+nb+'DC: '+dmg+'dmg — aucune cible sélectionnée'); return; }
    if(panel._lastHit === false){ addLog('🗡 '+(panel._ennemNom||'Ennemi')+' rate '+(c.data.nom||pid)+' (pas de dégâts)'); panel._atkMode=null; return; }
    const loc = rollLocation();
    const rdObj = playerLocRD(c.data, loc);
    const dt = panel._dmgType || 'physical';
    const rd = (dt==='energy') ? rdObj.en : (dt==='radiation'||dt==='rad') ? rdObj.rad : rdObj.phys;
    const net = rd===999 ? 0 : Math.max(0, dmg - rd);
    addLog('🗡 '+(panel._ennemNom||'Ennemi')+' touche '+(c.data.nom||pid)+' ['+loc.label+'] : '+net+' ('+dmg+'dmg − RD '+(rd===999?'∞':rd)+(ef?' · +'+ef+'⚡':'')+')');
    panel._atkMode = null;
    dmgJoueur(pid, net);   // applique aux PV + sync Firebase
    return;
  }
  // Attaque d'un compagnon → dégâts auto sur l'ennemi ciblé (− RD)
  if(panel && panel._atkMode === 'ally'){
    const sel = document.getElementById('cible-sel');
    const eid = sel ? sel.value : '';
    const e = eid ? ennemis.find(x => x.id == eid) : null;
    if(!e){ addLog('🐾💥 '+(panel._ennemNom||'Compagnon')+' '+nb+'DC: '+dmg+'dmg — aucune cible sélectionnée'); return; }
    if(panel._lastHit === false){ addLog('🐾 '+(panel._ennemNom||'Compagnon')+' rate '+e.nom+' (pas de dégâts)'); panel._atkMode=null; return; }
    const rd = parseInt(e.rd)||0;
    const net = Math.max(0, dmg - rd);
    const avant = e.pvCur;
    e.pvCur = Math.max(0, e.pvCur - net);
    addLog('🐾💥 '+(panel._ennemNom||'Compagnon')+' inflige '+net+' à '+e.nom+' ('+dmg+'dmg − RD '+rd+(ef?' · +'+ef+'⚡':'')+') · '+avant+'→'+e.pvCur+' PV'+(e.pvCur<=0?' 💀 éliminé !':''));
    panel._atkMode = null;   // évite une 2e application sur re-clic
    renderCombat(); renderTracker(); syncCombatToFirebase();
    return;
  }
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

// ---- PARTAGE ----
function partagerCombat(){
  const base = window.location.href.replace(/combat\.html.*$/, 'combat_joueur.html');
  const ids = Object.keys(combattants);
  const mo = document.getElementById('mo-partage');
  if(!mo) return;
  let html = '<div class="mtitle">LIENS JOUEURS</div>';
  if(!ids.length){
    html += '<div style="font-size:8px;color:var(--td)">Aucun joueur en combat.<br>Les liens utilisent le format :<br><code>?id={joueur}&combat=' + currentCombatId + '</code></div>';
  } else {
    ids.forEach(id => {
      const d = combattants[id]?.data;
      const nom = d?.nom || id;
      const url = base + '?id=' + id + '&combat=' + currentCombatId;
      html += '<div style="margin-bottom:8px"><div style="font-size:8px;color:var(--g);margin-bottom:2px">' + nom.toUpperCase() + '</div>' +
        '<div style="font-size:7px;color:var(--td);word-break:break-all;background:#060d06;padding:4px;border:1px solid var(--b)">' + url + '</div>' +
        '<button class="btn sm" style="margin-top:3px" onclick="navigator.clipboard.writeText(\'' + url + '\').then(()=>this.textContent=\'✓ Copié!\').catch(()=>{})">Copier</button>' +
        '</div>';
    });
  }
  html += '<div style="margin-top:10px;text-align:right"><button class="btn" onclick="document.getElementById(\'mo-partage\').classList.remove(\'on\')">Fermer</button></div>';
  mo.querySelector('.mbox').innerHTML = html;
  mo.classList.add('on');
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

// XP d'un ennemi (repli bestiaire si le champ a été perdu)
function combatXpOf(e){
  if(e && e.xp != null) return e.xp;
  const base = (e?.nom||'').replace(/\s+\d+$/,'').replace(/\s*\(.*\)\s*$/,'').trim();
  return window.ENNEMIS_DB?.[base]?.xp || 0;
}
// Attribue l'XP totale des ennemis vaincus à CHAQUE joueur du combat (RAW : non divisée) + journal MJ
async function attribuerXPFinCombat(){
  const defaits = ennemis.filter(e => (e.pvCur||0) <= 0);
  const total = defaits.reduce((a,e) => a + combatXpOf(e), 0);
  const ids = Object.keys(combattants);
  if(total <= 0 || !ids.length) return;
  let tdata = {};
  try { const ts = await db.collection('temps').doc('data').get(); tdata = ts.exists ? ts.data() : {}; } catch(e){}
  const journalEntries = [];
  for(const id of ids){
    const d = combattants[id]?.data; if(!d) continue;
    let xp = (d.xp||0) + total, niv = d.niveau || 1;
    while(niv < 20 && xp >= XP_TABLE[niv]) niv++;
    try { await db.collection('joueurs').doc(id).update({ xp, niveau: niv, lastUpdate: Date.now() }); } catch(e){ console.error(e); }
    addLog('★ ' + (d.nom||id) + ' +' + total + ' XP (combat) → niveau ' + niv);
    const time = (typeof partyMinutesFor === 'function') ? partyMinutesFor(tdata, id) : 480;
    journalEntries.push({ id:'j'+Date.now().toString(36)+Math.floor(Math.random()*99999), time, type:'info',
      title:'Gain d\'XP (combat)', text:(d.nom||id)+' gagne '+total+' XP — '+defaits.length+' ennemi(s) vaincu(s)',
      revealedFor:[] });   // visible MJ uniquement
  }
  // Un seul write journal (évite les courses read-modify-write)
  if(journalEntries.length){
    try {
      const js = await db.collection('journal').doc('data').get();
      const entries = (js.exists && Array.isArray(js.data().entries)) ? js.data().entries : [];
      entries.push(...journalEntries);
      await db.collection('journal').doc('data').set({ entries });
    } catch(e){ console.warn('journal XP', e); }
  }
}
async function finCombat(){
  // Attribution automatique de l'XP (avec confirmation pour laisser le MJ ajuster avant de clore)
  const defaits = ennemis.filter(e => (e.pvCur||0) <= 0);
  const total = defaits.reduce((a,e) => a + combatXpOf(e), 0);
  const nbJ = Object.keys(combattants).length;
  if(total > 0 && nbJ > 0){
    if(!confirm('Terminer le combat et attribuer ' + total + ' XP à chacun des ' + nbJ + ' joueur(s) ?')) return;
    await attribuerXPFinCombat();
  } else if(!confirm('Terminer le combat ?')) return;
  ordreInitiative = [];
  actionsState = {};
  tourActif = 0;
  numRound = 0;
  // Effacer le combatId sur les fiches joueurs (retire le bandeau combat)
  // + purge auto des effets actifs de durée « combat » (chems Brefs)
  Object.keys(combattants).forEach(async id => {
    try {
      const snap = await db.collection('joueurs').doc(id).get();
      const upd = { combatId: null };
      if(snap.exists) upd.activeEffects = (snap.data().activeEffects||[]).filter(e => e.dur !== 'combat');
      db.collection('joueurs').doc(id).update(upd).catch(()=>{});
    } catch(e){ db.collection('joueurs').doc(id).update({ combatId: null }).catch(()=>{}); }
  });
  stopCombat();
  resetActionsDeclarees();
  addLog('🏁 Combat terminé.');
  renderTracker();
}

// ============================================================
// BUTIN DU COMBAT — génère le loot des ennemis vaincus (generateCombatLoot
// dans mj_shared.js) et le fusionne dans le pool partagé /butin/data.
// ============================================================
async function genButinCombat(){
  const defaits = ennemis.filter(e => (e.pvCur||0) <= 0);
  if(!defaits.length){ alert('Aucun ennemi vaincu : tue les ennemis avant de générer leur butin.'); return; }
  const { items, caps } = generateCombatLoot(defaits);
  if(!items.length && !caps){ alert('Les ennemis vaincus ne laissent rien cette fois.'); return; }
  const resume = items.map(it => `${it.qty}× ${it.name}`).join('\n') + (caps ? `\n${caps} caps` : '');
  if(!confirm(`Butin de ${defaits.length} ennemi(s) vaincu(s) :\n\n${resume}\n\nAjouter au pool de butin partagé ?`)) return;
  try{
    const ref = db.collection('butin').doc('data');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const pool = { items: Array.isArray(data.items) ? data.items : [], caps: data.caps || 0, players: Array.isArray(data.players) ? data.players : [] };
    items.forEach(it => {
      const ex = pool.items.find(x => x.name===it.name && x.cat===it.cat);
      if(ex) ex.qty += it.qty;
      else pool.items.push({ ...it, id: 'b'+Date.now().toString(36)+Math.floor(Math.random()*999) });
    });
    pool.caps = (pool.caps||0) + caps;
    await ref.set(pool);
    addLog(`🎒 Butin généré (${items.length} objet(s)${caps?' + '+caps+' caps':''}) → pool partagé.`);
    alert('Butin ajouté au pool. Révèle-le aux joueurs depuis le tableau de bord MJ (Butin).');
  }catch(e){ console.error('genButinCombat', e); alert('Erreur lors de l\'ajout du butin.'); }
}

// ============================================================
// ACTIONS JOUEURS — VALIDATION MJ
// ============================================================

function renderActionsMJ(){
  const el = document.getElementById('actions-joueurs-notif'); if(!el) return;
  const pending = [];
  Object.entries(actionsJoueurs).forEach(([jId, data]) => {
    ['mineure','majeure'].forEach(cat => {
      const p = data?.[cat]?.pending;
      if(p && p.status === 'waiting'){
        const nom = combattants[jId]?.data?.nom || jId;
        pending.push({jId, cat, p, nom});
      }
    });
  });
  if(!pending.length){ el.innerHTML = '<span class="empty">Aucune action en attente</span>'; return; }
  el.innerHTML = pending.map(({jId, cat, p, nom}) => {
    const key = jId + '_' + cat;
    return '<div style="padding:5px;border:1px solid var(--am);background:#1a1200;margin-bottom:4px">'
      + '<div style="font-size:8px;margin-bottom:3px">'
      + '<span style="color:var(--am)">' + nom.toUpperCase() + '</span>'
      + ' <span style="color:var(--td)">· ' + cat + ' ·</span>'
      + ' <span style="color:var(--tb)">' + p.type + '</span>'
      + '</div>'
      + (p.details ? '<div style="font-size:7px;color:var(--td);margin-bottom:4px;font-style:italic">&ldquo;' + p.details + '&rdquo;</div>' : '')
      + '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">'
      + '<button class="ap-btn-sm" style="border-color:var(--g);color:var(--g)" onclick="validerAction(\'' + jId + '\',\'' + cat + '\')">✓ Valider</button>'
      + '<input type="text" placeholder="Motif refus..." id="ri-' + key + '"'
      + ' style="flex:1;min-width:60px;background:#060d06;border:1px solid var(--b);color:var(--t);font-family:monospace;font-size:7px;padding:2px 4px;outline:none">'
      + '<button class="ap-btn-sm" style="border-color:var(--rd);color:var(--rd)" onclick="refuserAction(\'' + jId + '\',\'' + cat + '\')">✗ Refuser</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

async function validerAction(jId, cat){
  const data = actionsJoueurs[jId]; if(!data) return;
  const p = data?.[cat]?.pending; if(!p || p.status !== 'waiting') return;
  const nom = combattants[jId]?.data?.nom || jId;
  const isMovement = ['Move','Sprint'].includes(p.type);
  const upd = {};
  upd['actionsDeclarees.' + jId + '.' + cat + '.used'] = [...(data[cat].used || []), p.type];
  upd['actionsDeclarees.' + jId + '.' + cat + '.pending'] = null;
  // Décrément ATOMIQUE du compteur (−1 sur la valeur serveur) — n'écrase pas une action bonus achetée par le joueur
  upd['actionsState.' + jId + '.' + cat] = firebase.firestore.FieldValue.increment(-1);
  if(isMovement) upd['actionsDeclarees.' + jId + '.mouvement_used'] = true;
  try {
    await db.collection(COMBATS_COLL).doc(currentCombatId).update(upd);
    if(actionsState[jId]) actionsState[jId][cat] = Math.max(0, (actionsState[jId][cat]||1) - 1);   // miroir local pour le tracker
    renderTracker();
    addLog('✓ ' + nom + ' : ' + p.type + ' (' + cat + ') validée');
  } catch(e){ console.error(e); }
}

async function refuserAction(jId, cat){
  const data = actionsJoueurs[jId]; if(!data) return;
  const p = data?.[cat]?.pending; if(!p || p.status !== 'waiting') return;
  const nom = combattants[jId]?.data?.nom || jId;
  const key = jId + '_' + cat;
  const raison = document.getElementById('ri-' + key)?.value?.trim() || '';
  const upd = {};
  upd['actionsDeclarees.' + jId + '.' + cat + '.pending.status'] = 'refused';
  upd['actionsDeclarees.' + jId + '.' + cat + '.pending.refusalReason'] = raison;
  try {
    await db.collection(COMBATS_COLL).doc(currentCombatId).update(upd);
    addLog('✗ ' + nom + ' : ' + p.type + ' (' + cat + ') refusée' + (raison ? ' — ' + raison : ''));
  } catch(e){ console.error(e); }
}
