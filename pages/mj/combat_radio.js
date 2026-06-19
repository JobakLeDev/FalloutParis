// ============================================================
// COMBAT RADIO — joue la station "combat" en aléatoire sur l'écran de combat
//   Pistes : /radio/combat/*.mp3 (manifeste radio/combat/tracks.json)
//   Lecture en boucle mélangée ; autoplay tenté, repris au 1er geste si bloqué.
//   Bouton flottant 🎵 (mute/repren.) en bas à gauche. Vol/mute mémorisés.
// ============================================================
(function(){
  const MANIFEST = '../../radio/combat/tracks.json';
  const BASE     = '../../radio/combat/';
  let tracks = [], queue = [], audio = null;
  let muted = (localStorage.getItem('fp_combatMusic') === 'off');
  let vol   = Math.min(1, Math.max(0, parseFloat(localStorage.getItem('fp_combatMusicVol') || '0.4')));

  function shuffle(a){ a = a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

  function nextTrack(){
    if(!tracks.length || !audio) return;
    if(!queue.length) queue = shuffle(tracks);
    const t = queue.shift();
    audio.src = BASE + t.split('/').map(encodeURIComponent).join('/');
    if(!muted) audio.play().catch(()=>{});
    _setLabel(t.replace(/\.mp3$/i,''));
  }
  function ensureAudio(){
    if(audio) return;
    audio = new Audio();
    audio.volume = muted ? 0 : vol;
    audio.addEventListener('ended', nextTrack);
    audio.addEventListener('error', () => setTimeout(nextTrack, 400));
  }
  function tryPlay(){ if(audio && !muted) audio.play().catch(()=>{}); }

  // --- UI flottante ---
  let btn, lbl;
  function buildUI(){
    const wrap = document.createElement('div');
    wrap.id = 'combat-radio';
    wrap.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:998;display:flex;align-items:center;gap:6px;'
      + 'background:#0c150c;border:1px solid var(--b2,#3a5c3a);padding:4px 8px;font-family:"Share Tech Mono",monospace;max-width:46vw';
    btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;color:var(--am,#e8a820);font-size:15px;cursor:pointer;line-height:1';
    btn.title = 'Musique de combat (aléatoire)';
    btn.onclick = toggleMute;
    lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:8px;color:var(--td,#4a7a4a);letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw';
    const slider = document.createElement('input');
    slider.type='range'; slider.min='0'; slider.max='100'; slider.value=String(Math.round(vol*100));
    slider.style.cssText='width:60px;accent-color:var(--g,#5dbe5d)';
    slider.oninput = () => { vol = slider.value/100; localStorage.setItem('fp_combatMusicVol', vol); if(!muted && audio) audio.volume = vol; };
    wrap.appendChild(btn); wrap.appendChild(slider); wrap.appendChild(lbl);
    document.body.appendChild(wrap);
    _refreshBtn();
  }
  function _refreshBtn(){ if(btn) btn.textContent = muted ? '🔇' : '🎵'; }
  function _setLabel(t){ if(lbl) lbl.textContent = muted ? '— musique coupée' : '♪ ' + t; }
  function toggleMute(){
    muted = !muted;
    localStorage.setItem('fp_combatMusic', muted ? 'off' : 'on');
    _refreshBtn();
    if(muted){ if(audio){ audio.pause(); } _setLabel(''); }
    else { ensureAudio(); if(audio.volume!==undefined) audio.volume = vol; if(!audio.src) nextTrack(); else tryPlay(); }
  }

  function init(){
    fetch(MANIFEST).then(r=>r.json()).then(list=>{
      tracks = Array.isArray(list) ? list : (list.tracks || []);
      if(!tracks.length) return;
      buildUI();
      ensureAudio();
      if(!muted) nextTrack();                 // tente l'autoplay
      // Reprise au 1er geste si l'autoplay est bloqué par le navigateur
      const onGesture = () => { tryPlay(); window.removeEventListener('pointerdown', onGesture); window.removeEventListener('keydown', onGesture); };
      window.addEventListener('pointerdown', onGesture);
      window.addEventListener('keydown', onGesture);
    }).catch(()=>{});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
