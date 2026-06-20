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

// Icône SVG ligne (style Pip-Boy / Vault-Tec) — monochrome, couleur via currentColor
function _pic(inner){
  return '<svg class="poi-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}
const POI_TYPES = {
  settlement: { label: 'Maison / Colonie', color: '#5dbe5d', icon: _pic('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>') },
  danger:     { label: 'Danger',     color: '#e04040', icon: _pic('<path d="M12 3L22 20H2z"/><path d="M12 9v5"/><path d="M12 17.3v.2"/>') },
  faction:    { label: 'QG Faction', color: '#4a7ba6', icon: _pic('<path d="M6 3v18"/><path d="M6 4h12l-3 3 3 3H6"/>') },
  loot:       { label: 'Cache',      color: '#c8923a', icon: _pic('<path d="M4 8h16v11H4z"/><path d="M4 8l1.5-3h13L20 8"/><path d="M12 8v11"/><path d="M10 12h4"/>') },
  trader:     { label: 'Marchand (caps)', color: '#e8a820', icon: _pic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>') },
  water:      { label: "Point d'eau",color: '#4a9bd5', icon: _pic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>') },
  camp:       { label: 'Campement',  color: '#d57b30', icon: _pic('<path d="M3 20L12 5l9 15z"/><path d="M12 5v15"/><path d="M9 20l3-5 3 5"/>') },
  quest:      { label: 'Objectif',   color: '#f1c40f', icon: _pic('<path d="M12 2.5l2.9 6 6.6.6-5 4.4 1.5 6.4L12 16.6 6 19.9l1.5-6.4-5-4.4 6.6-.6z"/>') },
  npc:        { label: 'PNJ',        color: '#b0f0b0', icon: _pic('<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>') },
  other:      { label: 'Lieu',       color: '#7ed87e', icon: _pic('<path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/>') },
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
let pendingPoiType = 'other';   // type de POI sélectionné dans le picker
let mapData = { pois: [], zones: [], tokens: {}, fog: {}, geoReveal: {}, geoVisited: {}, ping: null, metroTokens: {}, metroFog: {}, underground: {}, beacons: {} };
const geoMarkerRefs = {};                          // nom → layer (pour réouverture popup)
let lieux = [];            // [{id, name, image, pois:[]}] — plans de bâtiments
let lieuActif = null;      // lieu sélectionné dans l'onglet LIEUX
let mapLieu = null;        // instance Leaflet pour les lieux
let settlementsData = { sites: {} };   // refuges (/settlements/<camp>) — affichés dans LIEUX selon la position
let _openRefuge = null;    // id du refuge ouvert dans l'onglet LIEUX
let joueurs = {};
let zoneLayer, poiLayer, tokenLayer;
const poiMarkers = {}, zonePolys = {};
let openItem = null, reopening = false;            // popup ouvert (pour le réouvrir après render)
let zoneFormCtx = null;                            // {polygon} (création) ou {zone} (édition)
let currentTab = 'paris';
let centeredOnPlayer = false;                      // vue déjà centrée sur le jeton du joueur
let _autoTabDone = false;                           // bascule auto vers le métro (1er chargement si sous terre) déjà faite
let parties = [];                                   // groupes (temps/data) : [{id,name,players[],solo}] — fusion des jetons
let moveMode = false, movingToken = null;          // déplacement de jeton (depuis son popup)
let pingMode = false, pingLayer = null;            // ping joueurs

// Couches GeoJSON authorées (QGIS) : zones (rencontres/danger) + marqueurs
let geoZonesData = null, geoMarkersData = null;
let geoZoneLayer, geoMarkerLayer, geoZoneRenderer = null;

const GEO_MARKER_ICONS = { Landmark:'🗼', Settlement:'🏠', Safe:'🛡', Metro:'🚇', Danger:'☢', Faction:'🚩', Loot:'📦', Quest:'❗' };

// Chemin de l'image pour un marqueur : img/<nom normalisé>.png
// Normalisation : minuscules, sans accents, sans apostrophes/tirets/espaces.
// L'utilisateur dépose les fichiers dans img/ avec le nom du monument.
// Si le fichier n'existe pas, l'icône se masque et le marqueur bascule sur le style standard (onerror).
// IMG_VER : à incrémenter quand on remplace des images (casse le cache navigateur).
const IMG_VER = '4';
// Clé normalisée (sert au nom de fichier ET aux ajustements par monument)
function landmarkKey(nom){
  return ('' + nom).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // retire les accents
    .replace(/['’‘\-\s]+/g, '');                        // retire apostrophes, tirets, espaces
}
// Luminosité par monument (défaut 1.25 via --lb) — vide = toutes uniformes.
// Ajouter des entrées ici seulement si une image source est trop claire/sombre.
const LANDMARK_BRIGHT = {};
function landmarkImgPath(nom){
  return '../../img/500pix/' + landmarkKey(nom) + '.png?v=' + IMG_VER;
}
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
  // La fiche joueur (iframe) demande un recentrage à chaque réaffichage de l'onglet CARTE
  window.addEventListener('message', e => {
    if (e.data === 'carte-recenter' && viewerId) {
      if (currentTab === 'paris' && map) map.invalidateSize();
      if (currentTab === 'metro' && metroMap) metroMap.invalidateSize();
      setTimeout(centerOnViewer, 60);
    }
  });

  updateModeUI();

  window.DB_READY.then(() => {
    fdb.collection('joueurs').onSnapshot(s => {
      joueurs = {}; s.forEach(d => joueurs[d.id] = { ...d.data(), _id: d.id });
      renderAll();
    });
    fdb.collection('carte').doc(fpCampId()).onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      mapData = { pois: d.pois || [], zones: normZones(d.zones), tokens: d.tokens || {}, fog: d.fog || {}, geoReveal: d.geoReveal || {}, geoVisited: d.geoVisited || {}, ping: d.ping || null, metroTokens: d.metroTokens || {}, metroFog: d.metroFog || {}, underground: d.underground || {}, beacons: d.beacons || {} };
      renderAll();
      tryCenterPlayer();   // au 1er chargement : centrer sur le jeton du joueur
      // Si le joueur est sous terre au 1er chargement → ouvrir directement le métro centré sur lui
      if (!_autoTabDone && viewerId && !isMJ) {
        _autoTabDone = true;
        if (mapData.underground?.[viewerId]) switchMapTab('metro');
      }
    });
    fdb.collection('carte').doc('lieux').onSnapshot(s => {
      lieux = (s.exists ? s.data().lieux : null) || [];
      if (currentTab === 'lieux') renderLieux();
    });
    // Refuges (settlements) — apparaissent dans LIEUX quand le joueur est sur le lieu (POI révélé)
    fdb.collection('settlements').doc(fpCampId()).onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      settlementsData = { sites: (d.sites && typeof d.sites === 'object') ? d.sites : {} };
      if (currentTab === 'lieux') renderLieux();
      if (currentTab === 'paris' && typeof renderPOIs === 'function') renderPOIs();   // rafraîchit les pins 🛏
    }, e => console.warn('settlements:', e && e.code));
    // Groupes (temps/data) → fusion des jetons des membres en une seule icône de groupe
    fdb.collection('temps').doc(fpCampId()).onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      parties = Array.isArray(d.parties) ? d.parties : [];
      renderAll();
    });
    // Échanges entre joueurs (proximité) — uniquement en vue joueur
    if (!isMJ && viewerId) watchEchanges();
    // Boutiques (POI marchands) — pour afficher le bon bouton dans les popups
    fdb.collection('boutiques').doc(fpCampId()).onSnapshot(s => {
      const d = s.exists ? s.data() : {};
      shopsData = (d.shops && typeof d.shops === 'object') ? d.shops : {};
      if (currentTab === 'paris') renderPOIs();
    }, e => console.warn('boutiques:', e && e.code));
  });
}
let shopsData = {};

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
          return { stroke: false, weight: 0, fillColor: '#5dff5d', fillOpacity: fonctionnelle ? 0.14 : 0.4, interactive: isMJ };
        }
        const col = geoColor(f.properties.Faction, f.properties.Type);
        return { color: col, weight: fonctionnelle ? 1 : 2, dashArray: fonctionnelle ? '4 4' : null,
                 fillColor: col, fillOpacity: fonctionnelle ? 0.05 : 0.18, opacity: fonctionnelle ? 0.55 : 0.9,
                 interactive: isMJ };  // joueurs : zone = simple dessin, non cliquable
      },
      // Joueurs : pas de popup (zone non interactive)
      onEachFeature: (f, layer) => { if (isMJ) layer.bindPopup(geoZonePopup(f.properties)); },
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
        // Tous les marqueurs essaient leur image dédiée ; si absente → marqueur générique Fallout
        // (l'image se cache et le losange apparaît via onerror — sans guillemets doubles)
        const imgPath = landmarkImgPath(nom);
        const lb = LANDMARK_BRIGHT[landmarkKey(nom)];
        const lbStyle = lb != null ? ` style="--lb:${lb}"` : '';
        const m = L.marker(latlng, { opacity: dim ? 0.5 : 1, icon: L.divIcon({ className: 'land-pin',
          html: `<span class="land-icon-wrap">`
              +   `<img class="land-icon-img" src="${imgPath}"${lbStyle} onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`
              +   `<span class="geo-mark-dot${dim?' dim':''}" style="display:none"></span>`
              + `</span>`,
          iconSize: [42, 42], iconAnchor: [21, 42] }) });
        m.bindTooltip(nom + lock, { className: 'map-tip', direction: 'top', offset: [0, -44] });
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
function toggleRevealGeo(nom, pid) {
  _geoToggle('geoReveal', nom, pid);
  if ((mapData.geoReveal?.[nom] || []).includes(pid)) logLieu(nom, pid, 'geo:' + nom);
}
function revealGeoAll(nom, all)    {
  _geoAll('geoReveal', nom, all);
  if (all) Object.keys(joueurs).forEach(pid => logLieu(nom, pid, 'geo:' + nom));
}

// ---- Journal : log auto d'un lieu découvert (hybride, dédup par src) ----
function logLieu(nom, pid, baseSrc) { logJournal({ type: 'lieu', title: nom, text: 'Lieu découvert', revealedFor: [pid], src: baseSrc + ':' + pid }); revealEncyLieu(nom, pid); }
// Déblocage auto du Lieu d'encyclopédie lié à ce POI (entry.poi === nom) pour le joueur
function revealEncyLieu(nom, pid) {
  if (!fdb || !nom || !pid) return;
  fdb.collection('encyclopedie').doc(fpCampId()).set({ lieuxPoi: { [nom]: firebase.firestore.FieldValue.arrayUnion(pid) } }, { merge: true }).catch(() => {});
}
function logJournal(entry) {
  if (!fdb) return;
  Promise.all([fdb.collection('journal').doc(fpCampId()).get(), fdb.collection('temps').doc(fpCampId()).get()])
    .then(([js, ts]) => {
      const data = js.exists ? js.data() : {};
      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (entry.src && entries.some(e => e.src === entry.src)) return;     // déjà journalisé
      entry.id = 'j' + Date.now().toString(36) + Math.floor(Math.random() * 999);
      if (entry.time == null) {
        const pid = (entry.revealedFor || [])[0];
        entry.time = (typeof partyMinutesFor === 'function') ? partyMinutesFor(ts.exists ? ts.data() : {}, pid) : 480;
      }
      entries.push(entry);
      fdb.collection('journal').doc(fpCampId()).set({ entries });
    }).catch(e => console.warn('logJournal', e));
}
function toggleVisitGeo(nom, pid)  { _geoToggle('geoVisited', nom, pid); }
function visitGeoAll(nom, all)     { _geoAll('geoVisited', nom, all); }

function geoZonePopup(p) {
  const fk = geoFactionKey(p.Faction);
  const facLabel = (fk && window.FACTIONS?.[fk]?.label) || p.Faction || '—';
  const col = geoColor(p.Faction, p.Type);
  let h = `<div class="zpop"><div class="zpop-title">${p.Nom || 'Zone'}</div>
    <div class="zpop-pool"><span style="color:${col}">${facLabel}</span>${p.Type ? ' · ' + p.Type : ''}${p.Statut ? ' · ' + p.Statut : ''}</div>`;
  if (p.Descriptio) h += `<div class="zpop-pool" style="color:var(--td)">${p.Descriptio}</div>`;
  // Lien générateur de rencontres : MJ uniquement (les joueurs ne déclenchent pas de rencontre)
  if (isMJ) h += `<a class="zpop-link" href="../mj/mj.html?${geoZoneGenQuery(p)}">⚔ Générer une rencontre</a>`;
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
  try { await fdb.collection('carte').doc(fpCampId()).set(mapData); }
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
  // Bandeau MJ gauche (ping/édition) : sur PARIS uniquement (sur Lieux, les outils sont DANS la barre des lieux)
  if (ml) ml.style.display = (isMJ && tab === 'paris') ? 'block' : 'none';
  if (mr) mr.style.display = (isMJ && tab !== 'lieux') ? 'block' : 'none';
  if (tab !== 'paris') { addingPOI = false; cancelDrawZone(); }
  if (tab === 'paris') {
    if (map) setTimeout(() => { map.invalidateSize(); centerOnViewer(); }, 50);
  } else if (tab === 'metro') {
    initMetroMap();
    if (metroMap) setTimeout(() => { lockMetro(); centerOnViewer(); }, 50);
  } else {
    renderLieux();
    if (mapLieu) setTimeout(() => mapLieu.invalidateSize(), 50);
  }
}

// Recentre la carte active sur le jeton du joueur (vue joueur uniquement)
function centerOnViewer() {
  if (!viewerId) return;
  if (currentTab === 'metro') {
    if (!metroMap) return;
    metroMap.invalidateSize();
    const t = mapData.metroTokens?.[viewerId];
    if (t && mapData.underground?.[viewerId]) metroMap.setView([t.lat, t.lng], Math.max(metroMap.getZoom(), 14), { animate: false });
    else lockMetro();
  } else if (currentTab === 'paris') {
    if (!map) return;
    map.invalidateSize();
    const t = mapData.tokens?.[viewerId];
    if (!t) return;
    const zFill = map.getBoundsZoom(MAP_BOUNDS, true);
    const z = Math.max(map.getZoom(), Math.min(zFill + 0.6, 16));   // au moins le zoom de navigation
    map.setView([t.lat, t.lng], z, { animate: false });
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
// Clés de lignes sur lesquelles se trouve un joueur (ligne la plus proche du jeton métro).
// MJ → tous les joueurs sous terre ; joueur → la sienne. Sert à mettre la ligne en évidence.
function activeLineKeys(){
  const set = new Set();
  const ids = (!isMJ && viewerId) ? [viewerId] : Object.keys(mapData.metroTokens || {});
  ids.forEach(id => {
    if (!mapData.underground?.[id]) return;
    const t = mapData.metroTokens?.[id]; if (!t) return;
    const allowed = (!isMJ && viewerId) ? unlockedLinesFor(id) : null;
    const line = nearestMetroLine(t.lat, t.lng, allowed);
    if (line) set.add(lineKey(line));
  });
  return set;
}

// Affiche les égouts. MJ → réseau complet (gestion). Joueur → seulement les lignes des gares découvertes.
// La (les) ligne(s) où se trouve un joueur sont surlignées en ambre (par-dessus) pour suivre le bon tunnel.
function renderMetroLines(){
  if (!metroLineLayer || !metroLinesData) return;
  metroLineLayer.clearLayers();
  let baseFilter;
  if (isMJ || !viewerId) {
    baseFilter = () => true;                               // MJ : tout le réseau
  } else {
    const allowed = unlockedLinesFor(viewerId);
    if (!allowed.size) return;                             // aucune gare découverte → rien
    baseFilter = f => allowed.has(lineKey(f.properties.name));
  }
  const active = activeLineKeys();
  // Réseau de base (lignes non occupées par un joueur)
  L.geoJSON(metroLinesData, { pane: 'metroPane',
    filter: f => baseFilter(f) && !active.has(lineKey(f.properties.name)),
    style: { color: '#5dff5d', weight: 1.6, opacity: active.size ? 0.55 : 0.85, fill: false },
  }).addTo(metroLineLayer);
  // Ligne(s) occupée(s) par un joueur — en ambre, plus épaisses, par-dessus
  if (active.size) L.geoJSON(metroLinesData, { pane: 'metroPane',
    filter: f => baseFilter(f) && active.has(lineKey(f.properties.name)),
    style: { color: '#e8a820', weight: 3, opacity: 0.95, fill: false },
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
  const groups = activeGroups();
  const grouped = new Set(); groups.forEach(p => (p.players||[]).forEach(id => grouped.add(id)));

  // Icône de groupe (métro) à la position moyenne des membres sous terre
  groups.forEach(party => {
    const gp = groupPos(party, mapData.metroTokens, true);
    if (!gp) return;
    const iAmMember = viewerId && (party.players||[]).includes(viewerId);
    if (!isMJ && viewerId && !iAmMember){
      if (!my) return;
      if (L.latLng(my.lat,my.lng).distanceTo(L.latLng(gp.lat,gp.lng)) > VISION_RADIUS_M) return;
    }
    renderGroupMarker(party, gp, iAmMember, metroTokenLayer, mapData.metroTokens, true, my);
  });

  Object.entries(mapData.metroTokens || {}).forEach(([id, pos]) => {
    if (!pos || !mapData.underground?.[id]) return;
    if (grouped.has(id)) return;                       // membre d'un groupe → icône de groupe
    if (!isMJ && viewerId && id !== viewerId){
      if (!my) return;
      if (L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) > VISION_RADIUS_M) return;
    }
    const nom = joueurs[id]?.nom || id;
    const me = id === viewerId;
    const sel = movingMetroToken && movingMetroToken.id === id;
    const m = L.marker([pos.lat, pos.lng], { icon: L.divIcon({ className: 'token-pin' + (me ? ' me' : '') + (sel ? ' sel' : ''),
      html: `<span class="token-dot">${nom.charAt(0).toUpperCase()}</span><span class="token-label">${nom}${me ? ' (toi)' : ''}</span>`,
      iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(metroTokenLayer);
    if (isMJ){
      const st = nearestStation(pos.lat, pos.lng);
      const canUp = st && st.dist < METRO_DESCEND_M;
      m.bindPopup(`<b>${nom}</b><div class="zpop-mj">
        <button onclick="startMetroMove('${id}')">➤ Déplacer</button>
        ${canUp ? `<button onclick="remonterSurface('${id}')">🏙 Remonter (${st.nom})</button>` : '<small>Pas de station à proximité</small>'}
      </div>`);
    } else {
      // Vue joueur : interactions de proximité (les jetons affichés ici sont déjà à portée)
      const exBtns = (viewerId && id !== viewerId) ? _interactBtns(id) : '';
      m.bindPopup('<b>' + nom + '</b>' + exBtns);
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
  const to = e.latlng;
  const ids = movingMetroToken.ids || [movingMetroToken.id];
  ids.forEach(id => {
    const from = mapData.metroTokens[id] || movingMetroToken.from;
    mapData.metroTokens[id] = { lat: to.lat, lng: to.lng };
    recordMetroFog(id, from.lat, from.lng);
    recordMetroFog(id, to.lat, to.lng);
  });
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

// Un POI/lieu est "atteint" par le joueur s'il lui est révélé (revealedFor) ou géo-révélé
function poiRevealedToViewer(name) {
  if (!name) return false;
  if (isMJ) return true;
  if (!viewerId) return false;
  const poi = (mapData.pois || []).find(p => p.name === name);
  if (poi && Array.isArray(poi.revealedFor) && poi.revealedFor.includes(viewerId)) return true;
  if ((mapData.geoReveal?.[name] || []).includes(viewerId)) return true;
  return false;
}
function settlementVisible(s) { return isMJ || poiRevealedToViewer(s.poi); }
// Refuge "point de repos" visible lié à ce POI (pour le pin 🛏 sur la carte)
function restRefugeAt(poiName) {
  if (!poiName) return null;
  return Object.values(settlementsData.sites || {}).find(s => s.poi === poiName && s.restPoint && settlementVisible(s)) || null;
}

function renderLieux() {
  const el = document.getElementById('lieux-list'); if (!el) return;
  let html = '';
  if (isMJ) html += '<button class="lieu-btn" style="border-color:var(--g);color:var(--g)" onclick="ajouterLieu()">🏛 + Ajouter un lieu</button>';
  if (lieux.length) html += lieux.map(l =>
    `<button class="lieu-btn${lieuActif?.id === l.id ? ' on' : ''}" onclick="ouvrirLieu('${l.id}')">${l.name}</button>`
  ).join('');
  // Refuges visibles (le joueur est sur le lieu) — MJ voit tout
  const sites = Object.entries(settlementsData.sites || {}).filter(([id, s]) => settlementVisible(s));
  if (sites.length) {
    html += '<div class="lieux-sub">🏚 Refuges</div>' + sites.map(([id, s]) =>
      `<button class="lieu-btn refuge${_openRefuge === id ? ' on' : ''}" onclick="ouvrirRefuge('${id}')">🏚 ${s.name}${s.restPoint ? ' 🛏' : ''}${isMJ && !s.poi ? ' ⚠' : ''}</button>`
    ).join('');
  }
  el.innerHTML = html || '<span class="empty">Aucun lieu accessible.</span>';
}

// Ouvre le constructeur de refuge (iframe) dans la zone des lieux
function ouvrirRefuge(id) {
  _openRefuge = id; lieuActif = null;
  const ph = document.getElementById('lieux-placeholder'); if (ph) ph.style.display = 'none';
  const mapDiv = document.getElementById('map-lieux'); if (mapDiv) mapDiv.style.display = 'none';
  if (mapLieu) { mapLieu.remove(); mapLieu = null; }
  const fr = document.getElementById('lieux-settlement-frame'); if (!fr) return;
  const camp = (typeof fpCampId === 'function') ? fpCampId() : 'data';
  let src = '../settlements/settlement.html?embed=1&site=' + encodeURIComponent(id) + '&camp=' + encodeURIComponent(camp);
  if (viewerId) src += '&id=' + encodeURIComponent(viewerId);
  fr.src = src; fr.style.display = 'block';
  renderLieux();
}

function ouvrirLieu(id) {
  const l = lieux.find(x => x.id === id); if (!l) return;
  lieuActif = l; _openRefuge = null;
  const fr = document.getElementById('lieux-settlement-frame'); if (fr) { fr.style.display = 'none'; fr.src = ''; }
  const ph = document.getElementById('lieux-placeholder');
  const mapDiv = document.getElementById('map-lieux');
  if (mapDiv) mapDiv.style.display = '';
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
  if (isMJ) { editMode = true; const t = document.getElementById('mjp-tools'); if (t) t.style.display = 'block'; buildPoiPicker(); }
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
      // Joueurs : zone = simple dessin, non cliquable (le clic traverse, ex. déplacement/POI)
      interactive: isMJ,
    }).addTo(zoneLayer);
    if (isMJ) {
      poly.bindPopup(zonePopup(z));
      poly.on('popupopen', () => { openItem = { kind: 'zone', id: z.id }; });
    }
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
    const hasType = !!POI_TYPES[p.type];
    const t = POI_TYPES[p.type] || POI_TYPES.other;
    const dim = isMJ && !anyRevealed(p);
    // POI sans type défini → simple pastille verte lumineuse (pas d'icône)
    const dotHtml = hasType
      ? `<span class="poi-dot" style="background:${t.color}">${t.icon}</span>`
      : `<span class="poi-dot glow"></span>`;
    const m = L.marker([p.lat, p.lng], {
      draggable: isMJ && editMode, opacity: dim ? 0.5 : 1,
      icon: L.divIcon({ className: 'poi-pin', html: dotHtml,
        iconSize: [16, 16], iconAnchor: [8, 8] }),
    }).addTo(poiLayer);
    m.bindTooltip(p.name + (restRefugeAt(p.name) ? ' 🛏' : '') + (dim ? ' 🔒' : ''), { className: 'map-tip', direction: 'top', offset: [0, -8] });
    m.bindPopup(poiPopup(p, t));
    m.on('popupopen', () => { openItem = { kind: 'poi', id: p.id }; });
    poiMarkers[p.id] = m;
    if (isMJ && editMode) m.on('dragend', () => {
      const o = mapData.pois.find(x => x.id === p.id);
      if (o) { o.lat = m.getLatLng().lat; o.lng = m.getLatLng().lng; saveData(); }
    });
  });
}

// Groupes actifs (non solo, >= 2 joueurs) — leurs jetons fusionnent en une seule icône
function activeGroups(){ return (parties||[]).filter(p => !p.solo && (p.players||[]).length >= 2); }
function groupOf(id){ return activeGroups().find(p => (p.players||[]).includes(id)) || null; }
// Position moyenne des membres d'un groupe sur une couche donnée (src=tokens surface ou metroTokens)
function groupPos(party, src, undergroundWanted){
  const pts = (party.players||[])
    .filter(pid => !!mapData.underground?.[pid] === undergroundWanted)
    .map(pid => src?.[pid]).filter(Boolean);
  if (!pts.length) return null;
  const lat = pts.reduce((a,p)=>a+p.lat,0)/pts.length;
  const lng = pts.reduce((a,p)=>a+p.lng,0)/pts.length;
  return { lat, lng, count: pts.length };
}

function renderTokens() {
  tokenLayer.clearLayers();
  const my = (!isMJ && viewerId) ? mapData.tokens?.[viewerId] : null;
  const groups = activeGroups();
  const grouped = new Set(); groups.forEach(p => (p.players||[]).forEach(id => grouped.add(id)));

  // 1) Icône de groupe (surface) à la position moyenne des membres en surface
  groups.forEach(party => {
    const gp = groupPos(party, mapData.tokens, false);
    if (!gp) return;                                   // aucun membre du groupe en surface
    const iAmMember = viewerId && (party.players||[]).includes(viewerId);
    if (!isMJ && viewerId && !iAmMember){
      // visible si un membre est à portée OU balise partagée avec un membre
      const beaconShared = (party.players||[]).some(pid => (mapData.beacons?.[viewerId]||[]).includes(pid));
      if (!beaconShared){
        if (!my) return;
        if (L.latLng(my.lat,my.lng).distanceTo(L.latLng(gp.lat,gp.lng)) > VISION_RADIUS_M) return;
      }
    }
    renderGroupMarker(party, gp, iAmMember, tokenLayer, mapData.tokens, false, my);
  });

  Object.entries(mapData.tokens || {}).forEach(([id, pos]) => {
    if (!pos) return;
    if (grouped.has(id)) return;                       // membre d'un groupe → représenté par l'icône de groupe
    if (mapData.underground?.[id]) return;            // sous terre → visible sur la carte métro, pas en surface
    // Vue joueur : alliés visibles dans VISION_RADIUS_M m, OU en permanence si balise GPS partagée
    if (!isMJ && viewerId && id !== viewerId) {
      const beaconShared = (mapData.beacons?.[viewerId] || []).includes(id);
      if (!beaconShared) {
        if (!my) return;
        if (L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) > VISION_RADIUS_M) return;
      }
    }
    const nom = joueurs[id]?.nom || id;
    const me = id === viewerId;
    const sel = movingToken && movingToken.id === id;
    const m = L.marker([pos.lat, pos.lng], {
      draggable: isMJ && editMode,
      icon: L.divIcon({ className: 'token-pin' + (me ? ' me' : '') + (sel ? ' sel' : ''),
        html: `<span class="token-dot">${nom.charAt(0).toUpperCase()}</span><span class="token-label">${nom}${me ? ' (toi)' : ''}</span>`,
        iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(tokenLayer);
    let mjBtns = '';
    if (isMJ) {
      const st = nearestStation(pos.lat, pos.lng);
      const canDown = st && st.dist < METRO_DESCEND_M;
      mjBtns = `<div class="zpop-mj"><button onclick="startMoveFromToken('${id}')">➤ Déplacer</button>${canDown ? `<button onclick="descendreMetro('${id}')">🚇 Descendre (${st.nom})</button>` : ''}</div>`;
    }
    // Vue joueur : actions d'interaction UNIQUEMENT si réellement à portée (pas seulement visible via balise GPS)
    let exBtns = '';
    if (!isMJ && viewerId && id !== viewerId) {
      const inRange = my && L.latLng(my.lat, my.lng).distanceTo(L.latLng(pos.lat, pos.lng)) <= VISION_RADIUS_M;
      exBtns = inRange ? _interactBtns(id)
                       : '<div class="tok-actions"><span style="font-size:7px;color:var(--td)">Hors de portée pour interagir</span></div>';
    }
    m.bindPopup('<b>' + nom + '</b>' + mjBtns + exBtns);
    if (isMJ && editMode) m.on('dragend', () => {
      const ll = m.getLatLng();
      mapData.tokens[id] = { lat: ll.lat, lng: ll.lng };
      recordFog(id, ll.lat, ll.lng);
      saveData();
    });
  });
}

// Icône unique pour un groupe de joueurs (surface ou métro). Cache les jetons individuels des membres.
function renderGroupMarker(party, gp, iAmMember, layer, src, underground, my){
  const nom = party.name || 'Groupe';
  const me = iAmMember;
  const m = L.marker([gp.lat, gp.lng], {
    draggable: isMJ && editMode && !underground,
    icon: L.divIcon({ className: 'token-pin group' + (me ? ' me' : ''),
      html: `<span class="token-dot">👥</span><span class="token-label">${nom} (${gp.count})${me ? ' (toi)' : ''}</span>`,
      iconSize: [24, 24], iconAnchor: [12, 12] }),
  }).addTo(layer);

  let mjBtns = '';
  if (isMJ){
    const st = nearestStation(gp.lat, gp.lng);
    if (!underground){
      const canDown = st && st.dist < METRO_DESCEND_M;
      mjBtns = `<div class="zpop-mj"><button onclick="startGroupMove('${party.id}')">➤ Déplacer le groupe</button>${canDown ? `<button onclick="descendreGroupe('${party.id}')">🚇 Descendre (${st.nom})</button>` : ''}</div>`;
    } else {
      const canUp = st && st.dist < METRO_DESCEND_M;
      mjBtns = `<div class="zpop-mj"><button onclick="startGroupMetroMove('${party.id}')">➤ Déplacer le groupe</button>${canUp ? `<button onclick="remonterGroupe('${party.id}')">🏙 Remonter (${st.nom})</button>` : '<small>Pas de station à proximité</small>'}</div>`;
    }
  }
  const memberNames = (party.players||[]).map(pid => joueurs[pid]?.nom || pid).join(', ');
  let exBtns = '';
  if (!isMJ && viewerId && !iAmMember){
    const inRange = my && L.latLng(my.lat, my.lng).distanceTo(L.latLng(gp.lat, gp.lng)) <= VISION_RADIUS_M;
    exBtns = inRange
      ? (party.players||[]).map(pid => `<div style="font-size:7px;color:var(--td);margin-top:4px">${joueurs[pid]?.nom || pid}</div>` + _interactBtns(pid)).join('')
      : '<div class="tok-actions"><span style="font-size:7px;color:var(--td)">Hors de portée pour interagir</span></div>';
  }
  m.bindPopup(`<b>👥 ${nom}</b><div style="font-size:8px;color:var(--td);margin:2px 0">${memberNames}</div>${mjBtns}${exBtns}`);

  if (isMJ && editMode && !underground) m.on('dragend', () => {
    const ll = m.getLatLng();
    (party.players||[]).filter(pid => !mapData.underground?.[pid] && mapData.tokens?.[pid]).forEach(pid => {
      mapData.tokens[pid] = { lat: ll.lat, lng: ll.lng };
      recordFog(pid, ll.lat, ll.lng);
    });
    saveData();
  });
}

// Déplacement de groupe (surface) : clic destination → tous les membres en surface s'y rendent
function startGroupMove(partyId){
  const party = (parties||[]).find(p => p.id === partyId); if (!party) return;
  const ids = (party.players||[]).filter(pid => !mapData.underground?.[pid] && mapData.tokens?.[pid]);
  if (!ids.length) return;
  map.closePopup();
  pingMode = false; document.getElementById('btn-ping')?.classList.remove('on');
  addingPOI = false; if(typeof updatePoiPicker==='function')updatePoiPicker(); cancelDrawZone();
  moveMode = true; movingToken = { groupId: partyId, ids, from: { ...mapData.tokens[ids[0]] } };
  setLayersClickable(false);
  setHint('Clique la destination pour le groupe « ' + (party.name||'') + ' ».');
  renderTokens();
}
// Déplacement de groupe (métro)
function startGroupMetroMove(partyId){
  const party = (parties||[]).find(p => p.id === partyId); if (!party) return;
  const ids = (party.players||[]).filter(pid => mapData.underground?.[pid] && mapData.metroTokens?.[pid]);
  if (!ids.length) return;
  metroMap.closePopup();
  metroMoveMode = true; movingMetroToken = { groupId: partyId, ids, from: { ...mapData.metroTokens[ids[0]] } };
  setHint('Clique la destination dans le métro pour le groupe « ' + (party.name||'') + ' ».');
  renderMetroTokens();
}
// Transport surface→métro de tout un groupe (membres proches d'une station)
function descendreGroupe(partyId){
  const party = (parties||[]).find(p => p.id === partyId); if (!party) return;
  mapData.underground = mapData.underground || {}; mapData.metroTokens = mapData.metroTokens || {};
  (party.players||[]).forEach(pid => {
    const t = mapData.tokens?.[pid]; if (!t) return;
    const st = nearestStation(t.lat, t.lng); if (!st || st.dist > METRO_DESCEND_M) return;
    mapData.underground[pid] = true;
    mapData.metroTokens[pid] = { lat: st.lat, lng: st.lng };
    recordMetroFog(pid, st.lat, st.lng);
  });
  saveData(); if (map) map.closePopup();
}
function remonterGroupe(partyId){
  const party = (parties||[]).find(p => p.id === partyId); if (!party) return;
  mapData.underground = mapData.underground || {};
  (party.players||[]).forEach(pid => {
    const t = mapData.metroTokens?.[pid]; if (!t) return;
    const st = nearestStation(t.lat, t.lng);
    mapData.underground[pid] = false;
    if (st){ mapData.tokens[pid] = { lat: st.lat, lng: st.lng }; recordFog(pid, st.lat, st.lng); }
  });
  saveData(); if (metroMap) metroMap.closePopup();
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
  renderMJMaintenance();
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

// ---- Maintenance MJ : reset brouillards / jetons, nettoyage des orphelins ----
function _mapPresenceIds(){
  const s = new Set();
  ['tokens','metroTokens','fog','metroFog','underground','beacons'].forEach(k => {
    Object.keys(mapData[k] || {}).forEach(id => s.add(id));
  });
  return [...s];
}
function renderMJMaintenance(){
  const el = document.getElementById('mj-maintenance'); if (!el) return;
  const ids = Object.keys(joueurs);
  const orphans = _mapPresenceIds().filter(id => !joueurs[id]);
  let h = ids.map(id => `<div class="mt-row"><span class="mt-nom">${_exEsc(joueurs[id]?.nom || id)}</span>
      <button class="mt-btn" onclick="resetFog('${id}')" title="Réinitialiser le brouillard de ce joueur">🌫</button>
      <button class="mt-btn del" onclick="removeToken('${id}')" title="Retirer son jeton de la carte">✖</button></div>`).join('');
  if (orphans.length){
    h += `<div class="mt-sub">Jetons orphelins (joueur supprimé)</div>`;
    h += orphans.map(id => `<div class="mt-row"><span class="mt-nom" style="color:var(--td)">${_exEsc(id)}</span>
      <button class="mt-btn del" onclick="removeToken('${id}')" title="Supprimer ce jeton orphelin">✖ supprimer</button></div>`).join('');
  }
  h += `<div class="mt-glob">
      <button class="mt-btn" onclick="resetAllFog()">🌫 Reset tous les brouillards</button>
      <button class="mt-btn del" onclick="cleanOrphanTokens()">🧹 Nettoyer les orphelins</button>
      <button class="mt-btn del" onclick="resetAllTokens()">✖ Reset tous les jetons</button>
    </div>`;
  el.innerHTML = h || '<span class="empty">—</span>';
}
function resetFog(id){
  if (!confirm('Réinitialiser le brouillard de ' + (joueurs[id]?.nom || id) + ' ?')) return;
  if (mapData.fog) delete mapData.fog[id];
  if (mapData.metroFog) delete mapData.metroFog[id];
  saveData();
  if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', 'Brouillard réinitialisé : ' + (joueurs[id]?.nom || id));
}
function resetAllFog(){
  if (!confirm('Réinitialiser le brouillard de TOUS les joueurs ?')) return;
  mapData.fog = {}; mapData.metroFog = {};
  saveData();
  if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', 'Tous les brouillards réinitialisés');
}
function removeToken(id){
  if (!confirm('Retirer ' + (joueurs[id]?.nom || id) + ' de la carte (jeton + brouillard) ?')) return;
  ['tokens','metroTokens','fog','metroFog','underground','beacons'].forEach(k => { if (mapData[k]) delete mapData[k][id]; });
  // retire aussi cet id des listes de balises des autres
  if (mapData.beacons) Object.keys(mapData.beacons).forEach(k => { mapData.beacons[k] = (mapData.beacons[k] || []).filter(x => x !== id); });
  saveData();
}
function cleanOrphanTokens(){
  const orphans = _mapPresenceIds().filter(id => !joueurs[id]);
  if (!orphans.length){ alert('Aucun jeton orphelin.'); return; }
  if (!confirm('Supprimer ' + orphans.length + ' jeton(s) orphelin(s) ?')) return;
  orphans.forEach(id => ['tokens','metroTokens','fog','metroFog','underground','beacons'].forEach(k => { if (mapData[k]) delete mapData[k][id]; }));
  if (mapData.beacons) Object.keys(mapData.beacons).forEach(k => { mapData.beacons[k] = (mapData.beacons[k] || []).filter(x => joueurs[x]); });
  saveData();
}
function resetAllTokens(){
  if (!confirm('Retirer TOUS les jetons de la carte ? (le brouillard est conservé)')) return;
  mapData.tokens = {}; mapData.metroTokens = {}; mapData.underground = {};
  saveData();
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
  if (z.radLevel > 0) tags.push(`<span style="color:#5dff5d">☢ ${z.radLevel} rad</span>`);
  let h = `<div class="zpop"><div class="zpop-title">${z.name || base.label || z.baseZone || 'Zone'}</div>`;
  if (tags.length) h += `<div class="zpop-pool">${tags.join(' · ')}</div>`;
  // Lien vers le générateur de rencontres : MJ uniquement (les joueurs ne déclenchent pas de rencontre)
  if (isMJ) {
    const qs = new URLSearchParams({ zone: z.baseZone || '', occ: z.occupation || '', var: z.variation || '', threat: z.threat || '' });
    h += `<a class="zpop-link" href="../mj/mj.html?${qs.toString()}">⚔ Générer une rencontre</a>`;
  }
  if (isMJ) h += `<div class="zpop-mj"><button onclick="editZone('${z.id}')">✎ Éditer</button>
    <button onclick="deleteZone('${z.id}')" class="del">🗑</button></div>` + revealControls('zone', z.id, z);
  return h + '</div>';
}
function poiPopup(p, t) {
  let h = `<div class="zpop"><div class="zpop-title">${t.icon} ${p.name}</div>
    <div class="zpop-pool">${t.label}${p.desc ? ' — ' + p.desc : ''}</div>`;
  // POI marchand : boutique
  if (p.type === 'trader') {
    if (isMJ) {
      h += `<div class="zpop-mj"><button onclick="genPoiShop('${p.id}')">🛒 ${shopsData[p.id] ? 'Régénérer' : 'Générer'} la boutique</button></div>`;
    } else if (viewerId) {
      if (shopsData[p.id]) {
        h += _poiInRange(p)
          ? `<div class="tok-actions"><button onclick="enterPoiShop('${p.id}')">🛒 Entrer dans la boutique</button></div>`
          : `<div class="zpop-pool" style="color:var(--td)">🛒 Trop loin pour commercer.</div>`;
      }
    }
  }
  if (isMJ) h += `<div class="zpop-mj"><button onclick="editPOI('${p.id}')">✎ Éditer</button>
    <button onclick="deletePOI('${p.id}')" class="del">🗑</button></div>` + revealControls('poi', p.id, p);
  return h + '</div>';
}
function _poiInRange(p){ const t = mapData.tokens?.[viewerId]; return !!(t && L.latLng(t.lat,t.lng).distanceTo(L.latLng(p.lat,p.lng)) <= VISION_RADIUS_M); }
function enterPoiShop(poiId){
  if (window.parent && window.parent !== window) window.parent.postMessage({ type:'open-shop', shop: poiId }, '*');
  else window.open('../boutique/boutique.html?id=' + encodeURIComponent(viewerId||'') + '&shop=' + encodeURIComponent(poiId), '_blank');
}
function _genShopItems(n){
  const DBs = window.DB || {};
  const cats = [['weapons','WEAPON'],['armor','ARMOR'],['food','FOOD'],['drinks','DRINK'],['drugs','DRUGS'],['stuff','STUFF']];
  const pick = list => { let tot=0; const w=list.map(it=>{ const x=Math.max(1,6-(it.r||3)); tot+=x; return x; }); let r=Math.random()*tot; for(let i=0;i<list.length;i++){ r-=w[i]; if(r<=0) return list[i]; } return list[list.length-1]; };
  const items = [];
  for(let i=0;i<n*2 && items.length<n;i++){
    const [ck,ctype] = cats[Math.floor(Math.random()*cats.length)];
    const src = DBs[ck] || []; if(!src.length) continue;
    const it = pick(src);
    const ex = items.find(x => x.name === it.n); if(ex){ ex.qty++; continue; }
    items.push({ id:'s'+Date.now().toString(36)+i, name:it.n, type:(ck==='armor'?(it.t||'ARMOR'):ctype), cat:ck, r:it.r||3, w:it.w||0, qty:1+Math.floor(Math.random()*4) });
  }
  return items;
}
async function genPoiShop(poiId){
  const poi = (mapData.pois||[]).find(x => x.id === poiId); if(!poi) return;
  const nb = parseInt(prompt('Nombre d\'articles dans la boutique :', '12')) || 12;
  const ref = fdb.collection('boutiques').doc(fpCampId());
  let shops = {};
  try { const s = await ref.get(); shops = (s.exists && s.data().shops) || {}; } catch(e){}
  shops[poiId] = { id: poiId, name: poi.name || 'Marchand', markup: 1, items: _genShopItems(Math.min(40, Math.max(1, nb))), openFor: [] };
  try { await ref.set({ shops }, { merge:true }); carteToast('🛒 Boutique générée : ' + (poi.name||'Marchand')); }
  catch(e){ console.error(e); carteToast('Échec', true); }
  map.closePopup();
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
function creerPOI(latlng) {
  const type = POI_TYPES[pendingPoiType] ? pendingPoiType : 'other';
  addingPOI = false; updatePoiPicker(); setHint('');
  const name = prompt('Nom du ' + POI_TYPES[type].label + ' :'); if (!name) return;
  const desc = prompt('Description (optionnel) :') || '';
  mapData.pois.push({ id: 'p' + Date.now(), name, type,
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

// ---- Radiation par zone (auto au déplacement) ----
const GEO_RAD_DEFAULT = 3;   // rads par défaut pour une zone GeoJSON marquée "irradiée" (sans niveau)
// Niveau de rad à un point (zones dessinées radLevel, sinon GeoJSON Statut "rad")
function zoneRadAt(lat, lng) {
  for (const z of (mapData.zones || [])) {
    if ((z.radLevel || 0) > 0 && z.polygon && z.polygon.length >= 3 &&
        pointInPoly(lng, lat, z.polygon.map(p => ({ x: p.lng, y: p.lat }))))
      return z.radLevel;
  }
  if (geoZonesData) {
    for (const f of geoZonesData.features) {
      if (('' + (f.properties.Statut || '')).toLowerCase().includes('rad') && geoPointInFeature(lat, lng, f))
        return parseInt(f.properties.RadLevel) || GEO_RAD_DEFAULT;
    }
  }
  return 0;
}
// RD radiation d'un joueur : meilleure RD rad d'armure équipée (+ mods) + perks
function radResist(d) {
  let r = 0;
  (d.inventory || []).forEach(it => {
    if (!it.equipped) return;
    const a = (window.DB?.armor || []).find(x => x.n === it.name);
    if (a && typeof a.rad === 'number') {
      const e = (typeof fpApplyArmorMods === 'function') ? fpApplyArmorMods(a, it.mods) : a;
      r = Math.max(r, e.rad || 0);
    }
  });
  const p = d.perks || {};
  if (p['Rad Resistant']) r += p['Rad Resistant'];
  return r;
}
function _hpMaxLite(d) {
  const s = d.special || {};
  return (s.L || 5) + (s.E || 5) + Math.max(0, (d.niveau || 1) - 1) + ((d.perks?.['Life Giver'] || 0) * (s.E || 5)) + (d.survie?.wellRested ? 2 : 0);
}
// Applique les rads de la zone d'arrivée (− RD radiation) sur le compteur du joueur
async function applyZoneRads(id, lat, lng) {
  const d = joueurs[id]; if (!d) return;
  const lvl = zoneRadAt(lat, lng); if (lvl <= 0) return;
  const resist = radResist(d);
  const net = Math.max(0, lvl - resist);
  if (net <= 0) return;
  const cur = d.rad || 0;
  const nv = Math.min(_hpMaxLite(d), cur + net);
  if (nv === cur) return;
  joueurs[id].rad = nv;
  try { await fdb.collection('joueurs').doc(id).update({ rad: nv, lastUpdate: Date.now() }); } catch (e) { console.error('applyZoneRads', e); }
  if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', `☢ ${d.nom || id} : +${net} rad (zone irradiée niv.${lvl}${resist ? `, RD rad ${resist}` : ''})`);
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
function propGroup(to){
  const g = groupOf(to);
  if(g){   // la cible est déjà dans un groupe → proposer de le rejoindre (pas de saisie de nom)
    _sendProposal(to, 'group', { groupName: g.name || 'Groupe', joinTarget: true });
    return;
  }
  const def = joueurs[viewerId]?.nom ? ('Groupe de ' + joueurs[viewerId].nom) : 'Groupe';
  const name = prompt('Nom du groupe à proposer :', def);
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
      return `<div class="ex-row"><span class="ex-name">${_exEsc(it.name)}</span><span class="ex-have">x${it.qty||1}</span>`
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
      if(it) items.push({ name: it.name, type: it.type, w: it.w||0, n });
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
    const lst = (p.items||[]).map(it => `${it.n}× ${_exEsc(it.ammo ? ('▪ '+it.cal) : it.name)}`).join(', ');
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
    const src = fromInv.find(it => it.name === gi.name && it.type === gi.type);
    if(!src) return;
    const give = Math.min(gi.n, src.qty || 1);
    src.qty = (src.qty || 1) - give;
    const dst = toInv.find(it => it.name === gi.name && it.type === gi.type && !it.equipped);
    if(dst) dst.qty = (dst.qty || 1) + give;
    else toInv.push({ name: gi.name, type: gi.type, w: gi.w || 0, qty: give });
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
