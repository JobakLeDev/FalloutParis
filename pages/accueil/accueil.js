const firebaseConfig = {
  apiKey: "AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",
  authDomain: "fallout-paris.firebaseapp.com",
  projectId: "fallout-paris",
  storageBucket: "fallout-paris.firebasestorage.app",
  messagingSenderId: "1063413308699",
  appId: "1:1063413308699:web:09e0e13c2200283b22c7be"
};
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
      window.location.href = `../fiche_perso/fiche_perso.html?id=${id}`;
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