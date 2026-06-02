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
const FOG_RADIUS_CITY_M  = 600;   // rayon de découverte intra-muros (ville)
const FOG_RADIUS_RURAL_M = 1500;  // rayon de découverte hors périphérique (campagne)
const FOG_STEP_M      = 250;   // espacement min entre points explorés enregistrés
const VISION_RADIUS_M = 1500;  // rayon de vision des alliés
const TELEPORT_M      = 5000;  // au-delà : repositionnement (pas de traîné)
// Métro
const METRO_REVEAL_M  = 350;   // portée de découverte le long du tunnel courant
const METRO_TUNNEL_W_M= 90;    // largeur dégagée du tunnel (rayon de gommage par sommet)
const METRO_FOG_STEP_M= 150;   // espacement min entre points explorés (métro)
const METRO_DESCEND_M = 250;   // distance max à une station pour descendre/remonter

// Intra-muros (vue courte) ? — approx. via la bounding box Paris
// (sera remplacé par le GeoJSON de limites quand tu l'enverras)
function isIntraMuros(lat, lng) { return PARIS_BOUNDS.contains([lat, lng]); }

const _params  = new URLSearchParams(location.search);
const viewerId = _params.get('id');               // perspective d'un joueur
const embed    = _params.get('embed') === '1';
let isMJ = !viewerId && sessionStorage.getItem('mj_auth') === '1';

let fdb, map;
let fogOverlay = null;
// Métro
let metroStationsData = null, metroLinesData = null; // GeoJSON stations / lignes (égouts)
let metroStationLayer = null, metroTokenLayer = null, metroLineLayer = null, metroFogOverlay = null;
let metroLinesByName = {};                         // {ligne: [{lat,lng}]} — sommets par ligne
let metroVertexFlat = [];                          // [{lat,lng,line,lk}] — sommets allégés (ligne la plus proche)
let metroMoveMode = false, movingMetroToken = null;
let editMode = false, addingPOI = false, drawingZone = null;
let mapData = { pois: [], zones: [], tokens: {}, fog: {}, geoReveal: {}, geoVisited: {}, ping: null, metroTokens: {}, metroFog: {}, underground: {} };
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
let moveMode = false, movingToken = null;          // déplacement de jeton (depuis son popup)
let pingMode = false, pingLayer = null;            // ping joueurs

// Couches GeoJSON authorées (QGIS) : zones (rencontres/danger) + marqueurs
let geoZonesData = null, geoMarkersData = null;
let geoZoneLayer, geoMarkerLayer, geoZoneRenderer = null;

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

// Bornes intra-muros (proxy ville/campagne pour le rayon de brouillard)
const PARIS_BOUNDS = L.latLngBounds([48.8156, 2.2241], [48.9022, 2.4699]);
// Bornes affichables de la carte — remplacées par map/cadre.geojson (FULL_ZONE) au chargement
let MAP_BOUNDS = PARIS_BOUNDS;
const SHIFT_FRAC = 1 / 7;   // décalage horizontal de la vue vers l'ouest (gauche)

// Bbox englobante d'un FeatureCollection GeoJSON → L.latLngBounds
function boundsFromGeoJSON(data) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  const scan = a => { if (typeof a[0] === 'number') { const [lng, lat] = a; if (lat<s)s=lat; if (lat>n)n=lat; if (lng<w)w=lng; if (lng>e)e=lng; } else a.forEach(scan); };
  (data.features || []).forEach(f => f.geometry && scan(f.geometry.coordinates));
  return L.latLngBounds([s, w], [n, e]);
}

// Bornes de pan = cadre affichable (léger padding)
function panBounds() { return MAP_BOUNDS.pad(0.02); }

// Bornes décalées vers l'ouest de SHIFT_FRAC de la largeur
function shiftedBounds() {
  const sw = MAP_BOUNDS.getSouthWest(), ne = MAP_BOUNDS.getNorthEast();
  const dLng = (ne.lng - sw.lng) * SHIFT_FRAC;
  return L.latLngBounds([sw.lat, sw.lng - dLng], [ne.lat, ne.lng - dLng]);
}

// Recadre sur Paris. Format navigable : zoomé pour pouvoir scroller N-S (et E-O)
// dans tout Paris ; le dézoom est bloqué au « remplissage largeur » (pas de vide).
// resetView=true recentre la vue (init seulement, pas au resize).
function lockParis(resetView) {
  map.invalidateSize();
  map.setMinZoom(0);
  const zFill = map.getBoundsZoom(MAP_BOUNDS, true);    // la carte remplit la largeur
  map.setMinZoom(zFill);                                // dézoom min = pas de vide
  map.setMaxBounds(panBounds());                        // pan limité au cadre affichable
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
    maxBounds: MAP_BOUNDS, maxBoundsViscosity: 1.0,    // défilement bloqué aux bords (cadre)
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
  // Pane des zones GeoJSON : SOUS le brouillard (révélées par exploration)
  // → renderer SVG dédié, sinon les polygones vont dans overlayPane (au-dessus du fog)
  map.createPane('geoZonePane'); map.getPane('geoZonePane').style.zIndex = 330;
  geoZoneRenderer = L.svg({ pane: 'geoZonePane' });
  // Pane du brouillard : au-dessus des zones, sous les marqueurs (400+)
  map.createPane('fogPane'); const fp = map.getPane('fogPane'); fp.style.zIndex = 350; fp.style.pointerEvents = 'none';

  // Couches GeoJSON Paris (PipBoy style)
  loadGeoJsonLayers();

  geoZoneLayer   = L.layerGroup().addTo(map);   // zones GeoJSON (sous les zones manuelles)
  geoMarkerLayer = L.layerGroup().addTo(map);
  zoneLayer  = L.layerGroup().addTo(map);
  poiLayer   = L.layerGroup().addTo(map);
  tokenLayer = L.layerGroup().addTo(map);

  map.on('click', onMapClick);
  map.on('popupclose', () => { if (!reopening) openItem = null; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (moveMode) endMoveMode(); if (pingMode) endPingMode(); } });

  lockParis(true);
  setTimeout(() => lockParis(true), 300);      // re-cadrage si conteneur (iframe) pas encore dimensionné
  window.addEventListener('resize', () => {
    if (currentTab === 'paris') lockParis(false);
    else if (currentTab === 'metro' && metroMap) lockMetro();
  });

  updateModeUI();

  window.DB_READY.then(() => {
    fdb.collection('joueurs').onSnapshot(s => {
      joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
      renderAll();
    });
    fdb.collection('carte').doc('data').onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      mapData = { pois: d.pois || [], zones: normZones(d.zones), tokens: d.tokens || {}, fog: d.fog || {}, geoReveal: d.geoReveal || {}, geoVisited: d.geoVisited || {}, ping: d.ping || null, metroTokens: d.metroTokens || {}, metroFog: d.metroFog || {}, underground: d.underground || {} };
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
  await window.DB_READY;                   // FACTIONS dispo pour couleurs/labels
  // Cadre — étendue affichable de la carte (limites de pan/zoom)
  try {
    const data = await fetch(GEOJSON_BASE + 'cadre.geojson').then(r => r.json());
    MAP_BOUNDS = boundsFromGeoJSON(data);
    lockParis(true);
  } catch(e) { console.warn('cadre.geojson non chargé', e); }
  // Zones + marqueurs (petits, prioritaires : libellés de position + détection)
  try { geoZonesData   = await fetch(GEOJSON_BASE + 'zones.geojson').then(r => r.json()); }
  catch(e){ console.warn('zones.geojson non chargé', e); }
  try { geoMarkersData = await fetch(GEOJSON_BASE + 'marqueurs.geojson').then(r => r.json()); }
  catch(e){ console.warn('marqueurs.geojson non chargé', e); }
  try { metroStationsData = await fetch(GEOJSON_BASE + 'stations_metro.geojson').then(r => r.json()); }
  catch(e){ console.warn('stations_metro.geojson non chargé', e); }
  renderGeoLayers();
  renderMJPanel();                         // positions à jour dès que les marqueurs sont chargés
  // Couches visuelles (plus lourdes) — chargées après
  try {
    const data = await fetch(GEOJSON_BASE + 'seine.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'seinePane',
      style: { color: '#4CFF77', weight: 1.6, opacity: 0.75, fillColor: '#0E2A0E', fillOpacity: 0.6 },
    }).addTo(map);
  } catch(e) { console.warn('seine.geojson non chargé', e); }
  try {
    const data = await fetch(GEOJSON_BASE + 'rails.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'railsPane',
      style: { color: '#9DF09D', weight: 1.0, opacity: 0.8, dashArray: '5 3', fill: false },
    }).addTo(map);
  } catch(e) { console.warn('rails.geojson non chargé', e); }
  try {
    const data = await fetch(GEOJSON_BASE + 'routes.geojson').then(r => r.json());
    L.geoJSON(data, { pane: 'routesPane',
      style: f => ({ color: '#B8FFB8', weight: isMajorRoad(f) ? 1.4 : 0.7, opacity: 0.85, fill: false }),
    }).addTo(map);
  } catch(e) { console.warn('routes.geojson non chargé', e); }
}

// Rendu des zones/marqueurs GeoJSON. MJ : tout (Visible=false en pointillé léger).
// Joueur : seulement Visible=true (et soumis au brouillard, comme le fond).
function renderGeoLayers() {
  if (!geoZoneLayer) return;
  geoZoneLayer.clearLayers();
  geoMarkerLayer.clearLayers();

  if (geoZonesData) {
    L.geoJSON(geoZonesData, {
      pane: 'geoZonePane', renderer: geoZoneRenderer,
      filter: f => isMJ || f.properties.Visible === true,
      style: f => {
        const fonctionnelle = isMJ && f.properties.Visible !== true;  // non visible joueurs
        // Désert de radiation : vert toxique, sans bordure, plus opaque
        if (('' + (f.properties.Statut || '')).toLowerCase().includes('rad')) {
          return { stroke: false, weight: 0, fillColor: '#5dff5d', fillOpacity: fonctionnelle ? 0.14 : 0.4 };
        }
        const col = geoColor(f.properties.Faction, f.properties.Type);
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
// Visité = le brouillard est dégagé autour du marqueur pour ce joueur
function geoMarkerVisitedFor(nom) {
  return !!viewerId && (mapData.geoVisited?.[nom] || []).includes(viewerId);
}
function _escq(s) { return ('' + s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// Deux contrôles par joueur (MJ) : Révéler (afficher) + Visiter (dégager le fog)
function revealControlsGeo(nom) {
  return geoToggleRow(nom, 'Révélé à', mapData.geoReveal, 'toggleRevealGeo', 'revealGeoAll', '👁')
       + geoToggleRow(nom, 'Visité par', mapData.geoVisited, 'toggleVisitGeo', 'visitGeoAll', '👣');
}
function geoToggleRow(nom, title, stateObj, fnToggle, fnAll, onIcon) {
  const arr = (stateObj || {})[nom] || [];
  const ids = Object.keys(joueurs);
  const e = _escq(nom);
  const btns = ids.length ? ids.map(pid => {
    const on = arr.includes(pid);
    return `<button class="rv${on ? ' on' : ''}" onclick="${fnToggle}('${e}','${pid}')">${on ? onIcon : '∅'} ${joueurs[pid]?.nom || pid}</button>`;
  }).join('') : '<span class="empty">Aucun joueur</span>';
  return `<div class="zpop-reveal"><div class="rv-lbl">${title} :</div><div class="rv-grid">${btns}</div>
    <div class="rv-all"><button onclick="${fnAll}('${e}',true)">Tous</button><button onclick="${fnAll}('${e}',false)">Aucun</button></div></div>`;
}
function _geoToggle(stateKey, nom, pid) {
  mapData[stateKey] = mapData[stateKey] || {};
  const arr = mapData[stateKey][nom] = mapData[stateKey][nom] || [];
  const i = arr.indexOf(pid);
  if (i >= 0) arr.splice(i, 1); else arr.push(pid);
  saveData();
}
function _geoAll(stateKey, nom, all) {
  mapData[stateKey] = mapData[stateKey] || {};
  mapData[stateKey][nom] = all ? Object.keys(joueurs) : [];
  saveData();
}
function toggleRevealGeo(nom, pid) { _geoToggle('geoReveal', nom, pid); }
function revealGeoAll(nom, all)    { _geoAll('geoReveal', nom, all); }
function toggleVisitGeo(nom, pid)  { _geoToggle('geoVisited', nom, pid); }
function visitGeoAll(nom, all)     { _geoAll('geoVisited', nom, all); }

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
  const order = ['paris', 'metro', 'lieux'];
  document.querySelectorAll('.map-tab').forEach((el, i) => el.classList.toggle('on', order[i] === tab));
  const pw = document.getElementById('map-paris-wrap');
  const mw = document.getElementById('map-metro-wrap');
  const lw = document.getElementById('map-lieux-wrap');
  const pt = document.getElementById('mjp-paris-tools');
  const lt = document.getElementById('mjp-lieux-tools');
  const da = document.getElementById('draw-actions');
  const ml = document.getElementById('mj-left');
  const mr = document.getElementById('mj-right');
  if (pw) pw.style.display = tab === 'paris' ? 'flex' : 'none';
  if (mw) mw.style.display = tab === 'metro' ? 'flex' : 'none';
  if (lw) lw.style.display = tab === 'lieux' ? 'flex' : 'none';
  if (pt) pt.style.display = tab === 'paris' ? 'block' : 'none';
  if (lt) lt.style.display = tab === 'lieux' ? 'block' : 'none';
  if (da) da.style.display = 'none';
  // Bandeaux MJ : outils sur Paris/Lieux ; positions joueurs sur Paris + Métro
  if (ml) ml.style.display = (isMJ && tab !== 'metro') ? 'block' : 'none';
  if (mr) mr.style.display = (isMJ && tab !== 'lieux') ? 'block' : 'none';
  if (tab !== 'paris') { addingPOI = false; cancelDrawZone(); }
  if (tab === 'paris') {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  } else if (tab === 'metro') {
    initMetroMap();
    if (metroMap) setTimeout(() => lockMetro(), 50);
  } else {
    renderLieux();
    if (mapLieu) setTimeout(() => mapLieu.invalidateSize(), 50);
  }
}

// ============================================================
// ONGLET MÉTRO — réseau de tunnels (map/lignes_metro.geojson)
// Fallout : plus de RATP. Tunnels en vert CRT monochrome, pointillés.
// ============================================================
let metroMap = null, metroInit = false;
async function initMetroMap(){
  if (metroInit) return;
  metroInit = true;
  const el = document.getElementById('map-metro');
  metroMap = L.map(el, { zoomSnap:0.25, maxZoom:17, attributionControl:false });
  // Pane tunnels (sous le brouillard)
  metroMap.createPane('metroPane');
  const mp = metroMap.getPane('metroPane');
  mp.style.zIndex = 300; mp.style.pointerEvents = 'none';
  mp.style.filter = 'drop-shadow(0 0 2px rgba(93,255,93,0.45))';
  // Pane brouillard (au-dessus des tunnels, sous les marqueurs/jetons)
  metroMap.createPane('metroFogPane');
  const fp = metroMap.getPane('metroFogPane'); fp.style.zIndex = 350; fp.style.pointerEvents = 'none';
  metroLineLayer    = L.layerGroup().addTo(metroMap);   // égouts révélés (lignes des gares découvertes)
  metroStationLayer = L.layerGroup().addTo(metroMap);
  metroTokenLayer   = L.layerGroup().addTo(metroMap);
  metroMap.on('click', onMetroClick);
  // Seine en repère géographique (discret)
  try {
    const seine = await fetch(GEOJSON_BASE + 'seine.geojson').then(r => r.json());
    L.geoJSON(seine, { style:{ color:'#2f6f3f', weight:1, opacity:0.5, fillColor:'#0E2A0E', fillOpacity:0.35 } }).addTo(metroMap);
  } catch(e){ console.warn('seine.geojson (métro) non chargé', e); }
  // Égouts — chargés mais affichés UNIQUEMENT pour les lignes des gares découvertes (renderMetroLines)
  try {
    metroLinesData = await fetch(GEOJSON_BASE + 'lignes_metro.geojson').then(r => r.json());
    buildMetroIndex(metroLinesData);
  } catch(e){ console.warn('lignes_metro.geojson non chargé', e); }
  lockMetro();
  renderMetro();
}

// Clé de ligne normalisée : "Métro 6"/"METRO 6"/"Métro 1 Voie…" → "6" ; "Métro 3bis" → "3bis"
function lineKey(label){
  const s = ('' + (label || '')).toLowerCase().replace(/^m[ée]tro\s+/, '');
  const m = s.match(/^\d+\s*bis/) || s.match(/^\d+/);
  return m ? m[0].replace(/\s+/g, '') : '';
}
// Lignes disponibles à un joueur = lignes des gares qu'il a découvertes (proches d'un point exploré)
function unlockedLinesFor(id){
  const set = new Set();
  const pts = metroExploredPoints(id);
  if (!pts.length || !metroStationsData) return set;
  metroStationsData.features.forEach(f => {
    const c = f.geometry?.coordinates; if (!c) return;
    const k = lineKey(f.properties.res_com); if (!k) return;
    if (pts.some(p => L.latLng(p.lat, p.lng).distanceTo(L.latLng(c[1], c[0])) < METRO_TUNNEL_W_M * 1.6)) set.add(k);
  });
  return set;
}
// Lignes visibles dans la perspective courante : joueur → les siennes ; MJ → union de tous
function unlockedLinesView(){
  if (!isMJ && viewerId) return unlockedLinesFor(viewerId);
  const set = new Set();
  const ids = new Set([...Object.keys(joueurs), ...Object.keys(mapData.metroFog || {})]);
  ids.forEach(id => unlockedLinesFor(id).forEach(k => set.add(k)));
  return set;
}
// Affiche les égouts des seules lignes débloquées
function renderMetroLines(){
  if (!metroLineLayer || !metroLinesData) return;
  metroLineLayer.clearLayers();
  const allowed = unlockedLinesView();
  if (!allowed.size) return;
  L.geoJSON(metroLinesData, { pane: 'metroPane',
    filter: f => allowed.has(lineKey(f.properties.name)),
    style: { color: '#5dff5d', weight: 1.6, opacity: 0.85, fill: false },
  }).addTo(metroLineLayer);
}

// Index des sommets de lignes (pour « ligne la plus proche » + dégagement du tunnel)
function buildMetroIndex(data){
  metroLinesByName = {}; metroVertexFlat = [];
  (data.features || []).forEach(f => {
    const line = f.properties?.name || '?';
    const g = f.geometry; if (!g) return;
    const segs = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    const arr = metroLinesByName[line] = metroLinesByName[line] || [];
    segs.forEach(seg => seg.forEach((c, i) => {
      const v = { lat: c[1], lng: c[0] };
      arr.push(v);
      if (i % 4 === 0) metroVertexFlat.push({ lat: v.lat, lng: v.lng, line, lk: lineKey(line) }); // index allégé (1 sommet/4)
    }));
  });
}
// Ligne (tunnel) la plus proche d'un point → nom de ligne. allowed = Set de clés autorisées (optionnel).
function nearestMetroLine(lat, lng, allowed){
  let best = null, bd = Infinity; const ll = L.latLng(lat, lng);
  for (const v of metroVertexFlat){
    if (allowed && !allowed.has(v.lk)) continue;
    const d = ll.distanceTo(L.latLng(v.lat, v.lng)); if (d < bd){ bd = d; best = v.line; }
  }
  return best;
}
// Station la plus proche d'un point → {nom, lat, lng, dist}
function nearestStation(lat, lng){
  if (!metroStationsData) return null;
  let best = null, bd = Infinity; const ll = L.latLng(lat, lng);
  metroStationsData.features.forEach(f => {
    const c = f.geometry?.coordinates; if (!c) return;
    const d = ll.distanceTo(L.latLng(c[1], c[0]));
    if (d < bd){ bd = d; best = { nom: f.properties.nom_gares || f.properties.nom_zdc || 'Station', lat: c[1], lng: c[0], dist: d }; }
  });
  return best;
}

// ---- RENDU DE LA CARTE MÉTRO ----
function renderMetro(){
  if (!metroMap) return;
  renderMetroLines();
  renderMetroStations();
  renderMetroTokens();
  renderMetroFog();
}

// Stations : MJ → toutes ; joueur → seulement celles découvertes (proches d'un point exploré)
function renderMetroStations(){
  if (!metroStationLayer) return;
  metroStationLayer.clearLayers();
  if (!metroStationsData) return;
  const explored = metroExploredPoints(viewerId);
  const seen = new Set();
  metroStationsData.features.forEach(f => {
    const nom = f.properties.nom_gares || f.properties.nom_zdc || '';
    if (seen.has(nom)) return; seen.add(nom);
    const c = f.geometry?.coordinates; if (!c) return;
    if (!isMJ && viewerId){
      const revealed = explored.some(p => L.latLng(p.lat, p.lng).distanceTo(L.latLng(c[1], c[0])) < METRO_TUNNEL_W_M * 1.6);
      if (!revealed) return;
    }
    L.marker([c[1], c[0]], { interactive: false, icon: L.divIcon({ className: 'metro-stn',
      html: `<span class="ms-dot"></span><span class="ms-label">${nom}</span>`, iconSize: [8, 8], iconAnchor: [4, 4] }) }).addTo(metroStationLayer);
  });
}

// Jetons sous terre (mapData.underground) sur la carte métro
function renderMetroTokens(){
  if (!metroTokenLayer) return;
  metroTokenLayer.clearLayers();
  const my = (!isMJ && viewerId) ? mapData.metroTokens?.[viewerId] : null;
  Object.entries(mapData.metroTokens || {}).forEach(([id, pos]) => {
    if (!pos || !mapData.underground?.[id]) return;
    if (!isMJ && viewerId && id !== viewerId){
      if (!my) return;
      if (L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) > VISION_RADIUS_M) return;
    }
    const nom = joueurs[id]?.nom || id;
    const me = id === viewerId;
    const sel = movingMetroToken && movingMetroToken.id === id;
    const m = L.marker([pos.lat, pos.lng], { icon: L.divIcon({ className: 'token-pin' + (me ? ' me' : '') + (sel ? ' sel' : ''),
      html: `<span class="token-dot">${nom.charAt(0).toUpperCase()}</span><span class="token-label">${nom}${me ? ' (toi)' : ''}</span>`,
      iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(metroTokenLayer);
    if (isMJ){
      const st = nearestStation(pos.lat, pos.lng);
      const canUp = st && st.dist < METRO_DESCEND_M;
      m.bindPopup(`<b>${nom}</b><div class="zpop-mj">
        <button onclick="startMetroMove('${id}')">➤ Déplacer</button>
        ${canUp ? `<button onclick="remonterSurface('${id}')">🏙 Remonter (${st.nom})</button>` : '<small>Pas de station à proximité</small>'}
      </div>`);
    } else {
      m.bindPopup('<b>' + nom + '</b>');
    }
  });
}

// Points explorés en métro (trajet enregistré + position courante)
function metroExploredPoints(id){
  if (!id) return [];
  const pts = (mapData.metroFog?.[id] || []).slice();
  const t = mapData.metroTokens?.[id];
  if (t && mapData.underground?.[id]) pts.push(t);
  return pts;
}

// Brouillard métro : ne dégage QUE le tunnel courant (ligne la plus proche) autour des points explorés
function renderMetroFog(){
  if (metroFogOverlay){ metroMap.removeLayer(metroFogOverlay); metroFogOverlay = null; }
  if (isMJ || !viewerId) return;
  const pts = metroExploredPoints(viewerId);

  const b = MAP_BOUNDS.pad(0.02);
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const dLng = ne.lng - sw.lng, dLat = ne.lat - sw.lat;
  const W = FOG_RES, H = Math.max(1, Math.round(W * dLat / dLng));
  const toPx = (lat, lng) => ({ x: (lng - sw.lng) / dLng * W, y: (1 - (lat - sw.lat) / dLat) * H });
  const widthM = dLng * 111000 * Math.cos((sw.lat + ne.lat) / 2 * Math.PI / 180);
  const pxPerM = W / widthM;

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(4,8,4,0.94)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  const pierce = (lat, lng, rM) => {
    const px = toPx(lat, lng); const r = rM * pxPerM;
    const g = ctx.createRadialGradient(px.x, px.y, r * 0.35, px.x, px.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px.x, px.y, r, 0, Math.PI * 2); ctx.fill();
  };
  const allowed = unlockedLinesFor(viewerId);              // seulement les tunnels accessibles
  pts.forEach(p => {
    const line = nearestMetroLine(p.lat, p.lng, allowed);
    pierce(p.lat, p.lng, METRO_TUNNEL_W_M);                 // autour de la position
    if (!line) return;
    (metroLinesByName[line] || []).forEach(v => {           // le long du tunnel courant
      if (L.latLng(p.lat, p.lng).distanceTo(L.latLng(v.lat, v.lng)) <= METRO_REVEAL_M) pierce(v.lat, v.lng, METRO_TUNNEL_W_M);
    });
  });
  ctx.globalCompositeOperation = 'source-over';
  metroFogOverlay = L.imageOverlay(cv.toDataURL(), b, { pane: 'metroFogPane', interactive: false }).addTo(metroMap);
}

// Enregistre le trajet métro (gommage permanent, traînée interpolée)
function recordMetroFog(id, lat, lng){
  mapData.metroFog = mapData.metroFog || {};
  const arr = mapData.metroFog[id] = mapData.metroFog[id] || [];
  const last = arr[arr.length - 1];
  if (!last){ arr.push({ lat, lng }); return; }
  const dist = L.latLng(last.lat, last.lng).distanceTo(L.latLng(lat, lng));
  if (dist < METRO_FOG_STEP_M) return;
  if (dist > TELEPORT_M){ arr.push({ lat, lng }); return; }
  const n = Math.ceil(dist / METRO_FOG_STEP_M);
  for (let i = 1; i <= n; i++) arr.push({ lat: last.lat + (lat - last.lat) * i / n, lng: last.lng + (lng - last.lng) * i / n });
}

// ---- DÉPLACEMENT MÉTRO (MJ) ----
function startMetroMove(id){
  const t = mapData.metroTokens?.[id]; if (!t) return;
  metroMap.closePopup();
  metroMoveMode = true; movingMetroToken = { id, from: { ...t } };
  setHint('Clique la destination dans le métro pour « ' + (joueurs[id]?.nom || id) + ' ».');
  renderMetroTokens();
}
function endMetroMove(){ metroMoveMode = false; movingMetroToken = null; setHint(''); renderMetroTokens(); }
function onMetroClick(e){
  if (!metroMoveMode || !movingMetroToken) return;
  const id = movingMetroToken.id, from = movingMetroToken.from, to = e.latlng;
  mapData.metroTokens[id] = { lat: to.lat, lng: to.lng };
  recordMetroFog(id, from.lat, from.lng);
  recordMetroFog(id, to.lat, to.lng);
  saveData();
  endMetroMove();
}

// ---- TRANSPORT SURFACE ↔ MÉTRO (MJ) ----
function descendreMetro(id){
  const t = mapData.tokens?.[id]; if (!t) return;
  const st = nearestStation(t.lat, t.lng);
  if (!st || st.dist > METRO_DESCEND_M){ alert('Aucune station de métro à proximité.'); return; }
  mapData.underground = mapData.underground || {};
  mapData.metroTokens = mapData.metroTokens || {};
  mapData.underground[id] = true;
  mapData.metroTokens[id] = { lat: st.lat, lng: st.lng };
  recordMetroFog(id, st.lat, st.lng);
  saveData();
  if (map) map.closePopup();
}
function remonterSurface(id){
  const t = mapData.metroTokens?.[id]; if (!t) return;
  const st = nearestStation(t.lat, t.lng);
  mapData.underground = mapData.underground || {};
  mapData.underground[id] = false;
  if (st){ mapData.tokens[id] = { lat: st.lat, lng: st.lng }; recordFog(id, st.lat, st.lng); }
  saveData();
  if (metroMap) metroMap.closePopup();
}

// Cadre la vue métro sur MAP_BOUNDS (cadre.geojson), comme la carte Paris :
// remplit la largeur, pan limité au cadre.
function lockMetro(){
  if (!metroMap) return;
  metroMap.invalidateSize();
  metroMap.setMinZoom(0);
  const zFill = metroMap.getBoundsZoom(MAP_BOUNDS, true);
  metroMap.setMinZoom(zFill);
  metroMap.setMaxBounds(MAP_BOUNDS.pad(0.02));
  metroMap.options.maxBoundsViscosity = 1.0;
  metroMap.setView(MAP_BOUNDS.getCenter(), zFill, { animate:false });
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
  const eb = document.getElementById('edit-btn'); if (eb) eb.style.display = 'none';  // édition toujours active
  const ml = document.getElementById('mj-left');  if (ml) ml.style.display = isMJ ? 'block' : 'none';
  const mr = document.getElementById('mj-right'); if (mr) mr.style.display = isMJ ? 'block' : 'none';
  // MJ : outils d'édition directement disponibles (plus de toggle)
  if (isMJ) { editMode = true; const t = document.getElementById('mjp-tools'); if (t) t.style.display = 'block'; }
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
  renderPing();
  renderMJPanel();
  if (metroMap) renderMetro();
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
    if (mapData.underground?.[id]) return;            // sous terre → visible sur la carte métro, pas en surface
    // Vue joueur : alliés visibles uniquement dans VISION_RADIUS_M mètres
    if (!isMJ && viewerId && id !== viewerId) {
      if (!my) return;
      if (L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) > VISION_RADIUS_M) return;
    }
    const nom = joueurs[id]?.nom || id;
    const me = id === viewerId;
    const sel = movingToken && movingToken.id === id;
    const m = L.marker([pos.lat, pos.lng], {
      draggable: isMJ && editMode,
      icon: L.divIcon({ className: 'token-pin' + (me ? ' me' : '') + (sel ? ' sel' : ''),
        html: `<span class="token-dot">${nom.charAt(0).toUpperCase()}</span><span class="token-label">${nom}${me ? ' (toi)' : ''}</span>`,
        iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(tokenLayer);
    let mjBtns = '';
    if (isMJ) {
      const st = nearestStation(pos.lat, pos.lng);
      const canDown = st && st.dist < METRO_DESCEND_M;
      mjBtns = `<div class="zpop-mj"><button onclick="startMoveFromToken('${id}')">➤ Déplacer</button>${canDown ? `<button onclick="descendreMetro('${id}')">🚇 Descendre (${st.nom})</button>` : ''}</div>`;
    }
    m.bindPopup('<b>' + nom + '</b>' + mjBtns);
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
  // mètres → px sur le canvas (rayon variable selon intra-muros / campagne)
  const widthM = dLng * 111000 * Math.cos((sw.lat + ne.lat) / 2 * Math.PI / 180);
  const pxPerM = W / widthM;

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(4,8,4,0.92)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';

  // Le brouillard se dégage : exploration (trajet + position) + marqueurs VISITÉS
  const pts = (mapData.fog?.[viewerId] || []).slice();
  const myPos = mapData.tokens?.[viewerId]; if (myPos) pts.push(myPos);
  if (geoMarkersData) geoMarkersData.features.forEach(f => {
    if (geoMarkerVisitedFor(f.properties.nom)) { const c = f.geometry.coordinates; pts.push({ lat: c[1], lng: c[0] }); }
  });

  pts.forEach(p => {
    const px = toPx(p.lat, p.lng);
    const rad = (isIntraMuros(p.lat, p.lng) ? FOG_RADIUS_CITY_M : FOG_RADIUS_RURAL_M) * pxPerM;
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
    if (mapData.underground?.[id]) {
      const mt = mapData.metroTokens?.[id];
      const st = mt ? nearestStation(mt.lat, mt.lng) : null;
      const line = mt ? nearestMetroLine(mt.lat, mt.lng, unlockedLinesFor(id)) : null;
      const lbl = '🚇 Métro' + (st && st.dist < METRO_DESCEND_M ? ' — ' + st.nom : line ? ' — ' + line : '');
      return `<div class="pp-row"><div class="pp-head"><span class="pp-nom">${joueurs[id]?.nom || id}</span></div>
        <div class="pp-pos" style="color:var(--am)">${lbl}</div></div>`;
    }
    const t = mapData.tokens[id];
    const z = t ? detectZone(t.lat, t.lng) : null;
    const label = t ? playerPositionLabel(t.lat, t.lng, z) : '—';
    return `<div class="pp-row">
      <div class="pp-head"><span class="pp-nom">${joueurs[id]?.nom || id}</span>
        ${t ? `<button class="pz-gen" onclick="centerOnToken('${id}')" title="Centrer la carte">⌖</button>` : ''}
        ${z ? `<a class="pz-gen" href="${z.genUrl}" title="Générer rencontre">⚔</a>` : ''}</div>
      <div class="pp-pos">${label}</div>
    </div>`;
  }).join('');
}

// Marqueur GeoJSON le plus proche d'un point → {nom, dist} ou null
function nearestMarker(lat, lng) {
  if (!geoMarkersData) return null;
  let best = null, bestD = Infinity;
  geoMarkersData.features.forEach(f => {
    const c = f.geometry?.coordinates; if (!c) return;
    const d = L.latLng(lat, lng).distanceTo(L.latLng(c[1], c[0]));
    if (d < bestD) { bestD = d; best = { nom: f.properties.nom, dist: d }; }
  });
  return best;
}
// Libellé de position : zone, sinon marqueur posé dessus, sinon région + proximité
function playerPositionLabel(lat, lng, z) {
  if (z) return z.name;
  const near = nearestMarker(lat, lng);
  if (near && near.dist < 120) return near.nom;               // posé sur un marqueur
  const region = isIntraMuros(lat, lng) ? 'Visite Paris' : 'En banlieue';
  return near ? `${region} — à proximité de ${near.nom}` : region;
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
  addingPOI = false; document.getElementById('btn-add-poi')?.classList.remove('on'); cancelDrawZone();
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
  addingPOI = false; document.getElementById('btn-add-poi')?.classList.remove('on'); cancelDrawZone();
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
