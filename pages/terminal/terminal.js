// ============================================================
// TERMINAL ROBCO — page autonome. Contenu = data/terminals.json (arborescence).
// ?t=<id> choisit le terminal. Navigation drill-down (l'écran est remplacé + [ RETOUR ]).
// Boot ROBCO + effet machine à écrire + bips. Vert phosphore.
// ============================================================

const _tp = new URLSearchParams(location.search);
let termData = {}, term = null, pathStack = [], _children = [];
let _type = null;   // { timer, el, full, cb }

function esc(s){ return (s == null ? '' : '' + s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function beep(){
  try{ if(localStorage.getItem('fp_sfxMuted') === '1') return;
    const a = new Audio('../../audio/sfx/bouton_sfx.mp3'); a.volume = 0.35; a.play().catch(()=>{}); }catch(e){}
}

function initTerminal(){
  // Skip de la frappe au clic sur l'écran (hors entrées de menu)
  document.getElementById('term-crt').addEventListener('click', e => {
    if(_type && !e.target.closest('.t-entry')) skipType();
  });
  fetch('../../data/terminals.json?v=2').then(r => r.json()).then(d => {
    termData = d.terminals || {};
    const wanted = _tp.get('t');
    term = (wanted && termData[wanted]) || termData[Object.keys(termData)[0]] || null;
    if(!term){ showError('AUCUN TERMINAL CONFIGURÉ'); return; }
    boot();
  }).catch(() => showError('ERREUR DE CHARGEMENT DES DONNÉES'));
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
  const step = () => {
    if(!_type || _type.el !== el){ return; }
    el.textContent = text.slice(0, i);
    if(i % 2 === 0) {} // (cadence)
    if(i++ <= text.length){ _type.timer = setTimeout(step, speed); }
    else { _type = null; cb && cb(); }
  };
  step();
}
function skipType(){
  if(!_type) return;
  clearTimeout(_type.timer);
  const { el, full, cb } = _type; _type = null;
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
    let h = _children.map((c, i) => '<button class="t-entry" onclick="enter(' + i + ')">' + esc(c.label || '(sans titre)') + '</button>').join('');
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
