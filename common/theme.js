// ============================================================
// THÈME PRINCIPAL — musique d'ambiance persistante entre pages
// (accueil → création de personnage…). La position de lecture est
// mémorisée en sessionStorage pour reprendre quasi sans coupure.
// Boucle ; repli si l'autoplay est bloqué → démarre au 1er clic/touche.
// Bouton flottant couper / reprendre (bas-gauche).
// Inclure via : <script src="../../common/theme.js"></script>
// ============================================================
(function(){
  const THEME_VOL = 0.4;
  const POS_KEY = 'fp_themePos';
  const MUTE_KEY = 'fp_themeMuted';
  const muted = localStorage.getItem(MUTE_KEY) === '1';

  const audio = new Audio('../../audio/main_theme.mp3');
  audio.loop = true; audio.volume = THEME_VOL; audio.preload = 'auto';

  // Reprendre où on s'était arrêté sur la page précédente
  const startAt = parseFloat(sessionStorage.getItem(POS_KEY) || '0') || 0;
  const seekStart = () => { try { if(startAt > 0 && isFinite(audio.duration)) audio.currentTime = startAt % audio.duration; } catch(e){} };
  audio.addEventListener('loadedmetadata', seekStart, { once:true });

  function tryPlay(){ if(audio.paused) audio.play().catch(()=>{}); }
  function startOnGesture(){ tryPlay(); }
  if(!muted){
    tryPlay();
    ['pointerdown','keydown','touchstart'].forEach(ev => window.addEventListener(ev, startOnGesture));
  }

  // Sauvegarde régulière de la position + au départ de la page
  const savePos = () => { try { sessionStorage.setItem(POS_KEY, String(audio.currentTime||0)); } catch(e){} };
  setInterval(() => { if(!audio.paused) savePos(); }, 1000);
  window.addEventListener('pagehide', savePos);
  window.addEventListener('beforeunload', savePos);

  // Bouton flottant couper / reprendre
  const SPK_ON  = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.title = "Musique d'ambiance";
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;width:34px;height:34px;background:var(--p2,#162016);border:1px solid var(--b2,#3a5c3a);color:var(--g,#5dbe5d);cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;padding:6px;border-radius:3px;';
  const upd = () => { btn.innerHTML = audio.paused ? SPK_OFF : SPK_ON; };
  btn.onclick = () => {
    if(audio.paused){ audio.play().catch(()=>{}); localStorage.setItem(MUTE_KEY,'0'); }
    else { audio.pause(); savePos(); localStorage.setItem(MUTE_KEY,'1'); }
    upd();
  };
  audio.addEventListener('play', upd); audio.addEventListener('pause', upd);
  const mount = () => { if(!document.getElementById('theme-toggle')) document.body.appendChild(btn); upd(); };
  if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
