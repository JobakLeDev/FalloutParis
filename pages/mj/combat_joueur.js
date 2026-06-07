// firebaseConfig, COMBAT_DOC, FACES_CD, SK_ATTR, WEAPONS_DB définis dans common/shared.js et mj_shared.js

// ---- EFFETS DE DÉGÂTS (règle p.XX) ----
const DAMAGE_EFFECTS = {
  Burst:       { calc: (ef, dmg)    => ({ note: ef+' cible(s) supp. à portée Courte (+1 munition/cible)' }) },
  Breaking:    { calc: (ef, dmg)    => ({ note: 'Réduit la RD de '+ef+' (couverture ou localisation)' }) },
  Persistent:  { calc: (ef, dmg)    => ({ note: 'Subit '+dmg+' dmg/tour × '+ef+' tour(s) (action maj. pour arrêter)' }) },
  Piercing:    { calc: (ef, dmg, x) => ({ note: 'Ignore '+(ef*(x||1))+' RD (Perforant '+x+')' }) },
  Radioactive: { calc: (ef, dmg)    => ({ rad: ef, note: '+'+ef+' RAD après les dégâts' }) },
  Spread:      { calc: (ef, dmg)    => ({ note: ef+'× '+Math.floor(dmg/2)+' dmg supp. zone aléatoire' }) },
  Stun:        { calc: (ef, dmg)    => ({ note: 'Cible étourdie : pas d\'actions normales au prochain tour' }) },
  Vicious:     { calc: (ef, dmg)    => ({ dmgBonus: ef, note: '+'+ef+' dmg (inclus)' }) },
};

function parseEffet(eff){
  if(!eff || eff === '—' || !eff.trim()) return null;
  const parts = eff.trim().split(/[\s,]+/);
  const name = parts[0];
  const val  = parts[1] ? parseInt(parts[1]) : 1;
  return DAMAGE_EFFECTS[name] ? { name, val } : null;
}

const MINOR_ACTIONS = [
  { type: 'Aim',       desc: 'Re-roll 1d20 sur la premiere attaque ce tour',   mouvement: false },
  { type: 'Draw Item', desc: 'Sortir ou ranger un objet',                       mouvement: false },
  { type: 'Interact',  desc: 'Interaction simple (ouvrir porte, bouton...)',    mouvement: false },
  { type: 'Move',      desc: 'Se deplacer d\'une zone (portee Medium)',         mouvement: true  },
  { type: 'Take Chem', desc: 'Administrer un chem a soi ou un allie a portee', mouvement: false },
];

const MAJOR_ACTIONS = [
  { type: 'Attack',      desc: 'Attaque melee ou a distance',                           mouvement: false },
  { type: 'Assist',      desc: 'Assister un allie sur son prochain test',               mouvement: false },
  { type: 'Command NPC', desc: 'Donner un ordre a un PNJ allie',                        mouvement: false },
  { type: 'Defend',      desc: 'Test AGI+Athletisme, +1 Defense (ou +2 pour 2AP)',      mouvement: false },
  { type: 'First Aid',   desc: 'Test INT+Medecine pour soigner un allie',               mouvement: false },
  { type: 'Pass',        desc: 'Ne rien faire ce tour',                                  mouvement: false },
  { type: 'Rally',       desc: 'Test END+Survie D0, generer des AP',                    mouvement: false },
  { type: 'Ready',       desc: 'Preparer une action declenchee par un evenement',       mouvement: false },
  { type: 'Sprint',      desc: 'Se deplacer de 2 zones (portee Long)',                  mouvement: true  },
  { type: 'Test',        desc: 'Test de competence libre (permission MJ)',               mouvement: false },
];

let db, joueurData = null, joueurId = null, combatId = null;
let combatState = null;
let tousJoueurs = {};
let armeSelectionnee = null;
let nbDCActuel = 2;
let nbDiceJ = 2;
let lastExcessJ = 0;
let lastSkKeyJ = '';
let useStackedDeck = false;
let currentArmeInfo = null;  // {nom, skKey, persoBonus, dmg}
let lastRollDice = [];       // [{val, rerolled}]
let lastRollTN = 0;
let aimRerolled = false;      // true si le re-roll Aim a déjà été utilisé ce lancer
let cibleAttaque = '';        // nom de l'ennemi ciblé (sélecteur)
const AIM_ZONES = ['', 'Tête', 'Torse', 'Bras G.', 'Bras D.', 'Jambe G.', 'Jambe D.'];  // '' = zone non ciblée
let lastAttackResultTs = 0;   // dédup notification résultat attaque
let actionState = null;       // extrait de combatState.actionsDeclarees[joueurId]
let selectedActionDraft = null; // {category, type, desc} — action en cours de saisie
let myAim = null;            // {cible, zone} — visée déclarée ce tour (Attack/Aim) ; zone '' = non visée
let attacksDone = 0;         // nb d'attaques (CD) résolues ce tour
let twoD20Done = -1;         // index d'attaque pour lequel le 2D20 a déjà été lancé (anti-relance)
// Nb d'attaques validées par le MJ (chaque action majeure Attack consommée)
function attacksValidated(){ return (actionState?.majeure?.used || []).filter(t => t === 'Attack').length; }
// Une attaque validée reste-t-elle à résoudre (jet) ?
function canAttackNow(){ return attacksValidated() > attacksDone; }
let turnEnded = false;       // a cliqué « Terminer mon tour »
let _turnKey = '';           // clé round:tourActif pour réinitialiser au changement de tour
let _declWeaps = [];         // armes proposées dans la déclaration d'attaque (index → params)
// Armes d'attaque du joueur (équipées) + mains nues, avec TN/DC calculés
function attackWeapons(){
  const d = joueurData; if(!d) return [];
  const list = (d.inventory||[]).filter(it => it.equipped && it.type==='WEAPON').map(inv => {
    const db2 = WEAPONS_DB[inv.name] || {};
    const tn  = db2.sk ? getTN(d, db2.sk).total + (inv.persoBonus?2:0) : 0;
    return { nom: inv.name, label: inv.name + (inv.persoBonus?' ★':''), tn, dmg: db2.dmg||'2D', persoBonus: !!inv.persoBonus };
  });
  list.push({ nom:'__unarmed__', label:'👊 Mains nues', tn: getTN(d,'barehand').total, dmg:'2D', persoBonus:false });
  return list;
}
const ZONES_RND = ['Tête','Torse','Torse','Bras G.','Bras D.','Jambe G.','Jambe D.'];  // tirage zone au hasard (torse plus fréquent)
function randomZone(){ return ZONES_RND[Math.floor(Math.random()*ZONES_RND.length)]; }

function initJoueur(){
  const params = new URLSearchParams(window.location.search);
  joueurId  = params.get('id');
  combatId  = params.get('combat');
  if(!joueurId){ document.getElementById('attente').innerHTML = '<div style="color:var(--rd);padding:40px;text-align:center">⚠ Aucun personnage — accède via ta fiche joueur</div>'; return; }
  if(!combatId){ document.getElementById('attente').innerHTML = '<div style="color:var(--td);padding:40px;text-align:center">Aucun combat en cours — demande le lien à ton MJ</div>'; return; }

  const app = firebase.initializeApp(firebaseConfig);
  db = app.firestore();

  // Mes données
  db.collection('joueurs').doc(joueurId).onSnapshot(snap => {
    if(!snap.exists) return;
    joueurData = {...snap.data(), _id: joueurId};
    document.getElementById('hdr-nom').textContent = joueurData.nom || joueurId;
    document.getElementById('lien-fiche').href = '../fiche_perso/fiche_perso.html?id=' + joueurId;
    renderMaCarte();
    renderLuckJoueur();
  });

  // Tous les joueurs (pour les coéquipiers)
  db.collection('joueurs').onSnapshot(snap => {
    tousJoueurs = {};
    snap.forEach(doc => { tousJoueurs[doc.id] = {...doc.data(), _id: doc.id}; });
    renderCoequipiers();
  });

  // État du combat
  db.collection(COMBATS_COLL).doc(combatId).onSnapshot(snap => {
    const show = id => document.getElementById(id).style.display = 'block';
    const hide = id => document.getElementById(id).style.display = 'none';

    if(!snap.exists){
      show('attente'); hide('combat-actif'); hide('combat-termine');
      return;
    }
    const data = snap.data();
    if(!data.actif){
      // Combat terminé (pas "en attente") — afficher l'écran de fin
      combatState = data;
      hide('attente'); hide('combat-actif');
      renderCombatTermine(data);
      show('combat-termine');
      return;
    }
    combatState = data;
    actionState = combatState?.actionsDeclarees?.[joueurId] || null;
    hide('attente'); show('combat-actif'); hide('combat-termine');
    renderCombatJoueur();
  });
}

// getHpMax, getTN définis dans mj_shared.js

// ---- LUCK POOL (vue joueur) ----
function renderLuckJoueur(){
  const luckPts = joueurData?.luck_points || 0;
  const lckMax  = joueurData?.special?.L  || 5;
  const valEl = document.getElementById('j-luck-val');   if(valEl) valEl.textContent = luckPts;
  const maxEl = document.getElementById('j-luck-max');   if(maxEl) maxEl.textContent = lckMax;
  const dotsEl= document.getElementById('j-luck-dots');
  if(dotsEl){
    dotsEl.innerHTML='';
    for(let i=0;i<lckMax;i++) dotsEl.innerHTML+=`<span class="j-luck-dot${i<luckPts?' on':''}"></span>`;
  }
  // Lucky Timing : disponible si pas mon tour
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id===joueurId;
  const ltBtn = document.getElementById('j-lucky-timing-btn');
  if(ltBtn){ ltBtn.disabled = isMoTour || luckPts < 1; ltBtn.style.opacity = (isMoTour||luckPts<1)?'0.35':'1'; }
}

// ---- RENDER PRINCIPAL ----
// ============================================================
// ÉCRAN DE FIN DE COMBAT
// ============================================================
function renderCombatTermine(data){
  const el = document.getElementById('combat-termine'); if(!el) return;

  const ennemis  = data.ennemis || [];
  const nbRounds = data.numRound || 0;

  // Déterminer victoire / défaite / indéterminé
  const tousMorts   = ennemis.length > 0 && ennemis.every(e => (e.pvCur||0) <= 0);
  const joueurMort  = joueurData && (joueurData.hp||0) <= 0;
  let label, couleur, sousLabel;
  if(tousMorts){
    label = 'VICTOIRE'; couleur = 'var(--g)';
    sousLabel = 'Tous les ennemis ont été éliminés.';
  } else if(joueurMort){
    label = 'DÉFAITE'; couleur = 'var(--rd)';
    sousLabel = 'Tu as été mis hors de combat.';
  } else {
    label = 'COMBAT TERMINÉ'; couleur = 'var(--am)';
    sousLabel = 'Le combat s\'est achevé.';
  }

  // XP (repli : si l'ennemi n'a pas d'xp stockée, on la retrouve dans le bestiaire par son nom)
  const xpOf = e => {
    if(e.xp != null) return e.xp;
    const base = (e.nom||'').replace(/\s+\d+$/,'').replace(/\s*\(.*\)\s*$/,'').trim();
    return window.ENNEMIS_DB?.[base]?.xp || 0;
  };
  const defaits  = ennemis.filter(e => (e.pvCur||0) <= 0);
  const xpTotal  = defaits.reduce((a, e) => a + xpOf(e), 0);

  // Fiche joueur
  const hpMax  = joueurData ? ((joueurData.special?.L||5) + (joueurData.special?.E||5) + Math.max(0,(joueurData.niveau||1)-1)) : '?';
  const hpFin  = joueurData?.hp ?? '?';
  const radFin = joueurData?.rad ?? 0;

  let html = '<div style="padding:40px 20px;text-align:center;font-family:\'Share Tech Mono\',monospace">';

  // Titre
  html += '<div style="font-family:\'Oswald\',sans-serif;font-size:36px;letter-spacing:6px;color:'+couleur+';margin-bottom:8px">'+label+'</div>';
  html += '<div style="font-size:9px;color:var(--td);letter-spacing:2px;margin-bottom:24px">'+sousLabel+'</div>';

  // Stats du combat
  html += '<div style="display:inline-flex;gap:24px;border:1px solid var(--b2);padding:12px 24px;margin-bottom:20px">';
  html += '<div><div style="font-size:7px;color:var(--td)">ROUNDS</div><div style="font-family:\'Oswald\',sans-serif;font-size:22px;color:var(--tb)">'+nbRounds+'</div></div>';
  html += '<div><div style="font-size:7px;color:var(--td)">ENNEMIS</div><div style="font-family:\'Oswald\',sans-serif;font-size:22px;color:var(--rd)">'+defaits.length+'/'+ennemis.length+'</div></div>';
  html += '<div><div style="font-size:7px;color:var(--td)">XP GAGNÉE</div><div style="font-family:\'Oswald\',sans-serif;font-size:22px;color:var(--am)">'+xpTotal+'</div></div>';
  html += '<div><div style="font-size:7px;color:var(--td)">PV RESTANTS</div><div style="font-family:\'Oswald\',sans-serif;font-size:22px;color:'+(joueurMort?'var(--rd)':'var(--g)')+'">'+hpFin+'</div></div>';
  if(radFin > 0) html += '<div><div style="font-size:7px;color:var(--td)">RAD</div><div style="font-family:\'Oswald\',sans-serif;font-size:22px;color:var(--am)">'+radFin+'</div></div>';
  html += '</div>';

  // Ennemis défaits
  if(defaits.length){
    html += '<div style="margin-bottom:16px;text-align:left;display:inline-block;min-width:260px">';
    html += '<div style="font-size:7px;color:var(--td);letter-spacing:2px;margin-bottom:6px">ENNEMIS DÉFAITS</div>';
    defaits.forEach(e => {
      html += '<div style="display:flex;justify-content:space-between;font-size:8px;padding:3px 0;border-bottom:1px solid var(--b)">'
        + '<span style="color:var(--t)">'+e.nom+'</span>'
        + '<span style="color:var(--am)">+'+xpOf(e)+' XP</span></div>';
    });
    html += '</div>';
  }

  // Note XP
  if(xpTotal > 0){
    html += '<div style="font-size:7px;color:var(--td);margin-bottom:20px">XP distribué par le MJ</div>';
  }

  // Lien retour fiche
  html += '<div style="margin-top:8px">';
  html += '<a href="../fiche_perso/fiche_perso.html?id='+joueurId+'" style="color:var(--g);border:1px solid var(--g);padding:8px 24px;text-decoration:none;font-size:9px;letter-spacing:2px">↗ MA FICHE</a>';
  html += '</div></div>';

  el.innerHTML = html;
}

function renderCombatJoueur(){
  if(!combatState) return;
  // Réinitialiser visée / attaque / fin de tour quand le tour change
  const tk = (combatState.numRound||0) + ':' + (combatState.tourActif||0);
  if(tk !== _turnKey){
    _turnKey = tk; myAim = null; turnEnded = false; attacksDone = 0; twoD20Done = -1;
    currentArmeInfo = null; armeSelectionnee = null; lastRollDice = [];
    const dc = document.getElementById('mes-des-context'); if(dc) dc.textContent = 'Déclare une attaque pour viser';
    ['j-dice-result','j-cd-result'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML='—'; });
    ['j-attack-result','j-miss-fortune','j-aim-reroll','j-convert-ap','j-bonus-dmg'].forEach(id => { const e=document.getElementById(id); if(e){ e.innerHTML=''; e.style.display='none'; } });
  }
  document.getElementById('j-round').textContent = combatState.numRound||1;
  document.getElementById('hdr-round').textContent = 'Round ' + (combatState.numRound||1);
  renderMaCarte();
  renderActionsJoueur();
  renderActionsDeclarees();
  renderDiceAccess();
  refreshDesContext();
  renderAPPoolJoueur();
  renderLuckJoueur();
  renderCoequipiers();
  renderTrackerJoueur();
  renderEnnemisJoueur();
}

// ---- AP POOL (vue joueur) ----
function renderAPPoolJoueur(){
  const pool = combatState?.apPool || 0;
  const valEl = document.getElementById('j-ap-val'); if(valEl) valEl.textContent = pool;
  const dotsEl = document.getElementById('j-ap-dots');
  if(dotsEl){
    dotsEl.innerHTML = '';
    for(let i=0;i<6;i++) dotsEl.innerHTML += '<span class="j-ap-dot'+(i<pool?' on':'')+'"></span>';
  }
  const btnsEl = document.getElementById('j-ap-spend-btns'); if(!btnsEl) return;
  const ap = pool;
  btnsEl.innerHTML =
    `<button class="j-ap-spend-btn" onclick="bonusActionGroupeJ('min')" ${ap<1?'disabled':''}>+Action mineure (−1AP)</button>`+
    `<button class="j-ap-spend-btn" onclick="bonusActionGroupeJ('maj')" ${ap<2?'disabled':''}>+Action majeure (−2AP)</button>`+
    `<button class="j-ap-spend-btn" onclick="demanderInfoJ()" ${ap<1?'disabled':''}>❓ Obtenir info (−1AP)</button>`+
    `<button class="j-ap-spend-btn" onclick="reduireTempsJ()" ${ap<2?'disabled':''}>⏱ Réduire temps (−2AP)</button>`+
    `<button class="j-ap-spend-btn" onclick="donnerAPMJ()" ${ap<1?'disabled':''}>↑ Donner AP au MJ (−1AP)</button>`;
}

async function _updateAPGroupe(delta){
  if(!db||!combatState) return;
  const newVal = Math.max(0, Math.min(6, (combatState.apPool||0)+delta));
  try { await db.collection(COMBATS_COLL).doc(combatId).update({apPool: newVal}); }
  catch(e){ console.error(e); }
}

async function bonusActionGroupeJ(type){
  if(!combatState) return;
  const cout = type==='min'?1:2;
  if((combatState.apPool||0)<cout) return;
  const s = combatState.actionsState?.[joueurId]; if(!s) return;
  const upd = {apPool: (combatState.apPool||0)-cout};
  upd['actionsState.'+joueurId+(type==='min'?'.mineure':'.majeure')] = Math.min((type==='min'?s.mineure:s.majeure)+1,2);
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); }
  catch(e){ console.error(e); }
}

async function demanderInfoJ(){
  if(!combatState||(combatState.apPool||0)<1) return;
  const nom = joueurData?.nom || joueurId;
  const upd = {apPool:(combatState.apPool||0)-1, infoRequest:{joueur:nom, ts:Date.now()}};
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); }
  catch(e){ console.error(e); }
}

async function reduireTempsJ(){
  if((combatState?.apPool||0)<2) return;
  await _updateAPGroupe(-2);
}

async function donnerAPMJ(){
  if(!combatState||(combatState.apPool||0)<1) return;
  const upd = {apPool:(combatState.apPool||0)-1, mjApPool:(combatState.mjApPool||0)+1};
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); }
  catch(e){ console.error(e); }
}

// ---- STACKED DECK ----
function toggleStackedDeck(){
  const luckPts = joueurData?.luck_points||0;
  if(!useStackedDeck && luckPts < 1) return;  // need luck to activate
  useStackedDeck = !useStackedDeck;
  const btn = document.getElementById('j-stacked-deck-btn');
  if(btn) btn.classList.toggle('on', useStackedDeck);
  if(!currentArmeInfo || !joueurData) return;
  let tn;
  if(useStackedDeck){
    const lck = joueurData.special?.L||5;
    const rang = joueurData.skills?.[currentArmeInfo.skKey]||0;
    const tag  = joueurData.taggedSkills?.includes(currentArmeInfo.skKey)?2:0;
    tn = lck+rang+tag+(currentArmeInfo.persoBonus?2:0);
  } else {
    tn = getTN(joueurData,currentArmeInfo.skKey).total+(currentArmeInfo.persoBonus?2:0);
  }
  document.getElementById('j-tn-val').value = tn;
  const nomAff = currentArmeInfo.nom==='__unarmed__'?'Mains nues':currentArmeInfo.nom;
  document.getElementById('mes-des-context').innerHTML =
    `<b style="color:var(--tb)">${nomAff}</b> · ${currentArmeInfo.dmg} · TN <b style="color:var(--am)">${tn}</b>${useStackedDeck?' <span style="color:var(--am)">🍀 LCK</span>':''}`;
}

// ---- MISS FORTUNE ----
function renderMissFortune(){
  const el = document.getElementById('j-miss-fortune'); if(!el) return;
  const luckPts = joueurData?.luck_points||0;
  const already = lastRollDice.filter(d=>d.rerolled).length;
  const canStill = lastRollDice.some(d=>!d.rerolled) && already < 3 && luckPts > 0;
  if(!canStill || lastRollDice.length===0){ el.style.display='none'; return; }
  let html = '<span style="font-size:7px;color:var(--td)">Miss Fortune (−1 Luck/dé) : </span>';
  lastRollDice.forEach((die,i)=>{
    const col = die.val<=lastRollTN?'var(--g)':'var(--rd)';
    if(die.rerolled){
      html+=`<span class="mf-die-btn rerolled" style="color:${col}">${die.val}↺</span>`;
    } else {
      html+=`<button class="mf-die-btn" style="color:${col}" onclick="missFortuneJ(${i})">${die.val} ↺</button>`;
    }
  });
  el.style.display='block'; el.innerHTML=html;
}

// ---- AIM RE-ROLL ----
function renderAimReroll(){
  const el = document.getElementById('j-aim-reroll'); if(!el) return;
  const hasAim = (actionState?.mineure?.used || []).includes('Aim');
  if(!hasAim || lastRollDice.length === 0){ el.style.display='none'; return; }
  if(aimRerolled){
    el.style.display='block';
    el.innerHTML='<span style="font-size:7px;color:var(--gd)">🎯 Aim utilisé</span>';
    return;
  }
  let html = '<span style="font-size:7px;color:var(--g)">🎯 Aim — relancer 1 dé : </span>';
  lastRollDice.forEach((die, i) => {
    const col = die.val <= lastRollTN ? 'var(--g)' : 'var(--rd)';
    html += '<button class="mf-die-btn" style="color:' + col + '" onclick="aimRelancerDe(' + i + ')">' + die.val + ' ↺</button>';
  });
  el.style.display='block'; el.innerHTML=html;
}

function aimRelancerDe(idx){
  if(aimRerolled || !lastRollDice[idx]) return;
  aimRerolled = true;
  lastRollDice[idx] = { val: Math.floor(Math.random()*20)+1, rerolled: false };

  const vals = lastRollDice.map(d => d.val);
  const tn = lastRollTN;
  let succes = vals.filter(v=>v<=tn).length + vals.filter(v=>v===1).length;
  const crits = vals.filter(v=>v===1).length;
  const echec = succes < 1;
  const succesBonus = Math.max(0, succes-1);
  const dcTotal = echec ? 0 : nbDCActuel + succesBonus;
  if(!echec) { nbDCActuel = dcTotal; const _d=document.getElementById('j-nb-cd-disp'); if(_d) _d.textContent = dcTotal; }

  const col = succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  let r = lastRollDice.map((d, i) => {
    const c = d.val<=tn?'var(--g)':'var(--rd)';
    const marker = i===idx ? '🎯' : (d.rerolled ? '↺' : '');
    return '<span style="color:'+c+';font-size:16px;font-family:Oswald,sans-serif">'+d.val+marker+'</span>';
  }).join('/');
  r += ' <b style="color:'+col+'">'+succes+'s</b>';
  if(crits) r += '<span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r += ' <span style="color:var(--rd)">ÉCHEC</span>';
  else r += '→<b style="color:var(--am)">'+dcTotal+'DC</b>';
  document.getElementById('j-dice-result').innerHTML = r;

  lastExcessJ = succesBonus;
  const cvEl = document.getElementById('j-convert-ap');
  if(cvEl){
    const pool = combatState?.apPool||0;
    const toAdd = Math.min(succesBonus, 6-pool);
    if(!echec && toAdd>0){
      cvEl.style.display='block';
      cvEl.innerHTML='<button class="j-ap-convert-btn" onclick="convertExcessToAPJ()">+'+toAdd+' AP groupe</button>';
    } else cvEl.style.display='none';
  }
  const bdEl = document.getElementById('j-bonus-dmg');
  if(bdEl){
    const isMeleeThrow = ['cac_weapon','barehand','throwing'].includes(lastSkKeyJ);
    const pool = combatState?.apPool||0;
    if(!echec && isMeleeThrow && pool>0){
      let btns = '<span style="font-size:7px;color:var(--td)">Dégâts bonus: </span>';
      for(let n=1;n<=Math.min(3,pool);n++) btns+='<button class="j-ap-dmg-btn" onclick="bonusDmgJ('+n+')">+'+n+'D (−'+n+'AP)</button>';
      bdEl.style.display='block'; bdEl.innerHTML=btns;
    } else bdEl.style.display='none';
  }
  renderAimReroll();
  renderMissFortune();
}

async function missFortuneJ(diceIdx){
  if(lastRollDice[diceIdx]?.rerolled) return;
  const luckPts = joueurData?.luck_points||0;
  if(luckPts<1) return;
  const newPts = luckPts-1;
  await db.collection('joueurs').doc(joueurId).update({luck_points:newPts, lastUpdate:Date.now()});
  lastRollDice[diceIdx] = {val:Math.floor(Math.random()*20)+1, rerolled:true};
  // Recalculer le résultat
  const vals = lastRollDice.map(d=>d.val);
  const tn   = lastRollTN;
  let succes  = vals.filter(v=>v<=tn).length + vals.filter(v=>v===1).length;
  const crits = vals.filter(v=>v===1).length;
  const echec = succes<1;
  const dcTotal = echec?0:nbDCActuel+Math.max(0,succes-1);
  if(!echec) { nbDCActuel = dcTotal; const _d=document.getElementById('j-nb-cd-disp'); if(_d) _d.textContent = dcTotal; }
  const col = succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  let r = lastRollDice.map(d=>{
    const c=d.val<=tn?'var(--g)':'var(--rd)';
    return `<span style="color:${c};font-size:16px;font-family:Oswald,sans-serif">${d.val}${d.rerolled?'↺':''}</span>`;
  }).join('/');
  r+=` <b style="color:${col}">${succes}s</b>`;
  if(crits) r+=`<span style="color:var(--am)">+${crits}★</span>`;
  if(echec) r+=` <span style="color:var(--rd)">ÉCHEC</span>`;
  else r+=`→<b style="color:var(--am)">${dcTotal}DC</b>`;
  document.getElementById('j-dice-result').innerHTML=r;
  renderMissFortune();
}

// ---- LUCKY TIMING ----
async function luckyTimingJ(){
  if(!combatState) return;
  const isMoTour = combatState.ordreInitiative?.[combatState.tourActif]?.id===joueurId;
  if(isMoTour) return;
  const luckPts = joueurData?.luck_points||0;
  if(luckPts<1) return;
  const newPts = luckPts-1;
  await db.collection('joueurs').doc(joueurId).update({luck_points:newPts, lastUpdate:Date.now()});
  await db.collection(COMBATS_COLL).doc(combatId).update({
    luckyTimingReq:{id:joueurId, nom:(joueurData?.nom||joueurId).toUpperCase(), ts:Date.now()}
  }).catch(e=>console.error(e));
}

// ---- LUCK OF THE DRAW ----
async function luckOfTheDrawJ(){
  const detail = document.getElementById('j-luck-draw-inp')?.value?.trim();
  if(!detail) return;
  const luckPts = joueurData?.luck_points||0;
  if(luckPts<1) return;
  const newPts = luckPts-1;
  await db.collection('joueurs').doc(joueurId).update({luck_points:newPts, lastUpdate:Date.now()});
  await db.collection(COMBATS_COLL).doc(combatId).update({
    luckRequest:{joueur:joueurData?.nom||joueurId, detail, ts:Date.now()}
  }).catch(e=>console.error(e));
  const inp = document.getElementById('j-luck-draw-inp'); if(inp) inp.value='';
}

// ---- SÉLECTEUR D20 ----
function setNbDiceJ(n){
  nbDiceJ = n;
  [2,3,4,5].forEach(i=>{ const b=document.getElementById('j-d20-'+i); if(b) b.classList.toggle('on',i===n); });
  const lb=document.getElementById('j-lance-btn'); if(lb) lb.textContent=n+'D20';
}

async function convertExcessToAPJ(){
  if(lastExcessJ<=0) return;
  const pool = combatState?.apPool||0;
  const toAdd = Math.min(lastExcessJ, 6-pool);
  if(toAdd<=0) return;
  await _updateAPGroupe(toAdd);
  lastExcessJ=0;
  const el=document.getElementById('j-convert-ap'); if(el) el.style.display='none';
}

async function bonusDmgJ(n){
  if((combatState?.apPool||0)<n) return;
  await _updateAPGroupe(-n);
  const vals=Array.from({length:n},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmg=vals.reduce((a,v)=>a+(parseInt(v)||0),0);
  const ef=vals.filter(v=>v.includes('⚡')).length;
  const extra=vals.map(v=>'<span style="color:'+(v.includes('⚡')?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-size:14px;font-family:Oswald,sans-serif">'+v+'</span>').join(' ');
  const cd=document.getElementById('j-cd-result');
  if(cd) cd.innerHTML+=' <span style="color:var(--am)">+['+extra+'] ='+dmg+'dmg'+(ef?' +'+ef+'⚡':'')+'</span>';
  const el=document.getElementById('j-bonus-dmg'); if(el) el.style.display='none';
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
    html += '<div class="jc-arme'+(sel?' selected-arme':'')+'">';
    html += '<span class="jc-arme-name">'+inv.name+(inv.persoBonus?' ★':'')+'</span>';
    { const at = db2.a && db2.a!=='-' ? db2.a : null;
      const ae = at ? (d.ammo||[]).find(a=>a.cal===at) : null;
      const aq = ae ? ae.qty : (at ? 0 : null);
      const ammoHtml = aq!==null ? ' · <span style="color:'+(aq>0?'var(--am)':'var(--rd)')+'">🔫'+aq+'</span>' : '';
      html += '<span class="jc-arme-stat">'+(db2.dmg||'?')+' · TN <b>'+tn+'</b>'+(db2.eff&&db2.eff!=='—'&&db2.eff!=='–'?' · '+db2.eff:'')+ammoHtml+'</span>'; }
    html += '</div>';
  });
  const tnUnarmed = getTN(d,'barehand').total;
  html += '<div class="jc-arme'+(armeSelectionnee==='__unarmed__'?' selected-arme':'')+'">';
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

  // Ronds purement indicatifs (pas de dépense manuelle ici)
  const minDots = [0,1].map(i => '<span class="act-dot-j'+(i < s.mineure ? ' on' : '')+'"></span>').join('');
  const majDots = [0,1].map(i => '<span class="act-dot-j maj'+(i < s.majeure ? ' on' : '')+'"></span>').join('');

  el.innerHTML =
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">MIN</span>' +
      '<div class="act-dots">' + minDots + '</div>' +
    '</div>' +
    '<div class="act-sep"></div>' +
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">MAJ</span>' +
      '<div class="act-dots">' + majDots + '</div>' +
    '</div>' +
    '<div class="act-sep"></div>' +
    '<div class="act-h-group">' +
      '<span class="act-section-lbl">PA</span>' +
      '<span class="pa-val-j">' + (s.pa||0) + '</span>' +
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
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); } catch(e){ console.error(e); }
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
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); } catch(e){ console.error(e); }
}

async function chPAJoueur(delta){
  if(!db||!combatState) return;
  const s = combatState.actionsState?.[joueurId]; if(!s) return;
  const newPA = Math.max(0, (s.pa||0) + delta);
  const upd = {};
  upd['actionsState.' + joueurId + '.pa'] = newPA;
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); } catch(e){ console.error(e); }
}

// ---- COÉQUIPIERS ----
function renderCoequipiers(){
  const el = document.getElementById('j-coequipiers'); if(!el) return;
  if(!combatState){ el.innerHTML='<span class="empty">Aucun coéquipier</span>'; return; }

  const ordre = combatState.ordreInitiative||[];
  const tourActif = combatState.tourActif||0;
  const coeqs = ordre.filter(c => c.type==='joueur' && c.id !== joueurId);
  // Mes compagnons (PNJ alliés) — affichés en tête
  const mesComp = (combatState.allies||[]).filter(a => a.owner === joueurId);
  let compHtml = mesComp.map(a => {
    const pct = a.pvMax?Math.round(a.pvCur/a.pvMax*100):0;
    const bc = pct<30?'var(--rd)':pct<60?'var(--am)':'var(--g)';
    return '<div class="coeq-card" style="border-left:3px solid var(--g)">'
      +'<div class="coeq-top"><span class="coeq-nom">🐾 '+a.nom+'</span></div>'
      +'<div class="coeq-bar"><div style="width:'+pct+'%;height:100%;background:'+bc+'"></div></div>'
      +'<div class="coeq-stats"><span>PV <b class="'+(pct<30?'danger':'')+'">'+a.pvCur+'/'+a.pvMax+'</b></span><span>ATQ <b>'+a.atq+' DC</b></span></div>'
      +'</div>';
  }).join('');

  if(!coeqs.length && !mesComp.length){ el.innerHTML='<span class="empty">Aucun coéquipier</span>'; return; }

  el.innerHTML = compHtml + coeqs.map((c, idx) => {
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
function estElimineJ(c){
  if(c.type === 'ennemi'){
    const e = (combatState?.ennemis||[]).find(x => x.id === c.eid);
    return !!e && (e.pvCur||0) <= 0;
  }
  if(c.type === 'allie'){
    const a = (combatState?.allies||[]).find(x => x.id === c.aid);
    return !!a && (a.pvCur||0) <= 0;
  }
  return (tousJoueurs[c.id]?.hp ?? 1) <= 0;
}

function renderTrackerJoueur(){
  const el = document.getElementById('j-tracker'); if(!el||!combatState) return;
  const ordre = combatState.ordreInitiative||[];
  const tourActif = combatState.tourActif||0;
  if(!ordre.length){ el.innerHTML='<span class="empty">En attente...</span>'; return; }

  el.innerHTML = ordre.map((c,i) => {
    const isActif = i===tourActif;
    const isMe = c.id===joueurId;
    const elimine = estElimineJ(c);
    if(elimine){
      return '<div class="tracker-item'+(c.type==='ennemi'?' ennemi':'')+'" style="opacity:0.35">'
        +'<div class="tracker-top">'
        +'<span class="tracker-nom" style="text-decoration:line-through">💀 '+c.nom+'</span>'
        +'<span class="tracker-init">'+c.init+'</span>'
        +'</div></div>';
    }
    if(c.type === 'allie'){
      return '<div class="tracker-item allie'+(isActif?' actif':'')+'">'
        +'<div class="tracker-top">'
        +'<span class="tracker-nom" style="font-size:10px">'+(isActif?'▶ ':'')+'🐾 '+c.nom+'</span>'
        +'<span class="tracker-init" style="font-size:7px;color:var(--td)">avec PC</span>'
        +'</div></div>';
    }
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
      +'<div class="jc-top"><span class="ennemi-name">'+e.nom+'</span></div>'
      +'<div class="jc-bar"><div style="width:'+pct+'%;height:100%;background:'+bc+'"></div></div>'
      +'<div class="jc-row">'
      +'<div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv'+(pct<30?' danger':'')+'">'+e.pvCur+'/'+e.pvMax+'</span></div>'
      +'<div class="jc-stat"><span class="jc-sl">ATQ</span><span class="jc-sv">'+e.atq+'</span></div>'
      +'<div class="jc-stat"><span class="jc-sl">RD</span><span class="jc-sv">'+e.rd+'</span></div>'
      +'</div></div>';
  }).join('');
}

// ---- SÉLECTION ARME + DÉS ----
function refreshDesContext(){
  if(!currentArmeInfo || !joueurData) return;
  const {nom, dmg, ammoType} = currentArmeInfo;
  const nomAff = nom === '__unarmed__' ? 'Mains nues' : nom;
  const hasAmmo = ammoType && ammoType !== '-';
  const ammoEntry = hasAmmo ? (joueurData.ammo||[]).find(a => a.cal === ammoType) : null;
  const qty = ammoEntry ? ammoEntry.qty : (hasAmmo ? 0 : null);
  const tn = document.getElementById('j-tn-val')?.value || '?';
  const ammoHtml = qty !== null
    ? ' · <span style="color:'+(qty>0?'var(--am)':'var(--rd)')+'">🔫 '+qty+' '+ammoType+'</span>'
    : '';
  const el = document.getElementById('mes-des-context');
  if(el) el.innerHTML = '<b style="color:var(--tb)">'+nomAff+'</b> · '+dmg+' · TN <b style="color:var(--am)">'+tn+'</b>'+ammoHtml;
}

function selArme(nom, tn, dmg, persoBonus=false){
  armeSelectionnee = nom;
  nbDCActuel = parseInt(dmg)||2;
  lastSkKeyJ = nom==='__unarmed__' ? 'barehand' : (WEAPONS_DB[nom]?.sk||'');
  const ammoType = nom==='__unarmed__' ? '' : (WEAPONS_DB[nom]?.a||'');
  currentArmeInfo = {nom, skKey:lastSkKeyJ, persoBonus, dmg, eff: nom==='__unarmed__' ? '' : (WEAPONS_DB[nom]?.eff||''), ammoType};
  useStackedDeck = false;
  const btn=document.getElementById('j-stacked-deck-btn'); if(btn) btn.classList.remove('on');
  const tnEl=document.getElementById('j-tn-val'); if(tnEl) tnEl.value = tn;
  renderMaCarte();
  refreshDesContext();
  const disp=document.getElementById('j-nb-cd-disp'); if(disp) disp.textContent = nbDCActuel;
  lastRollDice=[];
  const mf=document.getElementById('j-miss-fortune'); if(mf) mf.style.display='none';
}

async function jLancer2D20(){
  if(!canAttackNow() || twoD20Done === attacksDone) return;   // anti-spam : un seul toucher par attaque
  aimRerolled = false;
  const tn = parseInt(document.getElementById('j-tn-val').value)||10;
  const diff = 1;

  // Vérification et déduction des munitions (armes à distance uniquement)
  const ammoType = currentArmeInfo?.ammoType;
  const needsAmmo = ammoType && ammoType !== '-';
  if(needsAmmo){
    const ammoEntry = (joueurData?.ammo||[]).find(a => a.cal === ammoType);
    if(!ammoEntry || ammoEntry.qty <= 0){
      document.getElementById('j-dice-result').innerHTML =
        '<span style="color:var(--rd)">⚠ Plus de munitions ('+ammoType+')</span>';
      return;
    }
    ammoEntry.qty = Math.max(0, ammoEntry.qty - 1);
    db.collection('joueurs').doc(joueurId).update({ammo: joueurData.ammo, lastUpdate: Date.now()}).catch(()=>{});
    refreshDesContext();
  }

  // Coût AP groupe pour dés bonus
  const apCost = [0,0,0,1,3,6][nbDiceJ]||0;
  if(apCost>0){
    if((combatState?.apPool||0)<apCost) return;
    await _updateAPGroupe(-apCost);
  }

  const dés = Array.from({length:nbDiceJ},()=>Math.floor(Math.random()*20)+1);
  let succes = dés.filter(v=>v<=tn).length + dés.filter(v=>v===1).length;
  const crits = dés.filter(v=>v===1).length;
  const echec = succes<diff;
  const succesBonus = Math.max(0,succes-diff);
  const dcTotal = echec?0:nbDCActuel+succesBonus;
  if(!echec) { nbDCActuel = dcTotal; const _d=document.getElementById('j-nb-cd-disp'); if(_d) _d.textContent = dcTotal; }

  const col=succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  let r=dés.map(d=>'<span style="color:'+(d<=tn?'var(--g)':'var(--rd)')+';font-size:16px;font-family:Oswald,sans-serif">'+d+'</span>').join('/');
  r+=' <b style="color:'+col+'">'+succes+'s</b>';
  if(crits) r+='<span style="color:var(--am)">+'+crits+'★</span>';
  if(echec) r+=' <span style="color:var(--rd)">ÉCHEC</span>';
  else r+='→<b style="color:var(--am)">'+dcTotal+'DC</b>';
  document.getElementById('j-dice-result').innerHTML = r;
  twoD20Done = attacksDone; renderDiceAccess();   // verrouille le 2D20 pour cette attaque

  // Stocker pour Miss Fortune + reset Stacked Deck
  lastRollDice = dés.map(v=>({val:v, rerolled:false}));
  lastRollTN = tn;
  const wasStackedDeck = useStackedDeck;
  useStackedDeck = false;
  const sdBtn=document.getElementById('j-stacked-deck-btn'); if(sdBtn) sdBtn.classList.remove('on');

  // Si Stacked Deck était actif, dépenser 1 Luck
  if(wasStackedDeck){
    const lp=joueurData?.luck_points||0;
    if(lp>0) db.collection('joueurs').doc(joueurId).update({luck_points:lp-1,lastUpdate:Date.now()}).catch(()=>{});
  }

  setNbDiceJ(2);
  renderMissFortune();
  renderAimReroll();

  // Proposer conversion succès → AP groupe
  lastExcessJ = succesBonus;
  const cvEl=document.getElementById('j-convert-ap');
  if(cvEl){
    const pool=combatState?.apPool||0;
    const toAdd=Math.min(succesBonus,6-pool);
    if(!echec && toAdd>0){
      cvEl.style.display='block';
      cvEl.innerHTML='<button class="j-ap-convert-btn" onclick="convertExcessToAPJ()">+'+toAdd+' AP groupe</button>';
    } else { cvEl.style.display='none'; }
  }

  // Proposer dégâts bonus mêlée/jet
  const bdEl=document.getElementById('j-bonus-dmg');
  if(bdEl){
    const isMeleeThrow=['cac_weapon','barehand','throwing'].includes(lastSkKeyJ);
    const pool=combatState?.apPool||0;
    if(!echec && isMeleeThrow && pool>0){
      let btns='<span style="font-size:7px;color:var(--td)">Dégâts bonus: </span>';
      for(let n=1;n<=Math.min(3,pool);n++) btns+='<button class="j-ap-dmg-btn" onclick="bonusDmgJ('+n+')">+'+n+'D (−'+n+'AP)</button>';
      bdEl.style.display='block'; bdEl.innerHTML=btns;
    } else { bdEl.style.display='none'; }
  }
}

// ============================================================
// DÉCLARATION D'ACTIONS
// ============================================================

function renderActionsDeclarees(){
  const el = document.getElementById('j-actions-decl'); if(!el) return;

  // Préserver la saisie en cours si l'input existe
  const savedDetails = document.getElementById('j-action-details')?.value || '';
  const inputFocused = document.activeElement?.id === 'j-action-details';

  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  const s = combatState?.actionsState?.[joueurId] || {mineure:1, majeure:1};
  const as = actionState || {mineure:{used:[],pending:null}, majeure:{used:[],pending:null}, mouvement_used:false};

  let html = '';

  // Bandeaux actions refusées (toujours visibles)
  ['mineure','majeure'].forEach(cat => {
    const p = as[cat]?.pending;
    if(p?.status === 'refused'){
      html += '<div style="margin-bottom:4px;padding:4px 6px;border:1px solid var(--rd);background:var(--rdk);font-size:8px;display:flex;justify-content:space-between;align-items:center">'
        + '<div><span style="color:var(--rd)">✗ ' + p.type + '</span>'
        + (p.refusalReason ? ' <span style="color:var(--td);font-size:7px">— ' + p.refusalReason + '</span>' : '')
        + '</div>'
        + '<button onclick="dismissRefused(\'' + cat + '\')" style="background:none;border:1px solid var(--rd);color:var(--rd);font-size:7px;padding:1px 5px;cursor:pointer;font-family:monospace;letter-spacing:0">OK</button>'
        + '</div>';
    }
  });

  // Demandes envoyées (en attente de validation) : résumé non éditable
  ['mineure','majeure'].forEach(cat => {
    const p = as[cat]?.pending;
    if(p?.status === 'waiting'){
      html += '<div style="margin-bottom:6px;padding:5px;border:1px solid var(--am);background:#1a1200;font-size:8px">'
        + '<div style="color:var(--am);margin-bottom:3px;letter-spacing:1px">⏳ ' + p.type
        + ' <span style="color:var(--td);font-size:7px">(' + cat + ')</span> — EN ATTENTE DE VALIDATION</div>'
        + (p.details ? '<div style="color:var(--tb);font-size:8px;line-height:1.4">' + p.details + '</div>' : '')
        + '</div>';
    }
  });

  // Panneau de confirmation (action sélectionnée, pas encore envoyée)
  if(selectedActionDraft){
    const isAtk = (selectedActionDraft.type === 'Attack' || selectedActionDraft.type === 'Aim');
    const ennemisV = (combatState?.ennemis || []).filter(e => e.pvCur > 0);
    const savedCible = document.getElementById('j-act-cible')?.value || cibleAttaque || '';
    const savedZone  = document.getElementById('j-act-zone')?.value || '';
    const inputStyle = 'box-sizing:border-box;background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:8px;padding:3px 5px;outline:none';

    const aimUsed  = (as.mineure?.used || []).includes('Aim');
    const reuseAim = (selectedActionDraft.type === 'Attack' && aimUsed && myAim && myAim.w);

    let body = '';
    if(reuseAim){
      // Visée déjà effectuée (Aim) → on ne re-choisit ni arme, ni cible, ni zone
      body += '<div style="font-size:8px;color:var(--tb);margin-bottom:4px;padding:4px 6px;border:1px solid var(--gd);background:#0a140a">'
        + '🎯 Visée : <b>' + myAim.w.label + '</b> → <b style="color:var(--rd)">' + myAim.cible + '</b>'
        + (myAim.zone ? ' <span style="color:var(--am)">[' + myAim.zone + ']</span>' : ' <span style="color:var(--td)">(zone au hasard)</span>')
        + '</div>';
    } else {
      if(selectedActionDraft.type === 'Attack' || selectedActionDraft.type === 'Aim'){
        _declWeaps = attackWeapons();
        const savedW = document.getElementById('j-act-arme')?.value || '0';
        body += '<select id="j-act-arme" style="width:100%;margin-bottom:4px;' + inputStyle + '">'
          + _declWeaps.map((w,i) => '<option value="'+i+'"'+(String(i)===savedW?' selected':'')+'>'+w.label+' · '+w.dmg+' · TN '+w.tn+'</option>').join('')
          + '</select>';
      }
      if(isAtk){
        if(ennemisV.length){
          // La zone ne se choisit qu'en VISANT (Aim). Une attaque non visée → zone tirée au hasard.
          const showZone = (selectedActionDraft.type === 'Aim');
          body += '<div style="display:flex;gap:4px;margin-bottom:4px">'
            + '<select id="j-act-cible" style="flex:' + (showZone?'2':'1') + ';' + inputStyle + '">'
            + ennemisV.map(e => '<option value="' + e.nom + '"' + (e.nom===savedCible?' selected':'') + '>' + e.nom + ' (' + e.pvCur + ' PV)</option>').join('')
            + '</select>'
            + (showZone
                ? '<select id="j-act-zone" style="flex:1;' + inputStyle + '">'
                  + AIM_ZONES.map(z => '<option value="' + z + '"' + (z===savedZone?' selected':'') + '>' + (z || '— zone —') + '</option>').join('')
                  + '</select>'
                : '')
            + '</div>'
            + (showZone ? '' : '<div style="font-size:7px;color:var(--td);margin-bottom:4px">Zone touchée tirée au hasard (vise d\'abord pour cibler une zone)</div>');
        } else {
          body += '<div style="font-size:7px;color:var(--rd);margin-bottom:4px">Aucun ennemi vivant à cibler</div>';
        }
      }
      // Draw Item : accès à l'inventaire (armes + armures) → équiper / ranger
      if(selectedActionDraft.type === 'Draw Item'){
        const inv = joueurData?.inventory || [];
        const EQUIPABLE = ['WEAPON','ARMOR','POWERARMOR','CLOTHING','OUTFIT'];
        const items = inv.map((it,idx)=>({it,idx})).filter(o => EQUIPABLE.includes(o.it.type));
        if(items.length){
          const savedDraw = document.getElementById('j-act-draw')?.value || '';
          const kind = t => t==='WEAPON' ? '🔫' : '🛡';
          body += '<select id="j-act-draw" style="width:100%;margin-bottom:4px;' + inputStyle + '">'
            + '<option value="">— choisir un objet à sortir/ranger —</option>'
            + items.map(o => '<option value="'+o.idx+'"'+(String(o.idx)===savedDraw?' selected':'')+'>'+(o.it.equipped?'▣ ':'□ ')+kind(o.it.type)+' '+o.it.name+(o.it.equipped?' (équipé → ranger)':' (équiper)')+'</option>').join('')
            + '</select>';
        } else {
          body += '<div style="font-size:7px;color:var(--td);margin-bottom:4px">Aucun objet équipable dans l\'inventaire</div>';
        }
      }
      // Take Chem : liste des chems disponibles → consommer
      if(selectedActionDraft.type === 'Take Chem'){
        const inv = joueurData?.inventory || [];
        const chems = inv.map((it,idx)=>({it,idx})).filter(o => o.it.type === 'DRUGS' && (o.it.qty==null || o.it.qty>0));
        if(chems.length){
          const savedChem = document.getElementById('j-act-chem')?.value || '';
          body += '<select id="j-act-chem" style="width:100%;margin-bottom:4px;' + inputStyle + '">'
            + '<option value="">— choisir un chem —</option>'
            + chems.map(o => '<option value="'+o.idx+'"'+(String(o.idx)===savedChem?' selected':'')+'>'+o.it.name+' ×'+(o.it.qty??1)+'</option>').join('')
            + '</select>';
        } else {
          body += '<div style="font-size:7px;color:var(--rd);margin-bottom:4px">Aucun chem disponible dans l\'inventaire</div>';
        }
      }
    }
    body += '<input type="text" id="j-action-details" placeholder="Precisions optionnelles (note...)" style="width:100%;margin-bottom:4px;' + inputStyle + '">';

    html += '<div style="margin-bottom:6px;padding:5px;border:1px solid var(--am);background:#1a1200;font-size:8px">'
      + '<div style="color:var(--am);margin-bottom:2px">' + selectedActionDraft.type
      + ' <span style="color:var(--td);font-size:7px">(' + selectedActionDraft.category + ')</span></div>'
      + '<div style="color:var(--td);font-size:7px;margin-bottom:5px">' + selectedActionDraft.desc + '</div>'
      + body
      + '<div style="display:flex;gap:4px">'
      + '<button onclick="submitActionDeclaree()" style="flex:1;background:none;border:1px solid var(--g);color:var(--g);font-family:monospace;font-size:8px;padding:3px;cursor:pointer;letter-spacing:0">→ Envoyer au MJ</button>'
      + '<button onclick="cancelActionDeclaree()" style="background:none;border:1px solid var(--rd);color:var(--rd);font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;letter-spacing:0">✕</button>'
      + '</div>'
      + '</div>';
  }

  // Boutons d'actions (uniquement pendant mon tour)
  if(isMoTour && turnEnded){
    html += '<div style="padding:6px;border:1px solid var(--gd);background:#0a140a;font-size:8px;color:var(--gd);text-align:center">✓ Tour terminé</div>';
  } else if(isMoTour){
    // Disponible pendant tout mon tour : termine le tour directement (le MJ avance automatiquement)
    html += '<button onclick="finMonTour()" style="width:100%;margin-bottom:6px;background:var(--gk);border:1px solid var(--g);color:var(--g);font-family:monospace;font-size:9px;padding:5px;cursor:pointer;letter-spacing:1px">✓ TERMINER MON TOUR</button>';
    const minorUsed    = as.mineure?.used || [];
    const minorPending = as.mineure?.pending;
    const minorWaiting = minorPending?.status === 'waiting';
    const noMinorSlots = (s.mineure ?? 1) <= 0;   // grisé si plus d'action mineure dispo
    // Une action en attente de validation (mineure OU majeure) verrouille TOUS les boutons
    const anyWaiting = minorWaiting || (as.majeure?.pending?.status === 'waiting');
    // Visée non consommée : on a visé plus de fois qu'on a attaqué → pas de nouvelle visée tant qu'on n'a pas attaqué
    const aimsUsed   = minorUsed.filter(t => t === 'Aim').length + ((minorWaiting && minorPending.type === 'Aim') ? 1 : 0);
    const aimPending = aimsUsed > attacksDone;

    html += '<div style="font-size:7px;color:var(--td);letter-spacing:1px;margin-bottom:3px;margin-top:2px">ACTIONS MINEURES <span style="color:var(--g)">' + (s.mineure ?? 1) + '</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px">';
    MINOR_ACTIONS.forEach(a => {
      const isPendingThis = minorWaiting && minorPending.type === a.type;
      const moveBlocked   = a.mouvement && !!as.mouvement_used;
      const aimLock       = a.type === 'Aim' && aimPending && !isPendingThis;   // déjà visé, pas encore attaqué
      const disabled      = aimLock || moveBlocked || noMinorSlots || anyWaiting || !!selectedActionDraft;
      const col = isPendingThis ? 'var(--am)' : aimLock ? 'var(--gd)' : disabled ? '#1e2e1e' : 'var(--t)';
      const bdr = isPendingThis ? 'var(--am)' : aimLock ? 'var(--gd)' : disabled ? '#1e2e1e' : 'var(--b2)';
      const lbl = isPendingThis ? '⏳ ' + a.type : aimLock ? '✓ ' + a.type : a.type;
      html += '<button onclick="prepareAction(\'mineure\',\'' + a.type + '\')"'
        + (disabled ? ' disabled' : '')
        + ' style="background:none;border:1px solid ' + bdr + ';color:' + col + ';font-family:monospace;font-size:7px;padding:2px 5px;cursor:' + (disabled?'default':'pointer') + ';letter-spacing:0"'
        + ' title="' + a.desc + '">' + lbl + '</button>';
    });
    html += '</div>';

    const majorPending = as.majeure?.pending;
    const majorWaiting = majorPending?.status === 'waiting';
    const noMajorSlots = (s.majeure ?? 1) <= 0;   // grisé si plus d'action majeure dispo

    html += '<div style="font-size:7px;color:var(--td);letter-spacing:1px;margin-bottom:3px">ACTIONS MAJEURES <span style="color:var(--g)">' + (s.majeure ?? 1) + '</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:3px">';
    MAJOR_ACTIONS.forEach(a => {
      const isPendingThis = majorWaiting && majorPending.type === a.type;
      const moveBlocked   = a.mouvement && !!as.mouvement_used;
      const disabled      = moveBlocked || noMajorSlots || anyWaiting || !!selectedActionDraft;
      const col = isPendingThis ? 'var(--am)' : disabled ? '#1e2e1e' : 'var(--t)';
      const bdr = isPendingThis ? 'var(--am)' : disabled ? '#1e2e1e' : 'var(--b2)';
      const lbl = isPendingThis ? '⏳ ' + a.type : a.type;
      html += '<button onclick="prepareAction(\'majeure\',\'' + a.type + '\')"'
        + (disabled ? ' disabled' : '')
        + ' style="background:none;border:1px solid ' + bdr + ';color:' + col + ';font-family:monospace;font-size:7px;padding:2px 5px;cursor:' + (disabled?'default':'pointer') + ';letter-spacing:0"'
        + ' title="' + a.desc + '">' + lbl + '</button>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';

  // Restaurer la saisie après re-render
  const inp = document.getElementById('j-action-details');
  if(inp){
    if(savedDetails) inp.value = savedDetails;
    if(inputFocused){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function prepareAction(category, type){
  const list = category === 'mineure' ? MINOR_ACTIONS : MAJOR_ACTIONS;
  const action = list.find(a => a.type === type); if(!action) return;
  selectedActionDraft = { category, type: action.type, desc: action.desc };
  renderActionsDeclarees();
}

async function submitActionDeclaree(){
  if(!selectedActionDraft || !db) return;
  const { category, type } = selectedActionDraft;
  const free  = document.getElementById('j-action-details')?.value?.trim() || '';
  const aimUsed  = (actionState?.mineure?.used || []).includes('Aim');
  const reuseAim = (type === 'Attack' && aimUsed && myAim && myAim.w);

  let cible, zone, w;
  if(reuseAim){
    cible = myAim.cible; zone = myAim.zone || ''; w = myAim.w;
  } else {
    cible = document.getElementById('j-act-cible')?.value || '';
    zone  = document.getElementById('j-act-zone')?.value || '';
    if(type === 'Attack' || type === 'Aim'){
      const wi = parseInt(document.getElementById('j-act-arme')?.value || '0') || 0;
      w = _declWeaps[wi];
    }
  }

  // Draw Item : équiper / ranger l'arme choisie (écrit la fiche), Take Chem : consommer le chem
  let actLabel = '';
  if(type === 'Draw Item'){
    const di = document.getElementById('j-act-draw')?.value;
    if(di !== '' && di != null) actLabel = await drawEquipItem(parseInt(di));
  }
  if(type === 'Take Chem'){
    const ci = document.getElementById('j-act-chem')?.value;
    if(ci !== '' && ci != null) actLabel = await consumeChem(parseInt(ci));
  }

  let details = '';
  if(cible) details = '🎯 ' + cible + (zone ? ' — ' + zone : '');
  if(w)     details += (details ? ' · ' : '') + w.label;
  if(actLabel) details += (details ? ' · ' : '') + actLabel;
  if(free)  details += (details ? ' · ' : '') + free;
  // Mémoriser la visée (arme + cible + zone) pour réutilisation lors de l'attaque
  if((type === 'Attack' || type === 'Aim') && cible){ myAim = { cible, zone, w }; }
  // Attaque : appliquer l'arme choisie (sélectionnée à la déclaration ou héritée de l'Aim)
  if(type === 'Attack' && w) selArme(w.nom, w.tn, w.dmg, w.persoBonus);
  const upd = {};
  upd['actionsDeclarees.' + joueurId + '.' + category + '.pending'] = { type, details, requestedAt: Date.now(), status: 'waiting' };
  // Fermer le bloc d'édition AVANT l'écriture (Firestore re-render en local immédiatement)
  selectedActionDraft = null;
  renderActionsDeclarees();
  try {
    await db.collection(COMBATS_COLL).doc(combatId).update(upd);
  } catch(e){ console.error(e); }
}

function cancelActionDeclaree(){
  selectedActionDraft = null;
  renderActionsDeclarees();
}

// Draw Item : équipe (ou range) l'arme/armure d'inventaire i → écrit la fiche (sync Firebase). Renvoie un libellé d'action.
async function drawEquipItem(i){
  const inv = joueurData?.inventory; if(!inv || !inv[i]) return '';
  const it = inv[i];
  const APP = ['ARMOR','POWERARMOR','CLOTHING','OUTFIT'];
  const isE = x => { const d = (window.DB?.weapons||[]).find(w=>w.n===x.name); return !!d && (d.t==='Explosive'||d.sk==='explosives'); };
  let label;
  if(it.equipped){
    it.equipped = false;
    label = '📥 Range ' + it.name;
  } else if(it.type === 'WEAPON'){
    // Slots : 2 armes + 1 explosif (auto-remplace la plus ancienne si plein, pas de modale en combat)
    const equippedW = inv.filter(x => x !== it && x.type === 'WEAPON' && x.equipped);
    if(isE(it)){
      equippedW.filter(isE).forEach(x => x.equipped = false);
    } else {
      const armes = equippedW.filter(x => !isE(x));
      while(armes.length >= 2){ armes[0].equipped = false; armes.shift(); }
    }
    it.equipped = true;
    label = '🔫 Équipe ' + it.name;
  } else if(APP.includes(it.type)){
    // Superposition d'armure (RAW p.123) — même logique que la fiche (tEquip)
    const zone = it.zone || (window.DB?.armor||[]).find(a=>a.n===it.name)?.z || null;
    const isHead = zone === 'Head';
    inv.forEach(other => {
      if(other === it || !other.equipped || !APP.includes(other.type)) return;
      const oZone = other.zone || (window.DB?.armor||[]).find(a=>a.n===other.name)?.z || null;
      const oHead = oZone === 'Head';
      const oBase = ['CLOTHING','OUTFIT'].includes(other.type);
      if(it.type === 'OUTFIT'){
        if(oBase) other.equipped = false;            // une seule base
        else if(!oHead) other.equipped = false;      // tenue → retire l'armure de corps
      } else if(it.type === 'CLOTHING'){
        if(oBase) other.equipped = false;            // une seule base ; l'armure reste superposée
      } else {                                       // ARMOR / POWERARMOR
        if(other.type === 'OUTFIT' && !isHead) other.equipped = false;  // pas d'armure sur une tenue
        else if(zone && oZone === zone) other.equipped = false;         // 1 pièce / emplacement
      }
    });
    it.equipped = true;
    label = '🛡 Équipe ' + it.name;
  } else {
    it.equipped = true;
    label = '📤 Sort ' + it.name;
  }
  try { await db.collection('joueurs').doc(joueurId).update({ inventory: inv }); } catch(e){ console.error(e); }
  return label;
}

// Take Chem : décrémente la quantité du chem d'inventaire i → écrit la fiche. Renvoie un libellé d'action.
async function consumeChem(i){
  const inv = joueurData?.inventory; if(!inv || !inv[i]) return '';
  const it = inv[i];
  const name = it.name;
  it.qty = Math.max(0, (it.qty ?? 1) - 1);
  try { await db.collection('joueurs').doc(joueurId).update({ inventory: inv }); } catch(e){ console.error(e); }
  return '💊 Prend ' + name;
}

// Le joueur signale la fin de son tour (après avoir attaqué) → verrouille ses actions
async function finMonTour(){
  turnEnded = true;
  // Réinitialiser l'affichage de la box d'attaque (pas d'historique des derniers jets)
  ['j-dice-result','j-cd-result'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML='—'; });
  ['j-attack-result','j-miss-fortune','j-aim-reroll','j-convert-ap','j-bonus-dmg'].forEach(id => { const e=document.getElementById(id); if(e){ e.innerHTML=''; e.style.display='none'; } });
  lastRollDice = [];
  renderActionsDeclarees();
  renderDiceAccess();
  if(db && combatId){
    try { await db.collection(COMBATS_COLL).doc(combatId).update({ ['actionsDeclarees.' + joueurId + '.turnDone']: Date.now() }); } catch(e){}
  }
}

async function dismissRefused(category){
  if(!db) return;
  const upd = {};
  upd['actionsDeclarees.' + joueurId + '.' + category + '.pending'] = null;
  try {
    await db.collection(COMBATS_COLL).doc(combatId).update(upd);
  } catch(e){ console.error(e); }
}

// ---- ACCÈS AUX DÉS (conditionné par validation de l'attaque) ----
function renderDiceAccess(){
  const attackReady = canAttackNow();          // attaque validée par le MJ, pas encore résolue
  const lockEl  = document.getElementById('j-dice-lock');
  const cibleEl = document.getElementById('j-cible-wrap');
  const panel   = document.getElementById('j-dice-panel');

  // Le bloc d'attaque n'apparaît que si une attaque est déclarée / en cours :
  //   pending Attack (en attente MJ) · attaque validée à résoudre · attaque déjà résolue ce tour (résultat affiché)
  const attackPending = actionState?.majeure?.pending?.type === 'Attack';
  const showPanel = !turnEnded && (attackPending || attackReady || attacksDone > 0);
  if(panel) panel.style.display = showPanel ? '' : 'none';

  if(lockEl) lockEl.style.display = attackReady ? 'none' : 'flex';

  // Boutons de lancer : actifs seulement s'il reste une attaque à résoudre
  const lockDice = !attackReady;
  const lance = document.getElementById('j-lance-btn'); if(lance) lance.disabled = lockDice || (twoD20Done === attacksDone);  // un seul 2D20 par attaque
  const cdBtn = document.querySelector('.cd-btn');
  if(cdBtn) cdBtn.disabled = lockDice;

  // Pas d'attaque à résoudre → masquer le sélecteur de cible (on garde le dernier résultat affiché)
  if(!attackReady){
    if(cibleEl){ cibleEl.style.display='none'; cibleEl.innerHTML=''; }
    return;
  }

  // Sélecteur de cible
  if(!cibleEl) return;
  cibleEl.style.display = 'block';
  const ennemis = (combatState?.ennemis || []).filter(e => e.pvCur > 0);
  if(!ennemis.length){
    cibleEl.innerHTML = '<span style="font-size:7px;color:var(--td)">Aucun ennemi vivant</span>';
    cibleAttaque = '';
    return;
  }
  // Déjà visé (Attack/Aim) → on ne redemande pas la cible
  if(myAim && myAim.cible && ennemis.some(e => e.nom === myAim.cible)){
    cibleAttaque = myAim.cible;
    cibleEl.innerHTML = '<div style="font-size:7px;color:var(--td)">🎯 Cible visée : '
      + '<b style="color:var(--rd)">' + myAim.cible + '</b>'
      + (myAim.zone ? ' <span style="color:var(--am)">— ' + myAim.zone + '</span>' : ' <span style="color:var(--td)">(zone au hasard)</span>')
      + '</div>';
    return;
  }
  const prevVal = document.getElementById('j-cible-sel')?.value || '';
  cibleEl.innerHTML = '<div style="display:flex;align-items:center;gap:5px">'
    + '<span style="font-size:7px;color:var(--td)">Cible :</span>'
    + '<select id="j-cible-sel" style="flex:1;background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:7px;padding:2px 4px;outline:none">'
    + ennemis.map(e => '<option value="'+e.nom+'"'+(e.nom===prevVal?' selected':'')+'>'+e.nom+' ('+e.pvCur+'/'+e.pvMax+' PV)</option>').join('')
    + '</select></div>';
  const sel = document.getElementById('j-cible-sel');
  if(sel){
    cibleAttaque = sel.value;
    sel.onchange = () => { cibleAttaque = sel.value; };
  }
}

function jLancerCD(){
  if(!canAttackNow()) return;      // anti-spam : pas d'attaque en attente de résolution
  attacksDone++;                   // l'attaque est résolue (réactive les dés s'il reste une attaque validée)
  renderDiceAccess();              // verrouille immédiatement si plus d'attaque dispo
  const nb = nbDCActuel || 2;
  const vals = Array.from({length:nb},()=>FACES_CD[Math.floor(Math.random()*6)]);
  const dmgRaw = vals.reduce((a,v)=>a+(parseInt(v)||0),0);
  const ef = vals.filter(v=>v.includes('⚡')).length;
  // Zone touchée : visée si déclarée, sinon tirée au hasard (l'attaque a réussi puisqu'on lance les dégâts)
  const zone = (myAim && myAim.zone) ? myAim.zone : randomZone();
  const zoneAimee = !!(myAim && myAim.zone);

  // Résultat brut des dés
  document.getElementById('j-cd-result').innerHTML =
    vals.map(v=>'<span style="color:'+(v.includes('⚡')?'var(--am)':v==='—'?'var(--td)':'var(--tb)')+';font-size:14px;font-family:Oswald,sans-serif">'+v+'</span>').join(' ')
    +' <b style="color:var(--am)">'+dmgRaw+'dmg</b>'+(ef?' <span style="color:var(--am)">+'+ef+'⚡</span>':'');

  // Calculer l'effet de dégâts (si ⚡)
  let dmgTotal = dmgRaw;
  let effetInfo = null;
  if(ef > 0){
    const parsed = parseEffet(currentArmeInfo?.eff || '');
    if(parsed){
      const res = DAMAGE_EFFECTS[parsed.name].calc(ef, dmgRaw, parsed.val);
      if(res.dmgBonus) dmgTotal += res.dmgBonus;
      effetInfo = { nom: currentArmeInfo.eff, note: res.note, rad: res.rad || 0 };
    }
  }

  // Résultat narratif
  const nom = joueurData?.nom || joueurId;
  const cible = cibleAttaque ? ' à <b style="color:var(--rd)">'+cibleAttaque+'</b>' : '';
  const zoneTxt = ' <span style="color:'+(zoneAimee?'var(--am)':'var(--td)')+'">['+zone+(zoneAimee?'':' au hasard')+']</span>';
  const arEl = document.getElementById('j-attack-result');
  if(arEl){
    arEl.style.display = 'block';
    let html = '<div style="font-size:9px;color:var(--tb);padding:4px 6px;border:1px solid var(--g);background:#060d06;margin-top:2px">'
      + '⚔ <b>'+nom+'</b> inflige <b style="color:var(--am)">'+dmgTotal+' dmg</b>'+(ef?' <span style="color:var(--am)">'+ef+'⚡</span>':'')
      + cible+zoneTxt+'</div>';
    if(effetInfo){
      html += '<div style="font-size:8px;padding:3px 6px;border:1px solid var(--am);border-top:none;background:#1a1200">'
        +'<span style="color:var(--am)">⚡ '+effetInfo.nom+' : </span>'
        +'<span style="color:var(--td)">'+effetInfo.note+'</span>'
        +(effetInfo.rad>0?' <span style="color:var(--rd)">+'+effetInfo.rad+' RAD</span>':'')
        +'</div>';
    }
    arEl.innerHTML = html;
  }

  // Envoyer au MJ pour son log
  if(db && combatId){
    db.collection(COMBATS_COLL).doc(combatId).update({
      attackResult: { joueur: joueurId, nom, cible: cibleAttaque, zone, zoneAimee,
        dmg: dmgTotal, ef,
        effetNom: effetInfo?.nom||'', effetNote: effetInfo?.note||'', rad: effetInfo?.rad||0,
        ts: Date.now() }
    }).catch(()=>{});
  }

  // L'attaque est faite : proposer « Terminer mon tour » (verrou déjà posé en tête)
  renderActionsDeclarees();
}
