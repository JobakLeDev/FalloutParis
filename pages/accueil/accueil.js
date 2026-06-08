// firebaseConfig défini dans common/shared.js
const fbApp = firebase.initializeApp(firebaseConfig);
const db = fbApp.firestore();

// Entrée clavier → connexion au Enter
document.getElementById('inp-code').addEventListener('keydown', e => {
  if(e.key === 'Enter') connexion();
});
document.getElementById('inp-id').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('inp-code').focus();
});

async function connexion() {
  const id = document.getElementById('inp-id').value.trim().toLowerCase();
  const code = document.getElementById('inp-code').value.trim();

  if(!id){ showMsg('Entre ton identifiant !', 'err'); return; }
  if(!code){ showMsg('Entre ton code !', 'err'); return; }

  showLoading(true);

  try {
    const snap = await db.collection('joueurs').doc(id).get();

    if(!snap.exists){
      showLoading(false);
      showMsg('Identifiant introuvable. Crée un personnage d\'abord !', 'err');
      return;
    }

    const data = snap.data();

    // Vérifier le code
    if(data.code && data.code !== code){
      showLoading(false);
      showMsg('Code incorrect.', 'err');
      return;
    }

    // Pas de code défini → on laisse passer (rétrocompatibilité)
    showMsg('Accès autorisé. Chargement...', 'ok');
    setTimeout(() => {
      window.location.href = `/FalloutParis/pages/fiche_perso/fiche_perso.html?id=${id}`;
    }, 800);

  } catch(e) {
    showLoading(false);
    showMsg('Erreur de connexion : ' + e.message, 'err');
  }
}

function showMsg(txt, type){
  const el = document.getElementById('msg');
  el.textContent = txt;
  el.className = 'msg ' + type;
  el.style.display = 'block';
}
function showLoading(show){
  document.getElementById('loading').style.display = show ? 'block' : 'none';
}

// ============================================================
// THÈME PRINCIPAL — musique d'ambiance de l'écran d'accueil
// (boucle ; repli si l'autoplay est bloqué → démarre au 1er clic/touche)
// ============================================================
(function(){
  const THEME_VOL = 0.4;
  const muted = localStorage.getItem('fp_themeMuted') === '1';
  const audio = new Audio('../../audio/main_theme.mp3');
  audio.loop = true; audio.volume = THEME_VOL; audio.preload = 'auto';

  function tryPlay(){ if(!audio.paused) return; audio.play().catch(()=>{}); }
  function startOnGesture(){
    tryPlay();
    ['pointerdown','keydown','touchstart'].forEach(ev => window.removeEventListener(ev, startOnGesture));
  }
  if(!muted){
    tryPlay();   // tente l'autoplay
    // repli : si bloqué par le navigateur, démarre à la 1re interaction
    ['pointerdown','keydown','touchstart'].forEach(ev => window.addEventListener(ev, startOnGesture, { once:false }));
  }

  // Bouton flottant couper / reprendre (bas-gauche)
  const SPK_ON  = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.title = 'Musique d\'accueil';
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;width:34px;height:34px;background:var(--p2,#162016);border:1px solid var(--b2,#3a5c3a);color:var(--g,#5dbe5d);cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;padding:6px;border-radius:3px;';
  function upd(){ btn.innerHTML = audio.paused ? SPK_OFF : SPK_ON; }
  btn.onclick = () => {
    if(audio.paused){ audio.play().catch(()=>{}); localStorage.setItem('fp_themeMuted','0'); }
    else { audio.pause(); localStorage.setItem('fp_themeMuted','1'); }
    upd();
  };
  audio.addEventListener('play', upd); audio.addEventListener('pause', upd);
  document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(btn); upd(); });
  if(document.body){ document.body.appendChild(btn); upd(); }
})();
