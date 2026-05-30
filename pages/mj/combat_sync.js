// ============================================================
// COMBAT SYNC — Fonctions de synchronisation Firebase
// Partagé entre combat.html (MJ) et combat_joueur.html
// ============================================================

const COMBAT_DOC = 'fallout-paris'; // document dans collection 'combat'

// ---- MJ : écrire l'état du combat dans Firebase ----
async function syncCombatToFirebase(){
  if(!db) return;
  try {
    await db.collection('combat').doc(COMBAT_DOC).set({
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
      ennemis: ennemis.map(e => ({
        id: e.id, nom: e.nom, pvCur: e.pvCur, pvMax: e.pvMax,
        atq: e.atq, rd: e.rd, initiative: e.initiative
      })),
      lastUpdate: Date.now(),
    });
  } catch(e){ console.error('syncCombat:', e); }
}

async function stopCombat(){
  if(!db) return;
  await db.collection('combat').doc(COMBAT_DOC).set({actif:false, lastUpdate:Date.now()});
}
