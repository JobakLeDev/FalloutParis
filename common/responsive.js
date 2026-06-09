// ============================================================
// MISE À L'ÉCHELLE RESPONSIVE
// Le design est conçu autour d'une largeur de contenu ~1400px. Plutôt que
// d'imposer un zoom fixe (illisible/débordant selon l'écran : 14" → 27"),
// on calcule un zoom proportionnel à la largeur de la fenêtre, borné.
//   - petit écran (14"/16") : zoom < 1 → tout tient, pas de scroll horizontal
//   - grand écran (24"/27") : zoom jusqu'à 1.5 → confort de lecture
// Les pages embarquées en iframe (?embed=1) ne sont PAS zoomées (le parent
// les met déjà à l'échelle). La carte contre-zoome sa map Leaflet (1/zoom)
// pour qu'elle reste à l'échelle normale.
// ============================================================
(function(){
  var EMBED = false;
  try { EMBED = new URLSearchParams(location.search).get('embed') === '1'; } catch(e){}

  var DESIGN = 1460;   // largeur de contenu de référence (≈ max-width 1400 + marges)
  var MINZ = 0.8, MAXZ = 1.5;

  function apply(){
    if(!document.body) return;
    if(EMBED){ document.body.style.zoom = ''; return; }
    var w = window.innerWidth || document.documentElement.clientWidth || DESIGN;
    var z = w / DESIGN;
    if(z < MINZ) z = MINZ;
    if(z > MAXZ) z = MAXZ;
    z = Math.round(z * 1000) / 1000;
    document.body.style.zoom = z;
    window.__fpZoom = z;
    // Carte : la map Leaflet reste à l'échelle normale (contre-zoom = 1/zoom)
    var inv = (1 / z).toFixed(4);
    var maps = document.querySelectorAll('#map, #map-metro, #map-lieux');
    for(var i=0;i<maps.length;i++){ maps[i].style.zoom = inv; }
  }

  // Appliquer le plus tôt possible (body présent car script en fin de body), puis au resize.
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
})();
