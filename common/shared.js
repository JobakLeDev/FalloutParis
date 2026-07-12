// ============================================================
// SHARED — Constantes partagées entre toutes les pages
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDcBgIX3n-Ft_HTTXYb-mAwLq2mh3CsqwU",
  authDomain: "fallout-paris.firebaseapp.com",
  projectId: "fallout-paris",
  storageBucket: "fallout-paris.firebasestorage.app",
  messagingSenderId: "1063413308699",
  appId: "1:1063413308699:web:09e0e13c2200283b22c7be"
};

// ============================================================
// CAMPAGNES (sessions) — cloisonnement de l'état par campagne.
// Les docs d'état partagés (quetes, journal, carte, temps, encyclopedie,
// butin, boutiques, radio, terminaux, crochetage, log, messagerie, rolls,
// pointeur combats/current) sont scopés par doc id = campagne.
//   - Campagne par défaut = 'data'/'current' (l'existant → zéro migration).
//   - Nouvelle campagne → doc id = son <campId> ('current__<campId>' pour les pointeurs).
// Résolution de la campagne active : ?camp dans l'URL (iframes joueur / liens combat)
//   > campagne du joueur (fixée par la fiche) > localStorage fp_activeCampaign (MJ) > 'data'.
// ============================================================
window.FP_CAMP = (function(){ try{ return new URLSearchParams(location.search).get('camp') || null; }catch(e){ return null; } })();
function fpSetCamp(id){ window.FP_CAMP = (id && id !== 'data') ? id : (id === 'data' ? 'data' : null); }
function fpCampId(){
  if(window.FP_CAMP) return window.FP_CAMP;
  try{ const ls = localStorage.getItem('fp_activeCampaign'); if(ls) return ls; }catch(e){}
  return 'data';
}
function fpCampSuffix(){ const c = fpCampId(); return c === 'data' ? '' : ('__' + c); }

// Journal d'actions partagé (/log/<camp> {entries:[{ts,who,text}]}) — appelable depuis n'importe quelle page.
// arrayUnion : sûr face aux écritures concurrentes (pas de read-modify-write).
function fpLogAction(dbInst, who, text){
  if(!dbInst || !text) return;
  try {
    dbInst.collection('log').doc(fpCampId()).set({
      entries: firebase.firestore.FieldValue.arrayUnion({ ts: Date.now(), who: who || '?', text: '' + text })
    }, { merge: true });
  } catch(e){ console.warn('fpLogAction', e); }
}

// État de santé selon le % de PV restant (graduel) — partagé fiche joueur + tableau MJ.
// On n'est « blessé » qu'en dessous de 60 %, puis ça s'aggrave par paliers.
//   sev 0 OK (≥60%) · 1 BLESSÉ (35–59%) · 2 GRAVEMENT BLESSÉ (15–34%) · 3 CRITIQUE (<15%)
// ============================================================
// EFFET CRT — anti-cumul dans les iframes
// Le CRT (scanlines + voile phosphore vert) vient de html::before/::after de
// common/style.css : CHAQUE page l'applique donc sur toute sa surface. Une page
// affichée en iframe se retrouve avec le CRT du parent PAR-DESSUS le sien → cumul
// (×2 pour quêtes/journal/butin/boutique…, ×3 pour le refuge dans la carte dans la
// fiche). Seul le document RACINE doit afficher l'effet : les pages embarquées coupent
// le leur. (Cross-origin → l'accès à window.top jette : on suppose alors une iframe.)
(function(){
  var inIframe;
  try { inIframe = (window.self !== window.top); } catch(e){ inIframe = true; }
  if (inIframe && document.documentElement){
    document.documentElement.style.setProperty('--crt-green', '0');
    document.documentElement.style.setProperty('--crt-scan', '0');
  }
})();

function fpHealthStatus(pct){
  if(pct >= 60) return { sev:0, label:'OK' };
  if(pct >= 35) return { sev:1, label:'BLESSÉ' };
  if(pct >= 15) return { sev:2, label:'GRAVEMENT BLESSÉ' };
  return { sev:3, label:'CRITIQUE' };
}

// Cœur de fusion (source d'énergie des Power Armor). Ancien nom « Cellule de fusion »
// (qui est en réalité une munition) conservé en reconnaissance pour compat sauvegardes.
const FP_FUSION_CORE = 'Cœur de fusion';
function fpIsFusionCore(name){ return name === FP_FUSION_CORE || name === 'Cellule de fusion'; }

// ============================================================
// BONUS DE COLLECTION (cartes MTG) — dérivés de la POSSESSION
// Les cartes vivent dans l'objet « Collection de cartes » (collection:'mtg', cards:{id:qty}).
// RÈGLES : les doublons NE cumulent PAS (posséder 3× la carte = 1 bonus) ; sortir la carte
// de l'inventaire (échange) fait PERDRE le bonus — rien n'est jamais gravé dans la fiche.
// ============================================================
// SKILLS_DEF.attr vaut 'FOR'/'PER'/… → lettre SPECIAL correspondante
const FP_ATTR_LETTER = { FOR:'S', PER:'P', END:'E', CHR:'C', INT:'I', AGI:'A', LCK:'L' };
// Bobbleheads : +1 au SPECIAL correspondant (comme dans Fallout)
const FP_MTG_BOBBLEHEADS = {
  'strength-bobblehead':'S', 'perception-bobblehead':'P', 'endurance-bobblehead':'E',
  'charisma-bobblehead':'C', 'intelligence-bobblehead':'I', 'agility-bobblehead':'A',
  'luck-bobblehead':'L',
};
// Mythiques Fallout : chaque effet découle de l'identité du personnage
const FP_MTG_LEGENDARIES = {
  'dogmeat-ever-loyal':         { label:'Dogmeat, Ever Loyal',          effet:'+1 PER — il flaire le danger',    special:{P:1} },
  'liberty-prime-recharged':    { label:'Liberty Prime, Recharged',     effet:'+2 RD physique',                  rd:{phys:2} },
  'the-master-transcendent':    { label:'The Master, Transcendent',     effet:'+3 RD radiations',                rd:{rad:3} },
  'dr-madison-li':              { label:'Dr. Madison Li',               effet:'+2 Sciences',                     skill:{science:2} },
  'caesar-legion-s-emperor':    { label:"Caesar, Legion's Emperor",     effet:'+2 Armes de CàC',                 skill:{cac_weapon:2} },
  'the-wise-mothman':           { label:'The Wise Mothman',             effet:'+1 point de Chance max',          luckMax:1 },
  'mr-house-president-and-ceo': { label:'Mr. House, President and CEO', effet:'−15 % sur les prix en boutique',  shopDiscount:0.15 },
  'preston-garvey-minuteman':   { label:'Preston Garvey, Minuteman',    effet:'+1 potager productif au refuge',  farmBonus:1 },
};
// Cartes possédées d'un personnage (doc joueur ou objet char)
function fpMtgOwned(c){
  const col = ((c && c.inventory) || []).find(it => it && it.collection === 'mtg');
  return (col && col.cards) || {};
}
// Agrège tous les bonus de collection → {special,rd,skill,luckMax,shopDiscount,farmBonus,actives[]}
function fpMtgBonuses(c){
  const owned = fpMtgOwned(c);
  const b = { special:{}, rd:{phys:0,en:0,rad:0}, skill:{}, luckMax:0, shopDiscount:0, farmBonus:0, actives:[] };
  for(const id in FP_MTG_BOBBLEHEADS){
    if(!(owned[id] > 0)) continue;                                   // doublons : pas de cumul
    const k = FP_MTG_BOBBLEHEADS[id];
    b.special[k] = (b.special[k] || 0) + 1;
    b.actives.push({ id, label:'Bobblehead ' + k, effet:'+1 ' + k, bobble:true });
  }
  for(const id in FP_MTG_LEGENDARIES){
    if(!(owned[id] > 0)) continue;
    const L = FP_MTG_LEGENDARIES[id];
    if(L.special) for(const k in L.special) b.special[k] = (b.special[k] || 0) + L.special[k];
    if(L.rd)      for(const k in L.rd)      b.rd[k]      = (b.rd[k]      || 0) + L.rd[k];
    if(L.skill)   for(const k in L.skill)   b.skill[k]   = (b.skill[k]   || 0) + L.skill[k];
    if(L.luckMax)      b.luckMax   += L.luckMax;
    if(L.shopDiscount) b.shopDiscount = Math.max(b.shopDiscount, L.shopDiscount);   // non cumulable
    if(L.farmBonus)    b.farmBonus += L.farmBonus;
    b.actives.push({ id, label:L.label, effet:L.effet });
  }
  return b;
}

// ============================================================
// POINTS CHAUDS À BOOSTERS (boutiques de jeux d'avant-guerre)
// Les POI de type 'cardshop' (Le Repaire du Dragon, Parkage, Magic Corporation,
// Majestik Games…) « rayonnent » : plus un joueur en est proche, plus la part de
// BOOSTERS SCELLÉS augmente dans le butin « Cartes MTG ». Au-delà du rayon → part de base.
// ============================================================
const MTG_HOTSPOT_R      = 3000;   // rayon d'influence (m)
const MTG_HOTSPOT_BASE   = 0.05;   // part de boosters loin de tout (5 %)
const MTG_HOTSPOT_MAX    = 0.60;   // part de boosters au pied de la boutique (60 %)
// Décroissance quadratique : l'effet se concentre près de la boutique (plus « rayonnant »
// qu'une décroissance linéaire, qui donnerait trop de boosters à mi-distance).
function fpBoosterShare(distM){
  if(distM == null || !isFinite(distM)) return MTG_HOTSPOT_BASE;
  const t = Math.max(0, 1 - Math.min(distM, MTG_HOTSPOT_R) / MTG_HOTSPOT_R);   // 1 sur place → 0 au bord
  return MTG_HOTSPOT_BASE + (MTG_HOTSPOT_MAX - MTG_HOTSPOT_BASE) * t * t;
}
// Distance (m) entre deux points lat/lng — haversine
function fpDistM(a, b){
  if(!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000, rad = Math.PI/180;
  const dLat = (b.lat-a.lat)*rad, dLng = (b.lng-a.lng)*rad;
  const la1 = a.lat*rad, la2 = b.lat*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
// Distance du point le plus proche parmi les boutiques (POI cardshop)
function fpNearestCardshop(pos, pois){
  let best = Infinity;
  (pois||[]).forEach(p => { if(p && p.type === 'cardshop'){ const d = fpDistM(pos, p); if(d < best) best = d; } });
  return best;
}

// ============================================================
// FICHE : dérivés calculables pour N'IMPORTE QUELLE fiche (pas seulement celle ouverte)
// fiche_perso.js les avait en fermeture sur sa globale `char` → inutilisables côté MJ,
// qui a pourtant toutes les fiches (joueurs[id]). Ici : versions paramétrées ; la fiche
// délègue à ces fonctions (une seule définition de chaque règle).
// ============================================================
const FP_BACKPACK_BONUS = { 'Backpack Small':5, 'Backpack Large':10 };   // × FOR, un seul sac équipé

// SPECIAL effectif : base + bonus de collection MTG + 2 FOR si armure assistée portée
function fpSpecial(c){
  const s = Object.assign({}, (c && c.special) || {});
  const bs = (fpMtgBonuses(c) || {}).special || {};
  for(const k in bs) s[k] = Math.min(10, (s[k]||1) + bs[k]);
  if(c && c.powerArmor && ((c.inventory||[]).some(it => it && it.type==='POWERARMOR_FRAME' && it.equipped)))
    s.S = Math.min(10, (s.S||1) + 2);
  return s;
}
function fpHpMax(c){
  const sp = fpSpecial(c), pk = (c && c.perks) || {};
  return (sp.L||0) + (sp.E||0) + Math.max(0, ((c && c.niveau)||1) - 1)
       + (pk['Life Giver']||0) * (sp.E||0)
       + ((c && c.survie && c.survie.wellRested) ? 2 : 0)
       + fpEffSum(c && c.activeEffects, 'hpMax');
}
// FOR effective : Adrenalin Rush met FOR à 10 tant que le perso est blessé
function fpForEff(c){
  const sp = fpSpecial(c);
  const rush = ((c && c.perks && c.perks['Adrenalin Rush']) > 0) && ((c && c.hp) < fpHpMax(c));
  return rush ? 10 : (sp.S||0);
}
function fpBackpackMult(c){
  const bp = ((c && c.inventory) || []).find(it => it && it.equipped && FP_BACKPACK_BONUS[it.name] != null);
  return bp ? FP_BACKPACK_BONUS[bp.name] : 0;
}
// Charge maximale portable (kg)
function fpChargeMax(c){
  const f = fpForEff(c);
  const b = (150 + f*10) / 2.2046;
  const base = b * ((c && c.powerArmor) ? 1.5 : 1) + ((c && c.powerArmor) ? 200 : 0);
  return Math.round((base + fpBackpackMult(c)*f + fpEffSum(c && c.activeEffects, 'charge')) * 10) / 10;
}
// Charge réellement portée (kg) — objets + munitions (20 g / cartouche)
function fpChargePortee(c){
  let t = 0;
  ((c && c.inventory) || []).forEach(it => { t += (it.qty || 1) * (it.w || 0); });
  ((c && c.ammo) || []).forEach(a => { t += (a.qty || 0) * 0.02; });
  return Math.round(t * 100) / 100;
}

// ============================================================
// DÉPLACEMENT / rencontres aléatoires sur trajet (partagé carte + dashboard MJ)
// ============================================================
const FP_WALK_KMH = 5;   // vitesse de marche (km/h) → temps de trajet depuis la distance
const FP_THREAT_DANGER = { calme:1, normal:2, eleve:3, extreme:4 };
const FP_EVENEMENTS_DEPLACEMENT = [
  {pct:40, type:'calme',    label:'Calme',      desc:'Le groupe se déplace sans encombre.'},
  {pct:20, type:'combat',   label:'Combat !',   desc:'Rencontre hostile sur la route.'},
  {pct:15, type:'piege',    label:'Piège',      desc:'Zone piégée. Test PER+Discrétion D2 pour éviter.'},
  {pct:10, type:'ressource',label:'Ressource',  desc:'Le groupe trouve des ressources en chemin.'},
  {pct:10, type:'pnj',      label:'Rencontre PNJ', desc:'Un personnage non-hostile croise la route du groupe.'},
  {pct:5,  type:'danger',   label:'Grand danger !', desc:'Menace majeure. Ennemi puissant ou situation critique.'},
];
// km + menace → {segments, pKm, events[], mins, hasCombat} : 1 jet de rencontre par km
// (proba/km = 4 + menace×7), événements non-calme pondérés, temps de trajet à FP_WALK_KMH.
function fpRollDeplacement(km, threat){
  km = Math.max(0, +km || 0);
  const danger = FP_THREAT_DANGER[threat] || 2;
  const segments = Math.min(30, Math.max(1, Math.round(km)));
  const pKm = Math.min(80, 4 + danger*7);
  const nonCalme = FP_EVENEMENTS_DEPLACEMENT.filter(e => e.type!=='calme');
  const totW = nonCalme.reduce((a,e)=>a+e.pct,0);
  const events = [];
  for(let s=0;s<segments;s++){
    if(Math.random()*100 > pKm) continue;
    let r = Math.random()*totW, evt = nonCalme[0];
    for(const e of nonCalme){ r-=e.pct; if(r<=0){ evt=e; break; } }
    events.push(evt);
  }
  const mins = Math.round(km / FP_WALK_KMH * 60);
  return { segments, pKm, events, mins, hasCombat: events.some(e=>e.type==='combat'||e.type==='danger'), danger };
}
function fpFmtDuree(mins){ return mins>=60 ? `${Math.floor(mins/60)} h ${String(mins%60).padStart(2,'0')}` : `${mins} min`; }

// ============================================================
// MODS D'ARMES / D'ARMURES (window.WEAPON_MODS / ARMOR_MODS chargés par db.js)
// item.mods = { receiver:'hardened', barrel:'long', ... } (ids de mods par emplacement)
// ============================================================
// Stats d'arme effectives (base + mods) → {n,t,a,dmg,eff,fr,rng,w,sk,_rangeStep,_prefix}
function fpApplyWeaponMods(base, mods){
  const W = window.WEAPON_MODS || {};
  const out = Object.assign({}, base);
  if(!base || !mods) return out;
  let cd = parseInt(base.dmg) || 0;
  const frIsNum = !isNaN(parseInt(base.fr));
  let fr = parseInt(base.fr) || 0;
  let eff = (base.eff && base.eff!=='–' && base.eff!=='—') ? base.eff.split(/,\s*/).map(s=>s.trim()).filter(Boolean) : [];
  let ammo = base.a, weight = base.w || 0, rangeStep = 0; const prefixes = [];
  (W.slots||[]).forEach(slot => {
    const id = mods[slot]; if(!id) return;
    const m = (W[slot]||[]).find(x=>x.id===id); if(!m) return;
    if(m.setDmgCD!=null) cd = m.setDmgCD;
    if(m.dmgCD) cd += m.dmgCD;
    if(m.fr) fr += m.fr;
    if(m.ammo) ammo = m.ammo;
    if(m.w) weight += m.w;
    if(m.range) rangeStep += m.range;
    (m.add||[]).forEach(e => { if(!eff.some(x=>x.toLowerCase()===e.toLowerCase())) eff.push(e); });
    (m.remove||[]).forEach(e => { eff = eff.filter(x => x.toLowerCase()!==e.toLowerCase()); });
    if(m.prefix) prefixes.push(m.prefix);
  });
  out.dmg = Math.max(0,cd) + 'D';
  out.fr = frIsNum ? fr : base.fr;
  out.eff = eff.length ? eff.join(', ') : '–';
  out.a = ammo;
  out.w = Math.max(0, Math.round(weight*100)/100);
  out._rangeStep = rangeStep;
  out._prefix = prefixes.join(' ');
  return out;
}
// Stats d'armure effectives (base + mods) → {ph,en,rad,w,bonus:{phys,energy,rad}}
function fpApplyArmorMods(base, mods){
  const A = window.ARMOR_MODS || {};
  const bonus = { phys:0, energy:0, rad:0 };
  let weight = (base && base.w) || 0;
  if(base && mods){
    (A.slots||[]).forEach(slot => {
      const id = mods[slot]; if(!id) return;
      const m = (A[slot]||[]).find(x=>x.id===id); if(!m) return;
      if(m.rd){ bonus.phys += m.rd.phys||0; bonus.energy += m.rd.energy||0; bonus.rad += m.rd.rad||0; }
      if(m.w) weight += m.w;
    });
  }
  return {
    ph: ((base&&base.ph)||0) + bonus.phys,
    en: ((base&&base.en)||0) + bonus.energy,
    rad: ((base&&base.rad)||0) + bonus.rad,
    w: Math.max(0, Math.round(weight*100)/100),
    bonus
  };
}

// ============================================================
// EFFETS DE CONSOMMABLES → effets immédiats + buff temporaire
// def = entrée DB de l'objet {n, hp, eff, rad, dur, add}
// Retour : { instant:{hp,radHeal,ap,apMax,cure}, buff:{name,mods,reroll[],note,dur}|null }
// ============================================================
function fpParseConsumable(def){
  const out = { instant:{ hp:0, radHeal:0, ap:0, apMax:0, cure:false }, buff:null };
  if(!def) return out;
  const eff = (def.eff || '').toString();
  const e = eff.toLowerCase();
  let m;
  // ---- immédiat ----
  if(typeof def.hp === 'number' && def.hp > 0) out.instant.hp = def.hp;
  if((m = e.match(/soigne\s+(\d+)\s*(rad|d[ée]g[aâ]ts?\s+de\s+radiation)/))) out.instant.radHeal = parseInt(m[1]) || 0;
  if(/r[ée]serve\s+pa|pa\s+max|max(imum)?\s+ap/.test(e)){ const mm = e.match(/(\d+)/); out.instant.apMax = mm ? (parseInt(mm[1])||1) : 1; }
  else if((m = e.match(/\+?(\d+)\s*pa\b/)) || (m = e.match(/(\d+)\s*ap\b/))) out.instant.ap = parseInt(m[1]) || 0;
  if(/addiction|maladie|illness/.test(e)) out.instant.cure = true;
  // ---- buff temporaire ----
  const mods = {}; const reroll = [];
  if((m = e.match(/pv\s*max\s*\+?(\d+)/)) || (m = e.match(/\+?(\d+)\s*pv\s*max/)) || (m = e.match(/max\s*hp\s*\+?(\d+)/))) mods.hpMax = parseInt(m[1])||0;
  if((m = e.match(/\+?(\d+)\s*rd\s*phys/)))      mods.phys   = parseInt(m[1])||0;
  if((m = e.match(/\+?(\d+)\s*rd\s*[ée]nergie/)))mods.energy = parseInt(m[1])||0;
  if((m = e.match(/\+?(\d+)\s*rd\s*radiation/))) mods.rad    = parseInt(m[1])||0;
  if((m = e.match(/charge\s*\+?(\d+)/)))         mods.charge = parseInt(m[1])||0;
  if((m = e.match(/\+?(\d+)\s*(d|cd|dc)\b.*m[êe]l[ée]e/))) mods.dmgMelee = parseInt(m[1])||0;
  if((m = e.match(/regen\s*(\d+)\s*pv|(\d+)\s*pv\s*\/\s*tour|1\s*hp\s+at\s+the\s+start/))) mods.regen = parseInt(m[1]||m[2]||'1')||1;
  const RR = { 'for':'S','fr':'S','str':'S','per':'P','end':'E','int':'I','cha':'C','agi':'A','lck':'L','chance':'L' };
  const rrm = e.match(/relancer[^.]*?\b(for|fr|str|per|end|int|cha|agi|lck|chance)\b/g);
  if(rrm){ rrm.forEach(s => { const a = s.match(/\b(for|fr|str|per|end|int|cha|agi|lck|chance)\b/); if(a && RR[a[1]] && !reroll.includes(RR[a[1]])) reroll.push(RR[a[1]]); }); }
  if(Object.keys(mods).length || reroll.length){
    let dur = 'scene';
    if(def.dur === 'Bref') dur = 'combat';
    else if(def.dur === 'Durable' || def.dur === 'Lasting') dur = 'scene';
    else if(/jusqu'à fin de combat|ce combat/.test(e)) dur = 'combat';
    out.buff = { name: def.n || 'Effet', mods, reroll, note: eff, dur };
  }
  return out;
}
// Somme d'un modificateur sur une liste d'effets actifs
function fpEffSum(list, key){ return (list||[]).reduce((t,ef) => t + ((ef.mods && ef.mods[key]) || 0), 0); }

const XP_TABLE = [0,100,300,600,1000,1500,2100,2800,3600,4500,5500,6600,7800,9100,10500,12000,13600,15300,17100,19000,21000];

const SKILLS_DEF = [
  {name:'Armes énergie', attr:'PER', key:'en_weapon'},
  {name:'Armes de CàC',  attr:'FOR', key:'cac_weapon'},
  {name:'Armes légères', attr:'AGI', key:'light_weapon'},
  {name:'Armes lourdes', attr:'END', key:'heavy_weapon'},
  {name:'Athlétisme',    attr:'FOR', key:'athletics'},
  {name:'Crochetage',    attr:'PER', key:'lockpick'},
  {name:'Discours',      attr:'CHR', key:'speech'},
  {name:'Discrétion',    attr:'AGI', key:'sneak'},
  {name:'Explosifs',     attr:'PER', key:'explosives'},
  {name:'Mains nues',    attr:'FOR', key:'barehand'},
  {name:'Médecine',      attr:'INT', key:'medicine'},
  {name:'Pilotage',      attr:'PER', key:'pilot'},
  {name:'Projectiles',   attr:'AGI', key:'throwing'},
  {name:'Réparation',    attr:'INT', key:'repair'},
  {name:'Sciences',      attr:'INT', key:'science'},
  {name:'Survie',        attr:'END', key:'survival'},
  {name:'Troc',          attr:'CHR', key:'barter'},
];

// ============================================================
// PROFILS — scoring stats/skills/perks → profils dominants (%)
//   window.PROFILES est chargé par common/db.js depuis data/profiles.json.
//   computeProfileScores → {id:%} (part relative) · getPlayerProfile → top N
//   generateNPCStats(profileId) → SPECIAL cohérent (fonction inverse, PNJ)
// ============================================================
const _PROF_SP = ['S','P','E','C','I','A','L'];
function _profList(){ return (typeof window!=='undefined' && Array.isArray(window.PROFILES)) ? window.PROFILES : []; }
function computeProfileScores(special, skills, perks){
  const profiles = _profList();
  special = special || {}; skills = skills || {};
  const perkSet = {};
  if (Array.isArray(perks)) perks.forEach(p => { if(p) perkSet[p] = 1; });
  else if (perks && typeof perks === 'object') Object.entries(perks).forEach(([k,v]) => { if(v) perkSet[k] = 1; });
  const ratios = {};
  profiles.forEach(p => {
    const w = p.weights || {}; let num = 0, den = 0;
    Object.entries(w).forEach(([key, weight]) => {
      if (!(weight > 0)) return;
      let nv = 0;
      if (_PROF_SP.indexOf(key) >= 0)        nv = Math.min(1, (special[key] || 0) / 10);
      else if (skills.hasOwnProperty(key))   nv = Math.min(1, (skills[key] || 0) / 6);
      else if (perkSet.hasOwnProperty(key))  nv = 1;
      num += weight * nv; den += weight;
    });
    ratios[p.id] = den > 0 ? num / den : 0;
  });
  const tot = Object.values(ratios).reduce((a, b) => a + b, 0);
  const scores = {};
  profiles.forEach(p => { scores[p.id] = tot > 0 ? Math.round(ratios[p.id] / tot * 100) : 0; });
  return scores;
}
function getPlayerProfile(special, skills, perks, topN){
  const profiles = _profList();
  const scores = computeProfileScores(special, skills, perks);
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN || 3)
    .map(([id, percentage]) => ({ id, name: (profiles.find(p => p.id === id) || {}).name || id, percentage }));
}
function generateNPCStats(profileId){
  const p = _profList().find(x => x.id === profileId);
  const stats = {};
  _PROF_SP.forEach(k => {
    const w = (p && p.weights && p.weights[k]) || 0;
    const rnd = Math.floor(Math.random() * 3) - 1; // -1..+1
    stats[k] = Math.max(1, Math.min(10, 5 + Math.round(w * 12) + rnd));
  });
  return stats;
}

// ============================================================
// CALENDRIER DE CAMPAGNE
// Époque (Jour 0 = minute 0) : 14 juillet 2189 00:00.
// Le temps est stocké en MINUTES écoulées depuis l'époque, par GROUPE (party).
// /temps/data = { parties: [{id, name, players:[ids], minutes}] }
// ============================================================
const TEMPS_EPOCH = new Date(2189, 6, 14, 0, 0, 0);   // mois 6 = juillet
const TEMPS_DEFAUT = 8 * 60;                          // démarrage par défaut : 08:00
const TEMPS_MOIS  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const TEMPS_JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
function tempsDate(min){ return new Date(TEMPS_EPOCH.getTime() + (min||0) * 60000); }
function tempsMinutesDepuis(d){ return Math.round((d.getTime() - TEMPS_EPOCH.getTime()) / 60000); }
function fmtHeure(min){ const d = tempsDate(min); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function fmtDateCourt(min){ const d = tempsDate(min); return `${d.getDate()} ${TEMPS_MOIS[d.getMonth()].slice(0,4)}. ${d.getFullYear()}`; }
function fmtDateLong(min){ const d = tempsDate(min); return `${TEMPS_JOURS[d.getDay()]} ${d.getDate()} ${TEMPS_MOIS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtDateTime(min){ return fmtDateLong(min) + ' · ' + fmtHeure(min); }
// Minutes du groupe auquel appartient le joueur pid (sinon 1er groupe, sinon défaut)
function partyMinutesFor(tempsData, pid){
  const parties = (tempsData && Array.isArray(tempsData.parties)) ? tempsData.parties : [];
  const p = parties.find(x => (x.players || []).includes(pid));
  return p ? (p.minutes || 0) : TEMPS_DEFAUT;   // non groupé → son propre temps par défaut
}

// ============================================================
// POP-UPS STYLÉES — remplace alert() natif (look OS) par une modale aux couleurs de l'app.
// (prompt/confirm restent natifs : synchrones, non remplaçables sans réécriture asynchrone.)
// ============================================================
(function(){
  if(typeof window === 'undefined' || window.__fpAlertHooked) return;
  window.__fpAlertHooked = true;
  function fpShowAlert(msg){
    if(!document.body){ document.addEventListener('DOMContentLoaded', () => fpShowAlert(msg)); return; }
    let o = document.getElementById('fp-alert');
    if(!o){ o = document.createElement('div'); o.id = 'fp-alert'; document.body.appendChild(o); }
    const m = document.createElement('div'); m.className = 'fp-alert-box';
    const t = document.createElement('div'); t.className = 'fp-alert-msg'; t.textContent = (msg == null ? '' : '' + msg);
    const b = document.createElement('button'); b.className = 'fp-alert-ok'; b.textContent = 'OK';
    const close = () => { m.remove(); if(!o.children.length) o.style.display = 'none'; };
    b.onclick = close;
    m.appendChild(t); m.appendChild(b); o.appendChild(m); o.style.display = 'flex';
    try { b.focus(); } catch(e){}
  }
  window.alert = fpShowAlert;

  // confirm()/prompt() stylés (asynchrones → renvoient une Promise). À utiliser avec await.
  function fpModal(opts){
    const kind = opts.kind, msg = opts.msg, def = opts.def;
    return new Promise(resolve => {
      const go = () => {
        let o = document.getElementById('fp-alert');
        if(!o){ o = document.createElement('div'); o.id = 'fp-alert'; document.body.appendChild(o); }
        const m = document.createElement('div'); m.className = 'fp-alert-box';
        const t = document.createElement('div'); t.className = 'fp-alert-msg'; t.textContent = (msg == null ? '' : '' + msg);
        m.appendChild(t);
        let input = null;
        if(kind === 'prompt'){
          input = document.createElement('input'); input.className = 'fp-alert-input'; input.value = (def == null ? '' : '' + def);
          m.appendChild(input);
        }
        const row = document.createElement('div'); row.className = 'fp-alert-row';
        const done = (val) => { m.remove(); if(!o.children.length) o.style.display = 'none'; resolve(val); };
        const cancel = document.createElement('button'); cancel.className = 'fp-alert-cancel'; cancel.textContent = 'Annuler';
        cancel.onclick = () => done(kind === 'prompt' ? null : false);
        const ok = document.createElement('button'); ok.className = 'fp-alert-ok'; ok.textContent = 'OK';
        ok.onclick = () => done(kind === 'prompt' ? input.value : true);
        row.appendChild(cancel); row.appendChild(ok); m.appendChild(row);
        o.appendChild(m); o.style.display = 'flex';
        try { (input || ok).focus(); } catch(e){}
        if(input) input.addEventListener('keydown', e => { if(e.key === 'Enter') ok.onclick(); else if(e.key === 'Escape') done(null); });
      };
      if(!document.body) document.addEventListener('DOMContentLoaded', go); else go();
    });
  }
  window.fpConfirm = (msg) => fpModal({ kind:'confirm', msg });
  window.fpPrompt  = (msg, def) => fpModal({ kind:'prompt', msg, def });
})();
