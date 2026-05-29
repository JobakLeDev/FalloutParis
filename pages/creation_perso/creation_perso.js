const firebaseConfig={apiKey:"AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",authDomain:"fallout-paris.firebaseapp.com",projectId:"fallout-paris",storageBucket:"fallout-paris.firebasestorage.app",messagingSenderId:"1063413308699",appId:"1:1063413308699:web:09e0e13c2200283b22c7be"};
const db=firebase.initializeApp(firebaseConfig).firestore();

async function creer(){
  const id=document.getElementById('f-id').value.trim();
  const code=document.getElementById('f-code').value.trim();
  const nom=document.getElementById('f-nom').value.trim();
  const origine=document.getElementById('f-origine').value.trim();

  if(!id){showMsg('Identifiant obligatoire !','err');return;}
  if(!code||code.length<4){showMsg('Code de 4 chiffres obligatoire !','err');return;}
  if(!nom){showMsg('Nom du personnage obligatoire !','err');return;}

  // Vérifier que l'ID n'existe pas déjà
  const snap=await db.collection('joueurs').doc(id).get();
  if(snap.exists){showMsg('Cet identifiant est déjà pris !','err');return;}

  const data={
    nom, origine:origine||'Inconnu', code,
    niveau:1, xp:0, hp:10, rad:0, momentum:0, powerArmor:false,
    special:{S:5,P:5,E:5,C:5,I:5,A:5,L:5},
    perks:{}, skills:{en_weapon:0,cac_weapon:0,light_weapon:0,heavy_weapon:0,athletics:0,lockpick:0,speech:0,sneak:0,explosives:0,barehand:0,medicine:0,pilot:0,throwing:0,repair:0,science:0,survival:0,barter:0},
    taggedSkills:[], inventory:[], ammo:[],
    wounds:{head:false,torso:false,armL:false,armR:false,legL:false,legR:false},
    lastUpdate:Date.now(),
  };

  try{
    await db.collection('joueurs').doc(id).set(data);
    showMsg(`✓ ${nom} créé ! Redirection vers la fiche...`,'ok');
    setTimeout(()=>window.location.href=`/FalloutParis/pages/setup_perso/setup_perso.html?id=${id}`,1500);
  }catch(e){showMsg('Erreur : '+e.message,'err');}
}

function showMsg(t,c){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;e.style.display='block';}