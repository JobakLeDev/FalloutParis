// ============================================================
// carte_echanges.js — Échanges entre joueurs (pool commun, groupes,
// numéros, balises GPS). Extrait de carte.js (scope global partagé :
// chargé APRÈS carte.js, appels résolus au runtime).
// ============================================================
// ============================================================
// ÉCHANGES ENTRE JOUEURS (proximité sur la carte)
// Proposition → /echanges/{id} {from,fromNom,to,toNom,type,items?,ts,status}
//   type: 'group' | 'numbers' | 'beacon'  ;  status: pending|accepted|declined
// (le don unilateral a ete SUPPRIME : les echanges passent par un POOL commun)
// Côté cible : modale accepter/refuser → applique l'effet + journalise (MJ notifié).
// La portée est déjà garantie : le jeton d'un autre joueur n'est cliquable
// que s'il est dans VISION_RADIUS_M (renderTokens). _inRange revérifie à l'envoi.
// ============================================================
function _exEsc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function carteToast(msg){
  const el = document.getElementById('carte-toast'); if(!el) return;
  el.textContent = msg; el.classList.add('on');
  clearTimeout(carteToast._t); carteToast._t = setTimeout(()=>el.classList.remove('on'), 3200);
}
function _inRange(otherId){
  // Sous terre (les deux) → on compare les positions métro ; sinon les positions de surface
  const bothUnder = mapData.underground?.[viewerId] && mapData.underground?.[otherId];
  const src = bothUnder ? mapData.metroTokens : mapData.tokens;
  const my = src?.[viewerId], ot = src?.[otherId];
  if(!my || !ot) return false;
  return L.latLng(my.lat, my.lng).distanceTo(L.latLng(ot.lat, ot.lng)) <= VISION_RADIUS_M;
}
// Boutons d'interaction de proximité (groupe / numéros / échange / balise GPS)
function _interactBtns(id){
  const shared = (mapData.beacons?.[viewerId] || []).includes(id);
  const inGroup = !!groupOf(id);
  return '<div class="tok-actions">'
    + `<button onclick="propGroup('${id}')">👥 ${inGroup ? 'Proposer de rejoindre le groupe' : 'Proposer de grouper'}</button>`
    + `<button onclick="propNumbers('${id}')">📟 Échanger les numéros</button>`
    + `<button onclick="propEchange('${id}')">🔄 Proposer un échange</button>`
    + (shared ? '<button disabled style="opacity:.6;cursor:default">📡 Balise GPS partagée ✓</button>'
              : `<button onclick="propBeacon('${id}')">📡 Échanger les balises GPS</button>`)
    + '</div>';
}
function _sendProposal(to, type, extra){
  if(!fdb || !viewerId) return;
  if(!_inRange(to)){ carteToast('Trop loin — rapprochez-vous.'); return; }
  const doc = Object.assign({
    from: viewerId, fromNom: joueurs[viewerId]?.nom || viewerId,
    to, toNom: joueurs[to]?.nom || to,
    type, ts: Date.now(), status: 'pending'
  }, extra || {});
  fdb.collection('echanges').add(doc)
    .then(()=>carteToast('Proposition envoyée à ' + doc.toNom))
    .catch(e=>{ console.error('echange', e); carteToast("Échec de l'envoi"); });
  if (map) map.closePopup();
}
async function propGroup(to){
  const g = groupOf(to);
  if(g){   // la cible est déjà dans un groupe → proposer de le rejoindre (pas de saisie de nom)
    _sendProposal(to, 'group', { groupName: g.name || 'Groupe', joinTarget: true });
    return;
  }
  const def = joueurs[viewerId]?.nom ? ('Groupe de ' + joueurs[viewerId].nom) : 'Groupe';
  const name = await fpPrompt('Nom du groupe à proposer :', def);
  if(name === null) return;   // annulé
  _sendProposal(to, 'group', { groupName: name.trim() || 'Groupe' });
}
function propNumbers(to){ _sendProposal(to, 'numbers'); }
function propBeacon(to){ _sendProposal(to, 'beacon'); }

// ---- Échange : POOL COMMUN (remplace l'ancien don unilatéral) ----
// L'initiateur crée un pool vide (ou rajoute la cible à son pool existant) et l'ouvre
// aussitôt chez lui. La cible n'a rien à accepter : elle voit une ALERTE sur sa fiche
// (bandeau « échange en cours ») et ouvre le pool quand elle veut. Les deux déposent
// et prennent librement (transactions Firestore côté page Échange).
async function propEchange(to){
  if(!fdb || !viewerId) return;
  if(!_inRange(to)){ carteToast('Trop loin — rapprochez-vous.'); return; }
  try{
    const q = await fdb.collection('poolsEchange').where('members','array-contains',viewerId).limit(1).get();
    if(!q.empty){                                   // j'ai déjà un pool → j'y ajoute la cible
      const d = q.docs[0], mem = d.data().members || [];
      if(!mem.includes(to)) await d.ref.update({ members: [...mem, to] });
    } else {                                        // sinon → nouveau pool vide à deux
      const id = 'ex' + Date.now().toString(36) + Math.floor(Math.random()*999);
      await fdb.collection('poolsEchange').doc(id).set({
        creator: viewerId, creatorNom: joueurs[viewerId]?.nom || viewerId,
        partyName: 'Échange', members: [viewerId, to],
        items: [], ammo: [], caps: 0, cards: [], createdAt: Date.now()
      });
    }
    const nom = joueurs[to]?.nom || to;
    carteToast('🔄 Échange ouvert avec ' + nom);
    if(map) map.closePopup();
    _logEchangeOuvert(to);
    // La carte tourne en iframe dans la fiche → demander l'ouverture du pool chez moi
    if(window.parent && window.parent !== window) window.parent.postMessage('open-echange','*');
  }catch(e){ console.error('propEchange', e); carteToast("Échec de l'ouverture de l'échange."); }
}
function _logEchangeOuvert(to){
  const a = joueurs[viewerId]?.nom || viewerId, b = joueurs[to]?.nom || to;
  const txt = `${a} a ouvert un échange avec ${b}.`;
  if(typeof logJournal === 'function') logJournal({ type:'info', title:'Échange entre joueurs', text: txt, revealedFor: [], src: 'echange:' + Date.now() });
  if(typeof fpLogAction === 'function') fpLogAction(fdb, a, txt);
}

// ---- Réception des propositions ----
let _pendingProps = [];
let _activeProp = null;
function watchEchanges(){
  fdb.collection('echanges').where('to','==',viewerId).onSnapshot(s => {
    _pendingProps = [];
    s.forEach(d => { const v = d.data(); if(v.status === 'pending') _pendingProps.push({ id: d.id, ...v }); });
    if(!_activeProp && _pendingProps.length) showProp(_pendingProps[0]);
  }, e => console.warn('echanges in:', e && e.code));
  fdb.collection('echanges').where('from','==',viewerId).onSnapshot(s => {
    s.forEach(d => {
      const v = d.data();
      if(v.status === 'accepted'){ carteToast('✓ ' + (v.toNom||'') + ' a accepté.'); d.ref.delete().catch(()=>{}); }
      else if(v.status === 'declined'){ carteToast('✗ ' + (v.toNom||'') + ' a refusé.'); d.ref.delete().catch(()=>{}); }
    });
  }, e => console.warn('echanges out:', e && e.code));
}
function showProp(p){
  _activeProp = p;
  let body = '';
  if(p.type === 'group')   body = p.joinTarget
    ? `<b>${_exEsc(p.fromNom)}</b> souhaite <b>rejoindre ton groupe « ${_exEsc(p.groupName || 'Groupe')} »</b> (vous partagerez le même temps de jeu).`
    : `<b>${_exEsc(p.fromNom)}</b> te propose de rejoindre le groupe <b>« ${_exEsc(p.groupName || 'Groupe')} »</b> (vous partagerez le même temps de jeu).`;
  if(p.type === 'numbers') body = `<b>${_exEsc(p.fromNom)}</b> veut <b>échanger vos numéros</b> (vous pourrez vous envoyer des messages).`;
  if(p.type === 'beacon')  body = `<b>${_exEsc(p.fromNom)}</b> veut <b>échanger vos balises GPS</b> (vous vous verrez en permanence sur la carte, même à distance).`;
  document.getElementById('prop-title').textContent =
    p.type === 'group' ? '👥 Proposition de groupe'
    : p.type === 'beacon' ? '📡 Balises GPS'
    : '📟 Échange de numéros';
  document.getElementById('prop-body').innerHTML = body;
  document.getElementById('prop-mo').classList.add('on');
}
function _closeProp(){
  document.getElementById('prop-mo').classList.remove('on');
  const done = _activeProp; _activeProp = null;
  setTimeout(()=>{ const next = _pendingProps.find(p => p.id !== (done && done.id)); if(next && !_activeProp) showProp(next); }, 300);
}
async function declineProp(){
  const p = _activeProp; if(!p){ _closeProp(); return; }
  try { await fdb.collection('echanges').doc(p.id).update({ status:'declined' }); } catch(e){ console.warn(e); }
  _closeProp();
}
async function acceptProp(){
  const p = _activeProp; if(!p) return;
  try {
    if(p.type === 'numbers')     await _applyNumbers(p);
    else if(p.type === 'group')  await _applyGroup(p);
    else if(p.type === 'beacon') await _applyBeacon(p);
    await fdb.collection('echanges').doc(p.id).update({ status:'accepted' });
    _logMJ(p);
    carteToast('✓ Accepté.');
  } catch(e){ console.error('acceptProp', e); carteToast("Erreur lors de l'échange."); }
  _closeProp();
}
// ---- Effets ----
async function _applyNumbers(p){
  const ref = fdb.collection('messagerie').doc(fpCampId());
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  const links = (d.links && typeof d.links === 'object') ? d.links : {};
  const add = (a,b) => { links[a] = Array.isArray(links[a]) ? links[a] : []; if(!links[a].includes(b)) links[a].push(b); };
  add(p.from, p.to); add(p.to, p.from);
  await ref.set({ links });
}
async function _applyGroup(p){
  const ref = fdb.collection('temps').doc(fpCampId());
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  let parties = Array.isArray(data.parties) ? data.parties : [];
  const detach = id => parties.forEach(x => x.players = (x.players||[]).filter(y => y !== id));
  const proposerGroup = parties.find(x => !x.solo && (x.players||[]).includes(p.from));
  const targetGroup   = parties.find(x => !x.solo && (x.players||[]).includes(p.to));
  if(proposerGroup){            // le proposant a déjà un groupe → la cible le rejoint
    detach(p.to);
    proposerGroup.players.push(p.to);
  } else if(targetGroup){       // la cible a un groupe → le proposant le rejoint
    detach(p.from);
    targetGroup.players.push(p.from);
  } else {                      // ni l'un ni l'autre → nouveau groupe
    const solo = parties.find(x => (x.players||[]).includes(p.from));
    const mins = (solo && solo.minutes != null) ? solo.minutes : (typeof TEMPS_DEFAUT !== 'undefined' ? TEMPS_DEFAUT : 480);
    detach(p.from); detach(p.to);
    parties.push({ id: 'p' + Date.now().toString(36) + Math.floor(Math.random()*999),
      name: (p.groupName || p.fromNom || 'Groupe'), players: [p.from, p.to], minutes: mins, solo: false });
  }
  parties = parties.filter(x => !(x.solo && (x.players||[]).length === 0));
  await ref.set({ ...data, parties });
}
async function _applyBeacon(p){
  const ref = fdb.collection('carte').doc(fpCampId());
  const snap = await ref.get();
  const beacons = (snap.exists && snap.data().beacons && typeof snap.data().beacons === 'object') ? snap.data().beacons : {};
  const add = (a,b) => { beacons[a] = Array.isArray(beacons[a]) ? beacons[a] : []; if(!beacons[a].includes(b)) beacons[a].push(b); };
  add(p.from, p.to); add(p.to, p.from);
  await ref.set({ beacons }, { merge: true });
}
function _logMJ(p){
  let txt = '';
  if(p.type === 'group')   txt = `${p.fromNom} et ${p.toNom} forment un groupe.`;
  if(p.type === 'numbers') txt = `${p.fromNom} et ${p.toNom} ont échangé leurs numéros.`;
  if(p.type === 'beacon')  txt = `${p.fromNom} et ${p.toNom} ont échangé leurs balises GPS (visibles en permanence sur la carte).`;
  if(typeof logJournal === 'function') logJournal({ type:'info', title:'Échange entre joueurs', text: txt, revealedFor: [], src: 'echange:' + (p.ts || Date.now()) });
  if(typeof fpLogAction === 'function') fpLogAction(fdb, joueurs[viewerId]?.nom || viewerId, txt);
}
