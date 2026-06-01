// ============================================================
// CARTE — Leaflet (coordonnées géographiques WGS84) + couche système
// (POI, zones, jetons) synchronisée Firebase /carte/data.
// Fond : CartoDB Dark Matter + GeoJSON (seine, rails).
// Révélation PAR JOUEUR : chaque POI/zone a revealedFor:[joueurIds].
//   - MJ (auth 1234, pas de ?id) : voit tout + édite + révèle par joueur
//   - Joueur (?id=<joueurId>) : voit seulement ce qui lui est révélé + jetons
//   - ?embed=1 : masque le header (intégration iframe dans la fiche)
// Firestore interdit les tableaux imbriqués → polygones en [{lat,lng}].
// ============================================================

const GEOJSON_BASE = '../../map/';
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

const VARIATION_LABELS = { irradiated: 'Irradiée', abandoned: 'Abandonnée', occupied: 'Occupée', dark: 'Sombre', flooded: 'Inondée' };
const THREAT_LABELS    = { calme: 'Calme', normal: 'Normal', eleve: 'Élevé', extreme: 'Extrême' };
const OCC_LABELS       = { neutral: 'Neutre' };

// Distances géographiques (mètres)
const FOG_RADIUS_M    = 600;   // rayon de découverte du brouillard
const FOG_STEP_M      = 150;   // espacement min entre points explorés enregistrés
const VISION_RADIUS_M = 1500;  // rayon de vision des alliés
const TELEPORT_M      = 5000;  // au-delà : repositionnement (pas de traîné)

const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');               // perspective d'un joueur
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb, map;
let fogOverlay = null;
let editMode = false, addingPOI = false, drawingZone = null;
let mapData = { pois: [], zones: [], tokens: {}, fog: {}, geoReveal: {} };
const geoMarkerRefs = {};                          // nom → layer (pour réouverture popup)
let lieux = [];            // [{id, name, image, pois:[]}] — plans de bâtiments
let lieuActif = null;      // lieu sélectionné dans l'onglet LIEUX
let mapLieu = null;        // instance Leaflet pour les lieux
let joueurs = {};
let zoneLayer, poiLayer, tokenLayer;
const poiMarkers = {}, zonePolys = {};
let openItem = null, reopening = false;            // popup ouvert (pour le réouvrir après render)
let zoneFormCtx = null;                            // {polygon} (création) ou {zone} (édition)
let currentTab = 'paris';
let centeredOnPlayer = false;                      // vue déjà centrée sur le jeton du joueur

// Couches GeoJSON authorées (QGIS) : zones (rencontres/danger) + marqueurs
let geoZonesData = null, geoMarkersData = null;
let geoZoneLayer, geoMarkerLayer;

const GEO_MARKER_ICONS = { Landmark:'🗼', Settlement:'🏠', Safe:'🛡', Metro:'🚇', Danger:'☢', Faction:'🚩', Loot:'📦', Quest:'❗' };

// Sprite img/Icons.png (2 col × 4 lignes) → position de fond par monument (nom minuscule)
const LANDMARK_SPRITES = {
  'tour eiffel':              '0% 0%',
  'obélisque de la concorde': '100% 0%',
  'arc de triomphe':          '0% 33.333%',
  'notre-dame':               '0% 66.667%',
  'musée du louvre':          '100% 66.667%',
  'montmartre':               '0% 100%',
};
const GEO_OTHER_COLORS = { mutants:'#a05ad0', independant:'#c0a040', independants:'#c0a040', 'vault-tec':'#3a7bd5' };

// Faction GeoJSON → clé factions.json (null si pas une faction joueur)
function geoFactionKey(f) {
  const s = ('' + (f || '')).toLowerCase().trim();
  if (s.startsWith('republiq') || s.startsWith('républiq')) return 'republique';
  if (s.startsWith('commune')) return 'commune';
  if (s.startsWith('nnfp')) return 'nnfp';
  if (s.startsWith('reseau') || s.startsWith('réseau')) return 'reseau';
  if (s.startsWith('zazou')) return 'zazous';
  if (s.startsWith('ultra')) return 'ultras';
  return null;
}
// Couleur d'une zone/marqueur selon faction puis type
function geoColor(faction, type) {
  const k = geoFactionKey(faction);
  if (k && window.FACTIONS?.[k]) return window.FACTIONS[k].color;
  const o = GEO_OTHER_COLORS[('' + (faction || '')).toLowerCase().trim()];
  if (o) return o;
  if (type === 'Danger') return '#e04040';
  if (type === 'Safe') return '#5dbe5d';
  return '#7ed87e';
}
// Paramètres du générateur déduits d'une zone GeoJSON (occupation/variation/menace)
function geoZoneGenQuery(props) {
  const occ = geoFactionKey(props.Faction) || 'neutral';
  let variation = '', threat = 'normal';
  const st = ('' + (props.Statut || '')).toLowerCase();
  const ty = ('' + (props.Type || '')).toLowerCase();
  if (st.includes('rad')) { variation = 'irradiated'; threat = 'extreme'; }
  if (st.includes('inond') || st.includes('flood')) variation = 'flooded';
  if (ty === 'danger' && threat === 'normal') threat = 'eleve';
  if (ty === 'safe') threat = 'calme';
  return new URLSearchParams({ zone: 'rues', occ, var: variation, threat }).toString();
}

function init() {
  if (embed) document.body.classList.add('embed');
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  buildMap();
}

// Bornes de Paris intra-muros — délimitent la carte (pan + dézoom bloqués)
const PARIS_BOUNDS = L.latLngBounds([48.8156, 2.2241], [48.9022, 2.4699]);
const SHIFT_FRAC = 1 / 7;   // décalage horizontal de la vue vers l'ouest (gauche)
const NS_EXTEND_KM = 2;     // marge de pan navigable au nord et au sud (km)

// Bornes de pan : Paris + NS_EXTEND_KM au nord et au sud
function panBounds() {
  const dLat = NS_EXTEND_KM / 111;            // ~0.018° de latitude pour 2 km
  const sw = PARIS_BOUNDS.getSouthWest(), ne = PARIS_BOUNDS.getNorthEast();
  return L.latLngBounds([sw.lat - dLat, sw.lng], [ne.lat + dLat, ne.lng]).pad(0.02);
}

// Bornes décalées vers l'ouest de SHIFT_FRAC de la largeur
function shiftedBounds() {
  const sw = PARIS_BOUNDS.getSouthWest(), ne = PARIS_BOUNDS.getNorthEast();
  const dLng = (ne.lng - sw.lng) * SHIFT_FRAC;
  return L.latLngBounds([sw.lat, sw.lng - dLng], [ne.lat, ne.lng - dLng]);
}

// Recadre sur Paris. Format navigable : zoomé pour pouvoir scroller N-S (et E-O)
// dans tout Paris ; le dézoom est bloqué au « remplissage largeur » (pas de vide).
// resetView=true recentre la vue (init seulement, pas au resize).
function lockParis(resetView) {
  map.invalidateSize();
  map.setMinZoom(0);
  const zFill = map.getBoundsZoom(PARIS_BOUNDS, true); // Paris remplit la largeur
  map.setMinZoom(zFill);                                // dézoom min = pas de vide
  map.setMaxBounds(panBounds());                        // pan libre dans Paris + 2 km N/S
  map.options.maxBoundsViscosity = 1.0;
  if (resetView && !centeredOnPlayer) {
    const z = Math.min(zFill + 0.6, 16);               // un cran plus serré → marge de scroll N-S
    const t = viewerId ? mapData.tokens?.[viewerId] : null;
    if (t) { map.setView([t.lat, t.lng], z, { animate: false }); centeredOnPlayer = true; }
    else map.setView(shiftedBounds().getCenter(), z, { animate: false });  // défaut (jeton pas encore chargé / MJ)
  }
}

// Centre la vue sur le jeton du joueur (1re fois), clampé aux limites (maxBounds)
function tryCenterPlayer() {
  if (centeredOnPlayer || !viewerId) return;
  const t = mapData.tokens?.[viewerId];
  if (!t) return;
  map.setView([t.lat, t.lng], map.getZoom(), { animate: false });  // _limitCenter clampe aux bornes
  centeredOnPlayer = true;
}

function buildMap() {
  map = L.map('map', {
    zoomSnap: 0.25, maxZoom: 17,
    maxBounds: PARIS_BOUNDS, maxBoundsViscosity: 1.0,  // défilement bloqué aux bords
    attributionControl: false,
  });

  // Fond plein PipBoy — pas de tuiles (pas de noms de rues)
  // Les panes GeoJSON reçoivent chacun leur filtre CSS de glow
  const SVG_LOOK = ' contrast(1.25) brightness(0.9)';
  const mkPane = (name, z, glow) => {
    map.createPane(name);
    const p = map.getPane(name);
    p.style.zIndex = z;
    p.style.pointerEvents = 'none';
    p.style.filter = glow + SVG_LOOK;
  };
  mkPane('seinePane',  200, 'drop-shadow(0 0 2px rgba(85,255,136,0.25))');
  mkPane('routesPane', 201, 'drop-shadow(0 0 2px rgba(140,255,140,0.35))');
  mkPane('railsPane',  202, 'drop-shadow(0 0 1.5px rgba(140,255,140,0.25))');
  // Pane du brouillard : au-dessus des marqueurs (640) — repositionné par Leaflet
  map.createPane('fogPane'); const fp = map.getPane('fogPane'); fp.style.zIndex = 640; fp.style.pointerEvents = 'none';

  // Couches GeoJSON Paris (PipBoy style)
  loadGeoJsonLayers();

  geoZoneLayer   = L.layerGroup().addTo(map);   // zones GeoJSON (sous les zones manuelles)
  geoMarkerLayer = L.layerGroup().addTo(map);
  zoneLayer  = L.layerGroup().addTo(map);
  poiLayer   = L.layerGroup().addTo(map);
  tokenLayer = L.layerGroup().addTo(map);

  map.on('click', onMapClick);
  map.on('popupclose', () => { if (!reopening) openItem = null; });

  lockParis(true);
  setTimeout(() => lockParis(true), 300);      // re-cadrage si conteneur (iframe) pas encore dimensionné
  window.addEventListener('resize', () => { if (currentTab === 'paris') lockParis(false); });

  updateModeUI();

  window.DB_READY.then(() => {
    fdb.collection('joueurs').onSnapshot(s => {
      joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
      renderAll();
    });
    fdb.collection('carte').doc('data').onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      mapData = { pois: d.pois || [], zones: normZones(d.zones), tokens: d.tokens || {}, fog: d.fog || {}, geoReveal: d.geoReveal || {} };
      renderAll();
      tryCenterPlayer();   // au 1er chargement : centrer sur le jeton du joueur
    });
    fdb.collection('carte').doc('lieux').onSnapshot(s => {
      lieux = (s.exists ? s.data().lieux : null) || [];
      if (currentTab === 'lieux') renderLieux();
    });
  });
}

async function loadGeoJsonLayers() {
  // Seine — eau vert sombre + liseré vert vif
  try {
    const data = await fetch(GEOJSON_BASE + 'seine.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'seinePane',
      style: { color: '#4CFF77', weight: 1.6, opacity: 0.75, fillColor: '#0E2A0E', fillOpacity: 0.6 },
    }).addTo(map);
  } catch(e) { console.warn('seine.geojson non chargé', e); }
  // Routes — réseau vert clair PipBoy
  try {
    const data = await fetch(GEOJSON_BASE + 'routes.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'routesPane',
      style: f => ({ color: '#B8FFB8', weight: isMajorRoad(f) ? 1.4 : 0.7, opacity: 0.85, fill: false }),
    }).addTo(map);
  } catch(e) { console.warn('routes.geojson non chargé', e); }
  // Rails / métro — vert pointillé
  try {
    const data = await fetch(GEOJSON_BASE + 'rails.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'railsPane',
      style: { color: '#9DF09D', weight: 1.0, opacity: 0.8, dashArray: '5 3', fill: false },
    }).addTo(map);
  } catch(e) { console.warn('rails.geojson non chargé', e); }
  // Zones + marqueurs authorés (QGIS)
  try { geoZonesData   = await fetch(GEOJSON_BASE + 'zones.geojson').then(r => r.json()); }
  catch(e){ console.warn('zones.geojson non chargé', e); }
  try { geoMarkersData = await fetch(GEOJSON_BASE + 'marqueurs.geojson').then(r => r.json()); }
  catch(e){ console.warn('marqueurs.geojson non chargé', e); }
  await window.DB_READY;          // FACTIONS dispo pour couleurs/labels
  renderGeoLayers();
}

// Rendu des zones/marqueurs GeoJSON. MJ : tout (Visible=false en pointillé léger).
// Joueur : seulement Visible=true (et soumis au brouillard, comme le fond).
function renderGeoLayers() {
  if (!geoZoneLayer) return;
  geoZoneLayer.clearLayers();
  geoMarkerLayer.clearLayers();

  if (geoZonesData) {
    L.geoJSON(geoZonesData, {
      filter: f => isMJ || f.properties.Visible === true,
      style: f => {
        const col = geoColor(f.properties.Faction, f.properties.Type);
        const fonctionnelle = isMJ && f.properties.Visible !== true;  // non visible joueurs
        return { color: col, weight: fonctionnelle ? 1 : 2, dashArray: fonctionnelle ? '4 4' : null,
                 fillColor: col, fillOpacity: fonctionnelle ? 0.05 : 0.18, opacity: fonctionnelle ? 0.55 : 0.9 };
      },
      onEachFeature: (f, layer) => layer.bindPopup(geoZonePopup(f.properties)),
    }).addTo(geoZoneLayer);
  }

  if (geoMarkersData) {
    for (const k in geoMarkerRefs) delete geoMarkerRefs[k];
    L.geoJSON(geoMarkersData, {
      filter: f => geoMarkerVisibleFor(f.properties.nom),
      pointToLayer: (f, latlng) => {
        const nom = f.properties.nom || '';
        const dim = isMJ && !geoMarkerAnyRevealed(nom);   // MJ : caché = grisé + 🔒
        const lock = dim ? ' 🔒' : '';
        const sprite = LANDMARK_SPRITES[nom.toLowerCase()];
        let m;
        if (sprite) {  // monument avec icône dédiée (sprite Icons.png)
          m = L.marker(latlng, { opacity: dim ? 0.5 : 1, icon: L.divIcon({ className: 'land-pin',
            html: `<span class="land-icon" style="background-position:${sprite}"></span><span class="poi-label">${nom}${lock}</span>`,
            iconSize: [60, 45], iconAnchor: [30, 38] }) });
        } else {
          const col = geoColor(f.properties.faction, f.properties.type);
          const icon = GEO_MARKER_ICONS[f.properties.type] || '📍';
          m = L.marker(latlng, { opacity: dim ? 0.5 : 1, icon: L.divIcon({ className: 'poi-pin',
            html: `<span class="poi-dot" style="background:${col}">${icon}</span><span class="poi-label">${nom}${lock}</span>`,
            iconSize: [16, 16], iconAnchor: [8, 8] }) });
        }
        geoMarkerRefs[nom] = m;
        m.on('popupopen', () => { openItem = { kind: 'geomarker', id: nom }; });
        return m;
      },
      onEachFeature: (f, layer) => layer.bindPopup(geoMarkerPopup(f.properties)),
    }).addTo(geoMarkerLayer);
  }
}

// ---- Visibilité / révélation des marqueurs GeoJSON (par joueur, comme les POI) ----
function geoMarkerVisibleFor(nom) {
  if (isMJ) return true;
  return !!viewerId && (mapData.geoReveal?.[nom] || []).includes(viewerId);
}
function geoMarkerAnyRevealed(nom) {
  return (mapData.geoReveal?.[nom] || []).length > 0;
}
function _escq(s) { return ('' + s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// Contrôles de révélation par joueur pour un marqueur GeoJSON (MJ)
function revealControlsGeo(nom) {
  const rf = mapData.geoReveal?.[nom] || [];
  const ids = Object.keys(joueurs);
  const e = _escq(nom);
  const btns = ids.length ? ids.map(pid => {
    const on = rf.includes(pid);
    return `<button class="rv${on ? ' on' : ''}" onclick="toggleRevealGeo('${e}','${pid}')">${on ? '👁' : '∅'} ${joueurs[pid]?.nom || pid}</button>`;
  }).join('') : '<span class="empty">Aucun joueur</span>';
  return `<div class="zpop-reveal"><div class="rv-lbl">Révélé à :</div><div class="rv-grid">${btns}</div>
    <div class="rv-all"><button onclick="revealGeoAll('${e}',true)">Tous</button><button onclick="revealGeoAll('${e}',false)">Aucun</button></div></div>`;
}
function toggleRevealGeo(nom, pid) {
  mapData.geoReveal = mapData.geoReveal || {};
  const arr = mapData.geoReveal[nom] = mapData.geoReveal[nom] || [];
  const i = arr.indexOf(pid);
  if (i >= 0) arr.splice(i, 1); else arr.push(pid);
  saveData();
}
function revealGeoAll(nom, all) {
  mapData.geoReveal = mapData.geoReveal || {};
  mapData.geoReveal[nom] = all ? Object.keys(joueurs) : [];
  saveData();
}

function geoZonePopup(p) {
  const fk = geoFactionKey(p.Faction);
  const facLabel = (fk && window.FACTIONS?.[fk]?.label) || p.Faction || '—';
  const col = geoColor(p.Faction, p.Type);
  let h = `<div class="zpop"><div class="zpop-title">${p.Nom || 'Zone'}</div>
    <div class="zpop-pool"><span style="color:${col}">${facLabel}</span>${p.Type ? ' · ' + p.Type : ''}${p.Statut ? ' · ' + p.Statut : ''}</div>`;
  if (p.Descriptio) h += `<div class="zpop-pool" style="color:var(--td)">${p.Descriptio}</div>`;
  h += `<a class="zpop-link" href="../mj/mj.html?${geoZoneGenQuery(p)}">⚔ Générer une rencontre</a>`;
  if (!isMJ) {} // joueurs : pas d'outils
  return h + '</div>';
}

function geoMarkerPopup(p) {
  const fk = geoFactionKey(p.faction);
  const facLabel = (fk && window.FACTIONS?.[fk]?.label) || p.faction || '';
  const icon = GEO_MARKER_ICONS[p.type] || '📍';
  let h = `<div class="zpop"><div class="zpop-title">${icon} ${p.nom || ''}</div>
    <div class="zpop-pool">${p.type || ''}${facLabel ? ' · ' + facLabel : ''}</div>`;
  if (p.descriptio) h += `<div class="zpop-pool" style="color:var(--td)">${p.descriptio}</div>`;
  if (isMJ) h += revealControlsGeo(p.nom);
  return h + '</div>';
}

// Route principale ? (selon le tag OSM highway)
function isMajorRoad(f) {
  const h = f?.properties?.highway || '';
  return /motorway|trunk|primary|secondary/.test(h);
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

// ============================================================
// ONGLETS DE CARTE
// ============================================================
function switchMapTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.map-tab').forEach((el, i) => el.classList.toggle('on', ['paris', 'lieux'][i] === tab));
  const pw = document.getElementById('map-paris-wrap');
  const lw = document.getElementById('map-lieux-wrap');
  const pt = document.getElementById('mjp-paris-tools');
  const lt = document.getElementById('mjp-lieux-tools');
  const da = document.getElementById('draw-actions');
  if (tab === 'paris') {
    if (pw) pw.style.display = 'flex';
    if (lw) lw.style.display = 'none';
    if (pt) pt.style.display = 'block';
    if (lt) lt.style.display = 'none';
    if (map) setTimeout(() => map.invalidateSize(), 50);
  } else {
    if (pw) pw.style.display = 'none';
    if (lw) lw.style.display = 'flex';
    if (pt) pt.style.display = 'none';
    if (lt) lt.style.display = 'block';
    if (da) da.style.display = 'none';
    addingPOI = false; cancelDrawZone();
    renderLieux();
    if (mapLieu) setTimeout(() => mapLieu.invalidateSize(), 50);
  }
}

function ajouterLieu() {
  const name = prompt('Nom du lieu :'); if (!name) return;
  const image = prompt('Chemin de l\'image (ex: ../../img/plan_metro.jpg) :', '../../img/') || '';
  const newLieu = { id: 'l' + Date.now(), name, image, pois: [] };
  lieux.push(newLieu);
  fdb.collection('carte').doc('lieux').set({ lieux });
  ouvrirLieu(newLieu.id);
  switchMapTab('lieux');
}

function renderLieux() {
  const el = document.getElementById('lieux-list'); if (!el) return;
  if (!lieux.length) { el.innerHTML = '<span class="empty">Aucun lieu configuré</span>'; return; }
  el.innerHTML = lieux.map(l =>
    `<button class="lieu-btn${lieuActif?.id === l.id ? ' on' : ''}" onclick="ouvrirLieu('${l.id}')">${l.name}</button>`
  ).join('');
}

function ouvrirLieu(id) {
  const l = lieux.find(x => x.id === id); if (!l) return;
  lieuActif = l;
  const ph = document.getElementById('lieux-placeholder');
  const mapDiv = document.getElementById('map-lieux');
  if (!l.image) { if (ph) ph.style.display = 'flex'; renderLieux(); return; }
  if (ph) ph.style.display = 'none';
  if (mapLieu) { mapLieu.remove(); mapLieu = null; }
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    mapLieu = L.map(mapDiv, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, attributionControl: false });
    const bounds = [[0, 0], [h, w]];
    L.imageOverlay(l.image, bounds).addTo(mapLieu);
    mapLieu.fitBounds(bounds);
    mapLieu.setMaxBounds(L.latLngBounds(bounds).pad(0.3));
  };
  img.src = l.image;
  renderLieux();
}

// ---- AUTH MJ ----
function demanderMJ() {
  if (isMJ || viewerId) return;
  if (prompt('Code MJ :') !== MJ_CODE) return;
  sessionStorage.setItem('mj_auth', '1');
  isMJ = true; updateModeUI(); renderGeoLayers(); renderAll();
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
  renderGeoLayers();   // réagit aussi aux changements de geoReveal
  renderTokens();
  renderFog();
  renderMJPanel();
  if (openItem) {
    const layer = openItem.kind === 'poi' ? poiMarkers[openItem.id]
                : openItem.kind === 'zone' ? zonePolys[openItem.id]
                : openItem.kind === 'geomarker' ? geoMarkerRefs[openItem.id] : null;
    if (layer) layer.openPopup();
  }
  reopening = false;
}

// Normalise les zones en array d'entités (rétrocompat ancien format {key:{...}})
function normZones(z) {
  if (Array.isArray(z)) return z;
  return Object.entries(z || {}).map(([key, v]) => ({
    id: 'z' + key, name: window.ZONES_DB?.[key]?.label || key,
    polygon: v.polygon || [], revealedFor: v.revealedFor || [],
    baseZone: key, occupation: 'neutral', variation: '', threat: 'normal',
  }));
}

function renderZones() {
  zoneLayer.clearLayers();
  for (const k in zonePolys) delete zonePolys[k];
  (mapData.zones || []).forEach(z => {
    if (!z.polygon || z.polygon.length < 3 || !visibleFor(z)) return;
    const latlngs = z.polygon.map(p => [p.lat, p.lng]);
    const dim = isMJ && !anyRevealed(z);
    const fcol = window.FACTIONS?.[z.occupation]?.color || '#5dbe5d';
    const poly = L.polygon(latlngs, {
      color: dim ? '#888' : fcol, weight: dim ? 1 : 2, dashArray: dim ? '5 5' : null,
      fillColor: fcol, fillOpacity: dim ? 0.05 : 0.15,
    }).addTo(zoneLayer);
    poly.bindPopup(zonePopup(z));
    poly.on('popupopen', () => { openItem = { kind: 'zone', id: z.id }; });
    zonePolys[z.id] = poly;
    L.marker(polygonCentroid(latlngs), { interactive: false, icon: L.divIcon({
      className: 'zone-area-label', html: (z.name || '') + (dim ? ' 🔒' : ''), iconSize: [0, 0],
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
  const my = (!isMJ && viewerId) ? mapData.tokens?.[viewerId] : null;
  Object.entries(mapData.tokens || {}).forEach(([id, pos]) => {
    if (!pos) return;
    // Vue joueur : alliés visibles uniquement dans VISION_RADIUS_M mètres
    if (!isMJ && viewerId && id !== viewerId) {
      if (!my) return;
      if (L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) > VISION_RADIUS_M) return;
    }
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
      const ll = m.getLatLng();
      mapData.tokens[id] = { lat: ll.lat, lng: ll.lng };
      recordFog(id, ll.lat, ll.lng);
      saveData();
    });
  });
}

// ---- BROUILLARD (L.imageOverlay sur l'étendue de Paris, dans le pane fog) ----
// Repositionné automatiquement par Leaflet au pan/zoom ; on ne le redessine
// qu'au changement de données (renderFog appelé dans renderAll).
const FOG_RES = 1500;          // résolution du canvas fog (px sur la largeur)

function renderFog() {
  if (fogOverlay) { map.removeLayer(fogOverlay); fogOverlay = null; }
  if (isMJ || !viewerId) return;

  const b = panBounds();
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const dLng = ne.lng - sw.lng, dLat = ne.lat - sw.lat;
  const W = FOG_RES, H = Math.max(1, Math.round(W * dLat / dLng));
  // latlng → pixel du canvas (linéaire sur l'étendue b)
  const toPx = (lat, lng) => ({ x: (lng - sw.lng) / dLng * W, y: (1 - (lat - sw.lat) / dLat) * H });
  // rayon (m) → px sur le canvas
  const widthM = dLng * 111000 * Math.cos((sw.lat + ne.lat) / 2 * Math.PI / 180);
  const rad = FOG_RADIUS_M / widthM * W;

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(4,8,4,0.92)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';

  const pts = (mapData.fog?.[viewerId] || []).slice();
  const myPos = mapData.tokens?.[viewerId]; if (myPos) pts.push(myPos);
  (mapData.pois || []).forEach(p => { if (visibleFor(p)) pts.push({ lat: p.lat, lng: p.lng }); });
  (mapData.zones || []).forEach(z => {
    if (z.polygon?.length >= 3 && visibleFor(z)) {
      const c = polygonCentroid(z.polygon.map(p => [p.lat, p.lng]));
      pts.push({ lat: c[0], lng: c[1] });
    }
  });
  if (geoMarkersData) geoMarkersData.features.forEach(f => {
    if (geoMarkerVisibleFor(f.properties.nom)) { const c = f.geometry.coordinates; pts.push({ lat: c[1], lng: c[0] }); }
  });

  pts.forEach(p => {
    const px = toPx(p.lat, p.lng);
    const g = ctx.createRadialGradient(px.x, px.y, rad * 0.3, px.x, px.y, rad);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px.x, px.y, rad, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';

  fogOverlay = L.imageOverlay(cv.toDataURL(), b, { pane: 'fogPane', interactive: false }).addTo(map);
}

// Enregistre le trajet exploré en mètres (gommage permanent, traînée interpolée).
function recordFog(id, lat, lng) {
  mapData.fog = mapData.fog || {};
  const arr = mapData.fog[id] = mapData.fog[id] || [];
  const last = arr[arr.length - 1];
  if (!last) { arr.push({ lat, lng }); return; }
  const dist = L.latLng(last.lat, last.lng).distanceTo(L.latLng(lat, lng));
  if (dist < FOG_STEP_M) return;
  if (dist > TELEPORT_M) { arr.push({ lat, lng }); return; }
  const n = Math.ceil(dist / FOG_STEP_M);
  for (let i = 1; i <= n; i++)
    arr.push({ lat: last.lat + (lat - last.lat) * i / n, lng: last.lng + (lng - last.lng) * i / n });
}

function renderMJPanel() {
  if (!isMJ) return;
  const el = document.getElementById('player-zones'); if (!el) return;
  const ids = Object.keys(joueurs);
  if (!ids.length) { el.innerHTML = '<span class="empty">Aucun joueur</span>'; return; }
  el.innerHTML = ids.map(id => {
    const t = mapData.tokens[id];
    const z = t ? detectZone(t.lat, t.lng) : null;
    return `<div class="pz-row"><span class="pz-nom">${joueurs[id]?.nom || id}</span>
      <span class="pz-zone">${z ? z.name : '—'}</span>
      ${z ? `<a class="pz-gen" href="${z.genUrl}" title="Générer rencontre">⚔</a>` : ''}</div>`;
  }).join('');
}

// ---- POPUPS ----
function zonePopup(z) {
  const base = window.ZONES_DB?.[z.baseZone] || {};
  const fac = window.FACTIONS?.[z.occupation];
  const tags = [];
  if (fac) tags.push(`<span style="color:${fac.color}">${fac.label}</span>`);
  if (z.variation) tags.push(VARIATION_LABELS[z.variation] || z.variation);
  if (z.threat && z.threat !== 'normal') tags.push('Menace ' + (THREAT_LABELS[z.threat] || z.threat));
  let h = `<div class="zpop"><div class="zpop-title">${z.name || base.label || z.baseZone || 'Zone'}</div>`;
  if (tags.length) h += `<div class="zpop-pool">${tags.join(' · ')}</div>`;
  const qs = new URLSearchParams({ zone: z.baseZone || '', occ: z.occupation || '', var: z.variation || '', threat: z.threat || '' });
  h += `<a class="zpop-link" href="../mj/mj.html?${qs.toString()}">⚔ Générer une rencontre</a>`;
  if (isMJ) h += `<div class="zpop-mj"><button onclick="editZone('${z.id}')">✎ Éditer</button>
    <button onclick="deleteZone('${z.id}')" class="del">🗑</button></div>` + revealControls('zone', z.id, z);
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
}
function revealForAll(kind, id, all) {
  const it = _item(kind, id); if (!it) return;
  delete it.revealed;
  it.revealedFor = all ? Object.keys(joueurs) : [];
  saveData();
}
function deletePOI(id) { mapData.pois = mapData.pois.filter(x => x.id !== id); openItem = null; saveData(); map.closePopup(); }
function deleteZone(id) { mapData.zones = mapData.zones.filter(z => z.id !== id); openItem = null; saveData(); map.closePopup(); }
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
// Détecte la zone d'un point. Priorité aux zones GeoJSON authorées (rencontres
// /danger, y compris Visible=false), puis aux zones manuelles Firebase.
// Retourne {name, genUrl} ou null.
function detectZone(lat, lng) {
  if (geoZonesData) {
    for (const f of geoZonesData.features) {
      if (geoPointInFeature(lat, lng, f))
        return { name: f.properties.Nom || 'Zone', genUrl: '../mj/mj.html?' + geoZoneGenQuery(f.properties) };
    }
  }
  for (const z of (mapData.zones || [])) {
    if (z.polygon && z.polygon.length >= 3 &&
        pointInPoly(lng, lat, z.polygon.map(p => ({ x: p.lng, y: p.lat }))))
      return { name: z.name || z.baseZone, genUrl: zoneGenLink(z) };
  }
  return null;
}

// Point dans une feature GeoJSON (Polygon / MultiPolygon, anneau extérieur)
function geoPointInFeature(lat, lng, f) {
  const g = f.geometry; if (!g) return false;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : (g.type === 'Polygon' ? [g.coordinates] : []);
  for (const poly of polys) {
    const ring = poly[0];
    if (ring && pointInPoly(lng, lat, ring.map(c => ({ x: c[0], y: c[1] })))) return true;
  }
  return false;
}

function zoneGenLink(z) {
  return '../mj/mj.html?' + new URLSearchParams({
    zone: z.baseZone || '', occ: z.occupation || '', var: z.variation || '', threat: z.threat || '',
  }).toString();
}
function polygonCentroid(latlngs) {
  let y = 0, x = 0; latlngs.forEach(p => { y += p[0]; x += p[1]; });
  return [y / latlngs.length, x / latlngs.length];
}

document.addEventListener('DOMContentLoaded', init);
