// ============================================================
// COMBAT SYNC — Fonctions de synchronisation Firebase
// Partagé entre combat.html (MJ) et combat_joueur.html
// ============================================================

// COMBATS_COLL défini dans mj_shared.js
// currentCombatId défini dans combat.js

// ---- MJ : écrire l'état du combat dans Firebase ----
async function syncCombatToFirebase(){
  if(!db || !currentCombatId) return;
  try {
    await db.collection(COMBATS_COLL).doc(currentCombatId).set({
      actif: true,
      numRound,
      tourActif,
      ordreInitiative: ordreInitiative.map(x => ({
        id: x.id,
        nom: x.nom,
        type: x.type,
        init: x.init,
        eid: x.eid || null,
      })),
      actionsState,
      // Conserver TOUS les champs des ennemis (xp, dmgType, eff, dr, level, category…) — sinon ils sont perdus à chaque sync
      ennemis: ennemis.map(e => ({ ...e })),
      allies: (typeof allies !== 'undefined' ? allies : []).map(a => ({ ...a })),
      apPool:   typeof apPool   !== 'undefined' ? apPool   : 0,
      mjApPool: typeof mjApPool !== 'undefined' ? mjApPool : 0,
      grid: (typeof combatMap !== 'undefined' && combatMap) ? combatMap : null,
      lastUpdate: Date.now(),
    }, { merge: true });
    // Mise à jour du pointeur courant (utilisé par firebase.js côté joueur)
    db.collection(COMBATS_COLL).doc('current'+fpCampSuffix()).set({
      combatId: currentCombatId,
      lastUpdate: Date.now()
    }).catch(() => {});
  } catch(e){ console.error('syncCombat:', e); }
}

async function resetActionsDeclarees(){
  if(!db || !currentCombatId) return;
  try {
    const snap = await db.collection(COMBATS_COLL).doc(currentCombatId).get();
    if(!snap.exists) return;
    const existing = snap.data()?.actionsDeclarees || {};
    if(!Object.keys(existing).length) return;
    const upd = {};
    Object.keys(existing).forEach(id => {
      upd['actionsDeclarees.' + id] = { mineure:{used:[],pending:null}, majeure:{used:[],pending:null}, mouvement_used:false };
    });
    await db.collection(COMBATS_COLL).doc(currentCombatId).update(upd);
  } catch(e){ console.error('resetActionsDeclarees:', e); }
}

async function stopCombat(){
  if(!db || !currentCombatId) return;
  await db.collection(COMBATS_COLL).doc(currentCombatId).set({
    actif: false, apPool: 0, mjApPool: 0, lastUpdate: Date.now(),
    'meta.status': 'termine'
  }, { merge: true });
  // Effacer le pointeur courant
  db.collection(COMBATS_COLL).doc('current'+fpCampSuffix()).set({combatId: null, lastUpdate: Date.now()}).catch(() => {});
}
