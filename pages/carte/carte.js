// ============================================================
// CARTE — Leaflet (image CRS.Simple) + couche système (POI, zones,
// jetons joueurs) synchronisée Firebase /carte/data.
// Révélation PAR JOUEUR : chaque POI/zone a revealedFor:[joueurIds].
//   - MJ (auth 1234, pas de ?id) : voit tout + édite + révèle par joueur
//   - Joueur (?id=<joueurId>) : voit seulement ce qui lui est révélé + jetons
//   - ?embed=1 : masque le header (intégration iframe dans la fiche)
// Firestore interdit les tableaux imbriqués → polygones en [{lat,lng}].
// ============================================================

const IMG_SRC = '../../img/paris%20fallout.jpg';
const MJ_CODE = '1234';

const POI_TYPES = {
  settlement: { label: 'Colonie',    color: '#5dbe5d', icon: '🏠' },
  faction:    { label: 'QG Faction', color: '#4a7ba6', icon: '🚩' },
  danger:     { label: 'Danger',     color: '#e04040', icon: '☢' },
  loot:       { label: 'Cache',      color: '#e8a820', icon: '📦' },
  quest:      { label: 'Objectif',   color: '#f1c40f', icon: '❗' },
  npc:        { label: 'PNJ',        color: '#b0f0b0', icon: '👤' },
  other:      { label: 'Lieu',       color: '#7ed87e', icon: '📍' },
};

const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');               // perspective d'un joueur
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb, map, mapW = 0, mapH = 0;
let editMode = false, addingPOI = false, drawingZone = null;
let mapData = { pois: [], zones: {}, tokens: {} };
let joueurs = {};
let zoneLayer, poiLayer, tokenLayer;
const poiMarkers = {}, zonePolys = {};
let openItem = null, reopening = false;            // popup ouvert (pour le réouvrir après render)

function init() {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  const img = new Image();
  img.onload  = () => { mapW = img.naturalWidth; mapH = img.naturalHeight; buildMap(); };
  img.onerror = () => { document.getElementById('carte-msg').style.display = 'flex'; };
  img.src = IMG_SRC;
}

function buildMap() {
  map = L.map('map', { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, attributionControl: false });
  const bounds = [[0, 0], [mapH, mapW]];
  L.imageOverlay(IMG_SRC, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(L.latLngBounds(bounds).pad(0.3));

  zoneLayer = L.layerGroup().addTo(map);
  poiLayer = L.layerGroup().addTo(map);
  tokenLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);
  map.on('popupclose', () => { if (!reopening) openItem = null; });

  updateModeUI();

  window.DB_READY.then(() => {
    fdb.collection('joueurs').onSnapshot(s => {
      joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
      renderAll();
    });
    fdb.collection('carte').doc('data').onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      mapData = { pois: d.pois || [], zones: d.zones || {}, tokens: d.tokens || {} };
      renderAll();
    });
  });
}

async function saveData() {
  try { await fdb.collection('carte').doc('data').set(mapData); }
  catch (e) { console.error('saveData:', e); }
}

// ---- Visibilité d'un élément selon la perspective ----
function visibleFor(item) {
  if (isMJ) return true;
  if (item.revealed === true) return true;                          // legacy/global
  if (viewerId && Array.isArray(item.revealedFor) && item.revealedFor.includes(viewerId)) return true;
  return false;
}
function anyRevealed(item) {
  return item.revealed === true || (Array.isArray(item.revealedFor) && item.revealedFor.length > 0);
}

// ---- AUTH MJ ----
function demanderMJ() {
  if (isMJ || viewerId) return;
  if (prompt('Code MJ :') !== MJ_CODE) return;
  sessionStorage.setItem('mj_auth', '1');
  isMJ = true; updateModeUI(); renderAll();
}
function updateModeUI() {
  const md = document.getElementById('hdr-mode');
  if (md) md.textContent = isMJ ? 'Vue MJ' : (viewerId ? 'Vue joueur' : 'Visiteur');
  const mb = document.getElementById('mj-btn'); if (mb) mb.style.display = (isMJ || viewerId) ? 'none' : 'inline-block';
  const eb = document.getElementById('edit-btn'); if (eb) eb.style.display = isMJ ? 'inline-block' : 'none';
  const mp = document.getElementById('mj-panel'); if (mp) mp.style.display = isMJ ? 'block' : 'none';
}
function toggleEdit() {
  editMode = !editMode;
  document.getElementById('edit-btn').classList.toggle('on', editMode);
  document.getElementById('mjp-tools').style.display = editMode ? 'block' : 'none';
  if (!editMode) { addingPOI = false; cancelDrawZone(); }
  renderAll();
}

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  if (!map) return;
  reopening = true;
  renderZones();
  renderPOIs();
  renderTokens();
  renderMJPanel();
  if (openItem) {
    const layer = openItem.kind === 'poi' ? poiMarkers[openItem.id] : zonePolys[openItem.id];
    if (layer) layer.openPopup();
  }
  reopening = false;
}

function renderZones() {
  zoneLayer.clearLayers();
  for (const k in zonePolys) delete zonePolys[k];
  Object.entries(mapData.zones || {}).forEach(([key, z]) => {
    if (!z.polygon || z.polygon.length < 3 || !visibleFor(z)) return;
    const latlngs = z.polygon.map(p => [p.lat, p.lng]);
    const def = window.ZONES_DB?.[key] || {};
    const dim = isMJ && !anyRevealed(z);
    const poly = L.polygon(latlngs, {
      color: dim ? '#888' : '#5dbe5d', weight: dim ? 1 : 2, dashArray: dim ? '5 5' : null,
      fillColor: '#5dbe5d', fillOpacity: dim ? 0.04 : 0.12,
    }).addTo(zoneLayer);
    poly.bindPopup(zonePopup(key, def, z));
    poly.on('popupopen', () => { openItem = { kind: 'zone', id: key }; });
    zonePolys[key] = poly;
    L.marker(polygonCentroid(latlngs), { interactive: false, icon: L.divIcon({
      className: 'zone-area-label', html: (def.label || key) + (dim ? ' 🔒' : ''), iconSize: [0, 0],
    }) }).addTo(zoneLayer);
  });
}

function renderPOIs() {
  poiLayer.clearLayers();
  for (const k in poiMarkers) delete poiMarkers[k];
  (mapData.pois || []).forEach(p => {
    if (!visibleFor(p)) return;
    const t = POI_TYPES[p.type] || POI_TYPES.other;
    const dim = isMJ && !anyRevealed(p);
    const m = L.marker([p.lat, p.lng], {
      draggable: isMJ && editMode, opacity: dim ? 0.5 : 1,
      icon: L.divIcon({ className: 'poi-pin',
        html: `<span class="poi-dot" style="background:${t.color}">${t.icon}</span><span class="poi-label">${p.name}${dim ? ' 🔒' : ''}</span>`,
        iconSize: [16, 16], iconAnchor: [8, 8] }),
    }).addTo(poiLayer);
    m.bindPopup(poiPopup(p, t));
    m.on('popupopen', () => { openItem = { kind: 'poi', id: p.id }; });
    poiMarkers[p.id] = m;
    if (isMJ && editMode) m.on('dragend', () => {
      const o = mapData.pois.find(x => x.id === p.id);
      if (o) { o.lat = m.getLatLng().lat; o.lng = m.getLatLng().lng; saveData(); }
    });
  });
}

function renderTokens() {
  tokenLayer.clearLayers();
  Object.entries(mapData.tokens || {}).forEach(([id, pos]) => {
    if (!pos) return;
    const nom = joueurs[id]?.nom || id;
    const me = id === viewerId;
    const m = L.marker([pos.lat, pos.lng], {
      draggable: isMJ && editMode,
      icon: L.divIcon({ className: 'token-pin' + (me ? ' me' : ''),
        html: `<span class="token-dot">${nom.charAt(0).toUpperCase()}</span><span class="token-label">${nom}${me ? ' (toi)' : ''}</span>`,
        iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(tokenLayer);
    m.bindPopup('<b>' + nom + '</b>');
    if (isMJ && editMode) m.on('dragend', () => {
      mapData.tokens[id] = { lat: m.getLatLng().lat, lng: m.getLatLng().lng }; saveData();
    });
  });
}

function renderMJPanel() {
  if (!isMJ) return;
  const el = document.getElementById('player-zones'); if (!el) return;
  const ids = Object.keys(joueurs);
  if (!ids.length) { el.innerHTML = '<span class="empty">Aucun joueur</span>'; return; }
  el.innerHTML = ids.map(id => {
    const t = mapData.tokens[id];
    const zk = t ? detectZone(t.lat, t.lng) : null;
    const zl = zk ? (window.ZONES_DB?.[zk]?.label || zk) : '—';
    return `<div class="pz-row"><span class="pz-nom">${joueurs[id]?.nom || id}</span>
      <span class="pz-zone">${zl}</span>
      ${zk ? `<a class="pz-gen" href="../mj/mj.html?zone=${zk}" title="Générer rencontre">⚔</a>` : ''}</div>`;
  }).join('');
}

// ---- POPUPS ----
function zonePopup(key, def, z) {
  const top = Object.entries(def.pool || {}).filter(([n]) => n !== 'none')
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n).join(', ');
  let h = `<div class="zpop"><div class="zpop-title">${def.label || key}</div>`;
  if (top) h += `<div class="zpop-pool">${top}</div>`;
  h += `<a class="zpop-link" href="../mj/mj.html?zone=${encodeURIComponent(key)}">⚔ Générer une rencontre</a>`;
  if (isMJ) h += revealControls('zone', key, z);
  return h + '</div>';
}
function poiPopup(p, t) {
  let h = `<div class="zpop"><div class="zpop-title">${t.icon} ${p.name}</div>
    <div class="zpop-pool">${t.label}${p.desc ? ' — ' + p.desc : ''}</div>`;
  if (isMJ) h += `<div class="zpop-mj"><button onclick="editPOI('${p.id}')">✎ Éditer</button>
    <button onclick="deletePOI('${p.id}')" class="del">🗑</button></div>` + revealControls('poi', p.id, p);
  return h + '</div>';
}

// Contrôles de révélation par joueur (MJ)
function revealControls(kind, id, item) {
  const rf = item.revealedFor || [];
  const ids = Object.keys(joueurs);
  const btns = ids.length ? ids.map(pid => {
    const on = rf.includes(pid) || item.revealed === true;
    return `<button class="rv${on ? ' on' : ''}" onclick="toggleRevealFor('${kind}','${id}','${pid}')">${on ? '👁' : '∅'} ${joueurs[pid]?.nom || pid}</button>`;
  }).join('') : '<span class="empty">Aucun joueur</span>';
  return `<div class="zpop-reveal"><div class="rv-lbl">Révélé à :</div><div class="rv-grid">${btns}</div>
    <div class="rv-all"><button onclick="revealForAll('${kind}','${id}',true)">Tous</button><button onclick="revealForAll('${kind}','${id}',false)">Aucun</button></div></div>`;
}

// ============================================================
// ÉDITION (MJ)
// ============================================================
function onMapClick(e) {
  if (addingPOI) { creerPOI(e.latlng); return; }
  if (drawingZone) { drawingZone.pts.push([e.latlng.lat, e.latlng.lng]); drawingZone.layer.setLatLngs(drawingZone.pts); }
}
function toggleAddPOI() {
  addingPOI = !addingPOI;
  if (addingPOI) cancelDrawZone();
  document.getElementById('btn-add-poi').classList.toggle('on', addingPOI);
  setHint(addingPOI ? 'Clique sur la carte pour placer le POI.' : '');
}
function creerPOI(latlng) {
  addingPOI = false; document.getElementById('btn-add-poi').classList.remove('on'); setHint('');
  const name = prompt('Nom du lieu :'); if (!name) return;
  const keys = Object.keys(POI_TYPES);
  const type = prompt('Type (' + keys.join(', ') + ') :', 'settlement');
  const desc = prompt('Description (optionnel) :') || '';
  mapData.pois.push({ id: 'p' + Date.now(), name, type: POI_TYPES[type] ? type : 'other',
    lat: latlng.lat, lng: latlng.lng, desc, revealedFor: [] });
  saveData();
}
function editPOI(id) {
  const p = mapData.pois.find(x => x.id === id); if (!p) return;
  const name = prompt('Nom :', p.name); if (name === null) return;
  const type = prompt('Type (' + Object.keys(POI_TYPES).join(', ') + ') :', p.type);
  const desc = prompt('Description :', p.desc || '');
  p.name = name || p.name; if (POI_TYPES[type]) p.type = type; p.desc = desc || '';
  saveData();
}
function toggleDrawZone() {
  if (drawingZone) { cancelDrawZone(); return; }
  addingPOI = false; document.getElementById('btn-add-poi').classList.remove('on');
  drawingZone = { pts: [], layer: L.polyline([], { color: '#e8a820', weight: 2, dashArray: '4 4' }).addTo(map) };
  document.getElementById('draw-actions').style.display = 'block';
  document.getElementById('btn-draw-zone').classList.add('on');
  setHint('Clique pour poser les sommets, puis « Terminer ».');
}
function finishDrawZone() {
  if (!drawingZone || drawingZone.pts.length < 3) { cancelDrawZone(); return; }
  const keys = Object.keys(window.ZONES_DB || {});
  const key = prompt('Zone (' + keys.join(', ') + ') :', keys[0]);
  if (window.ZONES_DB?.[key]) {
    mapData.zones[key] = { polygon: drawingZone.pts.map(p => ({ lat: p[0], lng: p[1] })),
      revealedFor: mapData.zones[key]?.revealedFor || [] };
    saveData();
  }
  cancelDrawZone();
}
function cancelDrawZone() {
  if (drawingZone) { map.removeLayer(drawingZone.layer); drawingZone = null; }
  const da = document.getElementById('draw-actions'); if (da) da.style.display = 'none';
  document.getElementById('btn-draw-zone')?.classList.remove('on');
  setHint('');
}
function placerJetons() {
  const c = { lat: mapH / 2, lng: mapW / 2 }; let n = 0;
  Object.keys(joueurs).forEach(id => { if (!mapData.tokens[id]) { mapData.tokens[id] = { ...c }; n++; } });
  if (n) saveData();
  setHint(n ? n + ' jeton(s) placé(s) au centre — active l\'édition pour les déplacer.' : 'Tous les jetons existent déjà.');
}

// ---- Révélation par joueur ----
function _item(kind, id) { return kind === 'poi' ? mapData.pois.find(p => p.id === id) : mapData.zones[id]; }
function toggleRevealFor(kind, id, pid) {
  const it = _item(kind, id); if (!it) return;
  delete it.revealed;                               // bascule vers le modèle par-joueur
  it.revealedFor = it.revealedFor || [];
  const i = it.revealedFor.indexOf(pid);
  if (i >= 0) it.revealedFor.splice(i, 1); else it.revealedFor.push(pid);
  saveData();
}
function revealForAll(kind, id, all) {
  const it = _item(kind, id); if (!it) return;
  delete it.revealed;
  it.revealedFor = all ? Object.keys(joueurs) : [];
  saveData();
}
function deletePOI(id) { mapData.pois = mapData.pois.filter(x => x.id !== id); openItem = null; saveData(); map.closePopup(); }
function deleteZone(key) { delete mapData.zones[key]; openItem = null; saveData(); map.closePopup(); }
function setHint(txt) { const el = document.getElementById('mjp-hint'); if (el) el.textContent = txt; }

// ============================================================
// GÉOMÉTRIE
// ============================================================
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function detectZone(lat, lng) {
  for (const [key, z] of Object.entries(mapData.zones || {})) {
    if (z.polygon && z.polygon.length >= 3 &&
        pointInPoly(lng, lat, z.polygon.map(p => ({ x: p.lng, y: p.lat })))) return key;
  }
  return null;
}
function polygonCentroid(latlngs) {
  let y = 0, x = 0; latlngs.forEach(p => { y += p[0]; x += p[1]; });
  return [y / latlngs.length, x / latlngs.length];
}

document.addEventListener('DOMContentLoaded', init);
