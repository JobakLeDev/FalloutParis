// ============================================================
// CARTE — Visualiseur Leaflet (image CRS.Simple) + marqueurs de zones
// Les zones viennent de window.ZONES_DB (db.js). Positions plaçables en
// mode édition, sauvegardées en localStorage + export JSON.
// ============================================================

const IMG_SRC = '../../img/paris%20fallout.jpg'; // ← changer si autre fichier
const LS_KEY  = 'carte_zone_positions';

let map, editMode = false;
const markers = {};

function init() {
  const img = new Image();
  img.onload  = () => buildMap(img.naturalWidth, img.naturalHeight);
  img.onerror = () => { document.getElementById('carte-msg').style.display = 'flex'; };
  img.src = IMG_SRC;
}

function buildMap(w, h) {
  map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -6, maxZoom: 4, zoomSnap: 0.25,
    attributionControl: false,
  });
  const bounds = [[0, 0], [h, w]];
  L.imageOverlay(IMG_SRC, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(L.latLngBounds(bounds).pad(0.3));
  window.DB_READY.then(() => placeZones(w, h));
}

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
}
function savePositions(p) { localStorage.setItem(LS_KEY, JSON.stringify(p)); }

function placeZones(w, h) {
  const zones = window.ZONES_DB || {};
  const saved = loadPositions();
  const keys = Object.keys(zones);
  const cols = Math.ceil(Math.sqrt(keys.length || 1));

  keys.forEach((k, i) => {
    let pos = saved[k];
    if (!pos) {                       // position par défaut : grille au centre
      const r = Math.floor(i / cols), c = i % cols;
      pos = [h * (0.30 + 0.40 * r / Math.max(1, cols - 1)),
             w * (0.30 + 0.40 * c / Math.max(1, cols - 1))];
    }
    const m = L.marker(pos, { draggable: editMode, icon: zoneIcon(zones[k]) }).addTo(map);
    m.bindPopup(zonePopup(k, zones[k]));
    m.on('dragend', () => {
      const p = loadPositions();
      const ll = m.getLatLng();
      p[k] = [Math.round(ll.lat), Math.round(ll.lng)];
      savePositions(p);
    });
    markers[k] = m;
  });
}

function zoneIcon(zone) {
  return L.divIcon({
    className: 'zone-pin',
    html: `<span class="zone-pin-dot"></span><span class="zone-pin-label">${zone.label || ''}</span>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  });
}

function zonePopup(key, zone) {
  const top = Object.entries(zone.pool || {})
    .filter(([n]) => n !== 'none')
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, w]) => `${n} <span style="color:#4a7a4a">(${w})</span>`).join(' · ');
  return `<div class="zpop">
    <div class="zpop-title">${zone.label || key}</div>
    <div class="zpop-pool">${top || '—'}</div>
    <a class="zpop-link" href="../mj/mj.html?zone=${encodeURIComponent(key)}">⚔ Générateur de rencontres</a>
  </div>`;
}

function toggleEdit() {
  editMode = !editMode;
  Object.values(markers).forEach(m => {
    if (m.dragging) editMode ? m.dragging.enable() : m.dragging.disable();
  });
  document.getElementById('edit-btn').classList.toggle('on', editMode);
  document.getElementById('edit-hint').style.display = editMode ? 'block' : 'none';
}

function exportPositions() {
  const p = loadPositions();
  const txt = JSON.stringify(p, null, 2);
  navigator.clipboard?.writeText(txt).catch(() => {});
  window.prompt('Positions des zones (copiées) — à coller dans data/zone_positions.json :', txt);
}

document.addEventListener('DOMContentLoaded', init);
