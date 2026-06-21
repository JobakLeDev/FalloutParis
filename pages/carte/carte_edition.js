// ============================================================
// carte_edition.js — Outils d'ÉDITION MJ : clic carte, déplacement de
// jetons, ping, POI (créer/éditer/supprimer), zones (dessin/formulaire),
// révélation par joueur. Extrait de carte.js.
// Scope global partagé : chargé APRÈS carte.js (états + helpers y restent),
// appels résolus au runtime. Aucune variable/exécution top-level ici.
// ============================================================
// ============================================================
// ÉDITION (MJ)
// ============================================================
function onMapClick(e) {
  if (moveMode) { handleMoveClick(e.latlng); return; }
  if (pingMode) { sendPing(e.latlng); return; }
  if (addingPOI) { creerPOI(e.latlng); return; }
  if (drawingZone) { drawingZone.pts.push([e.latlng.lat, e.latlng.lng]); drawingZone.layer.setLatLngs(drawingZone.pts); }
}

// ---- OUTIL DÉPLACEMENT DE JETON (clic jeton → clic destination) ----
// Désactive les clics sur zones/marqueurs (pour que le clic atteigne la carte).
// Via une classe CSS car les éléments .leaflet-interactive forcent pointer-events:auto.
function setLayersClickable(on) {
  const m = document.getElementById('map'); if (m) m.classList.toggle('move-passthrough', !on);
}
// Déplacement déclenché depuis le popup d'un jeton (flèche ➤)
function startMoveFromToken(id) {
  const t = mapData.tokens?.[id]; if (!t) return;
  map.closePopup();
  pingMode = false; document.getElementById('btn-ping')?.classList.remove('on');
  addingPOI = false; if(typeof updatePoiPicker==='function')updatePoiPicker(); cancelDrawZone();
  moveMode = true; movingToken = { id, from: { ...t } };
  setLayersClickable(false);                        // les clics passent à la carte
  setHint('Clique la destination pour « ' + (joueurs[id]?.nom || id) + ' ».');
  renderTokens();
}
function endMoveMode() {
  moveMode = false; movingToken = null;
  setLayersClickable(true);
  setHint('');
  renderTokens();
}

// ---- PING JOUEURS (signal lumineux 30 s sur toutes les cartes) ----
function togglePingMode() {
  if (pingMode) { endPingMode(); return; }
  pingMode = true;
  moveMode = false; movingToken = null;
  addingPOI = false; if(typeof updatePoiPicker==='function')updatePoiPicker(); cancelDrawZone();
  setLayersClickable(false);
  document.getElementById('btn-ping').classList.add('on');
  setHint('Clique l\'endroit à signaler aux joueurs.');
}
function endPingMode() {
  pingMode = false; setLayersClickable(true);
  document.getElementById('btn-ping')?.classList.remove('on'); setHint('');
}
function sendPing(latlng) {
  mapData.ping = { lat: latlng.lat, lng: latlng.lng, ts: Date.now() };
  saveData();
  endPingMode();
}
function renderPing() {
  if (pingLayer) { map.removeLayer(pingLayer); pingLayer = null; }
  const p = mapData.ping; if (!p || !p.ts) return;
  const remaining = 30000 - (Date.now() - p.ts);
  if (remaining <= 0) return;
  pingLayer = L.marker([p.lat, p.lng], { interactive: false, icon: L.divIcon({
    className: 'ping-pin', html: '<span class="ping-ring"></span><span class="ping-ring r2"></span><span class="ping-dot"></span>', iconSize: [0, 0] }) }).addTo(map);
  setTimeout(() => { if (pingLayer) { map.removeLayer(pingLayer); pingLayer = null; } }, remaining);
}
function handleMoveClick(latlng) {
  if (!movingToken) { endMoveMode(); return; }
  if (movingToken.ids) {                              // déplacement de groupe : tous les membres vers la destination
    let dist = 0;
    movingToken.ids.forEach(id => {
      const from = mapData.tokens[id] || movingToken.from;
      dist = Math.max(dist, L.latLng(from.lat, from.lng).distanceTo(latlng));
      mapData.tokens[id] = { lat: latlng.lat, lng: latlng.lng };
      recordFog(id, from.lat, from.lng); recordFog(id, latlng.lat, latlng.lng);
      applyZoneRads(id, latlng.lat, latlng.lng);   // irradiation auto (chaque membre)
    });
    saveData();
    showMoveResult(movingToken.ids[0], dist, zonesAlongPath(movingToken.from, latlng));
    endMoveMode();
    return;
  }
  executeMove(movingToken.id, movingToken.from, latlng);
  endMoveMode();
}
function executeMove(id, from, to) {
  const dist = L.latLng(from.lat, from.lng).distanceTo(L.latLng(to.lat, to.lng));
  const zones = zonesAlongPath(from, to);
  // déplacer le jeton + tracer le brouillard en ligne droite (rayon applicable)
  mapData.tokens[id] = { lat: to.lat, lng: to.lng };
  recordFog(id, from.lat, from.lng);
  recordFog(id, to.lat, to.lng);
  saveData();
  applyZoneRads(id, to.lat, to.lng);   // irradiation auto selon la zone d'arrivée
  showMoveResult(id, dist, zones);
}
// Zones traversées le long du trajet (échantillonnage) → [{name, genUrl}]
function zonesAlongPath(from, to) {
  const steps = 30, seen = new Map();
  for (let i = 0; i <= steps; i++) {
    const lat = from.lat + (to.lat - from.lat) * i / steps;
    const lng = from.lng + (to.lng - from.lng) * i / steps;
    const z = detectZone(lat, lng);
    if (z) seen.set(z.name, z);
  }
  return [...seen.values()];
}
function showMoveResult(id, dist, zones) {
  const el = document.getElementById('move-result'); if (!el) return;
  const nom = joueurs[id]?.nom || id;
  const distTxt = dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(2) + ' km';
  el.innerHTML = `<div class="mjp-section">
    <div class="mjp-title">Déplacement</div>
    <div class="pz-row"><span class="pz-nom">${nom}</span><span class="pz-zone" style="color:var(--am)">${distTxt}</span></div>
    <div class="mjp-title" style="margin-top:6px">Zones traversées</div>
    ${zones.length ? zones.map(z => `<div class="pz-row"><span class="pz-nom">${z.name}</span><a class="pz-gen" href="${z.genUrl}" title="Générer rencontre">⚔</a></div>`).join('') : '<span class="empty">Aucune</span>'}
  </div>`;
}
function centerOnToken(id) {
  const t = mapData.tokens?.[id]; if (!t) return;
  map.setView([t.lat, t.lng], map.getZoom(), { animate: true });
}
// Barre de pictos pour ajouter un POI (MJ)
function buildPoiPicker(){
  const el = document.getElementById('poi-picker'); if (!el) return;
  el.innerHTML = Object.entries(POI_TYPES).map(([k,t]) =>
    `<button class="poi-pick" id="poi-pick-${k}" title="${t.label}" onclick="startAddPOI('${k}')" style="color:${t.color}">
       <span class="pp-ic">${t.icon}</span></button>`).join('');
  updatePoiPicker();
}
function updatePoiPicker(){
  document.querySelectorAll('.poi-pick').forEach(b => b.classList.remove('on'));
  if (addingPOI){ const b = document.getElementById('poi-pick-' + pendingPoiType); if (b) b.classList.add('on'); }
}
function startAddPOI(type){
  if (!POI_TYPES[type]) type = 'other';
  if (addingPOI && pendingPoiType === type){ addingPOI = false; updatePoiPicker(); setHint(''); return; }   // re-clic = annuler
  addingPOI = true; pendingPoiType = type; cancelDrawZone();
  updatePoiPicker();
  setHint('Clique sur la carte pour placer : ' + POI_TYPES[type].label);
}
async function creerPOI(latlng) {
  const type = POI_TYPES[pendingPoiType] ? pendingPoiType : 'other';
  addingPOI = false; updatePoiPicker(); setHint('');
  const name = await fpPrompt('Nom du ' + POI_TYPES[type].label + ' :'); if (!name) return;
  const desc = await fpPrompt('Description (optionnel) :') || '';
  mapData.pois.push({ id: 'p' + Date.now(), name, type,
    lat: latlng.lat, lng: latlng.lng, desc, revealedFor: [] });
  saveData();
}
async function editPOI(id) {
  const p = mapData.pois.find(x => x.id === id); if (!p) return;
  const name = await fpPrompt('Nom :', p.name); if (name === null) return;
  const type = await fpPrompt('Type (' + Object.keys(POI_TYPES).join(', ') + ') :', p.type);
  const desc = await fpPrompt('Description :', p.desc || '');
  p.name = name || p.name; if (POI_TYPES[type]) p.type = type; p.desc = desc || '';
  saveData();
}
function toggleDrawZone() {
  if (drawingZone) { cancelDrawZone(); return; }
  addingPOI = false; updatePoiPicker();
  drawingZone = { pts: [], layer: L.polyline([], { color: '#e8a820', weight: 2, dashArray: '4 4' }).addTo(map) };
  document.getElementById('draw-actions').style.display = 'block';
  document.getElementById('btn-draw-zone').classList.add('on');
  setHint('Clique pour poser les sommets, puis « Terminer ».');
}
function finishDrawZone() {
  if (!drawingZone || drawingZone.pts.length < 3) { cancelDrawZone(); return; }
  const polygon = drawingZone.pts.map(p => ({ lat: p[0], lng: p[1] }));
  cancelDrawZone();
  openZoneForm({ polygon });
}

// ---- Formulaire de zone (création / édition) ----
function _fill(id, obj, labelFn, noneLabel) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = (noneLabel ? `<option value="">${noneLabel}</option>` : '')
    + Object.keys(obj || {}).map(k => `<option value="${k}">${labelFn(k)}</option>`).join('');
}
function openZoneForm(ctx) {
  zoneFormCtx = ctx;
  const z = ctx.zone;
  _fill('zf-base', window.ZONES_DB, k => window.ZONES_DB[k].label || k, false);
  _fill('zf-occ', window.ZONE_OCCUPATION, k => window.FACTIONS?.[k]?.label || OCC_LABELS[k] || k, false);
  _fill('zf-var', window.ZONE_VARIATIONS, k => VARIATION_LABELS[k] || k, 'Aucune');
  _fill('zf-threat', window.ZONE_THREAT, k => THREAT_LABELS[k] || k, false);
  document.getElementById('zf-name').value = z?.name || '';
  document.getElementById('zf-base').value = z?.baseZone || Object.keys(window.ZONES_DB || {})[0] || '';
  document.getElementById('zf-occ').value = z?.occupation || 'neutral';
  document.getElementById('zf-var').value = z?.variation || '';
  document.getElementById('zf-threat').value = z?.threat || 'normal';
  document.getElementById('zf-rad').value = z?.radLevel || 0;
  document.getElementById('zone-form').style.display = 'flex';
}
function closeZoneForm() { document.getElementById('zone-form').style.display = 'none'; zoneFormCtx = null; }
function editZone(id) { const z = mapData.zones.find(x => x.id === id); if (z) { map.closePopup(); openZoneForm({ zone: z }); } }
function submitZoneForm() {
  if (!zoneFormCtx) return;
  const g = id => document.getElementById(id).value;
  const base = g('zf-base');
  const data = {
    name: g('zf-name').trim() || window.ZONES_DB?.[base]?.label || base,
    baseZone: base, occupation: g('zf-occ') || 'neutral',
    variation: g('zf-var') || '', threat: g('zf-threat') || 'normal',
    radLevel: Math.max(0, parseInt(g('zf-rad')) || 0),
  };
  if (zoneFormCtx.zone) Object.assign(zoneFormCtx.zone, data);
  else mapData.zones.push({ id: 'z' + Date.now(), polygon: zoneFormCtx.polygon, revealedFor: [], ...data });
  saveData();
  closeZoneForm();
}
function cancelDrawZone() {
  if (drawingZone) { map.removeLayer(drawingZone.layer); drawingZone = null; }
  const da = document.getElementById('draw-actions'); if (da) da.style.display = 'none';
  document.getElementById('btn-draw-zone')?.classList.remove('on');
  setHint('');
}
function placerJetons() {
  const ctr = map.getCenter(); const c = { lat: ctr.lat, lng: ctr.lng }; let n = 0;
  Object.keys(joueurs).forEach(id => { if (!mapData.tokens[id]) { mapData.tokens[id] = { ...c }; n++; } });
  if (n) saveData();
  setHint(n ? n + ' jeton(s) placé(s) au centre — active l\'édition pour les déplacer.' : 'Tous les jetons existent déjà.');
}

// ---- Révélation par joueur ----
function _item(kind, id) { return kind === 'poi' ? mapData.pois.find(p => p.id === id) : mapData.zones.find(z => z.id === id); }
function toggleRevealFor(kind, id, pid) {
  const it = _item(kind, id); if (!it) return;
  delete it.revealed;                               // bascule vers le modèle par-joueur
  it.revealedFor = it.revealedFor || [];
  const i = it.revealedFor.indexOf(pid);
  if (i >= 0) it.revealedFor.splice(i, 1); else it.revealedFor.push(pid);
  saveData();
  if (kind === 'poi' && it.revealedFor.includes(pid)) logLieu(it.name || 'Lieu', pid, 'poi:' + id);
}
function revealForAll(kind, id, all) {
  const it = _item(kind, id); if (!it) return;
  delete it.revealed;
  it.revealedFor = all ? Object.keys(joueurs) : [];
  saveData();
  if (kind === 'poi' && all) Object.keys(joueurs).forEach(pid => logLieu(it.name || 'Lieu', pid, 'poi:' + id));
}
function deletePOI(id) { mapData.pois = mapData.pois.filter(x => x.id !== id); openItem = null; saveData(); map.closePopup(); }
function deleteZone(id) { mapData.zones = mapData.zones.filter(z => z.id !== id); openItem = null; saveData(); map.closePopup(); }
function setHint(txt) { const el = document.getElementById('mjp-hint'); if (el) el.textContent = txt; }
