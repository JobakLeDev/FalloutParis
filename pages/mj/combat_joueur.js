// firebaseConfig, COMBAT_DOC, FACES_CD, SK_ATTR, WEAPONS_DB définis dans common/shared.js et mj_shared.js

// ---- EFFETS DE DÉGÂTS (règle p.XX) ----
const DAMAGE_EFFECTS = {
  Burst:       { calc: (ef, dmg)    => ({ note: ef+' cible(s) supp. à portée Courte (+1 munition/cible)' }) },
  Breaking:    { calc: (ef, dmg)    => ({ note: 'Réduit la RD de '+ef+' (couverture ou localisation)' }) },
  Persistent:  { calc: (ef, dmg)    => ({ note: 'Subit '+dmg+' dmg/tour × '+ef+' tour(s) (action maj. pour arrêter)' }) },
  Piercing:    { calc: (ef, dmg, x) => ({ note: 'Ignore '+(ef*(x||1))+' RD (Perforant '+x+')' }) },
  Radioactive: { calc: (ef, dmg)    => ({ rad: ef, note: '+'+ef+' RAD après les dégâts' }) },
  Spread:      { calc: (ef, dmg)    => ({ dmgBonus: ef*Math.floor(dmg/2), note: ef+' touche(s) supp. × '+Math.floor(dmg/2)+' dmg (inclus, zone aléatoire)' }) },
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
// Tous les effets de dégâts d'une arme (séparés par des virgules) : "Spread,Vicious" → [{Spread},{Vicious}]
function parseEffets(eff){
  if(!eff || eff === '—' || !eff.trim()) return [];
  return eff.split(',').map(s => {
    const parts = s.trim().split(/\s+/);
    const name = parts[0];
    const val  = parts[1] ? parseInt(parts[1]) : 1;
    return DAMAGE_EFFECTS[name] ? { name, val } : null;
  }).filter(Boolean);
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
let _campaignMinJ = null;   // minutes de campagne du joueur (pour la Fatigue de survie)
let lastSkKeyJ = '';
let useStackedDeck = false;
let currentArmeInfo = null;  // {nom, skKey, persoBonus, dmg}
let lastRollDice = [];       // [{val, rerolled}]
let lastRollTN = 0;
let lastRollDiff = 1;         // difficulté du dernier jet d'attaque (1 + pénalité de portée) — pour recalculer après relance
let aimRerolled = false;      // true si le re-roll Aim a déjà été utilisé ce lancer
let sabotsRerolledLocal = false; // garde locale : Gros Sabots déjà utilisés ce combat (source de vérité = combatState.sabotsUsed)
let cibleAttaque = '';        // nom de l'ennemi ciblé (sélecteur)
const AIM_ZONES = ['', 'Tête', 'Torse', 'Bras G.', 'Bras D.', 'Jambe G.', 'Jambe D.'];  // '' = zone non ciblée
let lastAttackResultTs = 0;   // dédup notification résultat attaque
let lastFxTs = 0;             // dédup traceur/clignotement (fxAttack)
let _fxSeeded = false;        // au 1er snapshot : on adopte les ts existants sans rejouer (évite le son/flash au rechargement)
let _diceDismissed = false;  // popup « Mes jets » fermé manuellement (bouton OK)
let _lastSeenValidated = 0;  // nb d'attaques validées déjà vues (pour ré-ouvrir le popup à chaque nouvelle attaque)
// Ferme le popup de jets d'attaque (bouton OK) jusqu'à la prochaine attaque validée
function closeDicePopupJ(){
  _diceDismissed = true;
  const panel = document.getElementById('j-dice-panel'); if(panel) panel.style.display = 'none';
}
let _finSfxDone = false;      // sons de fin de combat (XP / niveau) joués une seule fois

// Joue un son de SFX (respecte le mute global, contourne le blocage autoplay au 1er geste)
function _combatSfx(file, delay){
  try{ if(localStorage.getItem('fp_sfxMuted') === '1') return; }catch(e){}
  setTimeout(() => {
    try{
      const a = new Audio('../../audio/sfx/' + file); a.volume = 0.6;
      a.play().catch(() => {
        const g = () => { a.play().catch(()=>{}); document.removeEventListener('pointerdown',g); document.removeEventListener('keydown',g); };
        document.addEventListener('pointerdown', g); document.addEventListener('keydown', g);
      });
    }catch(e){}
  }, delay || 0);
}
let actionState = null;       // extrait de combatState.actionsDeclarees[joueurId]
let selectedActionDraft = null; // {category, type, desc} — action en cours de saisie
let myAim = null;            // {cible, zone} — visée déclarée ce tour (Attack/Aim) ; zone '' = non visée
let attacksDone = 0;         // nb d'attaques (CD) résolues ce tour
let twoD20Done = -1;         // index d'attaque pour lequel le 2D20 a déjà été lancé (anti-relance)
let lastAttackMissed = false;// le dernier 2D20 d'attaque est un échec → pas de jet de dégâts
// Nb d'attaques validées par le MJ (chaque action majeure Attack consommée)
function attacksValidated(){ return (actionState?.majeure?.used || []).filter(t => t === 'Attack').length; }
// Une attaque validée reste-t-elle à résoudre (jet) ?
function canAttackNow(){ return attacksValidated() > attacksDone; }
let turnEnded = false;       // a cliqué « Terminer mon tour »
let actionsExecuted = {};    // {type: nb} — actions à effet déjà exécutées ce tour

// --- Ciblage par ID d'ennemi (les noms peuvent être en double : 3× Radroach…) ---
function cibleNom(id){ const e = (combatState?.ennemis||[]).find(x => String(x.id) === String(id)); return e ? e.nom : ''; }
function enemyOptions(list, selectedId){
  const counts = {}; list.forEach(e => counts[e.nom] = (counts[e.nom]||0) + 1);
  const seen = {};
  return list.map(e => {
    seen[e.nom] = (seen[e.nom]||0) + 1;
    const suf = counts[e.nom] > 1 ? ' #' + seen[e.nom] : '';
    return '<option value="' + e.id + '"' + (String(e.id) === String(selectedId) ? ' selected' : '') + '>' + e.nom + suf + ' (' + e.pvCur + '/' + e.pvMax + ' PV)</option>';
  }).join('');
}
let _turnKey = '';           // clé round:tourActif pour réinitialiser au changement de tour
let _declWeaps = [];         // armes proposées dans la déclaration d'attaque (index → params)
// Armes d'attaque du joueur (équipées) + mains nues, avec TN/DC calculés
function attackWeapons(){
  const d = joueurData; if(!d) return [];
  const list = (d.inventory||[]).filter(it => it.equipped && it.type==='WEAPON').map(inv => {
    const db2 = fpApplyWeaponMods(WEAPONS_DB[inv.name] || {}, inv.mods);   // mods d'arme
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

  // Horloge de campagne (pour calculer la Fatigue de survie)
  db.collection('temps').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    if(typeof partyMinutesFor === 'function') _campaignMinJ = partyMinutesFor(d, joueurId);
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
    // 1er snapshot : adopter les ts déjà présents dans le doc sans rejouer les effets (sinon son/flash au rechargement)
    if(!_fxSeeded){ _fxSeeded = true; lastFxTs = data.fxAttack?.ts || 0; lastAttackResultTs = Math.max(lastAttackResultTs, data.attackResult?.ts || 0); }
    if(!data.actif){
      // Combat terminé (pas "en attente") — afficher l'écran de fin
      combatState = data;
      hide('attente'); hide('combat-actif');
      renderCombatTermine(data);
      show('combat-termine');
      return;
    }
    combatState = data;
    // Gros Sabots : si le doc indique « non utilisé » (ex. nouvelle initiative), libérer la garde locale
    if(!(combatState.sabotsUsed && combatState.sabotsUsed[joueurId])) sabotsRerolledLocal = false;
    _finSfxDone = false;   // un nouveau combat actif → rejouer les sons à la prochaine fin
    actionState = combatState?.actionsDeclarees?.[joueurId] || null;
    hide('attente'); show('combat-actif'); hide('combat-termine');
    renderCombatJoueur();
    // Effet visuel d'attaque : traceur attaquant → cible (+ clignotement de la cible touchée)
    if(data.fxAttack && data.fxAttack.ts > lastFxTs){
      lastFxTs = data.fxAttack.ts;
      const f = data.fxAttack;
      if(f.stranger) _combatSfx('mysterious_stranger_sfx.mp3', 0);   // l'Étranger Mystérieux frappe
      setTimeout(() => {
        fpFireTracer('#j-combat-map .cmap', combatState?.grid, 30, f.fromTok, f.toTok, !f.hit);
        if(f.hit) fpFlashToken('#j-combat-map .cmap', combatState?.grid, 30, f.toTok);
      }, 60);
    }
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

  // Sons de fin de combat : XP gagnée et/ou montée de niveau (joués une seule fois)
  if(!_finSfxDone){
    _finSfxDone = true;
    const curXp = joueurData?.xp || 0, curLvl = joueurData?.niveau || 1;
    let simLvl = curLvl, simXp = curXp + xpTotal;
    while(simLvl < 20 && simXp >= (XP_TABLE[Math.min(simLvl, 20)] || 21000)) simLvl++;
    const leveledUp = simLvl > curLvl;
    if(xpTotal > 0) _combatSfx('xp_up_sfx.mp3', 300);
    if(leveledUp)   _combatSfx('lvl_up_sfx.mp3', xpTotal > 0 ? 1100 : 300);
  }
}

function renderCombatJoueur(){
  if(!combatState) return;
  // Réinitialiser visée / attaque / fin de tour quand le tour change
  const tk = (combatState.numRound||0) + ':' + (combatState.tourActif||0);
  if(tk !== _turnKey){
    _turnKey = tk; myAim = null; turnEnded = false; attacksDone = 0; twoD20Done = -1; lastAttackMissed = false;
    _diceDismissed = false; _lastSeenValidated = 0;   // popup de jets : réinitialisé au changement de tour
    currentArmeInfo = null; armeSelectionnee = null; lastRollDice = [];
    actionsExecuted = {};   // actions à effet déjà exécutées ce tour
    const dc = document.getElementById('mes-des-context'); if(dc) dc.textContent = 'Déclare une attaque pour viser';
    ['j-dice-result','j-cd-result'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML='—'; });
    ['j-attack-result','j-miss-fortune','j-aim-reroll','j-sabots-reroll','j-convert-ap','j-bonus-dmg'].forEach(id => { const e=document.getElementById(id); if(e){ e.innerHTML=''; e.style.display='none'; } });
  }
  document.getElementById('j-round').textContent = combatState.numRound||1;
  document.getElementById('hdr-round').textContent = 'Round ' + (combatState.numRound||1);
  renderMaCarte();
  renderActionsJoueur();
  renderActionsDeclarees();
  renderDiceAccess();
  renderActionExec();
  refreshDesContext();
  renderAPPoolJoueur();
  renderLuckJoueur();
  renderCoequipiers();
  renderTrackerJoueur();
  renderEnnemisJoueur();
  renderJMap();
}

// ============================================================
// MINI-CARTE DE COMBAT (vue joueur) — lecture + déplacement pendant Move/Sprint
// ============================================================
let _jMoveActive = null, _jMoveRange = 0;   // type d'action de déplacement en cours + portée (cases)
function _jMapToks(){
  const list = [];
  (combatState?.ordreInitiative||[]).filter(o=>o.type==='joueur').forEach(o=>list.push({ id:o.id, nom:(tousJoueurs[o.id]?.nom||o.nom||o.id), kind:'joueur', me:o.id===joueurId }));
  (combatState?.allies||[]).forEach(a=>list.push({ id:'A'+a.id, nom:a.nom, kind:'allie' }));
  (combatState?.ennemis||[]).filter(e=>!e.hidden && enemyVisible(e)).forEach(e=>list.push({ id:'E'+e.id, nom:e.nom, kind:'ennemi', dead:(e.pvCur||0)<=0 }));
  return list;
}
function renderJMap(){
  const pnl = document.getElementById('j-map-pnl'); const el = document.getElementById('j-combat-map');
  const grid = combatState?.grid;
  if(!pnl || !el) return;
  if(!grid || !grid.w){ pnl.style.display='none'; return; }
  pnl.style.display='';
  const hint = document.getElementById('j-map-hint');
  if(hint) hint.textContent = _jMoveActive ? `— déplace-toi : clique une case verte (≤ ${_jMoveRange} cases)` : '';
  const { w, h } = grid;
  const toks = _jMapToks();
  const byPos = {}; Object.keys(grid.pos||{}).forEach(id => { const p=grid.pos[id]; byPos[p.x+','+p.y]=id; });
  const myPos = grid.pos?.[joueurId];
  const _act = combatState?.ordreInitiative?.[combatState.tourActif];
  const activeTok = !_act ? null : (_act.type==='joueur' ? _act.id : _act.type==='ennemi' ? ('E'+_act.eid) : _act.type==='allie' ? ('A'+_act.aid) : null);
  // Cases atteignables (parcours qui contourne murs/fenêtres) quand on se déplace
  const reach = (_jMoveActive && myPos) ? reachableCells(grid, myPos, _jMoveRange) : null;
  const moving = !!reach;   // mode déplacement : on masque le quadrillage, on affiche bords de zone + points d'accroche
  const nbReach = (x,y) => reach && reach[x+','+y]!=null;
  let html = `<div class="cmap${moving?' moving':''}" style="grid-template-columns:repeat(${w},var(--cs,22px))">`;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const key=x+','+y; const tid=byPos[key]; const t=tid?toks.find(z=>z.id===tid):null;
    const terr = gridTerrainAt(grid, x, y);
    const bt = (typeof BLOCK_TYPES!=='undefined') ? BLOCK_TYPES.find(b=>b.id===terr) : null;
    let cls='cmap-cell';
    if(terr) cls+=' b-'+terr;
    let onclick='', style='';
    if(reach && reach[key]!=null){
      cls+=' reach-snap'; onclick=`moveJSelf(${x},${y})`;
      // bord de la zone atteignable : on borde seulement les côtés donnant sur une case NON atteignable
      if(!nbReach(x,y-1)) style+='border-top:2px solid var(--g);';
      if(!nbReach(x+1,y)) style+='border-right:2px solid var(--g);';
      if(!nbReach(x,y+1)) style+='border-bottom:2px solid var(--g);';
      if(!nbReach(x-1,y)) style+='border-left:2px solid var(--g);';
    }
    let inner;
    if(t){
      const glow = (t.id===activeTok && !t.dead) ? ' turn-glow' : '';
      const rot = (grid.rot && grid.rot[t.id]) || 0;
      const rotStyle = rot ? ' style="transform:rotate('+rot+'deg)"' : '';
      if(t.kind==='ennemi') inner = fpEnemyTokenHtml(t.nom, { dead:t.dead, glow:(t.id===activeTok && !t.dead), rot });
      else inner = '<span class="ctok '+(t.kind==='joueur'?'ctok-j':'ctok-a')+(t.dead?' dead':'')+glow+(t.me?' me-ring':'')+'"'+rotStyle+'>'+((t.nom||'?').charAt(0).toUpperCase())+'</span>';
    } else inner = (bt?bt.icon:'');
    if(reach && reach[key]!=null && !t) inner += '<span class="snap-dot"></span>';   // point d'accroche souris
    const eAttr = (t && t.kind==='ennemi') ? ` data-eid="${t.id.slice(1)}"` : '';
    html += `<div class="${cls}"${style?` style="${style}"`:''}${onclick?` onclick="${onclick}"`:''}${eAttr} title="${t?t.nom:(bt?bt.label:'')}">${inner}</div>`;
  }
  html += '<div class="cmap-edges">' + (typeof gridEdgesHtml==='function' ? gridEdgesHtml(grid, 30) : '') + '</div>';
  // Portes adjacentes à mon jeton → cliquables (déclare une action mineure) — seulement à mon tour
  const _isMoTour = _act?.type==='joueur' && _act.id===joueurId;
  if(myPos && _isMoTour && !turnEnded && typeof gridDoorHotspots==='function')
    html += '<div class="cmap-edges">' + gridDoorHotspots(grid, myPos, 30, 'openDoorJ') + '</div>';
  // Ligne de visée pendant l'attaque : pointillés tant qu'on n'a pas touché, plein dès le succès au 2D20
  const aimTgt = (myAim && myAim.cible) ? myAim.cible : cibleAttaque;
  if(myPos && _isMoTour && !turnEnded && aimTgt && typeof canAttackNow==='function' && canAttackNow()){
    const tp = grid.pos['E'+aimTgt];
    if(tp){
      const solid = (twoD20Done===attacksDone) && !lastAttackMissed && lastRollDice.length>0;
      const pad=5, cs=30, pitch=cs+1;
      const cx=p=>pad+p.x*pitch+cs/2, cy=p=>pad+p.y*pitch+cs/2;
      const x1=cx(myPos), y1=cy(myPos), x2=cx(tp), y2=cy(tp);
      const len=Math.hypot(x2-x1,y2-y1), ang=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
      html += '<div class="cmap-aimline'+(solid?' solid':'')+'" style="left:'+x1+'px;top:'+y1+'px;width:'+len+'px;transform:rotate('+ang+'deg)"></div>';
    }
  }
  html += '</div>';
  el.innerHTML = html;
}
// Ouvrir / fermer une porte adjacente : le joueur DÉCLARE une action mineure (Interact) → le MJ valide → la porte pivote.
async function openDoorJ(key){
  const grid = combatState?.grid; if(!grid || !db) return;
  const cur = (grid.edges||{})[key];
  if(cur !== 'door' && cur !== 'doorOpen') return;
  const hint = document.getElementById('j-map-hint');
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  if(!isMoTour || turnEnded){ if(hint) hint.textContent = '— ce n\'est pas ton tour'; return; }
  const pend = actionState?.mineure?.pending;
  if(pend && pend.status === 'waiting'){ if(hint) hint.textContent = '— action mineure déjà en attente du MJ'; return; }
  const verb = cur === 'door' ? 'Ouvrir' : 'Fermer';
  const upd = {};
  upd['actionsDeclarees.'+joueurId+'.mineure.pending'] =
    { type:'Interact', details:'🚪 '+verb+' la porte', doorKey:key, requestedAt:Date.now(), status:'waiting' };
  try {
    await db.collection(COMBATS_COLL).doc(combatId).update(upd);
    if(hint) hint.textContent = '— demande envoyée au MJ : '+verb+' la porte';
  } catch(e){ console.error(e); }
}
// Ennemi visible depuis ma position (ligne de vue non coupée par un mur) — vrai si pas de grille/position
function enemyVisible(e){
  const g = combatState?.grid; if(!g || !g.pos) return true;
  const ep = g.pos['E'+e.id], mp = g.pos[joueurId];
  if(!ep || !mp || typeof gridLineOfSight!=='function') return true;
  return gridLineOfSight(g, mp, ep);
}
// Bande de distance d'un ennemi calculée depuis la grille (jeton ennemi ↔ mon jeton)
function enemyGridBand(e){
  const g = combatState?.grid; if(!g || !g.pos) return null;
  const ep = g.pos['E'+e.id], mp = g.pos[joueurId];
  if(!ep || !mp) return null;
  return gridBand(gridChebyshev(ep, mp));
}
function startJMove(type, range){ _jMoveActive = type; _jMoveRange = range; renderJMap();
  const pnl=document.getElementById('j-map-pnl'); if(pnl) pnl.scrollIntoView({behavior:'smooth',block:'nearest'}); }
async function moveJSelf(x,y){
  if(!_jMoveActive || !combatState?.grid || !db) return;
  const type = _jMoveActive; _jMoveActive = null; _jMoveRange = 0;
  combatState.grid.pos = combatState.grid.pos || {};
  combatState.grid.pos[joueurId] = { x, y };
  try { await db.collection(COMBATS_COLL).doc(combatId).update({ ['grid.pos.'+joueurId]: { x, y } }); } catch(e){ console.error(e); }
  renderJMap();
  if(typeof _finishExec==='function') _finishExec(type, 'se déplace en ('+x+','+y+')');
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
  document.getElementById('j-tn-val').textContent = tn;
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
  const echec = succes < lastRollDiff;
  const succesBonus = Math.max(0, succes-lastRollDiff);
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
  // Si la relance Aim transforme l'échec en réussite, déverrouiller le jet de dégâts (comme Miss Fortune)
  lastAttackMissed = echec;
  const arEl0 = document.getElementById('j-attack-result');
  if(!echec && arEl0){ arEl0.style.display='none'; arEl0.innerHTML=''; }
  renderAimReroll();
  renderMissFortune();
  renderSabotsReroll();
  renderDiceAccess();
  if(typeof renderJMap==='function') renderJMap();
}

// ---- GROS SABOTS ----
// Si Gros Sabots équipés ET dernier en initiative : relance 1 dé, une seule fois par combat.
function hasGrosSabotsEquipped(){
  return (joueurData?.inventory||[]).some(it => it && it.equipped && /gros\s*sabots/i.test(it.name||''));
}
function isLastInInitiative(){
  const ordre = combatState?.ordreInitiative||[];
  return ordre.length>0 && ordre[ordre.length-1]?.id === joueurId;
}
function sabotsUsedThisCombat(){
  return sabotsRerolledLocal || !!(combatState?.sabotsUsed && combatState.sabotsUsed[joueurId]);
}
function renderSabotsReroll(){
  const el = document.getElementById('j-sabots-reroll'); if(!el) return;
  if(!hasGrosSabotsEquipped() || !isLastInInitiative() || lastRollDice.length === 0){ el.style.display='none'; el.innerHTML=''; return; }
  if(sabotsUsedThisCombat()){
    el.style.display='block';
    el.innerHTML='<span style="font-size:7px;color:var(--gd)">🥾 Gros Sabots utilisés</span>';
    return;
  }
  let html = '<span style="font-size:7px;color:var(--am)">🥾 Gros Sabots — relancer 1 dé (1×/combat) : </span>';
  lastRollDice.forEach((die, i) => {
    const col = die.val <= lastRollTN ? 'var(--g)' : 'var(--rd)';
    html += '<button class="mf-die-btn" style="color:' + col + '" onclick="sabotsRelancerDe(' + i + ')">' + die.val + ' ↺</button>';
  });
  el.style.display='block'; el.innerHTML=html;
}
async function sabotsRelancerDe(idx){
  if(sabotsUsedThisCombat() || !lastRollDice[idx]) return;
  sabotsRerolledLocal = true;
  if(db && combatId){ db.collection(COMBATS_COLL).doc(combatId).update({ ['sabotsUsed.'+joueurId]: true }).catch(()=>{}); }
  lastRollDice[idx] = { val: Math.floor(Math.random()*20)+1, rerolled: false };

  const vals = lastRollDice.map(d => d.val);
  const tn = lastRollTN;
  let succes = vals.filter(v=>v<=tn).length + vals.filter(v=>v===1).length;
  const crits = vals.filter(v=>v===1).length;
  const echec = succes < lastRollDiff;
  const succesBonus = Math.max(0, succes-lastRollDiff);
  const dcTotal = echec ? 0 : nbDCActuel + succesBonus;
  if(!echec) { nbDCActuel = dcTotal; const _d=document.getElementById('j-nb-cd-disp'); if(_d) _d.textContent = dcTotal; }

  const col = succes===0?'var(--rd)':succes>1?'var(--g)':'var(--am)';
  let r = lastRollDice.map((d, i) => {
    const c = d.val<=tn?'var(--g)':'var(--rd)';
    const marker = i===idx ? '🥾' : (d.rerolled ? '↺' : '');
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
  lastAttackMissed = echec;
  const arEl0 = document.getElementById('j-attack-result');
  if(!echec && arEl0){ arEl0.style.display='none'; arEl0.innerHTML=''; }
  renderAimReroll();
  renderMissFortune();
  renderSabotsReroll();
  renderDiceAccess();
  if(typeof renderJMap==='function') renderJMap();
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
  const echec = succes<lastRollDiff;
  const dcTotal = echec?0:nbDCActuel+Math.max(0,succes-lastRollDiff);
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
  // Met à jour l'état de ratage : si la relance fait réussir, on débloque le jet de dégâts
  lastAttackMissed = echec;
  const arEl = document.getElementById('j-attack-result');
  if(!echec && arEl){ arEl.style.display='none'; arEl.innerHTML=''; }
  renderMissFortune();
  renderDiceAccess();
  if(typeof renderJMap==='function') renderJMap();
}
// Confirmer le ratage (échec définitif) : résout l'attaque sans dégâts
function resolveMissJ(){
  if(!lastAttackMissed) return;
  attacksDone++;
  lastAttackMissed = false;
  if(db && combatId){
    const _ts = Date.now();
    db.collection(COMBATS_COLL).doc(combatId).update({
      attackResult: { joueur: joueurId, nom: (joueurData?.nom||joueurId), cible: cibleNom(cibleAttaque), cibleId: cibleAttaque, miss: true, dmg: 0, ts: _ts },
      fxAttack: { fromTok: joueurId, toTok: 'E'+cibleAttaque, hit: false, ts: _ts }
    }).catch(()=>{});
  }
  const mf=document.getElementById('j-miss-fortune'); if(mf){ mf.style.display='none'; mf.innerHTML=''; }
  const arEl=document.getElementById('j-attack-result');
  if(arEl){ arEl.style.display='block'; arEl.innerHTML='<div class="miss-box" style="font-size:9px;color:var(--rd);padding:4px 6px;border:1px solid var(--rd);background:var(--rdk)">✗ Attaque ratée — aucun dégât</div>'; }
  renderDiceAccess();
  if(typeof renderJMap==='function') renderJMap();
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
  // Fatigue (survie) : les AP gagnés sont réduits de 'fatigue' (RAW p.190)
  const fat = survieFatigueJ();
  const gain = Math.max(0, lastExcessJ - fat);
  const toAdd = Math.min(gain, 6-pool);
  lastExcessJ=0;
  const el=document.getElementById('j-convert-ap'); if(el) el.style.display='none';
  if(toAdd<=0) return;
  await _updateAPGroupe(toAdd);
}
// Fatigue actuelle du joueur (depuis sa survie + l'horloge de campagne)
function survieFatigueJ(){
  if(typeof SURVIE === 'undefined' || _campaignMinJ == null || !joueurData) return 0;
  return SURVIE.compute(joueurData.survie, _campaignMinJ).fatigue;
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
  if(combatState?.assistDie?.[joueurId]) html += '<div style="font-size:8px;color:var(--g);border-left:3px solid var(--g);padding:1px 0 1px 6px;margin-bottom:5px">🤝 +1 dé d\'assistance sur ton prochain jet</div>';

  html += '<div class="jc-top"><span class="jc-name">' + (d.nom||joueurId).toUpperCase() + '</span></div>';
  html += '<div class="jc-bar"><div style="width:'+pct+'%;height:100%;background:'+barColor+'"></div></div>';
  html += '<div class="jc-row">';
  html += '<div class="jc-stat"><span class="jc-sl">PV</span><span class="jc-sv'+(pct<30?' danger':pct<60?' warn':'')+'">'+d.hp+'/'+hpMax+'</span></div>';
  html += '<div class="jc-stat"><span class="jc-sl">RAD</span><span class="jc-sv'+(d.rad>0?' warn':'')+'">'+d.rad+'</span></div>';
  html += '</div>';

  // Armes
  html += '<div style="margin-top:6px">';
  weaps.forEach(inv => {
    const db2 = fpApplyWeaponMods(WEAPONS_DB[inv.name]||{}, inv.mods);   // mods d'arme
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

  // Étranger Mystérieux (perk) : à mon tour, une seule fois par combat (n'importe quel tour) — dépenser 1 Chance
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  const hasStranger = (joueurData?.perks?.['Mysterious Stranger'] || 0) > 0;
  const strangerUsed = !!combatState?.strangerUsed?.[joueurId];
  if(isMoTour && !turnEnded && hasStranger && !strangerUsed){
    const luck = joueurData?.luck_points || 0;
    el.innerHTML += '<button class="mj-stranger-btn"' + (luck < 1 ? ' disabled' : '') + ' onclick="callStrangerJ()" '
      + 'title="Une fois par combat : dépenser 1 Chance, l\'Étranger Mystérieux peut intervenir">🕴 Étranger Mystérieux (−1 🍀)</button>';
  }
}
// Appel de l'Étranger Mystérieux : dépense 1 Chance, envoie la requête au MJ (qui résout l'apparition)
async function callStrangerJ(){
  if(!db || !combatState) return;
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  if(!isMoTour) return;
  if((joueurData?.perks?.['Mysterious Stranger'] || 0) < 1) return;
  if(combatState?.strangerUsed?.[joueurId]) return;
  const luck = joueurData?.luck_points || 0; if(luck < 1) return;
  await db.collection('joueurs').doc(joueurId).update({ luck_points: luck - 1, lastUpdate: Date.now() });
  const upd = {};
  upd['strangerUsed.' + joueurId] = true;
  upd['strangerReq'] = { joueur: joueurId, nom: (joueurData?.nom || joueurId).toUpperCase(), ts: Date.now() };
  try { await db.collection(COMBATS_COLL).doc(combatId).update(upd); } catch(e){ console.error(e); }
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
    const eAttr = (c.type==='ennemi' && c.eid!=null) ? ' data-eid="'+c.eid+'"' : '';
    return '<div class="tracker-item'+(isActif?' actif':'')+(c.type==='ennemi'?' ennemi':'')+(isMe?' c-est-moi':'')+'"'+eAttr+'>'
      +'<div class="tracker-top">'
      +'<span class="tracker-nom">'+(isActif?'▶ ':'')+c.nom+(isMe?' ◀':'')+' </span>'
      +'<span class="tracker-init">'+c.init+'</span>'
      +'</div></div>';
  }).join('');
}

// ---- INFO ENNEMI AU SURVOL (jeton grille / ligne d'initiative) ----
let _jEnTip;
function _enemyById(id){ return (combatState?.ennemis||[]).find(e => String(e.id) === String(id)); }
function enemyTipText(e){
  if(!e) return '';
  const band = (enemyGridBand(e) ?? e.dist ?? 1);
  return '☠ '+e.nom+' — PV '+e.pvCur+'/'+e.pvMax+' · ATQ '+e.atq+' DC · RD '+e.rd+' · '+(RANGE_LABELS[band]||'');
}
function _jEnTipShow(elT){
  const e = _enemyById(elT.getAttribute('data-eid')); if(!e) return;
  if(!_jEnTip){ _jEnTip = document.createElement('div'); _jEnTip.id = 'j-en-tip'; document.body.appendChild(_jEnTip); }
  _jEnTip.textContent = enemyTipText(e);
  const z = window.__fpZoom || 1; const r = elT.getBoundingClientRect();
  _jEnTip.style.display = 'block';
  _jEnTip.style.left = (r.left / z) + 'px';
  _jEnTip.style.top  = (r.bottom / z + 3) + 'px';
}
function _jEnTipHide(){ if(_jEnTip) _jEnTip.style.display = 'none'; }
document.addEventListener('mouseover', e => { const t = e.target.closest?.('[data-eid]'); if(t) _jEnTipShow(t); });
document.addEventListener('mouseout',  e => { if(e.target.closest?.('[data-eid]')) _jEnTipHide(); });

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
      +'<div class="jc-stat"><span class="jc-sl">📏</span><span class="jc-sv" style="color:var(--am)">'+(RANGE_LABELS[(enemyGridBand(e)??e.dist??1)]||'Moy.')+'</span></div>'
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
  const tn = document.getElementById('j-tn-val')?.textContent || '?';
  const ammoHtml = qty !== null
    ? ' · <span style="color:'+(qty>0?'var(--am)':'var(--rd)')+'">🔫 '+qty+' '+ammoType+'</span>'
    : '';
  const el = document.getElementById('mes-des-context');
  if(el) el.innerHTML = '<b style="color:var(--tb)">'+nomAff+'</b> · '+dmg+' · TN <b style="color:var(--am)">'+tn+'</b>'+ammoHtml;
}

function selArme(nom, tn, dmg, persoBonus=false){
  armeSelectionnee = nom;
  nbDCActuel = parseInt(dmg)||2;
  // Mods de l'arme équipée (effet/munition modifiés par les mods)
  const invItem = nom==='__unarmed__' ? null
    : (joueurData?.inventory||[]).find(x=>x.name===nom && x.type==='WEAPON');
  const wdb = nom==='__unarmed__' ? {} : fpApplyWeaponMods(WEAPONS_DB[nom]||{}, invItem?.mods);
  lastSkKeyJ = nom==='__unarmed__' ? 'barehand' : (wdb.sk||'');
  const ammoType = nom==='__unarmed__' ? '' : (wdb.a||'');
  const rng = nom==='__unarmed__' ? '—' : (wdb.rng||'—');   // portée idéale (C/M/L/—)
  currentArmeInfo = {nom, skKey:lastSkKeyJ, persoBonus, dmg, eff: nom==='__unarmed__' ? '' : (wdb.eff||''), ammoType, rng};
  useStackedDeck = false;
  const btn=document.getElementById('j-stacked-deck-btn'); if(btn) btn.classList.remove('on');
  const tnEl=document.getElementById('j-tn-val'); if(tnEl) tnEl.textContent = tn;
  renderMaCarte();
  refreshDesContext();
  const disp=document.getElementById('j-nb-cd-disp'); if(disp) disp.textContent = nbDCActuel;
  lastRollDice=[];
  const mf=document.getElementById('j-miss-fortune'); if(mf) mf.style.display='none';
}

async function jLancer2D20(){
  if(!canAttackNow() || twoD20Done === attacksDone) return;   // anti-spam : un seul toucher par attaque
  aimRerolled = false;
  const tn = parseInt(document.getElementById('j-tn-val').textContent)||10;
  // Difficulté de portée : arme vs distance de la cible
  const cibleId = (myAim && myAim.cible) ? myAim.cible : cibleAttaque;
  const enCible = (combatState?.ennemis||[]).find(e => String(e.id) === String(cibleId));
  if(enCible && !enemyVisible(enCible)){
    document.getElementById('j-dice-result').innerHTML =
      '<span style="color:var(--rd)">🧱 Cible hors de vue (mur) — impossible de l\'atteindre</span>';
    return;
  }
  const gBand = enCible ? enemyGridBand(enCible) : null;   // distance via la grille si dispo
  const enDist = (gBand != null) ? gBand : (enCible ? (enCible.dist ?? 1) : 1);
  const rangePen = rangeDifficulty(currentArmeInfo?.rng || '—', enDist);
  if(rangePen >= 99){
    document.getElementById('j-dice-result').innerHTML =
      '<span style="color:var(--rd)">⚔ Trop loin pour la mêlée — rapproche-toi (Move/Sprint)</span>';
    return;
  }
  const diff = 1 + rangePen;

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

  // Dé bonus d'assistance (action Assist d'un allié) → +1 dé, consommé après le jet
  const assist = !!(combatState?.assistDie?.[joueurId]);
  const nbDice = nbDiceJ + (assist ? 1 : 0);
  if(assist) db.collection(COMBATS_COLL).doc(combatId).update({ ['assistDie.'+joueurId]: null }).catch(()=>{});

  const dés = Array.from({length:nbDice},()=>Math.floor(Math.random()*20)+1);
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
  if(rangePen>0) r+=' <span style="color:var(--td)" title="Difficulté de portée">(D'+diff+' · portée +'+rangePen+')</span>';
  if(echec) r+=' <span style="color:var(--rd)">ÉCHEC</span>';
  else r+='→<b style="color:var(--am)">'+dcTotal+'DC</b>';
  document.getElementById('j-dice-result').innerHTML = r;
  twoD20Done = attacksDone;
  lastRollDiff = diff;
  lastAttackMissed = echec;
  if(echec){
    // Échec : pas de dégâts pour l'instant. Le joueur peut relancer un dé (Miss Fortune) ou confirmer le ratage.
    const arEl = document.getElementById('j-attack-result');
    if(arEl){ arEl.style.display='block'; arEl.innerHTML =
      '<div class="miss-box" style="font-size:9px;color:var(--rd);padding:4px 6px;border:1px solid var(--rd);background:var(--rdk)">'
      + '✗ Échec — relance un dé (🎯 Aim / 🍀 Miss Fortune ci-dessus) ou '
      + '<button onclick="resolveMissJ()" style="background:none;border:1px solid var(--rd);color:var(--rd);font-family:monospace;font-size:8px;padding:1px 6px;cursor:pointer;margin-left:4px">Confirmer le ratage</button></div>'; }
  }
  renderDiceAccess();   // verrouille le 2D20 (et le CD tant que l'attaque est ratée)

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
  renderSabotsReroll();

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
  if(typeof renderJMap==='function') renderJMap();   // ligne de visée : pointillés → plein si touché
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
  let draftHtml = '';   // box de paramètres de l'action en cours (insérée près de sa catégorie)

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
    const ennemisV = (combatState?.ennemis || []).filter(e => e.pvCur > 0 && !e.hidden && enemyVisible(e));
    const savedCible = document.getElementById('j-act-cible')?.value || cibleAttaque || '';
    const savedZone  = document.getElementById('j-act-zone')?.value || '';
    const inputStyle = 'box-sizing:border-box;background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:8px;padding:3px 5px;outline:none';

    const aimUsed  = (as.mineure?.used || []).includes('Aim');
    const reuseAim = (selectedActionDraft.type === 'Attack' && aimUsed && myAim && myAim.w);

    let body = '';
    if(reuseAim){
      // Visée déjà effectuée (Aim) → on ne re-choisit ni arme, ni cible, ni zone
      body += '<div style="font-size:8px;color:var(--tb);margin-bottom:4px;padding:4px 6px;border:1px solid var(--gd);background:#0a140a">'
        + '🎯 Visée : <b>' + myAim.w.label + '</b> → <b style="color:var(--rd)">' + cibleNom(myAim.cible) + '</b>'
        + (myAim.zone ? ' <span style="color:var(--am)">[' + myAim.zone + ']</span>' : '')
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
            + enemyOptions(ennemisV, savedCible)
            + '</select>'
            + (showZone
                ? '<select id="j-act-zone" style="flex:1;' + inputStyle + '">'
                  + AIM_ZONES.map(z => '<option value="' + z + '"' + (z===savedZone?' selected':'') + '>' + (z || '— zone —') + '</option>').join('')
                  + '</select>'
                : '')
            + '</div>'
            + (showZone ? '' : '<div style="font-size:7px;color:var(--td);margin-bottom:4px">Vise pour cibler une zone précise</div>');
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

    draftHtml = '<div style="margin:6px 0;padding:5px;border:1px solid var(--am);background:#1a1200;font-size:8px">'
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
    const minorUsed    = as.mineure?.used || [];
    const minorPending = as.mineure?.pending;
    const minorWaiting = minorPending?.status === 'waiting';
    const majorWaiting = as.majeure?.pending?.status === 'waiting';
    const noMinorSlots = (s.mineure ?? 1) <= 0;   // grisé si plus d'action mineure dispo
    // Verrou PAR CATÉGORIE : une mineure en attente ne bloque pas les majeures (et inversement)
    // → on peut déclarer une Attaque juste après avoir visé.
    // Visée non consommée : on a visé plus de fois qu'on a attaqué → pas de nouvelle visée tant qu'on n'a pas attaqué
    const aimsUsed   = minorUsed.filter(t => t === 'Aim').length + ((minorWaiting && minorPending.type === 'Aim') ? 1 : 0);
    const aimPending = aimsUsed > attacksDone;

    html += '<div class="act-cat-lbl">ACTIONS MINEURES <span style="color:var(--g)">' + (s.mineure ?? 1) + '</span></div>'
      + '<div class="j-act-btns">';
    MINOR_ACTIONS.forEach(a => {
      const isPendingThis = minorWaiting && minorPending.type === a.type;
      const moveBlocked   = a.mouvement && !!as.mouvement_used;
      const aimLock       = a.type === 'Aim' && aimPending && !isPendingThis;   // déjà visé, pas encore attaqué
      const disabled      = aimLock || moveBlocked || noMinorSlots || minorWaiting || !!selectedActionDraft;
      const lbl = isPendingThis ? '⏳ ' + a.type : aimLock ? '✓ ' + a.type : a.type;
      const cls = 'j-act-btn' + (isPendingThis ? ' pending' : '') + (aimLock ? ' aimed' : '');
      html += '<button onclick="prepareAction(\'mineure\',\'' + a.type + '\')" class="' + cls + '"'
        + (disabled ? ' disabled' : '')
        + ' title="' + a.desc + '">' + lbl + '</button>';
    });
    html += '</div>';
    html += '<div id="j-exec-minor"></div>';   // exécution d'une action mineure (ex. Se déplacer) — entre mineures et majeures

    const majorPending = as.majeure?.pending;
    const noMajorSlots = (s.majeure ?? 1) <= 0;   // grisé si plus d'action majeure dispo

    html += '<div class="act-cat-lbl">ACTIONS MAJEURES <span style="color:var(--g)">' + (s.majeure ?? 1) + '</span></div>'
      + '<div class="j-act-btns">';
    MAJOR_ACTIONS.forEach(a => {
      const isPendingThis = majorWaiting && majorPending.type === a.type;
      const moveBlocked   = a.mouvement && !!as.mouvement_used;
      const disabled      = moveBlocked || noMajorSlots || majorWaiting || !!selectedActionDraft;
      const lbl = isPendingThis ? '⏳ ' + a.type : a.type;
      const cls = 'j-act-btn maj' + (isPendingThis ? ' pending' : '');
      html += '<button onclick="prepareAction(\'majeure\',\'' + a.type + '\')" class="' + cls + '"'
        + (disabled ? ' disabled' : '')
        + ' title="' + a.desc + '">' + lbl + '</button>';
    });
    html += '</div>';
    html += '<div id="j-exec-major"></div>';   // exécution d'une action majeure (Sprint/Defend/…)
    // (Le bouton « Terminer mon tour » est rendu séparément, sous le bloc « Mes jets ».)
  }

  // Box de paramètres en POPUP superposé au bloc (ne décale plus les boutons)
  if(draftHtml) html += '<div class="act-draft-pop">' + draftHtml + '</div>';

  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
  renderFinTour();

  // Restaurer la saisie après re-render
  const inp = document.getElementById('j-action-details');
  if(inp){
    if(savedDetails) inp.value = savedDetails;
    if(inputFocused){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

// Bouton « Terminer mon tour » (sous Mes jets) — visible pendant mon tour
function renderFinTour(){
  const el = document.getElementById('j-fin-tour'); if(!el) return;
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  if(isMoTour && !turnEnded){
    el.style.display = 'block';
    el.innerHTML = '<button onclick="finMonTour()" class="j-fin-btn">✓ TERMINER MON TOUR</button>';
  } else { el.style.display = 'none'; el.innerHTML = ''; }
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
  if(cible) details = '🎯 ' + cibleNom(cible) + (zone ? ' — ' + zone : '');
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

