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
    // Son de connexion (joué pendant le court délai avant redirection)
    try { sessionStorage.removeItem('fp_themePos'); } catch(e){}   // la musique d'accueil ne reprendra pas sur la fiche
    try { const a = new Audio('../../audio/sfx/load_joueur_sfx.mp3'); a.volume = 0.6; a.play().catch(()=>{}); } catch(e){}
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
// (Musique d'ambiance : gérée par common/theme.js, partagée et persistante entre pages.)
