// ============================================================
// carte_echanges.js — Échanges entre joueurs (don d'objets, groupes,
// numéros, balises GPS). Extrait de carte.js (scope global partagé :
// chargé APRÈS carte.js, appels résolus au runtime).
// ============================================================
// ============================================================
// ÉCHANGES ENTRE JOUEURS (proximité sur la carte)
// Proposition → /echanges/{id} {from,fromNom,to,toNom,type,items?,ts,status}
//   type: 'group' | 'numbers' | 'give'  ;  status: pending|accepted|declined
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
// Boutons d'interaction de proximité (groupe / numéros / don / balise GPS)
function _interactBtns(id){
  const shared = (mapData.beacons?.[viewerId] || []).includes(id);
  const inGroup = !!groupOf(id);
  return '<div class="tok-actions">'
    + `<button onclick="propGroup('${id}')">👥 ${inGroup ? 'Proposer de rejoindre le groupe' : 'Proposer de grouper'}</button>`
    + `<button onclick="propNumbers('${id}')">📟 Échanger les numéros</button>`
    + `<button onclick="openGive('${id}')">🎁 Donner des objets</button>`
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

// ---- Don d'objets (sens unique) ----
let _giveTo = null;
function openGive(to){
  if(!_inRange(to)){ carteToast('Trop loin — rapprochez-vous.'); return; }
  _giveTo = to;
  const myInv = joueurs[viewerId]?.inventory || [];
  const myAmmo = (joueurs[viewerId]?.ammo || []).filter(a => (a.qty||0) > 0);
  const giveable = myInv.filter(it => !it.equipped && (it.qty||1) > 0);
  document.getElementById('give-sub').textContent = 'À donner à ' + (joueurs[to]?.nom || to) + ' :';
  const list = document.getElementById('give-list');
  let h = '';
  if(giveable.length){
    h += giveable.map(it => {
      const i = myInv.indexOf(it);
      const isC = (window.DB?.stuff||[]).some(s => s.n === it.name && s.cap != null);
      const wc = isC ? ` <span style="color:#2a9d8f">💧${it.water||0}</span>` : '';
      return `<div class="ex-row"><span class="ex-name">${_exEsc(it.name)}${wc}</span><span class="ex-have">x${it.qty||1}</span>`
        + `<input type="number" min="0" max="${it.qty||1}" value="0" data-inv="${i}" data-max="${it.qty||1}"></div>`;
    }).join('');
  }
  if(myAmmo.length){
    h += '<div class="ex-empty" style="text-align:left;opacity:.7;margin:4px 0 2px">Munitions</div>';
    h += myAmmo.map(a =>
      `<div class="ex-row"><span class="ex-name">▪ ${_exEsc(a.cal)}</span><span class="ex-have">x${a.qty||0}</span>`
      + `<input type="number" min="0" max="${a.qty||0}" value="0" data-ammo="${_exEsc(a.cal)}" data-max="${a.qty||0}"></div>`
    ).join('');
  }
  list.innerHTML = h || '<div class="ex-empty">Aucun objet transférable (les objets équipés ne peuvent pas être donnés).</div>';
  if (map) map.closePopup();
  document.getElementById('give-mo').classList.add('on');
}
function closeGive(){ document.getElementById('give-mo').classList.remove('on'); _giveTo = null; }
function confirmGive(){
  if(!_giveTo) return;
  const myInv = joueurs[viewerId]?.inventory || [];
  const items = [];
  document.querySelectorAll('#give-list input').forEach(inp => {
    const max = parseInt(inp.dataset.max)||0;
    let n = Math.max(0, Math.min(parseInt(inp.value)||0, max));
    if(n<=0) return;
    if(inp.dataset.ammo != null){            // munitions
      items.push({ ammo: true, cal: inp.dataset.ammo, n });
    } else {
      const it = myInv[parseInt(inp.dataset.inv)];
      if(it) items.push({ name: it.name, type: it.type, w: it.w||0, n, water: it.water });
    }
  });
  if(!items.length){ carteToast('Sélectionne au moins 1 objet.'); return; }
  const to = _giveTo;
  closeGive();
  _sendProposal(to, 'give', { items });
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
  if(p.type === 'give'){
    const lst = (p.items||[]).map(it => `${it.n}× ${_exEsc(it.ammo ? ('▪ '+it.cal) : it.name)}${(it.water!=null) ? ' (💧'+it.water+')' : ''}`).join(', ');
    body = `<b>${_exEsc(p.fromNom)}</b> veut te <b>donner</b> : ${lst || '—'}.`;
  }
  document.getElementById('prop-title').textContent =
    p.type === 'give' ? '🎁 Don proposé'
    : p.type === 'group' ? '👥 Proposition de groupe'
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
    else if(p.type === 'give')   await _applyGive(p);
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
async function _applyGive(p){
  const fromRef = fdb.collection('joueurs').doc(p.from);
  const toRef   = fdb.collection('joueurs').doc(p.to);
  const [fs, ts] = await Promise.all([fromRef.get(), toRef.get()]);
  const fromInv  = (fs.exists && Array.isArray(fs.data().inventory)) ? fs.data().inventory : [];
  const toInv    = (ts.exists && Array.isArray(ts.data().inventory)) ? ts.data().inventory : [];
  const fromAmmo = (fs.exists && Array.isArray(fs.data().ammo)) ? fs.data().ammo : [];
  const toAmmo   = (ts.exists && Array.isArray(ts.data().ammo)) ? ts.data().ammo : [];
  (p.items||[]).forEach(gi => {
    if(gi.ammo){            // munitions
      const src = fromAmmo.find(a => a.cal === gi.cal);
      if(!src) return;
      const give = Math.min(gi.n, src.qty || 0);
      if(give<=0) return;
      src.qty = (src.qty || 0) - give;
      const dst = toAmmo.find(a => a.cal === gi.cal);
      if(dst) dst.qty = (dst.qty || 0) + give;
      else toAmmo.push({ cal: gi.cal, qty: give });
      return;
    }
    const isCont = (window.DB?.stuff||[]).some(s => s.n === gi.name && s.cap != null);
    // Contenant d'eau : on cible l'exemplaire ayant la bonne quantité d'eau, et on ne fusionne pas (eau par exemplaire)
    const src = fromInv.find(it => it.name === gi.name && it.type === gi.type && (!isCont || (it.water||0) === (gi.water||0)))
             || fromInv.find(it => it.name === gi.name && it.type === gi.type);
    if(!src) return;
    const give = Math.min(gi.n, src.qty || 1);
    src.qty = (src.qty || 1) - give;
    if(isCont){
      for(let k=0;k<give;k++) toInv.push({ name: gi.name, type: gi.type, w: gi.w || 0, qty: 1, water: gi.water || 0 });
    } else {
      const dst = toInv.find(it => it.name === gi.name && it.type === gi.type && !it.equipped);
      if(dst) dst.qty = (dst.qty || 1) + give;
      else toInv.push({ name: gi.name, type: gi.type, w: gi.w || 0, qty: give });
    }
  });
  const cleanFrom = fromInv.filter(it => (it.qty || 0) > 0);
  const cleanFromAmmo = fromAmmo.filter(a => (a.qty || 0) > 0);
  await Promise.all([
    fromRef.set({ inventory: cleanFrom, ammo: cleanFromAmmo }, { merge:true }),
    toRef.set({ inventory: toInv, ammo: toAmmo }, { merge:true })
  ]);
}
function _logMJ(p){
  let txt = '';
  if(p.type === 'group')   txt = `${p.fromNom} et ${p.toNom} forment un groupe.`;
  if(p.type === 'numbers') txt = `${p.fromNom} et ${p.toNom} ont échangé leurs numéros.`;
  if(p.type === 'beacon')  txt = `${p.fromNom} et ${p.toNom} ont échangé leurs balises GPS (visibles en permanence sur la carte).`;
  if(p.type === 'give'){ const lst = (p.items||[]).map(it => `${it.n}× ${it.name}`).join(', '); txt = `${p.fromNom} a donné à ${p.toNom} : ${lst}.`; }
  if(typeof logJournal === 'function') logJournal({ type:'info', title:'Échange entre joueurs', text: txt, revealedFor: [], src: 'echange:' + (p.ts || Date.now()) });
  if(typeof fpLogAction === 'function') fpLogAction(fdb, joueurs[viewerId]?.nom || viewerId, txt);
}
