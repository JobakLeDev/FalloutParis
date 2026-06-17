// firebaseConfig défini dans common/shared.js
const db=firebase.initializeApp(firebaseConfig).firestore();

async function creer(){
  const id=document.getElementById('f-id').value.trim();
  const code=document.getElementById('f-code').value.trim();
  const nom=document.getElementById('f-nom').value.trim();
  const faction=document.getElementById('f-faction').value||'';

  if(!id){showMsg('Identifiant obligatoire !','err');return;}
  if(!code||code.length<4){showMsg('Code de 4 chiffres obligatoire !','err');return;}
  if(!nom){showMsg('Nom du personnage obligatoire !','err');return;}

  // Vérifier que l'ID n'existe pas déjà
  const snap=await db.collection('joueurs').doc(id).get();
  if(snap.exists){showMsg('Cet identifiant est déjà pris !','err');return;}

  const data={
    nom, faction, factionRel:{}, code,
    niveau:1, xp:0, hp:10, rad:0, momentum:0, powerArmor:false,
    special:{S:5,P:5,E:5,C:5,I:5,A:5,L:5},
    perks:{}, skills:{en_weapon:0,cac_weapon:0,light_weapon:0,heavy_weapon:0,athletics:0,lockpick:0,speech:0,sneak:0,explosives:0,barehand:0,medicine:0,pilot:0,throwing:0,repair:0,science:0,survival:0,barter:0},
    taggedSkills:[], inventory:[
      {name:'Vault 74 Jumpsuit',type:'CLOTHING',qty:1,w:1,equipped:true},
      {name:'Pipe Gun',type:'WEAPON',qty:1,w:0.9,equipped:true,persoBonus:false},
      {name:'Stimpak',type:'DRUGS',qty:1,w:0.05,equipped:false},
    ], ammo:[],
    wounds:{head:false,torso:false,armL:false,armR:false,legL:false,legR:false},
    lastUpdate:Date.now(),
  };

  try{
    await db.collection('joueurs').doc(id).set(data);
    // Rend visible l'entrée de base de la faction d'origine dans l'encyclopédie
    if(faction){
      try{ await db.collection('encyclopedie').doc('data').set({ reveal: { [faction]: firebase.firestore.FieldValue.arrayUnion(id) } }, { merge:true }); }catch(e){}
    }
    showMsg(`✓ ${nom} créé ! Redirection vers la fiche...`,'ok');
    setTimeout(()=>window.location.href=`/FalloutParis/pages/setup_perso/setup_perso.html?id=${id}`,1500);
  }catch(e){showMsg('Erreur : '+e.message,'err');}
}

function showMsg(t,c){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;e.style.display='block';}
