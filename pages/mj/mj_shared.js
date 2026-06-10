// ============================================================
// MJ_SHARED — Constantes et fonctions partagées entre les pages MJ
// (combat.html, combat_joueur.html, mj.html)
// ============================================================

const COMBATS_COLL = 'combat'; // collection existante Firebase (réutilisée avec IDs dynamiques)

const SK_ATTR = {
  en_weapon:'P', cac_weapon:'S', light_weapon:'A', heavy_weapon:'E',
  athletics:'S', lockpick:'P', speech:'C', sneak:'A', explosives:'P',
  barehand:'S', medicine:'I', pilot:'P', throwing:'A', repair:'I',
  science:'I', survival:'E', barter:'C',
};

// Faces du dé de combat : 1dmg | 2dmg | blank | blank | 1dmg+effet | 1dmg+effet
const FACES_CD = ['1','2','—','—','1⚡','1⚡'];

// WEAPONS_DB et ENNEMIS_DB chargés depuis /data/*.json via common/db.js → window.WEAPONS_DB / window.ENNEMIS_DB

function getHpMax(d) {
  if (!d || !d.special) return 10;
  return (d.special?.L||5) + (d.special?.E||5) + Math.max(0,(d.niveau||1)-1) + (d.perks?.['Life Giver']||0) * (d.special?.E||5)
    + (d.survie?.wellRested ? 2 : 0);   // bien reposé : +2 PV max jusqu'au prochain sommeil
}

function rollDice(expr) {
  const m = expr.match(/(\d+)D\+?(\d*)/i);
  if (!m) return 10;
  const nb = parseInt(m[1])||1, bonus = parseInt(m[2])||0;
  let total = bonus;
  for (let i = 0; i < nb; i++) total += Math.floor(Math.random()*6)+1;
  return total;
}

// Construit une instance de combat depuis une fiche ennemi (nouveau schéma officiel)
// Retourne {nom, pvMax, pvCur, atq, rd, initiative, xp, body, mind, tn, dmgType, eff, dr, defense, level, category}
function enemyInstanceFromDB(nom, lvl = 1) {
  const e = window.ENNEMIS_DB?.[nom]; if (!e) return null;
  const L = Math.max(1, parseInt(lvl) || 1);
  const scale = 1 + (L - 1) * 0.25;
  const hp = Math.round((e.hp || 6) * scale);
  const atk = (e.attacks && e.attacks[0]) || {};
  // dr.phys peut être un nombre, ou une string (RD localisée : "4 tête / 3 jambes...")
  let phys;
  if (typeof e.dr?.phys === 'number') phys = e.dr.phys + Math.floor((L - 1) / 2);
  else if (typeof e.dr?.phys === 'string') phys = parseInt(e.dr.phys) || 0;
  else phys = 0;
  return {
    nom,
    pvMax: hp, pvCur: hp,
    atq: (atk.dmg != null ? atk.dmg : 3) + 'D',
    rd: phys,
    initiative: e.initiative || ((e.attrs?.body || 6) + (e.attrs?.mind || 4)),
    xp: Math.round((e.xp || 0) * scale),   // XP suit le facteur de difficulté (×1 au niv.1 = XP du bestiaire)
    body: e.attrs?.body || 6,
    mind: e.attrs?.mind || 4,
    tn: atk.tn ?? null,
    dmgType: atk.dmgType || 'physical',
    eff: atk.eff || '',
    dr: e.dr || { phys, energy: 0, rad: 0, poison: 0 },
    defense: e.defense ?? 1,
    level: e.level ?? L,
    category: e.category || 'normal',
    dist: 1   // distance vs joueurs : 0=Close 1=Medium 2=Long 3=Extreme (réglable en combat)
  };
}

// ---- DISTANCE / PORTÉE (combat) ----
const RANGE_LABELS = ['Contact', 'Moyenne', 'Longue', 'Extrême'];   // index 0..3 (Close/Medium/Long/Extreme)
function weaponRangeBand(rng){ const m = { C:0, M:1, L:2, X:3 }; return (rng in m) ? m[rng] : -1; }   // -1 = mêlée (—)
// Difficulté ajoutée par la portée : |distance ennemi − portée idéale de l'arme|. Mêlée : 0 au contact, sinon impossible (99).
function rangeDifficulty(weaponRng, enemyDist){
  const w = weaponRangeBand(weaponRng);
  const d = (enemyDist == null) ? 1 : enemyDist;
  if(w < 0) return d === 0 ? 0 : 99;   // mêlée hors contact = impossible
  return Math.abs(d - w);
}

// ---- MINI-CARTE DE COMBAT (grille de cases) ----
const GRID_MOVE = 3, GRID_SPRINT = 6;   // cases par déplacement (1 zone ≈ 3 cases)
function gridChebyshev(a, b){ return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
// Distance de déplacement (pas de diagonale gratuite : une diagonale = 2 cases)
function gridManhattan(a, b){ return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
// distance en cases → bande (0 Contact, 1 Moyenne, 2 Longue, 3 Extrême)
function gridBand(cells){ if(cells <= 1) return 0; if(cells <= 4) return 1; if(cells <= 7) return 2; return 3; }
// Types de blocs de terrain (MJ peut les peindre). solid = bloque le passage/placement.
const BLOCK_TYPES = [
  { id:'wall',   label:'Mur',        icon:'▦', solid:true  },
  { id:'rubble', label:'Débris',     icon:'⛰', solid:true  },
  { id:'cover',  label:'Couverture', icon:'◫', solid:false },
  { id:'hazard', label:'Danger',     icon:'☢', solid:false },
  { id:'water',  label:'Eau',        icon:'≈', solid:false },
];
function blockSolid(id){ const b = BLOCK_TYPES.find(t=>t.id===id); return !!(b && b.solid); }
// Lignes de bord (sur les arêtes entre cases) : murs / portes / fenêtres
const EDGE_TYPES = [
  { id:'wall',   label:'Mur',     icon:'┃' },
  { id:'door',   label:'Porte',   icon:'╫' },
  { id:'window', label:'Fenêtre', icon:'┆' },
];
// Arête entre deux cases adjacentes → clé d'arête ; mur/fenêtre + porte FERMÉE bloquent ; porte ouverte non
function gridEdgeBetween(x1, y1, x2, y2){
  if(x2 > x1) return 'V,' + x2 + ',' + y1;
  if(x2 < x1) return 'V,' + x1 + ',' + y1;
  if(y2 > y1) return 'H,' + x1 + ',' + y2;
  return 'H,' + x1 + ',' + y1;
}
function gridEdgeBlocks(grid, x1, y1, x2, y2){
  const t = (grid.edges || {})[gridEdgeBetween(x1, y1, x2, y2)];
  return t === 'wall' || t === 'window' || t === 'door';   // 'doorOpen' laisse passer/voir
}
// Ligne de vue entre deux cases (centre→centre) : false si un mur/fenêtre coupe le trajet
function gridLineOfSight(grid, a, b){
  if(!grid) return true;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y)) * 10);
  const ax = a.x + 0.5, ay = a.y + 0.5;
  let cx = a.x, cy = a.y;
  for(let i=1;i<=steps;i++){
    const t = i/steps;
    const sx = ax + (b.x - a.x) * t, sy = ay + (b.y - a.y) * t;
    const nx = Math.floor(sx), ny = Math.floor(sy);
    if(nx===cx && ny===cy) continue;
    if(nx!==cx && ny!==cy){
      // passage en coin : bloqué seulement si les deux contournements sont murés
      const path1 = gridEdgeBlocks(grid, cx, cy, nx, cy) || gridEdgeBlocks(grid, nx, cy, nx, ny);
      const path2 = gridEdgeBlocks(grid, cx, cy, cx, ny) || gridEdgeBlocks(grid, cx, ny, nx, ny);
      if(path1 && path2) return false;
    } else if(gridEdgeBlocks(grid, cx, cy, nx, ny)) return false;
    cx = nx; cy = ny;
  }
  return true;
}
// Cases atteignables (parcours orthogonal, coût 1/case) sans traverser mur/fenêtre ni bloc/jeton
function reachableCells(grid, start, range){
  const res = {}, seen = {}; const q = [{ x:start.x, y:start.y, d:0 }];
  seen[start.x+','+start.y] = 0;
  while(q.length){
    const c = q.shift();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = c.x+dx, ny = c.y+dy;
      if(nx<0||ny<0||nx>=grid.w||ny>=grid.h) continue;
      if(seen[nx+','+ny] != null) continue;
      if(gridEdgeBlocks(grid, c.x, c.y, nx, ny)) continue;   // mur/fenêtre entre les deux cases
      const nd = c.d + 1; if(nd > range) continue;
      const blocked = blockSolid(gridTerrainAt(grid, nx, ny)) || Object.values(grid.pos||{}).some(p => p.x===nx && p.y===ny);
      seen[nx+','+ny] = nd;
      if(!blocked){ res[nx+','+ny] = nd; q.push({ x:nx, y:ny, d:nd }); }   // on ne traverse pas une case bloquée
    }
  }
  return res;
}
// grid.edges = { "V,x,y":type (arête verticale à gauche de la case x,y) , "H,x,y":type (arête horizontale en haut de x,y) }
// Rendu des lignes existantes (HTML d'overlay), cs = taille de case en px
function gridEdgesHtml(grid, cs){
  const pad = 5, gap = 1, pitch = cs + gap; const E = grid.edges || {}; let h = '';
  const isWall = (o,x,y)=> E[o+','+x+','+y] === 'wall';
  // Segments — étendus de `gap` à chaque extrémité pour se rejoindre aux sommets (lignes continues)
  const isDoorK = k => E[k] === 'door' || E[k] === 'doorOpen';
  for(const key in E){
    const p = key.split(','); const o = p[0], x = +p[1], y = +p[2], type = E[key];
    // Porte ouverte : gond choisi pour que deux portes côte à côte s'ouvrent sur des gonds OPPOSÉS (ouverture large)
    let hinge = '';
    if(type === 'doorOpen'){
      if(o === 'V'){ const up = isDoorK('V,'+x+','+(y-1)), down = isDoorK('V,'+x+','+(y+1));
        hinge = ' ' + ((up && !down) ? 'dh-bot' : 'dh-top'); }
      else { const left = isDoorK('H,'+(x-1)+','+y), right = isDoorK('H,'+(x+1)+','+y);
        hinge = ' ' + ((left && !right) ? 'dh-right' : 'dh-left'); }
    }
    if(o === 'V') h += '<div class="cedge cedge-v e-'+type+hinge+'" style="left:'+(pad+x*pitch-gap)+'px;top:'+(pad+y*pitch-gap)+'px;height:'+(cs+2*gap)+'px"></div>';
    else          h += '<div class="cedge cedge-h e-'+type+hinge+'" style="top:'+(pad+y*pitch-gap)+'px;left:'+(pad+x*pitch-gap)+'px;width:'+(cs+2*gap)+'px"></div>';
  }
  // Arrondi des angles simples (L) : un sommet où exactement 1 mur vertical + 1 mur horizontal se rejoignent.
  // Les angles droits complets, les T et les croix (≥3 segments, ou 2 colinéaires) ne sont PAS arrondis.
  for(let vx=0; vx<=grid.w; vx++){
    for(let vy=0; vy<=grid.h; vy++){
      const nv = (isWall('V',vx,vy-1)?1:0) + (isWall('V',vx,vy)?1:0);
      const nh = (isWall('H',vx-1,vy)?1:0) + (isWall('H',vx,vy)?1:0);
      if(nv===1 && nh===1){
        const cx = pad + vx*pitch - gap/2, cy = pad + vy*pitch - gap/2;
        h += '<div class="cedge-knee" style="left:'+(cx-2)+'px;top:'+(cy-2)+'px"></div>';
      }
    }
  }
  return h;
}
// Portes (door/doorOpen) bordant une case → HTML de zones cliquables (ouvrir/fermer).
// fnName = nom d'une fonction globale appelée avec la clé d'arête, ex: openDoorJ('V,3,2')
function gridDoorHotspots(grid, pos, cs, fnName){
  if(!grid || !pos) return '';
  const pad = 5, gap = 1, pitch = cs + gap; const E = grid.edges || {}; const x = pos.x, y = pos.y; let h = '';
  const isDoor = k => E[k] === 'door' || E[k] === 'doorOpen';
  const add = (key, o, ex, ey) => {
    if(!isDoor(key)) return;
    if(o === 'V') h += '<div class="cdoor-hot" style="left:'+(pad+ex*pitch-gap-2)+'px;top:'+(pad+ey*pitch+3)+'px;width:8px;height:'+(cs-6)+'px" onclick="'+fnName+'(\''+key+'\')" title="Ouvrir / fermer la porte"></div>';
    else        h += '<div class="cdoor-hot" style="top:'+(pad+ey*pitch-gap-2)+'px;left:'+(pad+ex*pitch+3)+'px;height:8px;width:'+(cs-6)+'px" onclick="'+fnName+'(\''+key+'\')" title="Ouvrir / fermer la porte"></div>';
  };
  add('V,'+x+','+y,     'V', x,   y);   // gauche
  add('V,'+(x+1)+','+y, 'V', x+1, y);   // droite
  add('H,'+x+','+y,     'H', x,   y);   // haut
  add('H,'+x+','+(y+1), 'H', x,   y+1); // bas
  return h;
}
// Toutes les portes de la grille → zones cliquables (vue MJ : ouvre/ferme n'importe quelle porte)
function gridAllDoorHotspots(grid, cs, fnName){
  if(!grid || !grid.edges) return '';
  const pad = 5, gap = 1, pitch = cs + gap; let h = '';
  for(const key in grid.edges){
    const t = grid.edges[key]; if(t !== 'door' && t !== 'doorOpen') continue;
    const p = key.split(','); const o = p[0], x = +p[1], y = +p[2];
    if(o === 'V') h += '<div class="cdoor-hot" style="left:'+(pad+x*pitch-gap-2)+'px;top:'+(pad+y*pitch+3)+'px;width:8px;height:'+(cs-6)+'px" onclick="'+fnName+'(\''+key+'\')" title="Ouvrir / fermer la porte"></div>';
    else        h += '<div class="cdoor-hot" style="top:'+(pad+y*pitch-gap-2)+'px;left:'+(pad+x*pitch+3)+'px;height:8px;width:'+(cs-6)+'px" onclick="'+fnName+'(\''+key+'\')" title="Ouvrir / fermer la porte"></div>';
  }
  return h;
}
// Traceur d'attaque : trait du jeton attaquant vers sa cible sur la carte, qui s'efface après l'animation
function fpFireTracer(mapSelector, grid, cs, fromId, toId, miss){
  if(!grid || !grid.pos) return;
  const mapEl = (typeof mapSelector === 'string') ? document.querySelector(mapSelector) : mapSelector;
  if(!mapEl) return;
  const a = grid.pos[fromId], b = grid.pos[toId];
  if(!a || !b) return;
  const pad = 5, gap = 1, pitch = cs + gap;
  const cx = p => pad + p.x*pitch + cs/2, cy = p => pad + p.y*pitch + cs/2;
  const x1 = cx(a), y1 = cy(a), x2 = cx(b), y2 = cy(b);
  const len = Math.hypot(x2-x1, y2-y1), ang = Math.atan2(y2-y1, x2-x1) * 180 / Math.PI;
  const el = document.createElement('div');
  el.className = 'cmap-tracer' + (miss ? ' miss' : '');
  el.style.left = x1 + 'px'; el.style.top = y1 + 'px'; el.style.width = len + 'px';
  el.style.transform = 'rotate(' + ang + 'deg)';
  mapEl.appendChild(el);
  setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 750);
}
// Terrain d'une case (gère l'ancien format obstacles[] = murs)
function gridTerrainAt(grid, x, y){
  if(grid.terrain && grid.terrain[x+','+y]) return grid.terrain[x+','+y];
  if((grid.obstacles||[]).some(o => o.x===x && o.y===y)) return 'wall';
  return null;
}
function gridOccupied(grid, x, y){
  if(x<0||y<0||x>=grid.w||y>=grid.h) return true;
  if(blockSolid(gridTerrainAt(grid, x, y))) return true;
  return Object.values(grid.pos||{}).some(p => p.x===x && p.y===y);
}

// XP d'un PNJ selon son niveau et sa catégorie (window.NPC_XP chargé via db.js)
// cat : 'normal' | 'mighty' | 'legendary'  — extrapole au-delà du niveau 20
function getNpcXP(level, cat = 'normal') {
  const T = window.NPC_XP; if (!T || !T.perLevel?.length) return 0;
  const lvl = Math.max(1, parseInt(level) || 1);
  const c = ['normal','mighty','legendary'].includes(cat) ? cat : 'normal';
  if (lvl <= 20) return T.perLevel[lvl - 1][c];
  return T.perLevel[19][c] + (lvl - 20) * (T.above20[c] || 0);
}

function getTN(d, skKey) {
  const attr = SK_ATTR[skKey] || 'A';
  const map = {S:d.special?.S||5, P:d.special?.P||5, E:d.special?.E||5, C:d.special?.C||5, I:d.special?.I||5, A:d.special?.A||5, L:d.special?.L||5};
  const rang = d.skills?.[skKey] || 0;
  const tag  = d.taggedSkills?.includes(skKey) ? 2 : 0;
  return {total: map[attr]+rang+tag, attrVal: map[attr], rang, tag};
}

// ============================================================
// LOOT DE COMBAT — génère le butin en fonction des ennemis vaincus.
// Profils dans data/loot_profiles.json (window.LOOT_PROFILES) :
//   beast    → viande (selon la créature) + matériaux
//   human    → arme / armure / chems / nourriture / boisson / munitions / caps
//   machine  → ferraille/composants + munitions + (rare) arme/caps
// Quantités mises à l'échelle par category (swarm<normal<elite<boss).
// Retourne { items:[{name,type,cat,qty}], caps:int } à fusionner dans /butin/data.
// ============================================================
function lootTier(cat){ return (window.LOOT_PROFILES?.tierByCategory || {})[cat] || 2; }

// Tirage pondéré par rareté (commun = fréquent, légendaire = rare)
function lootWeightedPick(list){
  if(!Array.isArray(list) || !list.length) return null;
  let tot=0; const w=list.map(it=>{ const x=Math.max(1,6-(it.r||3)); tot+=x; return x; });
  let r=Math.random()*tot;
  for(let i=0;i<list.length;i++){ r-=w[i]; if(r<=0) return list[i]; }
  return list[list.length-1];
}
// Somme de n dés de combat (faces : 1,2,0,0,1,1 — comme FACES_CD)
function lootSumCD(n){ let s=0; for(let i=0;i<n;i++) s += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0; return s; }
// Munitions : jet 2D20 sur la table officielle (window.AMMO_LOOT) → {ammo, qty}
function lootRollAmmo(){
  const tbl = window.AMMO_LOOT; if(!tbl||!tbl.length) return null;
  const roll = (1+Math.floor(Math.random()*20)) + (1+Math.floor(Math.random()*20));
  const e = tbl.find(x => roll>=x.min && roll<=x.max); if(!e) return null;
  let q = e.base||0;
  for(let i=0;i<(e.cd||0);i++) q += parseInt(FACES_CD[Math.floor(Math.random()*6)])||0;
  return { ammo: e.ammo, qty: Math.max(1, q*(e.mult||1)) };
}
// Profil (beast/human/machine) d'un ennemi en combat (type relu depuis ENNEMIS_DB ; fallback humain)
function lootProfileKey(enemy){
  const LP = window.LOOT_PROFILES || {};
  const type = window.ENNEMIS_DB?.[enemy?.nom]?.type;
  if(type && LP.typeProfile && LP.typeProfile[type]) return LP.typeProfile[type];
  return 'human';   // unités de faction relabellisées / inconnus → humanoïdes
}

// Compétence d'attaque ennemie → compétence d'arme (sk) du DB
const LOOT_SKILL_SK = {
  'guns':'light_weapon', 'small guns':'light_weapon', 'big guns':'heavy_weapon',
  'energy weapons':'en_weapon', 'explosives':'explosives', 'throwing':'throwing',
  'melee weapons':'cac_weapon'
};
function _lootWdmg(w){ return parseInt(w?.dmg) || 0; }   // "4D" → 4
// Arme RÉELLEMENT utilisée : on choisit dans le DB une arme cohérente avec
// l'attaque de l'ennemi (compétence + nb de dés), puis on en déduit la munition (a).
// Retourne {weapon, ammoName} ou null (bête / pas d'arme identifiable).
function enemyWeaponLoot(enemy, profileKey){
  const weapons = window.DB?.weapons || [];
  if(!weapons.length) return null;
  const atks = window.ENNEMIS_DB?.[enemy?.nom]?.attacks || [];
  const weaponed = atks.filter(a => LOOT_SKILL_SK[a.skill]);   // ignore unarmed / melee naturel
  let sk, targetDmg;
  if(weaponed.length){
    const best = weaponed.reduce((m,a) => (a.dmg||0) > (m.dmg||0) ? a : m);
    sk = LOOT_SKILL_SK[best.skill]; targetDmg = best.dmg || 0;
  } else if(profileKey === 'machine'){ sk = 'en_weapon'; targetDmg = 5; }
  else if(profileKey === 'human'){ sk = Math.random() < 0.5 ? 'light_weapon' : 'cac_weapon'; targetDmg = 3; }
  else return null;   // bête : pas d'arme
  let cand = weapons.filter(w => w.sk === sk);
  if(!cand.length) cand = weapons.filter(w => w.sk === 'light_weapon');
  if(!cand.length) cand = weapons;
  // pondération : rareté × proximité du nb de dés
  let tot = 0; const wts = cand.map(w => { const rar = Math.max(1, 6-(w.r||3)); const close = 1/(1+Math.abs(_lootWdmg(w)-targetDmg)); const x = rar*close; tot += x; return x; });
  let r = Math.random()*tot, pick = cand[cand.length-1];
  for(let i=0;i<cand.length;i++){ r -= wts[i]; if(r<=0){ pick = cand[i]; break; } }
  const a = pick.a;
  return { weapon: pick, ammoName: (a && a !== '-' && a !== '–') ? a : null };
}
function _lootAmmoQty(t){ return Math.max(2, lootSumCD(4) + t*2); }   // quantité de munitions pour l'arme lâchée
function generateCombatLoot(enemies){
  const LP = window.LOOT_PROFILES || {}; const DB = window.DB || {};
  const items = []; let caps = 0;
  const add = (name, type, cat, qty) => {
    if(!name || qty <= 0) return;
    const ex = items.find(x => x.name===name && x.cat===cat);
    if(ex) ex.qty += qty; else items.push({ name, type, cat, qty });
  };
  (enemies || []).forEach(en => {
    const prof = lootProfileKey(en);
    const t = lootTier(en.category);
    if(prof === 'beast'){
      const p = LP.profiles?.beast || {};
      const meat = (LP.meatByCreature && LP.meatByCreature[en.nom]) || LP.defaultMeat || 'Viande crue mutée';
      add(meat, 'FOOD', 'food', Math.max(1, Math.round(t * (p.foodPerTier || 1))));
      const m = p.materials;
      if(m && Math.random() < (m.chance ?? 0.7)){
        const mat = m.pool[Math.floor(Math.random()*m.pool.length)];
        add(mat, 'STUFF', 'stuff', 1 + lootSumCD(t));
      }
    } else if(prof === 'machine'){
      const p = LP.profiles?.machine || {};
      const sc = p.scrap;
      if(sc && sc.pool?.length){ const n = Math.max(1, t * (sc.perTier || 1)); for(let i=0;i<n;i++){ add(sc.pool[Math.floor(Math.random()*sc.pool.length)], 'STUFF', 'stuff', 1); } }
      // arme réellement utilisée (montée sur le robot/la tourelle) + ses munitions
      if(p.weapon && Math.random() < (p.weapon.chance ?? 0.3)){
        const wl = enemyWeaponLoot(en, 'machine');
        if(wl){ add(wl.weapon.n, wl.weapon.t || 'WEAPON', 'weapons', 1); if(wl.ammoName) add(wl.ammoName, 'AMMO', 'ammo', _lootAmmoQty(t)); }
      }
      if(p.ammo && Math.random() < (p.ammo.chance ?? 0.6)){ const a = lootRollAmmo(); if(a) add(a.ammo, 'AMMO', 'ammo', a.qty); }
      if(p.caps && Math.random() < (p.caps.chance ?? 0.2)) caps += (p.caps.base || 0) + lootSumCD(t) * (p.caps.perTier || 2);
    } else { // human
      const p = LP.profiles?.human || {};
      // arme réellement utilisée par l'ennemi + ses munitions
      if(p.weapon && Math.random() < (p.weapon.chance ?? 0.5)){
        const wl = enemyWeaponLoot(en, 'human');
        if(wl){ add(wl.weapon.n, wl.weapon.t || 'WEAPON', 'weapons', 1); if(wl.ammoName) add(wl.ammoName, 'AMMO', 'ammo', _lootAmmoQty(t)); }
      }
      if(p.armor  && Math.random() < (p.armor.chance  ?? 0.35)){ const a = lootWeightedPick(DB.armor);  if(a) add(a.n, a.t || 'ARMOR', 'armor', 1); }
      if(p.drugs  && Math.random() < (p.drugs.chance  ?? 0.4)){ const d = lootWeightedPick(DB.drugs);  if(d) add(d.n, d.t || 'DRUGS', 'drugs', 1); }
      if(p.food   && Math.random() < (p.food.chance   ?? 0.5)){ const f = lootWeightedPick(DB.food);   if(f) add(f.n, f.t || 'FOOD', 'food', 1); }
      if(p.drinks && Math.random() < (p.drinks.chance ?? 0.4)){ const dr = lootWeightedPick(DB.drinks); if(dr) add(dr.n, dr.t || 'DRINK', 'drinks', 1); }
      // munitions supplémentaires (en plus de celles de l'arme)
      if(p.ammo   && Math.random() < (p.ammo.chance   ?? 0.7)){ const a = lootRollAmmo(); if(a) add(a.ammo, 'AMMO', 'ammo', a.qty); }
      caps += (p.caps?.base || 0) + lootSumCD(t) * (p.caps?.perTier || 3);
    }
  });
  return { items, caps };
}
