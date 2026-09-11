// ============================================================
// NETWAKE — survie des listeners Firestore au réveil du téléphone.
//
// Problème : quand l'écran se verrouille (ou que l'app passe en arrière-plan),
// iOS/Android peuvent tuer la socket du SDK sans que celui-ci s'en aperçoive.
// Au retour, la page reste figée sur les dernières données : en pleine session,
// le joueur croit son écran à jour alors qu'il ne reçoit plus rien.
//
// Remède : au retour au premier plan (ou au retour du réseau), on force un
// cycle disableNetwork() → enableNetwork(). Le SDK rétablit ses listeners et
// rejoue les changements manqués ; les écritures en attente repartent.
//
// Usage : fpNetWake(db)  — après l'init Firestore. Idempotent.
// Expose window.FP_NET = {state:'online'|'reconnect'|'offline'} et émet
// l'évènement 'fp-net' sur window à chaque changement d'état.
// ============================================================
(function (global) {
  let _db = null, _busy = false, _wired = false;
  let _lastOk = Date.now();

  function _setState(s) {
    global.FP_NET = { state: s, since: Date.now() };
    try { global.dispatchEvent(new CustomEvent('fp-net', { detail: s })); } catch (e) {}
    const el = document.getElementById('fp-net-pill');
    if (el) {
      el.className = 'fp-net-pill ' + s;
      el.textContent = s === 'online' ? '' : (s === 'reconnect' ? 'Reconnexion…' : 'Hors ligne');
      el.style.display = s === 'online' ? 'none' : 'flex';
    }
  }

  async function _cycle(reason) {
    if (!_db || _busy) return;
    _busy = true;
    _setState('reconnect');
    try {
      await _db.disableNetwork();
      await _db.enableNetwork();
      _lastOk = Date.now();
      _setState('online');
      console.log('[netwake] listeners relancés (' + reason + ')');
    } catch (e) {
      console.warn('[netwake] échec du cycle réseau :', e && e.code);
      _setState('offline');
    } finally {
      _busy = false;
    }
  }

  function fpNetWake(db) {
    _db = db;
    if (_wired) return;
    _wired = true;
    _setState(navigator.onLine === false ? 'offline' : 'online');

    // Retour au premier plan : on ne relance que si l'absence a duré (sinon on
    // cycle inutilement à chaque bascule d'onglet).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { _lastOk = Date.now(); return; }
      if (Date.now() - _lastOk > 20000) _cycle('retour au premier plan');
      else _setState(navigator.onLine === false ? 'offline' : 'online');
    });
    global.addEventListener('pageshow', e => { if (e.persisted) _cycle('restauration du cache de navigation'); });
    global.addEventListener('online',  () => _cycle('réseau retrouvé'));
    global.addEventListener('offline', () => _setState('offline'));
  }

  global.fpNetWake = fpNetWake;
  global.fpNetReconnect = () => _cycle('demande manuelle');
})(window);
