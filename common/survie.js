// ============================================================
// SURVIE — Faim / Soif / Sommeil + Fatigue (RAW Fallout 2D20, ch.5 p.190-192)
// Tout est calculé depuis l'horloge de campagne (minutes) : on stocke la
// minute du dernier repas/boisson/sommeil ; l'état se dégrade avec le temps.
//   char.survie = { eat, drink, sleep, wellRested? , adj? }   (minutes de campagne)
// ============================================================
(function(global){
  const H = 60; // minutes par heure

  // FAIM : Full(1h) Sated(4h) Peckish(8h) Hungry(16h) Starving
  const FAIM = {
    labels: ['Rassasié','Sustenté','Petite faim','Affamé','Famélique'],
    bounds: [1*H, (1+4)*H, (1+4+8)*H, (1+4+8+16)*H],      // 60,300,780,1740
    startMal: (1+4+8+16)*H,                                // famélique = 1740 min
    perDay: 24*H,                                          // +1 Fatigue / jour famélique
  };
  // SOIF : Quenched(1h) Hydrated(2h) Thirsty(4h) Dehydrated
  const SOIF = {
    labels: ['Désaltéré','Hydraté','Assoiffé','Déshydraté'],
    bounds: [1*H, (1+2)*H, (1+2+4)*H],                     // 60,180,420
    startMal: (1+2+4)*H,                                   // déshydraté = 420 min
    per: 8*H,                                              // +1 Fatigue / 8h déshydraté
  };
  // SOMMEIL : Rested(8h) Tired(8h) Weary(8h) Exhausted
  const SOMMEIL = {
    labels: ['Reposé','Fatigué','Épuisé','Exténué'],
    bounds: [8*H, 16*H, 24*H],                             // 480,960,1440
    startWeary: 16*H, startExh: 24*H,
    perExh: 4*H,                                           // +1 Fatigue / 4h exténué
  };

  function _idx(elapsed, bounds){ let i=0; while(i<bounds.length && elapsed>=bounds[i]) i++; return i; }

  function compute(survie, nowMin){
    survie = survie || {};
    const since = k => Math.max(0, nowMin - (survie[k] != null ? survie[k] : nowMin));
    const eEat = since('eat'), eDrink = since('drink'), eSleep = since('sleep');

    const faimIdx = _idx(eEat, FAIM.bounds);       // 0..4
    const soifIdx = _idx(eDrink, SOIF.bounds);     // 0..3
    const somIdx  = _idx(eSleep, SOMMEIL.bounds);  // 0..3

    // Fatigue par source
    let fFaim = eEat >= FAIM.startMal ? 1 + Math.floor((eEat - FAIM.startMal) / FAIM.perDay) : 0;
    let fSoif = eDrink >= SOIF.startMal ? 1 + Math.floor((eDrink - SOIF.startMal) / SOIF.per) : 0;
    let fSom  = eSleep >= SOMMEIL.startExh ? 2 + Math.floor((eSleep - SOMMEIL.startExh) / SOMMEIL.perExh)
              : (eSleep >= SOMMEIL.startWeary ? 1 : 0);
    const adj = Math.max(0, parseInt(survie.adj) || 0);
    const fatigue = fFaim + fSoif + fSom + adj;

    return {
      faim:    { idx: faimIdx, label: FAIM.labels[faimIdx],     danger: faimIdx >= 4, fatigue: fFaim },
      soif:    { idx: soifIdx, label: SOIF.labels[soifIdx],     danger: soifIdx >= 3, fatigue: fSoif },
      sommeil: { idx: somIdx,  label: SOMMEIL.labels[somIdx],   danger: somIdx >= 3, fatigue: fSom },
      adj,
      fatigue,
      hpLoss: Math.floor(fatigue / 2),   // PV perdus en début de scène (1 PV / 2 Fatigue)
      apMalus: fatigue,                  // AP gagnés réduits de 'fatigue'
      maxIdx: { faim:4, soif:3, sommeil:3 }
    };
  }

  global.SURVIE = { compute, FAIM, SOIF, SOMMEIL };
})(window);
