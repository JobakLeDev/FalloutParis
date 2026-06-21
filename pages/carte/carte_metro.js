// ============================================================
// carte_metro.js — Onglet MÉTRO (réseau de tunnels, brouillard métro,
// jetons sous terre, stations/lignes débloquées). Extrait de carte.js.
// Scope global partagé : chargé APRÈS carte.js, appels résolus au runtime.
// (top-level: let metroMap/metroInit — lus uniquement au runtime.)
// ============================================================
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
