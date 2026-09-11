// ============================================================
// PAGE MOBILE — hub joueur (fiche / sac / quêtes) + jet de dés.
// Second écran : on n'affiche QUE ce sur quoi le joueur agit ou dont il a
// besoin en propre. La carte, l'encyclopédie et le lore restent sur le PC.
//
// URL : mobile.html?id=<joueurId>[&camp=<campId>]
// L'id est mémorisé (localStorage) pour que l'icône d'écran d'accueil ouvre
// directement le bon personnage.
// ============================================================
let db = null, char = null, JOUEUR_ID = null;
let _tab = 'fiche', _invFilter = 'all', _quests = [], _campMin = null;

const P = new URLSearchParams(location.search);

// ---------- Démarrage ----------
async function init() {
  JOUEUR_ID = P.get('id') || localStorage.getItem('fp_mobileId') || '';
  if (!JOUEUR_ID) { _askId(); return; }
  try { localStorage.setItem('fp_mobileId', JOUEUR_ID); } catch (e) {}

  db = firebase.initializeApp(firebaseConfig).firestore();
  fpNetWake(db);                       // survie des listeners au réveil du téléphone
  await window.DB_READY;

  // Le perso porte sa campagne : on la fixe AVANT les listeners scopés.
  const first = await db.collection('joueurs').doc(JOUEUR_ID).get();
  if (!first.exists) { _askId('Personnage introuvable : ' + JOUEUR_ID); return; }
  const camp = P.get('camp') || first.data().campaign;
  if (camp && typeof fpSetCamp === 'function') fpSetCamp(camp);

  db.collection('joueurs').doc(JOUEUR_ID).onSnapshot(s => {
    if (!s.exists) return;
    char = _normalize(s.data());
    renderAll();
  }, e => console.warn('joueur:', e && e.code));

  db.collection('quetes').doc(fpCampId()).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    _quests = (Array.isArray(d.quests) ? d.quests : [])
      .filter(q => Array.isArray(q.revealedFor) && q.revealedFor.includes(JOUEUR_ID));
    renderQuetes();
  }, e => console.warn('quetes:', e && e.code));

  db.collection('temps').doc(fpCampId()).onSnapshot(s => {
    _campMin = s.exists ? (s.data().minutes ?? null) : null;
    renderHeader(); renderSurvie();
  }, e => console.warn('temps:', e && e.code));

  // Événements personnels non lus (écriture MJ à venir — cf. brief, phase 3)
  db.collection('events')
    .where('playerId', '==', JOUEUR_ID).where('read', '==', false)
    .onSnapshot(s => renderAlerts(s.docs.map(d => ({ id: d.id, ...d.data() }))),
                e => console.warn('events indisponible:', e && e.code));
}

function _askId(msg) {
  document.getElementById('m-main').innerHTML =
    `<div class="m-card"><div class="m-ct">Connexion</div>
      ${msg ? `<div class="m-empty" style="color:var(--rd)">${msg}</div>` : ''}
      <label class="m-lbl">Identifiant de personnage</label>
      <input class="m-in" id="ask-id" placeholder="ex : kuma">
      <button class="m-btn" onclick="_setId()">Ouvrir mon Pip-Boy</button>
      <div class="m-empty">Il est mémorisé : l'icône de l'écran d'accueil ouvrira directement ce personnage.</div>
    </div>`;
}
function _setId() {
  const v = (document.getElementById('ask-id').value || '').trim();
  if (!v) return;
  try { localStorage.setItem('fp_mobileId', v); } catch (e) {}
  location.search = '?id=' + encodeURIComponent(v);
}

// Complète les champs manquants pour ne pas semer des `undefined` dans le rendu
function _normalize(d) {
  return Object.assign({
    name: d.nom || JOUEUR_ID, special: {}, skills: {}, taggedSkills: [], perks: [],
    inventory: [], ammo: [], caps: 0, niveau: 1, xp: 0, pv: 0, rad: 0, luck: 0,
    wounds: {}, survie: {}, powerArmor: false,
  }, d, { name: d.nom || d.name || JOUEUR_ID });
}

// ---------- Navigation ----------
function mSw(t) {
  _tab = t;
  document.querySelectorAll('.m-tc').forEach(el => el.classList.toggle('on', el.id === 'tc-' + t));
  document.querySelectorAll('.m-tab').forEach(el => el.classList.toggle('on', el.id === 'nav-' + t));
  window.scrollTo(0, 0);
}

// ---------- Rendu ----------
function renderAll() {
  if (!char) return;
  renderHeader(); renderSpecial(); renderBody(); renderSurvie(); renderWeapons();
  renderCharge(); renderFilters(); renderInv();
}

function renderHeader() {
  if (!char) return;
  const sp = fpSpecial(char), hpMax = fpHpMax(char), hp = char.pv ?? hpMax;
  const pct = hpMax ? Math.round(100 * hp / hpMax) : 0;
  const st = fpHealthStatus(pct);
  document.getElementById('m-name').textContent = char.name;
  const clock = (_campMin != null && typeof fpFmtDuree === 'function')
    ? ' · ' + _fmtClock(_campMin) : '';
  document.getElementById('m-sub').textContent =
    `LVL ${char.niveau || 1} · ${st.label}${clock}`;

  const hpEl = document.getElementById('m-hp');
  hpEl.textContent = hp + '/' + hpMax;
  hpEl.parentElement.className = 'm-vital' + (pct < 35 ? ' danger' : pct < 60 ? ' warn' : '');
  const radEl = document.getElementById('m-rad');
  radEl.textContent = char.rad || 0;
  radEl.parentElement.className = 'm-vital' + ((char.rad || 0) > 0 ? ' warn' : '');
  document.getElementById('m-luck').textContent = (char.luck ?? 0) + '/' + (sp.L ?? 5);
}
function _fmtClock(min) {
  const h = Math.floor((min % 1440) / 60), m = min % 60;
  return String(h).padStart(2, '0') + 'h' + String(m).padStart(2, '0');
}

// Une seule ligne : initiale + valeur (le détail des noms reste sur le PC)
function renderSpecial() {
  const N = { S: 'Force', P: 'Perception', E: 'Endurance', C: 'Charisme', I: 'Intelligence', A: 'Agilité', L: 'Chance' };
  const sp = fpSpecial(char), forEff = fpForEff(char);
  document.getElementById('m-special').innerHTML = ['S','P','E','C','I','A','L'].map(k => {
    const v = k === 'S' ? forEff : sp[k];
    return `<span class="m-spx" title="${N[k]}"><b>${k}</b><i>${v}</i></span>`;
  }).join('');
}

// « Mon personnage » : Vault Boy radar + RD par localisation (blessures en rouge).
// Même règle qu'à la fiche (RAW p.123 : on garde la MEILLEURE RD par type, pas la somme).
const M_LOCS = [
  { k: 'head',  l: 'Tête' },   { k: 'torso', l: 'Buste' },
  { k: 'armR',  l: 'Bras D.' },{ k: 'armL',  l: 'Bras G.' },
  { k: 'legR',  l: 'Jambe D.' },{ k: 'legL', l: 'Jambe G.' },
];
function _frame() { return (char.inventory || []).find(it => it.type === 'POWERARMOR_FRAME' && it.equipped) || null; }
function _locRD(zone) {
  const zm = { head:'Head', torso:'Torso', armL:'Arm', armR:'Arm', legL:'Leg', legR:'Leg' };
  let ph = 0, en = 0, rad = 0, nom = '';
  const fr = _frame();
  if (char.powerArmor && fr) {
    const piece = fr.slots && fr.slots[zone];
    if (piece) {
      const base = (DB.armor || []).find(a => a.n === piece.name) || {};
      const e = fpApplyArmorMods ? fpApplyArmorMods(base, piece.mods) : base;
      ph = e.ph || 0; en = e.en || 0; rad = e.rad || 0; nom = piece.name;
    }
  } else {
    (char.inventory || []).forEach(it => {
      if (!it.equipped) return;
      const dbA = (DB.armor || []).find(a => a.n === it.name);
      if (!dbA) return;
      const covers = dbA.z === zm[zone] || (dbA.z === 'Body' && zone !== 'head') || dbA.z === 'All';
      if (!covers) return;
      const e = fpApplyArmorMods ? fpApplyArmorMods(dbA, it.mods) : dbA;
      ph = Math.max(ph, e.ph || 0); en = Math.max(en, e.en || 0);
      rad = (dbA.rad === 999 || rad === 999) ? 999 : Math.max(rad, e.rad || 0);
      if (!nom) nom = it.name;
    });
  }
  return { ph, en, rad, nom };
}
function renderBody() {
  const fr = char.powerArmor ? _frame() : null;
  const cells = M_LOCS.map(L => {
    const r = _locRD(L.k), hurt = !!(char.wounds || {})[L.k];
    return `<div class="m-loc${hurt ? ' hurt' : ''}">
      <span class="m-loc-l">${L.l}${hurt ? ' ✚' : ''}</span>
      <span class="m-loc-a">${r.nom || '—'}</span>
      <span class="m-loc-r"><b>${r.ph}</b><i>Ph</i><b>${r.en}</b><i>En</i><b>${r.rad === 999 ? '∞' : r.rad}</b><i>Ra</i></span>
    </div>`;
  }).join('');
  document.getElementById('m-body').innerHTML =
    (fr ? `<div class="m-pa">🦾 Servo-armure — ${fr.name}${fr.core ? '' : ' · ⚠ cœur vide'}</div>` : '')
    + `<img class="m-vb" src="../../img/${fr ? 'VaultBoyPA.png' : 'vaultboy_radar.png'}" alt="">`
    + `<div class="m-locs">${cells}</div>`;
}

function renderSurvie() {
  const el = document.getElementById('m-survie');
  if (typeof SURVIE === 'undefined') { el.innerHTML = ''; return; }
  const s = SURVIE.compute(char.survie || {}, _campMin != null ? _campMin : 0);
  const row = (ic, lbl, o, max) => {
    const col = o.danger || o.idx >= max - 1 ? 'var(--rd)' : o.idx >= max - 2 ? 'var(--am-br)' : 'var(--g)';
    const pct = Math.max(6, Math.round(100 * (max - 1 - o.idx) / (max - 1)));
    return `<div class="m-sv"><span class="m-sv-i">${ic}</span><span class="m-sv-l">${lbl}</span>
      <span class="m-sv-b"><span class="m-sv-f" style="width:${pct}%;background:${col};box-shadow:0 0 6px ${col}"></span></span>
      <span class="m-sv-s" style="color:${col}">${o.label}</span></div>`;
  };
  el.innerHTML = row('🍴', 'Faim', s.faim, s.maxIdx.faim)
    + row('💧', 'Soif', s.soif, s.maxIdx.soif)
    + row('🛏', 'Sommeil', s.sommeil, s.maxIdx.sommeil)
    + (s.fatigue > 0 ? `<div style="font-size:.62rem;color:var(--rd);margin-top:.3rem">Fatigue : <b>${s.fatigue}</b> (−${s.apMalus} AP · −${s.hpLoss} PV/scène)</div>` : '');
}

function renderWeapons() {
  const eq = (char.inventory || []).filter(it => it.type === 'WEAPON' && it.equipped);
  const el = document.getElementById('m-weap');
  if (!eq.length) { el.innerHTML = '<div class="m-empty">Aucune arme équipée.</div>'; return; }
  el.innerHTML = eq.map(inv => {
    const base = (DB.weapons || []).find(w => w.n === inv.name) || {};
    const w = fpApplyWeaponMods(base, inv.mods);
    const am = w.a && w.a !== '-' ? (char.ammo || []).find(a => a.cal === w.a) : null;
    return `<div class="m-weap">
      <span class="m-weap-ic"><img src="../../img/tabs/inv_armes.png" alt=""></span>
      <span class="m-weap-b"><span class="m-weap-n">${inv.name}</span>
        <span class="m-weap-s">${w.t || ''}${w.rng ? ' · ' + w.rng : ''}${am ? ' · ' + am.qty + ' mun.' : ''}</span></span>
      <span class="m-weap-d">${w.dmg || '?'}</span></div>`;
  }).join('');
}

// TN = attribut + rang + (tag ? 2 : 0)   — cf. CLAUDE.md
function _skTN(sk) {
  const sp = fpSpecial(char);
  const attr = sp[FP_ATTR_LETTER[sk.attr]] ?? 5;
  const rg = (char.skills || {})[sk.key] || 0;
  return attr + rg + ((char.taggedSkills || []).includes(sk.key) ? 2 : 0);
}


// ---------- SAC ----------
const INV_CATS = [
  { k: 'all',   lb: 'Tout',     ic: 'inv_tout' },
  { k: 'weap',  lb: 'Armes',    ic: 'inv_armes' },
  { k: 'armor', lb: 'Armures',  ic: 'inv_armure' },
  { k: 'aid',   lb: 'Aide',     ic: 'inv_aide' },
  { k: 'misc',  lb: 'Divers',   ic: 'inv_divers' },
  { k: 'ammo',  lb: 'Munitions',ic: 'inv_munitions' },
];
function renderFilters() {
  document.getElementById('m-filters').innerHTML = INV_CATS.map(c =>
    `<button class="m-chip${_invFilter === c.k ? ' on' : ''}" onclick="setInvFilter('${c.k}')">
       <img src="../../img/tabs/${c.ic}.png" alt="">${c.lb}</button>`).join('');
}
function setInvFilter(k) { _invFilter = k; renderFilters(); renderInv(); }

const AID_TYPES = ['FOOD', 'DRINK', 'DRUGS'];
function _matchCat(it) {
  switch (_invFilter) {
    case 'weap':  return it.type === 'WEAPON';
    case 'armor': return ['ARMOR', 'CLOTHING', 'OUTFIT', 'POWERARMOR', 'POWERARMOR_FRAME'].includes(it.type);
    case 'aid':   return AID_TYPES.includes(it.type);
    case 'misc':  return ['STUFF', 'JUNK'].includes(it.type);
    default:      return true;
  }
}
function renderInv() {
  const el = document.getElementById('m-inv');
  if (_invFilter === 'ammo') {
    const am = char.ammo || [];
    el.innerHTML = am.length ? am.map(a =>
      `<div class="m-it"><span class="m-it-b"><span class="m-it-n">${a.cal}</span></span>
       <span class="m-it-q">${a.qty}</span></div>`).join('')
      : '<div class="m-empty">Aucune munition.</div>';
    return;
  }
  const list = (char.inventory || []).map((it, i) => ({ it, i })).filter(o => _matchCat(o.it));
  if (!list.length) { el.innerHTML = '<div class="m-empty">Rien dans cette catégorie.</div>'; return; }
  el.innerHTML = list.map(({ it, i }) => {
    const equipable = ['WEAPON', 'ARMOR', 'CLOTHING', 'OUTFIT'].includes(it.type);
    const usable = AID_TYPES.includes(it.type);
    let acts = '';
    if (equipable) acts += `<button class="m-mini${it.equipped ? ' on' : ''}" onclick="toggleEquip(${i})">${it.equipped ? '✓ Équipé' : 'Équiper'}</button>`;
    if (usable)    acts += `<button class="m-mini use" onclick="useItem(${i})">Utiliser</button>`;
    const w = (it.w != null ? it.w : 0) * (it.qty || 1);
    return `<div class="m-it${it.equipped ? ' eq' : ''}">
      <span class="m-it-b"><span class="m-it-n">${it.name}</span>
        <span class="m-it-s">${it.type}${w ? ' · ' + (Math.round(w * 10) / 10) + ' kg' : ''}${it.eff ? ' · ' + it.eff : ''}</span></span>
      <span class="m-it-q">×${it.qty || 1}</span>
      <span class="m-it-a">${acts}</span></div>`;
  }).join('');
}

function renderCharge() {
  const max = fpChargeMax(char), cur = fpChargePortee(char);
  const pct = max ? Math.min(100, Math.round(100 * cur / max)) : 0;
  document.getElementById('m-charge').innerHTML =
    `<div class="m-charge-l"><span>Portée</span><span><b>${Math.round(cur * 10) / 10}</b> / ${Math.round(max * 10) / 10} kg</span></div>
     <div class="m-charge-b"><span class="m-charge-f${cur > max ? ' over' : ''}" style="width:${pct}%"></span></div>
     ${cur > max ? '<div style="font-size:.6rem;color:var(--rd);margin-top:.3rem">Surcharge : allure réduite de moitié.</div>' : ''}`;
}

// ---------- Actions (écriture Firestore) ----------
async function _save(patch) {
  try { await db.collection('joueurs').doc(JOUEUR_ID).update(patch); }
  catch (e) { console.error('save:', e); alert('Échec de l\'enregistrement.'); }
}
// Équiper/déséquiper. Une seule armure par emplacement : on déséquipe les
// concurrentes du même type (les armes restent cumulables, cf. 2 slots + explosif).
async function toggleEquip(i) {
  const inv = JSON.parse(JSON.stringify(char.inventory || []));
  const it = inv[i]; if (!it) return;
  const on = !it.equipped;
  if (on && ['ARMOR', 'CLOTHING', 'OUTFIT'].includes(it.type)) {
    inv.forEach((o, j) => { if (j !== i && o.type === it.type) o.equipped = false; });
  }
  it.equipped = on;
  await _save({ inventory: inv });
}
// Consommer : applique les PV du soin, décrémente, retire à 0.
async function useItem(i) {
  const inv = JSON.parse(JSON.stringify(char.inventory || []));
  const it = inv[i]; if (!it) return;
  const def = (DB.food || []).concat(DB.drinks || [], DB.drugs || []).find(x => x.n === it.name);
  const eff = (typeof fpParseConsumable === 'function' && def) ? fpParseConsumable(def) : null;
  const patch = {};
  const heal = eff && eff.hp ? eff.hp : 0;
  if (heal) patch.pv = Math.min(fpHpMax(char), (char.pv || 0) + heal);
  it.qty = (it.qty || 1) - 1;
  if (it.qty <= 0) inv.splice(i, 1);
  patch.inventory = inv;
  await _save(patch);
  if (heal) _toast(`+${heal} PV`);
}
function _toast(msg) {
  const el = document.createElement('div');
  el.className = 'fp-net-pill';
  el.style.cssText += 'background:#14210e;border-color:var(--g);color:var(--tb);top:auto;bottom:8rem;';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------- Quêtes ----------
function renderQuetes() {
  const el = document.getElementById('m-quetes');
  const dot = document.getElementById('dot-quetes');
  if (!_quests.length) { el.innerHTML = '<div class="m-empty">Aucune quête connue.</div>'; if (dot) dot.style.display = 'none'; return; }
  const actives = _quests.filter(q => (q.status || 'active') === 'active').length;
  if (dot) dot.style.display = actives ? 'block' : 'none';
  el.innerHTML = _quests.map(q => {
    const st = q.status || 'active';
    const objs = (q.objectives || []).map(o =>
      `<div class="m-q-o${o.done ? ' done' : ''}"><span class="bx">${o.done ? '☑' : '☐'}</span><span>${o.text || ''}</span></div>`).join('');
    return `<div class="m-q ${st === 'done' ? 'done' : st === 'failed' ? 'failed' : ''}">
      <div class="m-q-t">${q.title || 'Quête'}</div>
      ${q.desc ? `<div class="m-q-d">${q.desc}</div>` : ''}${objs}</div>`;
  }).join('');
}

// ---------- Alertes ----------
const EV_ICON = { quete: '📋', tour: '⚔', objet: '🎒', message: '📟', terminal: '💻', butin: '🎒' };
function renderAlerts(list) {
  const el = document.getElementById('m-alerts');
  el.innerHTML = (list || []).map(ev =>
    `<button class="m-alert" onclick="ackEvent('${ev.id}','${ev.type || ''}')">
       <span class="ic">${EV_ICON[ev.type] || '⚠'}</span><span>${ev.text || 'Événement'}</span></button>`).join('');
}
async function ackEvent(id, type) {
  if (type === 'quete') mSw('quetes');
  try { await db.collection('events').doc(id).update({ read: true }); } catch (e) { console.warn('ack:', e); }
}

// ---------- Dés ----------
let _diceMode = '2d20';
function openDice() {
  const sel = document.getElementById('dice-skill');
  if (!sel.options.length && char) {
    sel.innerHTML = (SKILLS_DEF || []).map(sk => `<option value="${sk.key}">${sk.name} — TN ${_skTN(sk)}</option>`).join('');
    syncTN();
  }
  document.getElementById('m-dice').classList.add('on');
}
function closeDice() { document.getElementById('m-dice').classList.remove('on'); }
function setDiceMode(m) {
  _diceMode = m;
  document.getElementById('dm-2d20').classList.toggle('on', m === '2d20');
  document.getElementById('dm-cd').classList.toggle('on', m === 'cd');
  document.getElementById('dice-2d20').style.display = m === '2d20' ? '' : 'none';
  document.getElementById('dice-cd').style.display = m === 'cd' ? '' : 'none';
}
function syncTN() {
  const key = document.getElementById('dice-skill').value;
  const sk = (SKILLS_DEF || []).find(s => s.key === key);
  if (sk) document.getElementById('dice-tn').value = _skTN(sk);
}
const _d = n => 1 + Math.floor(Math.random() * n);

function rollDice() {
  const out = document.getElementById('dice-out');
  let html = '', detail = '', label = '';
  if (_diceMode === '2d20') {
    const tn = parseInt(document.getElementById('dice-tn').value, 10) || 10;
    const nb = parseInt(document.getElementById('dice-nb').value, 10) || 2;
    const sk = (SKILLS_DEF || []).find(s => s.key === document.getElementById('dice-skill').value);
    const dice = Array.from({ length: nb }, () => _d(20));
    let succ = 0, crit = 0, comp = 0;
    html = dice.map(v => {
      const isCrit = v === 1, hit = v <= tn, isComp = v === 20;
      if (isCrit) { succ += 2; crit++; } else if (hit) succ++;
      if (isComp) comp++;
      return `<span class="m-die ${isCrit ? 'crit' : isComp ? 'comp' : hit ? 'hit' : ''}">${v}</span>`;
    }).join('');
    html += `<div class="m-dice-sum">${succ} succès${crit ? ' · ✦ critique' : ''}${comp ? ' · ⚠ complication' : ''} (TN ${tn})</div>`;
    detail = `${succ} succ.${crit ? ' ✦' : ''}${comp ? ' ⚠' : ''}`;
    label = (sk ? sk.name : 'Test') + ' ' + nb + 'D20 TN ' + tn;
  } else {
    const nb = parseInt(document.getElementById('dice-cdnb').value, 10) || 1;
    // Dé de combat (d6) : 1→1, 2→2, 3/4→0, 5/6→1 + effet
    let tot = 0, fx = 0;
    const dice = Array.from({ length: nb }, () => _d(6));
    html = dice.map(v => {
      const dmg = v === 1 ? 1 : v === 2 ? 2 : (v >= 5 ? 1 : 0);
      if (v >= 5) fx++;
      tot += dmg;
      return `<span class="m-die ${dmg ? 'hit' : ''}${v >= 5 ? ' crit' : ''}">${v}</span>`;
    }).join('');
    html += `<div class="m-dice-sum">${tot} dégâts${fx ? ' · ' + fx + ' effet' + (fx > 1 ? 's' : '') : ''}</div>`;
    detail = `${tot} dégâts${fx ? ' · ' + fx + ' effet(s)' : ''}`;
    label = nb + ' dés de combat';
  }
  out.innerHTML = html;
  if (document.getElementById('dice-public').checked) _announce(label, detail);
}
// Annonce au MJ : ligne de journal (visible dans le dashboard, sans perturber
// le lancer public du MJ qui vit dans /rolls).
function _announce(label, detail) {
  if (typeof fpLogAction === 'function' && db && char)
    fpLogAction(db, char.name || JOUEUR_ID, `a lancé « ${label} » : ${detail}`);
}

document.addEventListener('DOMContentLoaded', init);
