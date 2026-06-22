// ============================================================
// PNJ — roster narratif par campagne (/pnj/<campId> = {list:[...]})
// MJ : créer / éditer / supprimer / importer. Champs SPECIAL/skills/perks optionnels.
// Assignables aux postes de settlement (voir settlement.js renderEco).
// ============================================================
let fdb, camp = 'data', list = [], sel = -1;
const _SPK = ['S','P','E','C','I','A','L'];

function campId(){ return (typeof fpCampId === 'function') ? fpCampId() : 'data'; }
function esc(s){ return (''+ (s==null?'':s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function uid(){ return 'pnj_' + Date.now().toString(36) + Math.floor(Math.random()*999); }

document.addEventListener('DOMContentLoaded', () => {
  fdb = firebase.initializeApp(firebaseConfig).firestore();
  camp = campId();
  document.getElementById('pnj-camp').textContent = (camp === 'data') ? 'Campagne 1' : camp;
  if(sessionStorage.getItem('mj_auth') === '1') unlock();
});
function tryUnlock(){
  if(document.getElementById('lk-inp').value === '1234'){ sessionStorage.setItem('mj_auth','1'); unlock(); }
  else document.getElementById('lk-err').style.display = 'block';
}
function unlock(){ document.getElementById('lock').style.display='none'; document.getElementById('app').style.display='block'; listen(); }
function listen(){
  fdb.collection('pnj').doc(camp).onSnapshot(s => {
    const d = s.exists ? s.data() : {};
    list = Array.isArray(d.list) ? d.list : [];
    if(sel >= list.length) sel = -1;
    render();
  }, e => console.warn('pnj:', e && e.code));
}
function save(){ fdb.collection('pnj').doc(camp).set({ list }).catch(e => alert('Erreur : ' + e.message)); }

function addBlank(){ list.push({ id: uid(), nom: 'Nouveau PNJ', faction: '', role: '', notes: '' }); sel = list.length - 1; save(); render(); }
async function delPnj(i){ if(!await fpConfirm('Supprimer ce PNJ ?')) return; list.splice(i,1); if(sel===i) sel=-1; else if(sel>i) sel--; save(); render(); }
function pick(i){ sel = i; render(); }
function setF(i, k, v){ if(!list[i]) return; list[i][k] = v; save(); }
function setSp(i, k, v){ if(!list[i]) return; list[i].special = list[i].special || {}; const n = parseInt(v); if(v.trim()==='' || isNaN(n)) delete list[i].special[k]; else list[i].special[k] = n; if(!Object.keys(list[i].special).length) delete list[i].special; save(); }

function render(){
  document.getElementById('pnj-count').textContent = list.length;
  const el = document.getElementById('pnj-list');
  el.innerHTML = list.length ? list.map((p,i) =>
    `<button class="pnj-item${sel===i?' on':''}" onclick="pick(${i})">${esc(p.nom||'?')}<small>${esc(p.role||'')}${p.faction?' · '+esc(p.faction):''}</small></button>`
  ).join('') : '<span class="empty">Aucun PNJ. Crée-en un ou importe du JSON.</span>';

  const ed = document.getElementById('pnj-edit'), emp = document.getElementById('pnj-empty');
  const p = (sel>=0) ? list[sel] : null;
  emp.style.display = p ? 'none' : 'block';
  ed.style.display = p ? 'block' : 'none';
  if(!p) return;
  const sp = p.special || {};
  ed.innerHTML = `
    <div class="pnj-edit-head">
      <input class="pnj-inp" style="font-size:14px;flex:1" value="${esc(p.nom||'')}" onchange="setF(${sel},'nom',this.value)" placeholder="Nom">
      <button class="pbtn danger" onclick="delPnj(${sel})">✕ Supprimer</button>
    </div>
    <div class="pnj-row">
      <label>Faction</label><input class="pnj-inp" value="${esc(p.faction||'')}" onchange="setF(${sel},'faction',this.value)" placeholder="Ex: La Commune">
      <label>Rôle</label><input class="pnj-inp" value="${esc(p.role||'')}" onchange="setF(${sel},'role',this.value)" placeholder="Ex: Marchand, Garde…">
    </div>
    <div class="pnj-row col">
      <label>Notes (narratif)</label>
      <textarea class="pnj-inp pnj-notes" onchange="setF(${sel},'notes',this.value)" placeholder="Description, accroche, infos MJ…">${esc(p.notes||'')}</textarea>
    </div>
    <div class="pnj-sub">SPECIAL <small>(optionnel — laisser vide pour un PNJ purement narratif)</small></div>
    <div class="pnj-sp">${_SPK.map(k => `<span class="pnj-spc">${k}<input class="pnj-inp" type="number" value="${sp[k]??''}" onchange="setSp(${sel},'${k}',this.value)"></span>`).join('')}</div>
    <div class="pnj-note">Assignable aux postes d'un settlement (vendeur, médecin…) via la page Refuges.</div>`;
}

// Importer : accepte un tableau ou {list|npcs|pnj|personnages:[...]} ; normalise (id, nom, special full-word→S/P/E…)
function _spMap(o){
  if(!o || typeof o !== 'object') return undefined;
  const m = { strength:'S', perception:'P', endurance:'E', charisma:'C', intelligence:'I', agility:'A', luck:'L' };
  const out = {};
  Object.entries(o).forEach(([k,v]) => { const kk = m[k.toLowerCase()] || (_SPK.includes(k.toUpperCase()) ? k.toUpperCase() : null); const n = parseInt(v); if(kk && !isNaN(n)) out[kk] = n; });
  return Object.keys(out).length ? out : undefined;
}
function importJSON(){
  const raw = document.getElementById('pnj-import').value.trim();
  const msg = document.getElementById('pnj-imp-msg');
  if(!raw){ msg.textContent = 'Colle d\'abord du JSON.'; return; }
  let data; try { data = JSON.parse(raw); } catch(e){ msg.textContent = '❌ JSON invalide : ' + e.message; return; }
  const arr = Array.isArray(data) ? data : (data.list || data.npcs || data.pnj || data.personnages || data.companions || []);
  if(!Array.isArray(arr) || !arr.length){ msg.textContent = '❌ Aucune liste de PNJ trouvée (attendu : tableau ou {list:[…]}).'; return; }
  let n = 0;
  arr.forEach(o => {
    if(!o || typeof o !== 'object') return;
    const nom = o.nom || o.name; if(!nom) return;
    const pnj = { id: o.id ? (''+o.id) : uid(), nom, faction: o.faction || '', role: o.role || o.metier || '', notes: o.notes || o.description || o.desc || '' };
    const sp = _spMap(o.special); if(sp) pnj.special = sp;
    if(o.skills) pnj.skills = o.skills;
    if(o.perks)  pnj.perks  = o.perks;
    list.push(pnj); n++;
  });
  if(!n){ msg.textContent = '❌ Aucune entrée valide (il faut au moins un "nom").'; return; }
  document.getElementById('pnj-import').value = '';
  msg.textContent = '✓ ' + n + ' PNJ importé(s).';
  save(); render();
}
