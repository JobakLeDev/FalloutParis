// ============================================================
// combat_joueur_actions.js — Exécution des actions à effet (après
// validation MJ) : déplacement, jets, soin, équiper, chems, fin de tour,
// accès aux dés. Extrait de combat_joueur.js.
// Scope global partagé : chargé APRÈS combat_joueur.js, appels au runtime.
// Aucune variable/exécution top-level ici.
// ============================================================
// ============================================================
// EXÉCUTION DES ACTIONS À EFFET (après validation MJ)
// ============================================================
const ACTION_EXEC = {
  'Defend':      { cat:'majeure', skill:'athletics', diff:1, lbl:'🛡 Défendre (Athlétisme)' },
  'First Aid':   { cat:'majeure', skill:'medicine',  diff:1, lbl:'➕ Premiers soins (Médecine)', ally:true },
  'Rally':       { cat:'majeure', skill:'survival',  diff:0, lbl:'📣 Ralliement (Survie)' },
  'Test':        { cat:'majeure', pickSkill:true,    diff:1, lbl:'🎲 Test libre' },
  'Assist':      { cat:'majeure', noRoll:true, ally:true, lbl:'🤝 Assister un allié' },
  'Command NPC': { cat:'majeure', noRoll:true, ally:true, ownOnly:true, lbl:'🐕 Commander un PNJ' },
  'Pass':        { cat:'majeure', noRoll:true, lbl:'⏸ Passer' },
  'Ready':       { cat:'majeure', noRoll:true, note:true, lbl:'⏳ Action préparée' },
  'Interact':    { cat:'mineure', noRoll:true, note:true, lbl:'✋ Interaction' },
  'Move':        { cat:'mineure', noRoll:true, move:1, lbl:'🏃 Se déplacer (1 zone)' },
  'Sprint':      { cat:'majeure', noRoll:true, move:2, lbl:'🏃💨 Sprint (2 zones)' },
};

function _roll2D20(tn, diff, extraDice){
  const n = 2 + (extraDice||0);
  const dice = Array.from({length:n},()=>Math.floor(Math.random()*20)+1);
  const succ=dice.filter(v=>v<=tn).length + dice.filter(v=>v===1).length;   // 1 = crit (2 succès)
  return { dice, succ, crit: dice.filter(v=>v===1).length, echec: succ<diff, extra: Math.max(0,succ-diff) };
}
// Allies ciblables : soi + autres joueurs + compagnons (ownOnly = seulement mes compagnons, pour Command NPC)
function _allyTargets(ownOnly){
  const list = [{ id:'__self__', nom:(joueurData?.nom||joueurId)+' (moi)' }];
  if(!ownOnly){
    (combatState?.ordreInitiative||[]).filter(o => o.type==='joueur' && o.id!==joueurId)
      .forEach(o => list.push({ id:o.id, nom:(tousJoueurs[o.id]?.nom||o.nom||o.id)+' (joueur)' }));
  }
  (combatState?.allies||[]).filter(a => !ownOnly || a.owner===joueurId)
    .forEach(a => list.push({ id:a.id, nom:a.nom + (a.owner===joueurId?'':' ('+(a.ownerNom||'')+')') }));
  return list;
}

function renderActionExec(){
  const oldPanel = document.getElementById('j-action-exec'); if(oldPanel) oldPanel.style.display='none';   // ancien emplacement non utilisé
  const cMin = document.getElementById('j-exec-minor'), cMaj = document.getElementById('j-exec-major');
  const clearExec = () => { if(cMin) cMin.innerHTML=''; if(cMaj) cMaj.innerHTML=''; };
  const as = actionState;
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  if(!isMoTour || turnEnded || !as){ clearExec(); return; }
  // Première action à effet validée, non encore exécutée
  let found=null;
  for(const type in ACTION_EXEC){
    const cfg=ACTION_EXEC[type];
    const used=(as[cfg.cat]?.used||[]).filter(t=>t===type).length;
    if(used > (actionsExecuted[type]||0)){ found={type,cfg}; break; }
  }
  clearExec();
  if(!found) return;
  const inp = 'background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:8px;padding:3px 5px;outline:none';
  const btn = 'background:var(--gk);border:1px solid var(--g);color:var(--g);font-family:monospace;font-size:9px;padding:5px 14px;cursor:pointer;letter-spacing:1px';
  const t=found.type, cfg=found.cfg;
  let h='';

  if(cfg.skill || cfg.pickSkill){
    // jet de compétence
    let skSel='';
    if(cfg.pickSkill){
      skSel = '<select id="ax-skill" style="'+inp+';margin-bottom:5px;width:100%">'
        + ((typeof SKILLS_DEF!=='undefined'?SKILLS_DEF:[])).map(s=>'<option value="'+s.key+'">'+s.name+' ('+s.attr+')</option>').join('')
        + '</select>';
    }
    const tnNow = cfg.skill ? getTN(joueurData, cfg.skill).total : null;
    let allySel='';
    if(cfg.ally){
      allySel = '<div style="font-size:7px;color:var(--td);margin-bottom:2px">Cible</div><select id="ax-ally" style="'+inp+';margin-bottom:5px;width:100%">'
        + _allyTargets(cfg.ownOnly).map(a=>'<option value="'+a.id+'">'+a.nom+'</option>').join('') + '</select>';
    }
    let opt2='';
    if(t==='Defend'){
      opt2 = '<label style="font-size:7px;color:var(--td);display:flex;align-items:center;gap:4px;margin-bottom:5px"><input type="checkbox" id="ax-def2"> +2 Défense au lieu de +1 (−1 AP groupe)</label>';
    }
    h = allySel + skSel + opt2
      + '<div style="display:flex;align-items:center;gap:8px">'
      + (cfg.skill ? '<span style="font-size:8px;color:var(--td)">TN <b style="color:var(--tb);font-size:13px;font-family:Oswald,sans-serif">'+tnNow+'</b>'+(cfg.diff?' · D'+cfg.diff:' · D0')+'</span>' : '<span style="font-size:8px;color:var(--td)">D'+cfg.diff+'</span>')
      + '<button style="'+btn+'" onclick="execActionRoll(\''+t+'\')">Lancer 2D20</button></div>'
      + '<div id="ax-result" style="margin-top:6px;font-size:9px"></div>';
  } else if(cfg.move){
    const range = cfg.move===1 ? GRID_MOVE : GRID_SPRINT;   // 3 (Move) / 6 (Sprint)
    if(combatState?.grid && combatState.grid.pos?.[joueurId]){
      // Mode grille : déplacer son jeton sur la carte
      h = '<div style="font-size:8px;color:var(--td);margin-bottom:5px">Déplace-toi de <b style="color:var(--am)">'+range+'</b> cases max sur la carte ci-dessous.</div>'
        + '<button style="'+btn+'" onclick="startJMove(\''+t+'\','+range+')">🗺 Activer le déplacement</button>';
    } else {
      // Mode bandes (pas de carte) : se rapprocher / s'éloigner d'un ennemi
      const ennemisV = (combatState?.ennemis||[]).filter(e => e.pvCur > 0 && !e.hidden && enemyVisible(e));
      if(!ennemisV.length){
        h = '<div style="font-size:8px;color:var(--td)">Aucun ennemi.</div><button style="'+btn+'" onclick="execMoveDist(\''+t+'\')">✓ OK</button>';
      } else {
        h = '<div style="font-size:7px;color:var(--td);margin-bottom:2px">Par rapport à</div>'
          + '<select id="ax-move-enemy" style="'+inp+';width:100%;margin-bottom:5px">'
          + ennemisV.map(e=>'<option value="'+e.id+'">'+e.nom+' — '+(RANGE_LABELS[e.dist??1]||'')+'</option>').join('') + '</select>'
          + '<div style="font-size:7px;color:var(--td);margin-bottom:2px">Déplacement (×'+cfg.move+')</div>'
          + '<select id="ax-move-dir" style="'+inp+';width:100%;margin-bottom:5px"><option value="-1">▶ Se rapprocher</option><option value="1">◀ S\'éloigner</option></select>'
          + '<button style="'+btn+'" onclick="execMoveDist(\''+t+'\')">✓ Confirmer</button>';
      }
    }
  } else {
    // action sans jet
    let allySel='';
    if(cfg.ally){
      allySel = '<div style="font-size:7px;color:var(--td);margin-bottom:2px">Cible</div><select id="ax-ally" style="'+inp+';margin-bottom:5px;width:100%">'
        + _allyTargets(cfg.ownOnly).map(a=>'<option value="'+a.id+'">'+a.nom+'</option>').join('') + '</select>';
    }
    let noteInp = cfg.note ? '<input type="text" id="ax-note" placeholder="Précision (optionnel)…" style="'+inp+';width:100%;margin-bottom:5px">' : '';
    h = allySel + noteInp + '<button style="'+btn+'" onclick="execActionSimple(\''+t+'\')">✓ Confirmer</button>';
  }
  // Rendu dans le conteneur de la catégorie : mineure → entre actions mineures et majeures ; majeure → sous les majeures
  const cont = (cfg.cat==='mineure') ? cMin : cMaj;
  if(cont) cont.innerHTML = '<div class="pnl bottom-des j-exec-box" style="margin-top:6px">'
    + '<div class="pnl-title">' + cfg.lbl + '</div>'
    + '<div>' + h + '</div></div>';
}
async function execMoveDist(type){
  const cfg = ACTION_EXEC[type]; if(!cfg) return;
  const eid = document.getElementById('ax-move-enemy')?.value;
  const dir = parseInt(document.getElementById('ax-move-dir')?.value || '-1');
  const ennemis = (combatState?.ennemis||[]).map(e => ({...e}));
  const idx = ennemis.findIndex(e => String(e.id) === String(eid));
  if(idx < 0 || !db){ _finishExec(type, 'déplacement'); return; }
  const before = ennemis[idx].dist ?? 1;
  ennemis[idx].dist = Math.max(0, Math.min(3, before + dir * (cfg.move || 1)));
  try { await db.collection(COMBATS_COLL).doc(combatId).update({ ennemis }); } catch(e){ console.error(e); }
  const lbl = (dir < 0 ? '▶ se rapproche de ' : '◀ s\'éloigne de ') + ennemis[idx].nom + ' → ' + (RANGE_LABELS[ennemis[idx].dist] || '');
  _finishExec(type, lbl);
}

// Marque l'action comme exécutée et journalise au MJ
function _finishExec(type, detail){
  actionsExecuted[type] = (actionsExecuted[type]||0) + 1;
  if(db && combatId){
    db.collection(COMBATS_COLL).doc(combatId).update({
      actionResult: { joueur: joueurId, nom: (joueurData?.nom||joueurId), action: type, detail, ts: Date.now() }
    }).catch(()=>{});
  }
  renderActionExec();
}

async function execActionRoll(type){
  const cfg = ACTION_EXEC[type]; if(!cfg) return;
  const skill = cfg.pickSkill ? (document.getElementById('ax-skill')?.value || 'speech') : cfg.skill;
  const tn = getTN(joueurData, skill).total;
  // Dé bonus d'assistance → +1 dé, consommé après le jet
  const assist = !!(combatState?.assistDie?.[joueurId]);
  if(assist) db.collection(COMBATS_COLL).doc(combatId).update({ ['assistDie.'+joueurId]: null }).catch(()=>{});
  const r = _roll2D20(tn, cfg.diff, assist ? 1 : 0);
  const resEl = document.getElementById('ax-result');
  let effetTxt = '';

  if(!r.echec){
    if(type==='Defend'){
      const use2 = document.getElementById('ax-def2')?.checked;
      let bonus = 1;
      if(use2){
        if((combatState?.apPool||0) >= 1){ await db.collection(COMBATS_COLL).doc(combatId).update({ apPool:(combatState.apPool||0)-1 }); bonus = 2; }
      }
      await db.collection(COMBATS_COLL).doc(combatId).update({ ['defenseBonus.'+joueurId]: bonus });
      effetTxt = '🛡 +'+bonus+' Défense jusqu\'à ton prochain tour';
    } else if(type==='Rally'){
      const gain = Math.min(1 + r.extra, 6 - (combatState?.apPool||0));
      if(gain>0){ await db.collection(COMBATS_COLL).doc(combatId).update({ apPool:(combatState.apPool||0)+gain }); }
      effetTxt = '📣 +'+Math.max(0,gain)+' AP groupe';
    } else if(type==='First Aid'){
      const allyId = document.getElementById('ax-ally')?.value;
      const heal = 2 + r.extra;
      effetTxt = await _healTarget(allyId, heal);
    } else if(type==='Test'){
      effetTxt = '✓ Test réussi (le MJ adjuge l\'effet)';
    }
  } else {
    effetTxt = '✗ Échec';
  }
  const diceStr = r.dice.map(d=>'<span style="color:'+(d<=tn?'var(--g)':'var(--rd)')+';font-family:Oswald,sans-serif;font-size:14px">'+d+'</span>').join(' / ');
  if(resEl) resEl.innerHTML = diceStr + ' → <b style="color:'+(r.echec?'var(--rd)':'var(--g)')+'">'+r.succ+' succès</b>'+(r.crit?' +'+r.crit+'★':'')+'<div style="margin-top:3px;color:var(--tb)">'+effetTxt+'</div>';
  _finishExec(type, r.succ+'s '+(r.echec?'(échec)':'')+' — '+effetTxt.replace(/<[^>]+>/g,''));
}

async function execActionSimple(type){
  const cfg = ACTION_EXEC[type]; if(!cfg) return;
  let detail = '';
  if(cfg.ally){ const id=document.getElementById('ax-ally')?.value; detail = 'cible: '+_allyNom(id); }
  const note = document.getElementById('ax-note')?.value?.trim();
  if(note) detail += (detail?' · ':'')+note;
  if(type==='Assist' && cfg.ally){
    const id=document.getElementById('ax-ally')?.value;
    if(id && id!=='__self__'){ await db.collection(COMBATS_COLL).doc(combatId).update({ ['assistDie.'+id]: { from:(joueurData?.nom||joueurId), ts:Date.now() } }).catch(()=>{}); }
  }
  if(type==='Pass'){ detail = 'passe son tour'; }
  _finishExec(type, detail || cfg.lbl);
}

function _allyNom(id){
  if(id==='__self__') return (joueurData?.nom||joueurId)+' (moi)';
  if(tousJoueurs[id]) return tousJoueurs[id].nom||id;
  const a=(combatState?.allies||[]).find(x=>x.id===id); return a? a.nom : id;
}
// Soigne une cible (soi/autre joueur → fiche joueur ; compagnon → combat doc allies)
async function _healTarget(id, amount){
  if(id==='__self__'){
    const hpMax=getHpMax(joueurData); const cur=joueurData?.hp||0; const nv=Math.min(hpMax, cur+amount);
    await db.collection('joueurs').doc(joueurId).update({ hp: nv });
    return '➕ '+(joueurData?.nom||'Moi')+' : '+cur+' → '+nv+' PV';
  }
  if(tousJoueurs[id]){
    const pj=tousJoueurs[id]; const hpMax=getHpMax(pj); const cur=pj.hp||0; const nv=Math.min(hpMax, cur+amount);
    await db.collection('joueurs').doc(id).update({ hp: nv });
    return '➕ '+(pj.nom||id)+' : '+cur+' → '+nv+' PV';
  }
  const allies=(combatState?.allies||[]).map(a=>({...a}));
  const a=allies.find(x=>x.id===id); if(!a) return '➕ Soin appliqué';
  const before=a.hpCur||0; a.hpCur=Math.min(a.hpMax||before, before+amount);
  await db.collection(COMBATS_COLL).doc(combatId).update({ allies });
  return '➕ '+a.nom+' : '+before+' → '+a.hpCur+' PV';
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
  if(it.qty <= 0) inv.splice(i, 1);   // épuisé → retiré de l'inventaire
  const upd = { inventory: inv };
  let effetTxt = '';
  const def = (window.DB?.drugs||[]).find(d => d.n === name)
           || (window.DB?.food||[]).find(d => d.n === name)
           || (window.DB?.drinks||[]).find(d => d.n === name) || {};
  const fx = (typeof fpParseConsumable === 'function') ? fpParseConsumable(def) : { instant:{ hp:def.hp||0, radHeal:0, ap:0 }, buff:null };
  // Buff temporaire → effet actif (visible sur la fiche aussi)
  if(fx.buff){
    // Un même chem/aliment ne cumule pas son buff : on remplace l'effet du même objet (refresh). Les PV restent gagnés à chaque prise.
    joueurData.activeEffects = (Array.isArray(joueurData.activeEffects) ? joueurData.activeEffects : []).filter(e => e.src !== name);
    joueurData.activeEffects.push({ id:'e'+Date.now().toString(36)+Math.floor(Math.random()*999), src:name, ...fx.buff });
    upd.activeEffects = joueurData.activeEffects;
    effetTxt += ' (effet actif)';
  }
  if(fx.instant.hp){
    const hpMax = getHpMax(joueurData) + (typeof fpEffSum==='function'?fpEffSum(joueurData.activeEffects,'hpMax'):0);
    const cur = joueurData.hp || 0; const nv = Math.min(hpMax, cur + fx.instant.hp);
    upd.hp = nv; joueurData.hp = nv; if(nv>cur) effetTxt += ' (+'+(nv-cur)+' PV)';
  }
  if(fx.instant.radHeal){
    const curRad = joueurData.rad || 0; const nv = Math.max(0, curRad - fx.instant.radHeal);
    upd.rad = nv; joueurData.rad = nv; if(nv<curRad) effetTxt += ' (−'+(curRad-nv)+' RAD)';
  }
  try { await db.collection('joueurs').doc(joueurId).update(upd); } catch(e){ console.error(e); }
  // AP immédiats → pool de groupe
  if(fx.instant.ap){ try { await _updateAPGroupe(fx.instant.ap); effetTxt += ' (+'+fx.instant.ap+' AP groupe)'; } catch(e){} }
  return '💊 Prend ' + name + effetTxt;
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

  // Le bloc d'attaque (lancer de dés) n'apparaît QU'UNE FOIS L'ATTAQUE VALIDÉE par le MJ,
  // pendant MON tour uniquement, puis reste tant que l'attaque se résout (reroll/conversion/dégâts bonus).
  const isMoTour = combatState?.ordreInitiative?.[combatState.tourActif]?.id === joueurId;
  // Une nouvelle attaque validée ré-ouvre le popup (annule une fermeture manuelle précédente)
  const av = attacksValidated();
  if(av > _lastSeenValidated){ _lastSeenValidated = av; _diceDismissed = false; }
  const showPanel = isMoTour && !turnEnded && (attackReady || attacksDone > 0) && !_diceDismissed;
  if(panel) panel.style.display = showPanel ? '' : 'none';
  // Filet : si l'attaque n'est plus ratée (relance Aim/Miss Fortune réussie), faire disparaître le message d'échec
  const arBox = document.getElementById('j-attack-result');
  if(arBox && !lastAttackMissed && arBox.querySelector('.miss-box')){ arBox.style.display='none'; arBox.innerHTML=''; }
  // Bouton OK (fermer le popup) : visible une fois le jet effectué / l'attaque résolue
  const closeWrap = document.getElementById('j-dice-close-wrap');
  if(closeWrap) closeWrap.style.display = (showPanel && ((twoD20Done === attacksDone) || attacksDone > 0)) ? 'block' : 'none';

  // Plus de verrou « en attente » : le panneau ne s'affiche que lorsqu'on peut réellement lancer.
  if(lockEl) lockEl.style.display = 'none';

  // Boutons de lancer : actifs seulement s'il reste une attaque à résoudre
  const lockDice = !attackReady;
  const lance = document.getElementById('j-lance-btn'); if(lance) lance.disabled = lockDice || (twoD20Done === attacksDone);  // un seul 2D20 par attaque

  // Sélecteur de dés bonus : griser les options dont le coût AP dépasse le pool de groupe
  const selDice = document.getElementById('j-dice-sel');
  if(selDice){
    selDice.style.display = lockDice ? 'none' : '';
    const pool = combatState?.apPool || 0;
    const cost = {2:0, 3:1, 4:3, 5:6};
    [2,3,4,5].forEach(i => {
      const b = document.getElementById('j-d20-'+i); if(!b) return;
      const tooExpensive = cost[i] > pool;
      b.disabled = tooExpensive;
      b.style.opacity = tooExpensive ? '0.4' : '';
    });
    if(cost[nbDiceJ] > pool) setNbDiceJ(2);   // option choisie devenue inabordable → retour à 2D
  }
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
  const ennemis = (combatState?.ennemis || []).filter(e => e.pvCur > 0 && !e.hidden && enemyVisible(e));
  if(!ennemis.length){
    cibleEl.innerHTML = '<span style="font-size:7px;color:var(--td)">Aucun ennemi vivant</span>';
    cibleAttaque = '';
    return;
  }
  // Déjà visé (Attack/Aim) → on ne redemande pas la cible (vérif par ID ; l'ennemi visé doit être encore vivant)
  if(myAim && myAim.cible && ennemis.some(e => String(e.id) === String(myAim.cible))){
    cibleAttaque = myAim.cible;
    cibleEl.innerHTML = '<div style="font-size:7px;color:var(--td)">🎯 Cible visée : '
      + '<b style="color:var(--rd)">' + cibleNom(myAim.cible) + '</b>'
      + (myAim.zone ? ' <span style="color:var(--am)">— ' + myAim.zone + '</span>' : '')
      + '</div>';
    return;
  }
  const prevVal = document.getElementById('j-cible-sel')?.value || '';
  cibleEl.innerHTML = '<div style="display:flex;align-items:center;gap:5px">'
    + '<span style="font-size:7px;color:var(--td)">Cible :</span>'
    + '<select id="j-cible-sel" style="flex:1;background:#060d06;border:1px solid var(--b2);color:var(--t);font-family:monospace;font-size:7px;padding:2px 4px;outline:none">'
    + enemyOptions(ennemis, prevVal)
    + '</select></div>';
  const sel = document.getElementById('j-cible-sel');
  if(sel){
    cibleAttaque = sel.value;
    sel.onchange = () => { cibleAttaque = sel.value; if(typeof renderJMap==='function') renderJMap(); };
  }
}

function jLancerCD(){
  if(lastAttackMissed) return;     // attaque ratée (2D20 échec) → pas de dégâts
  if(!canAttackNow()) return;      // anti-spam : pas d'attaque en attente de résolution
  attacksDone++;                   // l'attaque est résolue (réactive les dés s'il reste une attaque validée)
  renderDiceAccess();              // verrouille immédiatement si plus d'attaque dispo
  let nb = nbDCActuel || 2;
  // Bonus dégâts mêlée des effets actifs (Psycho, Yao Guai Roast…)
  if(['cac_weapon','barehand','throwing'].includes(lastSkKeyJ) && typeof fpEffSum==='function')
    nb += fpEffSum(joueurData?.activeEffects, 'dmgMelee');
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

  // Calculer les effets de dégâts (si ⚡) — TOUS les effets de l'arme (Spread, Vicious, Persistent…)
  let dmgTotal = dmgRaw;
  let effetInfo = null;
  if(ef > 0){
    const all = parseEffets(currentArmeInfo?.eff || '');
    if(all.length){
      const notes = []; let radSum = 0;
      all.forEach(p => {
        const res = DAMAGE_EFFECTS[p.name].calc(ef, dmgRaw, p.val);
        if(res.dmgBonus) dmgTotal += res.dmgBonus;
        if(res.rad) radSum += res.rad;
        if(res.note) notes.push(p.name + ' : ' + res.note);
      });
      effetInfo = { nom: currentArmeInfo.eff, note: notes.join(' · '), rad: radSum };
    }
  }

  // Résultat narratif
  const nom = joueurData?.nom || joueurId;
  const cibleNomTxt = cibleNom(cibleAttaque);
  const cible = cibleNomTxt ? ' à <b style="color:var(--rd)">'+cibleNomTxt+'</b>' : '';
  const zoneTxt = ' <span style="color:'+(zoneAimee?'var(--am)':'var(--td)')+'">['+zone+']</span>';
  const arEl = document.getElementById('j-attack-result');
  if(arEl){
    arEl.style.display = 'block';
    const brk = dmgTotal>dmgRaw ? ' <span style="color:var(--td);font-size:8px">('+dmgRaw+' + '+(dmgTotal-dmgRaw)+' effet)</span>' : '';
    let html = '<div style="font-size:9px;color:var(--tb);padding:4px 6px;border:1px solid var(--g);background:#060d06;margin-top:2px">'
      + '⚔ <b>'+nom+'</b> inflige <b style="color:var(--am)">'+dmgTotal+' dmg</b>'+brk+(ef?' <span style="color:var(--am)">'+ef+'⚡</span>':'')
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
    const _ts = Date.now();
    db.collection(COMBATS_COLL).doc(combatId).update({
      attackResult: { joueur: joueurId, nom, cible: cibleNomTxt, cibleId: cibleAttaque, zone, zoneAimee,
        dmg: dmgTotal, base: dmgRaw, ef,
        effetNom: effetInfo?.nom||'', effetNote: effetInfo?.note||'', rad: effetInfo?.rad||0,
        ts: _ts },
      fxAttack: { fromTok: joueurId, toTok: 'E'+cibleAttaque, hit: true, ts: _ts }
    }).catch(()=>{});
  }

  // L'attaque est faite : proposer « Terminer mon tour » (verrou déjà posé en tête)
  renderActionsDeclarees();
  if(typeof renderJMap==='function') renderJMap();   // efface la ligne de visée
}
