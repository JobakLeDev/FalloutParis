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


async function ajouterLieu() {
  const name = await fpPrompt('Nom du lieu :'); if (!name) return;
  const image = await fpPrompt('Chemin de l\'image (ex: ../../img/plan_metro.jpg) :', '../../img/') || '';
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
async function demanderMJ() {
  if (isMJ || viewerId) return;
  if (await fpPrompt('Code MJ :') !== MJ_CODE) return;
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

// Découverte auto d'un refuge/settlement : son jeton arrive à <100 m du POI lié → révélé au joueur.
const SETTLEMENT_DISCOVER_M = 100;
function _settlementAutoReveal(id, lat, lng) {
  if (!id) return;
  Object.values(settlementsData.sites || {}).forEach(s => {
    if (!s.poi) return;
    const poi = (mapData.pois || []).find(p => p.name === s.poi);
    if (!poi || poi.lat == null) return;
    if (L.latLng(lat, lng).distanceTo(L.latLng(poi.lat, poi.lng)) > SETTLEMENT_DISCOVER_M) return;
    poi.revealedFor = poi.revealedFor || [];
    if (!poi.revealedFor.includes(id)) { poi.revealedFor.push(id); if (typeof logLieu === 'function') logLieu(poi.name, id, 'poi:' + poi.id); }
  });
}

// Enregistre le trajet exploré en mètres (gommage permanent, traînée interpolée).
function recordFog(id, lat, lng) {
  _settlementAutoReveal(id, lat, lng);
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
async function resetFog(id){
  if (!await fpConfirm('Réinitialiser le brouillard de ' + (joueurs[id]?.nom || id) + ' ?')) return;
  if (mapData.fog) delete mapData.fog[id];
  if (mapData.metroFog) delete mapData.metroFog[id];
  saveData();
  if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', 'Brouillard réinitialisé : ' + (joueurs[id]?.nom || id));
}
async function resetAllFog(){
  if (!await fpConfirm('Réinitialiser le brouillard de TOUS les joueurs ?')) return;
  mapData.fog = {}; mapData.metroFog = {};
  saveData();
  if (typeof fpLogAction === 'function') fpLogAction(fdb, 'MJ', 'Tous les brouillards réinitialisés');
}
async function removeToken(id){
  if (!await fpConfirm('Retirer ' + (joueurs[id]?.nom || id) + ' de la carte (jeton + brouillard) ?')) return;
  ['tokens','metroTokens','fog','metroFog','underground','beacons'].forEach(k => { if (mapData[k]) delete mapData[k][id]; });
  // retire aussi cet id des listes de balises des autres
  if (mapData.beacons) Object.keys(mapData.beacons).forEach(k => { mapData.beacons[k] = (mapData.beacons[k] || []).filter(x => x !== id); });
  saveData();
}
async function cleanOrphanTokens(){
  const orphans = _mapPresenceIds().filter(id => !joueurs[id]);
  if (!orphans.length){ alert('Aucun jeton orphelin.'); return; }
  if (!await fpConfirm('Supprimer ' + orphans.length + ' jeton(s) orphelin(s) ?')) return;
  orphans.forEach(id => ['tokens','metroTokens','fog','metroFog','underground','beacons'].forEach(k => { if (mapData[k]) delete mapData[k][id]; }));
  if (mapData.beacons) Object.keys(mapData.beacons).forEach(k => { mapData.beacons[k] = (mapData.beacons[k] || []).filter(x => joueurs[x]); });
  saveData();
}
async function resetAllTokens(){
  if (!await fpConfirm('Retirer TOUS les jetons de la carte ? (le brouillard est conservé)')) return;
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
  const nb = parseInt(await fpPrompt('Nombre d\'articles dans la boutique :', '12')) || 12;
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

