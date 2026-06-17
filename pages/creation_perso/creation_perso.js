// firebaseConfig défini dans common/shared.js
const db=firebase.initializeApp(firebaseConfig).firestore();

/* ===== Questionnaire « Qui suis-je ? » ===== */
const Q = [
  {q:"Tu trouves un blessé seul dans les ruines.",
   r:[
     {l:"Tu l'amènes dans un endroit sûr et organisé pour qu'il soit soigné proprement.",o:"vault"},
     {l:"Tu l'aides discrètement, loin des regards.",o:"settlement"},
     {l:"Tu l'amènes à tes potes, vous le soignez ensemble — ça fera une bonne histoire.",o:"zazous"},
     {l:"Tu lui demandes ce qu'il peut t'offrir en échange.",o:"ultras"}
   ]},
  {q:"Un groupe local te propose une mission payante mais risquée.",
   r:[
     {l:"Tu dis oui si le groupe est honnête et qu'on se protège mutuellement.",o:"ultras"},
     {l:"Tu veux comprendre pourquoi c'est risqué avant de décider.",o:"vault"},
     {l:"Tu dis oui si ça te tente et que c'est une bonne aventure.",o:"zazous"},
     {l:"Tu demandes l'avis de ta communauté avant de répondre.",o:"settlement"}
   ]},
  {q:"Tu découvres que quelqu'un que tu respectes a menti.",
   r:[
     {l:"Tu le dis à tes potes naturellement, sans jugement, vous en parlez.",o:"zazous"},
     {l:"Tu lui en parles en privé, discrètement.",o:"settlement"},
     {l:"Tu l'affrontes calmement pour comprendre pourquoi.",o:"vault"},
     {l:"Tu dis la vérité directement, pas de détour.",o:"ultras"}
   ]},
  {q:"Une ressource importante (eau, nourriture, munitions) devient rare.",
   r:[
     {l:"Tu fais ce qu'il faut pour que ton groupe survive.",o:"ultras"},
     {l:"Tu trouves des solutions créatives pour que tout le monde en ait.",o:"zazous"},
     {l:"Tu organises un plan pour la sécuriser longtemps.",o:"vault"},
     {l:"Tu la partages avec ceux que tu connais bien.",o:"settlement"}
   ]},
  {q:"Tu peux apprendre un secret qui pourrait te donner du pouvoir.",
   r:[
     {l:"Tu le gardes pour toi et quelques proches.",o:"settlement"},
     {l:"Tu l'utilises pour avancer et t'imposer.",o:"ultras"},
     {l:"Tu l'étudies pour vraiment le comprendre.",o:"vault"},
     {l:"Tu le partages, ça crée de la communion entre amis.",o:"zazous"}
   ]},
  {q:"Un conflit éclatera bientôt entre deux groupes. Tu peux partir avant.",
   r:[
     {l:"Tu restes pour documenter et comprendre ce qu'il va se passer.",o:"vault"},
     {l:"Tu restes, ça va être intense, tu veux le vivre avec tes potes.",o:"zazous"},
     {l:"Tu restes, tu vas défendre les tiens.",o:"ultras"},
     {l:"Tu restes discrètement pour aider ta communauté après.",o:"settlement"}
   ]},
  {q:"Tu peux trahir un inconnu pour sauver ta peau, ou prendre un risque pour le protéger.",
   r:[
     {l:"Tu protèges, on n'abandonne pas les gens.",o:"zazous"},
     {l:"Tu analyses la situation avant de décider.",o:"vault"},
     {l:"Tu protèges si c'est un des tiens, sinon tu survis.",o:"ultras"},
     {l:"Tu protèges discrètement si tu peux.",o:"settlement"}
   ]}
];

const ORIGINS = {
  vault:      {title:"Tu as grandi dans l'Abri 74.", desc:"Sûr, organisé, patient. Tu crois en la préparation et l'ordre.", faction:"vault"},
  settlement: {title:"Tu as grandi à Bourg-de-Bois.", desc:"Discret, attentif, pratique. Tu crois en la communauté discrète.", faction:"settlement"},
  zazous:     {title:"Tu es un Zazou !", desc:"Libre, expressif, créatif. Tu crois en la vie et l'amitié.", faction:"zazous"},
  ultras:     {title:"Tu es un Ultra !", desc:"Direct, loyal, courageux. Tu crois en la force et la fraternité.", faction:"ultras"}
};

let questIdx = 0;
let questScores = {vault:0, settlement:0, zazous:0, ultras:0};
let questResult = null; // clé d'origine retenue (vault/settlement/zazous/ultras)
let questTie = false;

function questAnswer(o){ questScores[o]++; questIdx++; questShow(); }

function questReset(){
  questIdx=0; questScores={vault:0, settlement:0, zazous:0, ultras:0}; questResult=null; questTie=false;
  questShow();
}

function questShow(){
  const stage=document.getElementById('quest-stage');
  const prog=document.getElementById('quest-progress');
  if(questIdx>=Q.length){
    const sorted=Object.entries(questScores).sort((a,b)=>b[1]-a[1]);
    questResult=sorted[0][0];
    questTie=sorted[1][1]===sorted[0][1];
    const o=ORIGINS[questResult];
    prog.innerHTML='<span class="quest-done">✓ Terminé</span>';
    stage.innerHTML=`
      <div class="quest-result">
        <div class="quest-result-lbl">Résultat</div>
        <div class="quest-result-title">${o.title}</div>
        <div class="quest-result-desc">${o.desc}</div>
        ${questTie?'<div class="quest-tie">Tu vibres entre plusieurs mondes — ton MJ te dira plus.</div>':''}
        <button class="quest-redo" onclick="questReset()">↻ Refaire le test</button>
      </div>`;
    return;
  }
  const q=Q[questIdx];
  prog.textContent=`Question ${questIdx+1} sur ${Q.length}`;
  let html=`<p class="quest-q">${q.q}</p><div class="quest-answers">`;
  q.r.forEach(a=>{ html+=`<button class="quest-ans" onclick="questAnswer('${a.o}')">${a.l}</button>`; });
  html+='</div>';
  stage.innerHTML=html;
}

async function creer(){
  const id=document.getElementById('f-id').value.trim();
  const code=document.getElementById('f-code').value.trim();
  const nom=document.getElementById('f-nom').value.trim();

  if(!id){showMsg('Identifiant obligatoire !','err');return;}
  if(!code||code.length<4){showMsg('Code de 4 chiffres obligatoire !','err');return;}
  if(!nom){showMsg('Nom du personnage obligatoire !','err');return;}
  if(!questResult){showMsg('Réponds au questionnaire « Qui suis-je ? » d\'abord !','err');return;}

  const origine=questResult;
  const faction=ORIGINS[origine].faction; // chaque origine est une faction (Abri 74 / Bourg-de-Bois = factions mineures)

  // Vérifier que l'ID n'existe pas déjà
  const snap=await db.collection('joueurs').doc(id).get();
  if(snap.exists){showMsg('Cet identifiant est déjà pris !','err');return;}

  const data={
    nom, origine, faction, factionRel:{}, code,
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

document.addEventListener('DOMContentLoaded', questShow);
