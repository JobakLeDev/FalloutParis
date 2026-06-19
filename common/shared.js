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
function fpHealthStatus(pct){
  if(pct >= 60) return { sev:0, label:'OK' };
  if(pct >= 35) return { sev:1, label:'BLESSÉ' };
  if(pct >= 15) return { sev:2, label:'GRAVEMENT BLESSÉ' };
  return { sev:3, label:'CRITIQUE' };
}

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
