// ============================================================
// TERMINAL ROBCO — page autonome. Contenu = data/terminals.json (arborescence).
// ?t=<id> choisit le terminal. Navigation drill-down (l'écran est remplacé + [ RETOUR ]).
// Boot ROBCO + effet machine à écrire + bips. Vert phosphore.
// ============================================================

const _tp = new URLSearchParams(location.search);
let termData = {}, term = null, pathStack = [], _children = [];
let _type = null;   // { timer, el, full, cb }
let powered = false;   // état marche/arrêt du moniteur
const sciTN = parseInt(_tp.get('sci')) || 0;   // TN de Sciences du joueur (passé par la fiche) pour le hacking
let _hacked = {}, _lockout = {}, _hackNode = null;   // nœuds déverrouillés / verrouillés cette session

function esc(s){ return (s == null ? '' : '' + s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function muted(){ try{ return localStorage.getItem('fp_sfxMuted') === '1'; }catch(e){ return false; } }
function beep(){
  try{ if(muted()) return;
    const a = new Audio('../../audio/sfx/bouton_sfx.mp3'); a.volume = 0.35; a.play().catch(()=>{}); }catch(e){}
}
// Son d'allumage (clic sur ON) / extinction (clic sur OFF)
function sfx(file, vol){
  try{ if(muted()) return;
    const a = new Audio('../../audio/sfx/' + file); a.volume = vol || 0.55; a.play().catch(()=>{}); }catch(e){}
}
// Son de frappe : boucle tant que du texte s'écrit (débounce pour rester continu entre les lignes)
let _typeAudio = null, _typeStopTimer = null;
function typeSfxOn(){
  if(muted()) return;
  if(_typeStopTimer){ clearTimeout(_typeStopTimer); _typeStopTimer = null; }
  try{
    if(!_typeAudio){ _typeAudio = new Audio('../../audio/sfx/type_txt_sfx.mp3'); _typeAudio.loop = true; _typeAudio.volume = 0.5; }
    if(_typeAudio.paused) _typeAudio.play().catch(()=>{});
  }catch(e){}
}
function typeSfxOff(now){
  if(!_typeAudio) return;
  if(_typeStopTimer) clearTimeout(_typeStopTimer);
  const stop = () => { try{ _typeAudio.pause(); _typeAudio.currentTime = 0; }catch(e){} _typeStopTimer = null; };
  if(now) stop(); else _typeStopTimer = setTimeout(stop, 160);
}

function initTerminal(){
  // Skip de la frappe au clic sur l'écran (hors entrées de menu)
  document.getElementById('term-crt').addEventListener('click', e => {
    if(powered && _type && !e.target.closest('.t-entry')) skipType();
  });
  // On charge les données mais on reste ÉTEINT : le bouton power lance le terminal
  fetch('../../data/terminals.json?v=3').then(r => r.json()).then(d => {
    termData = d.terminals || {};
    const wanted = _tp.get('t');
    term = (wanted && termData[wanted]) || termData[Object.keys(termData)[0]] || null;
  }).catch(() => { termData = {}; term = null; });
}

// Marche / Arrêt du moniteur
function togglePower(){
  powered = !powered;
  const off = document.getElementById('term-off');
  const btn = document.getElementById('power-btn');
  const screen = document.getElementById('crt-screen');
  if(off) off.classList.toggle('on', !powered);
  if(btn) btn.classList.toggle('on', powered);
  if(powered){
    sfx('start_terminal_sfx.mp3');   // son d'allumage
    if(screen){ screen.classList.remove('powering'); void screen.offsetWidth; screen.classList.add('powering'); }
    pathStack = []; _hacked = {}; _lockout = {};   // session fraîche
    if(!term){ showError('AUCUN TERMINAL CONFIGURÉ'); return; }
    boot();
  } else {
    sfx('end_terminal_sfx.mp3');      // son d'extinction
    typeSfxOff(true); _type = null; pathStack = [];
    const out = document.getElementById('term-out'); if(out) out.innerHTML = '';
  }
}

function showError(msg){
  document.getElementById('term-out').innerHTML = '<div class="t-head"><div class="t-h1">BULL TÉLÉMATIQUE (MC) — SERVICE TÉLÉTEL</div></div><div class="t-err">! ' + esc(msg) + ' !</div>';
}

// ---- Boot ----
function boot(){
  const out = document.getElementById('term-out');
  out.innerHTML = '<div id="t-boot"></div>';
  const el = document.getElementById('t-boot');
  const lines = [
    'BULL TÉLÉMATIQUE (MC) — PROTOCOLE TÉLÉTEL',
    'INITIALISATION DU SYSTÈME...',
    'COPYRIGHT 2075-2077 BULL TÉLÉMATIQUE — D.G.T.',
    'TERMINAL MINITEL 5000',
    'CONTIENT DE LA TAURINE — C\'EST PAS POUR LES PINPINS',
    '',
    'CONNEXION AU RÉSEAU TÉLÉTEL...',
    'NUMÉROTATION 3615...',
    'PORTEUSE DÉTECTÉE — 1200/75 BAUDS',
    '>CONNECT',
    '',
    'ACCÈS AUTORISÉ.',
    ''
  ];
  typeLines(el, lines, () => render());
}
function typeLines(el, lines, cb){
  let i = 0;
  const next = () => {
    if(i >= lines.length){ cb && cb(); return; }
    const div = document.createElement('div'); el.appendChild(div);
    typewriter(div, lines[i], () => { i++; setTimeout(next, 90); }, 9);
  };
  next();
}

// ---- Machine à écrire ----
function typewriter(el, text, cb, speed){
  speed = speed || 12;
  let i = 0; el.textContent = '';
  _type = { el, full: text, cb };
  if(text && text.length) typeSfxOn();
  const step = () => {
    if(!_type || _type.el !== el){ return; }
    el.textContent = text.slice(0, i);
    if(i++ <= text.length){ _type.timer = setTimeout(step, speed); }
    else { _type = null; typeSfxOff(); cb && cb(); }
  };
  step();
}
function skipType(){
  if(!_type) return;
  clearTimeout(_type.timer);
  const { el, full, cb } = _type; _type = null;
  typeSfxOff(true);
  el.textContent = full; cb && cb();
}

// ---- Rendu d'un nœud (drill-down) ----
function render(){
  const out = document.getElementById('term-out');
  const node = pathStack[pathStack.length - 1] || null;
  _children = node ? (node.children || []) : (term.nodes || []);
  const body = node ? node.body : '';
  const titre = node ? (node.label || '') : (term.titre || '');

  out.innerHTML =
    '<div class="t-head"><div class="t-h1">' + esc(term.header || 'BULL TÉLÉMATIQUE (MC) — SERVICE TÉLÉTEL') + '</div></div>'
    + (titre ? '<div class="t-title">' + esc(titre) + '</div>' : '')
    + '<div class="t-body" id="t-body"></div>'
    + '<div class="t-menu" id="t-menu"></div>';

  const menuEl = document.getElementById('t-menu');
  const showMenu = () => {
    let h = _children.map((c, i) => {
      const lock = c.locked && !_hacked[c.id];
      return '<button class="t-entry' + (lock ? ' locked' : '') + '" onclick="' + (lock ? 'hackNode' : 'enter') + '(' + i + ')">' + (lock ? '🔒 ' : '') + esc(c.label || '(sans titre)') + '</button>';
    }).join('');
    h += pathStack.length
      ? '<button class="t-entry t-back" onclick="back()">[ RETOUR ]</button>'
      : '<button class="t-entry t-back" onclick="back()">[ DÉCONNEXION ]</button>';
    h += '<span class="t-cursor"></span>';
    menuEl.innerHTML = h;
    scrollBottom();
  };
  if(body) typewriter(document.getElementById('t-body'), body, showMenu);
  else showMenu();
}

function enter(i){
  if(_type){ skipType(); return; }
  const node = _children[i]; if(!node) return;
  beep();
  pathStack.push(node);
  render();
}
function back(){
  beep();
  if(pathStack.length){ pathStack.pop(); render(); }
  else { boot(); }   // déconnexion → reboot
}
function scrollBottom(){ const c = document.getElementById('term-crt'); if(c) c.scrollTop = c.scrollHeight; }

// ---- HACKING (nœuds verrouillés : jet de Sciences + animation) ----
function hackNode(i){
  if(_type){ skipType(); return; }
  const node = _children[i]; if(!node) return;
  beep();
  if(_hacked[node.id]){ pathStack.push(node); render(); return; }   // déjà déverrouillé
  _hackNode = node;
  renderHackScreen();
}
function renderHackScreen(){
  const node = _hackNode; const diff = parseInt(node.locked) || 1;
  const out = document.getElementById('term-out');
  let h = '<div class="t-head"><div class="t-h1">' + esc(term.header || 'BULL TÉLÉMATIQUE (MC) — SERVICE TÉLÉTEL') + '</div></div>';
  h += '<div class="t-title">⚠ ACCÈS SÉCURISÉ</div>';
  h += '<div class="t-body" id="t-hack-body">VERROUILLAGE — NIVEAU ' + diff + '\n' + esc(node.label || '') + '</div>';
  h += '<div class="t-menu" id="t-hack-menu"></div>';
  out.innerHTML = h;
  const menu = document.getElementById('t-hack-menu');
  let m = '';
  if(_lockout[node.id]) m += '<div class="t-err">TERMINAL VERROUILLÉ — RÉINITIALISEZ L\'ALIMENTATION.</div>';
  else if(!sciTN) m += '<div class="t-err">ANALYSE IMPOSSIBLE — ACCÈS SCIENCES REQUIS.</div>';
  else m += '<button class="t-entry" onclick="doHack()">&gt; LANCER L\'ANALYSE DE SÉCURITÉ</button>';
  m += '<button class="t-entry t-back" onclick="render()">[ RETOUR ]</button><span class="t-cursor"></span>';
  menu.innerHTML = m;
  scrollBottom();
}
function _hex(n){ let s = ''; for(let i = 0; i < n; i++) s += '0123456789ABCDEF'[Math.floor(Math.random()*16)]; return s; }
function doHack(){
  const node = _hackNode; const diff = parseInt(node.locked) || 1;
  const menu = document.getElementById('t-hack-menu'); const body = document.getElementById('t-hack-body');
  if(menu) menu.innerHTML = '';
  const lines = []; for(let i = 0; i < 6; i++) lines.push('ANALYSE ' + _hex(2) + ' ' + _hex(4) + ' ' + _hex(6) + ' …');
  const anim = document.createElement('div'); anim.className = 't-body'; body.parentNode.insertBefore(anim, menu);
  typeLines(anim, lines, () => {
    const d = [Math.floor(Math.random()*20)+1, Math.floor(Math.random()*20)+1];
    const succ = d.filter(v => v <= sciTN).length + d.filter(v => v === 1).length;
    const ok = succ >= diff;
    const res = document.createElement('div'); res.className = 't-body' + (ok ? '' : ' t-err');
    res.textContent = 'DÉS : ' + d.join(' / ') + ' (TN ' + sciTN + ') → ' + succ + ' succès / ' + diff + ' requis\n'
      + (ok ? '>> ACCÈS AUTORISÉ <<' : '>> ACCÈS REFUSÉ — VERROUILLAGE <<');
    body.parentNode.insertBefore(res, menu); scrollBottom();
    if(ok){
      _hacked[node.id] = true; sfx('start_terminal_sfx.mp3', 0.4);
      setTimeout(() => { pathStack.push(node); render(); }, 1000);
    } else {
      _lockout[node.id] = true; sfx('end_terminal_sfx.mp3', 0.4);
      menu.innerHTML = '<button class="t-entry t-back" onclick="render()">[ RETOUR ]</button><span class="t-cursor"></span>';
    }
  });
}
