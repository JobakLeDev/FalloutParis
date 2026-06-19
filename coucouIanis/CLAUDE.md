# Fallout Paris — JDR 2D20

App web pour jouer à Fallout 2D20 en ligne. MJ + joueurs connectés en temps réel via Firebase.

---

## ⚠️ Règle Claude — à lire en premier

**Mettre à jour `CLAUDE.md` à chaque modification significative du code** : structure de fichiers, nouvelles fonctions clés, changement du schéma Firebase, nouvelles règles importantes, fonctionnalités implémentées.
⚠️ `CLAUDE.md` est **gitignoré** (non suivi par git) — c'est un doc local. Ne pas compter sur git pour le sauvegarder ; ne pas faire de gymnastique de branches qui pourrait l'effacer du dossier.

---

## Stack

- **HTML/CSS/JS vanilla** — pas de framework
- **Firebase Firestore** (compat v9) pour la persistance et le temps réel
- **GitHub Pages** pour l'hébergement (`dev` branch, pas `main`)
- **Repo** : `JobakLeDev/FalloutParis`
- **URL prod** : `https://jobakledev.github.io/FalloutParis/`

---

## Branches

| Branche | Rôle |
|---------|------|
| `locale` | branche de travail active |
| `dev` | branche servie par GitHub Pages (prod) |
| `main` | backup / référence |

Workflow : travailler sur `locale` → merger sur `dev` pour aller en prod.
Déploiement type : commit sur `locale` → `git checkout dev && git merge locale && git push origin dev && git checkout locale`. Bumper le `?v=N` des fichiers modifiés (cache-busting).

---

## Structure des fichiers (principaux)

```
data/                  → données statiques JSON (chargées par common/db.js → window.DB)
  weapons.json armor.json ammo.json ammo_loot.json npc_xp.json
  zones.json zone_variations.json zone_occupation.json zone_threat.json
  factions.json npc_roles.json items.json enemies.json perks.json
  loot_profiles.json weapon_mods.json armor_mods.json npc.json
  encyclopedie.json    → {lieux[],personnages[],bestiaire[],evenements[]} (contenu de Notion) — voir Encyclopédie
  terminals.json       → {terminals:{<id>:{titre,header,nodes[]}}} — arborescences terminaux (node:{id,label,body?,children?,locked?})
common/
  shared.js            → firebaseConfig + XP_TABLE + SKILLS_DEF + fpLogAction + fpHealthStatus + fpApply*Mods + fpParseConsumable + fpEffSum (sync, 1er chargé)
  db.js                → charge /data/*.json → window.DB + window.DB_READY (+ window.ENCY)
  style.css zoom.css responsive.js
  firebase.js          → sync Firebase + alertes joueur (combat, butin, boutique, terminal, crochetage, prop, lancer public)
  survie.js            → faim/soif/sommeil (SURVIE.compute)
pages/
  accueil/ creation_perso/ setup_perso/ fiche_perso/ admin_perso/
  carte/               → carte Leaflet + fog of war + métro (carte.html/js/css)
  quetes/ journal/     → MJ crée/révèle, joueur lit le révélé (revealedFor) ; iframe dans la fiche
  encyclopedie/        → Lieux/Personnages/Bestiaire/Timeline (encyclopedie.html/js/css) — voir Encyclopédie
  terminal/            → terminal Bull/Minitel (terminal.html/js/css) — voir Terminal
  mj/
    mj_shared.js       → SK_ATTR, FACES_CD, getHpMax, rollDice, getTN, enemyInstanceFromDB, getNpcXP, helpers grille combat, fpEnemyTokenHtml, fpFireTracer, fpFlashToken
    zones.js           → moteur rencontres pondérées
    mj.html/js/css     → tableau de bord MJ (code: 1234)
    combat.html/js/css combat_sync.js combat_joueur.html/js/css → écrans de combat
```

### Ordre de chargement
- Toutes : `shared.js` → `db.js` → scripts spécifiques. Les `init()` attendent `window.DB_READY`.
- `firebase.js` uniquement sur `fiche_perso.html` et `accueil.html`.
- `combat.html` : shared → db → mj_shared → combat_sync → combat.js.
- `combat_joueur.html` : shared → db → survie → mj_shared → combat_joueur.js.

---

## Données statiques (window.DB après DB_READY)

```js
DB.weapons[] {n,t,a,dmg,eff,dt,fr,rng,w,sk} · DB.armor[] {n,t,ph,en,rad,z,w}
DB.food/drinks/drugs/stuff/ammo
window.PERKS_DEF window.ENNEMIS_DB window.WEAPONS_DB window.NPC_DB window.AMMO_LOOT
window.NPC_XP window.ZONES_DB window.ZONE_* window.FACTIONS window.NPC_ROLES
window.LOOT_PROFILES window.WEAPON_MODS window.ARMOR_MODS
window.ENCY          // encyclopédie statique {lieux[],personnages[],bestiaire[],evenements[]}
```

### common/shared.js (synchrone)
```js
firebaseConfig · XP_TABLE[] · SKILLS_DEF[] (17 comp. dont lockpick=Crochetage/PER, science=Sciences/INT)
fpLogAction(db,who,text)                  // journal MJ /log/data
fpHealthStatus(pct) → {sev,label}         // état santé GRADUEL : OK ≥60% · BLESSÉ 35-59 · GRAVEMENT BLESSÉ 15-34 · CRITIQUE <15
fpApplyWeaponMods / fpApplyArmorMods      // arme/armure effective (base + item.mods{slot:id})
fpParseConsumable(def) / fpEffSum(list,key)   // effets actifs (buffs conso)
```
Effet conso : un MÊME aliment/chem ne **cumule pas** son buff (refresh par `src`) ; seuls les PV gagnés s'appliquent à chaque prise. Retirer un buff de PV max **clampe** les PV au nouveau max (rmEffect/purgeEffects + firebase appliquerDonnees).

### pages/mj/mj_shared.js (helpers clés)
```js
getHpMax(d) · getTN(d,skKey) · enemyInstanceFromDB(nom,lvl) · getNpcXP(level,cat) · generateCombatLoot(enemies)
// Grille de combat : gridChebyshev/gridManhattan, gridBand (1/6/11), reachableCells (BFS murs/portes fermées),
//   gridEdgeBetween, gridEdgeBlocks (mur/fenêtre/porte fermée bloquent le passage),
//   gridEdgeBlocksSight (mur + porte fermée bloquent la VUE ; la FENÊTRE laisse voir/viser),
//   gridLineOfSight, gridEdgesHtml (segments joints + angles L arrondis + portes ouvertes pivotées),
//   gridDoorHotspots / gridAllDoorHotspots
// Jetons battlemap : fpEnemyTokenHtml(nom,opts) → image détourée /img/tokens/<clé>.png (mappée par mots-clés ENEMY_IMG_RULES) sinon ☠ ;
//   fpFireTracer(sel,grid,cs,fromTok,toTok,miss) → traceur d'attaque ; fpFlashToken(...) → clignotement NES de la cible
```

---

## PV max & calculs

```js
hpMax = LCK + END + (niveau-1) + (Life Giver × END) + (wellRested?2) + effSum('hpMax')
// RD localisée (RAW p.123 : RD la plus élevée par type, pas la somme) — getLocRD(zone)
TN = attribut + rang + (TAG?2) + (persoBonus?2)
chargeMax = (150 + FOR×10)/2.2046 × (powerArmor?1.5:1) + (powerArmor?200:0)
```

---

## Système de combat (résumé)

- **Initiative** : joueurs PER+AGI ; ennemis body+mind. Tracker en bandeau.
- **Actions** : mineure/majeure gratuites (1/tour) + bonus via PA individuel / AP groupe. Déclaration d'actions (subcollection `combats/{id}/actions/{joueurId}`) validée par le MJ.
- **AP** : `apPool` (groupe, max 6) + `mjApPool` (MJ). Dés bonus 3/4/5D20 = −1/3/6 AP.
- **Distance/portée** : bandes (Contact/Moyenne/Longue/Extrême), pénalité = |dist − portée idéale|. Move/Sprint.
- **Battlemap** : grille **21×12**, `combatDoc.grid = {w,h,terrain,edges,pos,rot}`. Quadrillage masqué visuellement. Move=5/Sprint=9 cases (Manhattan). Murs/portes/fenêtres en arêtes. Mode déplacement joueur : pas de quadrillage, bords de zone + points d'accroche. Halo ambre sur le jeton du tour. Mon jeton = anneau rond. Ennemis = image détourée + halo rouge diffus.
- **Portes** : fermée bloque passage + vue ; le joueur déclare une action mineure (clic porte adjacente à son tour) → le MJ valide pour ouvrir ; le MJ ouvre directement (pastilles 🚪). Portes accolées : gonds opposés, ouverture symétrique.
- **Effets visuels (fxAttack)** : à la résolution d'une attaque → traceur attaquant→cible (ambre touché / gris raté) + clignotement NES de la cible, sur les 2 écrans. Ligne de visée pointillés→plein pendant le jet joueur. `lastFxTs`/`lastStrangerTs`/`lastAttackResultTs` amorcés au 1er snapshot (pas de rejeu/son au rechargement).
- **Bloc de jets MJ** : sélection joueur+arme → cible (ennemi) optionnelle → dégâts auto au CD (comme compagnon). Contexte en colonne (pas de chevauchement).
- **Aim / Miss Fortune** : sur échec, relance des d20 ; une relance réussie débloque les dégâts (recalcul vs `lastRollDiff`).
- **Cartes MJ repliables** (joueurs/alliés/ennemis) ; menu latéral au clic d'un jeton (masquer/démasquer, rotation 90°, désélectionner) ; indicateur 📍 sur la carte du combattant.
- **Popup « Mes jets »** (joueur) ancré sur le bloc d'actions (carte visible) + bouton OK pour fermer.
- **Compagnons** : `joueurs/{id}.companions[]` (schéma enemies.json) ; agissent avec leur PC.

### Perk Étranger Mystérieux
À son tour, **une fois par combat**, le joueur (perk `Mysterious Stranger`, LCK≥7) dépense 1 Chance → bouton dans ses actions. Le MJ tire (~25 %, d20≤5) ; s'il apparaît, le MJ choisit la cible → **8 DC** (− RD) ; clignotement + son `mysterious_stranger_sfx.mp3`. (combat.js handleStrangerReq/strangerHit, combat_joueur.js callStrangerJ, doc `/combats/{id}.strangerReq` + `strangerUsed`.)

---

## Firebase (collections Firestore)

- `/joueurs/{id}` · `/combats/{combatId}` + `/combats/current` · `/carte/data` · `/quetes/data` · `/journal/data` · `/temps/data` (horloge campagne {minutes}) · `/rolls/current` (lancer public) · `/messagerie/data` + `/messages/{convId}` · `/butin/data` · `/boutiques/data` · `/log/data` · `/radio/current`
- `/encyclopedie/data` — état de découverte `{reveal:{[entryId]:[ids]}, lieuxPoi:{[poiName]:[ids]}}` (le contenu est statique dans `data/encyclopedie.json`).
- `/terminaux/data` — `{open:{[joueurId]:termId}}` : terminaux déclenchés par le MJ vers des joueurs.
- `/crochetage/data` — `{[joueurId]:{diff,label,ts,status:'open'|'done',success?,broke?,dice?}}` : demandes de crochetage MJ → joueurs.
- `/saves/{id}` — sauvegardes de l'état du jeu (MJ). Doc `{ts,label,data:{joueurs:{id:fiche},docs:{quetes,journal,carte,temps,encyclopedie}}}`. Panneau « 💾 Sauvegardes » (mj.js : `creerSauvegarde`/`restaurerSauvegarde`/`supprimerSauvegarde`/`exporterSauvegardeFichier`/`importerSauvegardeFichier`, `SAVE_DOCS`). La restauration réécrit ces docs (n'efface pas les persos créés après). Export/import fichier JSON pour les états >1 Mo (limite doc Firestore).

**API compat v9 :** `snap.exists` (sans parenthèses).
**firestore.rules** : chaque collection `allow read,write:if true`. ⚠️ À **republier dans la console Firebase** après ajout d'une collection (sinon catch-all `if false` refuse). Collections ajoutées récemment : `/encyclopedie`, `/terminaux`, `/crochetage`, `/saves`.

---

## Carte interactive (pages/carte/)
Leaflet `CRS.Simple` sur `img/paris fallout.jpg`. Couche système `/carte/data` (POI, zones, jetons, fog). Perspectives MJ (1234) / joueur (`?id`) / `?embed=1`. Révélation **par joueur** (`revealedFor`). Onglets PARIS / MÉTRO / LIEUX. Fog of war par joueur, fusion de groupe, métro (lignes débloquées par exploration). Hooks auto journal (`logLieu`/`logQuete`). `logLieu` → `revealEncyLieu(poiName,pid)` débloque aussi le Lieu d'encyclopédie lié (`lieuxPoi`).

---

## Encyclopédie (pages/encyclopedie/)
Contenu **statique** `data/encyclopedie.json` (`window.ENCY`, exporté de Notion) ; découverte **dynamique** `/encyclopedie/data`. MJ (1234) voit tout + révèle par joueur ; joueur (`?id`) ne voit que le découvert. Onglet ENCYCLO. dans la fiche (iframe) + lien dans l'en-tête MJ.
- **Lieux** auto-débloqués via la carte (POI `revealedFor` → `lieuxPoi`, match `entry.poi === <nom POI>`). Reste révélé manuellement par le MJ.
- **Bestiaire** : `{ref:<clé enemies.json>}` → stats lues dans `ENNEMIS_DB` + texte lore.
- **Timeline** : `evenements[]` triés par `ordre` puis `date`.
- Schéma : lieu `{id,titre,img?,poi?,corps,liens?[]}` · perso `{id,titre,img?,faction?,lieu?,corps}` · bestiaire `{id,ref,img?,corps}` · événement `{id,titre,date,ordre,img?,corps}`. `ensureIds()` génère des ids stables si absents.

---

## Terminal (pages/terminal/) — Bull Télématique / Minitel 5000
Page autonome. Contenu `data/terminals.json` (`?t=<id>` choisit le terminal). Boîtier **CRT en CSS** (écran bombé, scanlines, vignette) sur fond assombri, **bouton POWER** ambre (on=boot, off=ferme ; sons `start_terminal_sfx`/`end_terminal_sfx`). Boot Bull/Minitel (3615, D.G.T., 1200/75 bauds, easter egg taurine) + **machine à écrire** (son `type_txt_sfx` en boucle) + **drill-down** (écran remplacé + [ RETOUR ]). En-tête centré.
- **Hack** : un node `locked:<diff 1-4>` → 🔒 → jet de **Sciences** (2D20 vs diff, TN passé par la fiche `?sci=`) + anim de décryptage. Réussite déverrouille, échec = **verrouillage** (reset à l'extinction).
- **Déclenchement MJ** : panneau « 💻 Terminal » (mj.js declencherTerminal/fermerTerminaux) → `/terminaux/data`. Côté joueur : bandeau + modale iframe (firebase.js openTerminal, passe `?id&sci`).

## Crochetage (serrures)
Le MJ déclenche (panneau « 🔓 Crochetage » : serrure + difficulté D1-D4) aux joueurs sélectionnés → `/crochetage/data` ; **Annuler** (efface la demande). Côté joueur : bandeau + modale avec **serrure animée** (firebase.js openCroch/crocheter) → jet de **Crochetage (PER)** 2D20 vs diff. **Consomme une « Bobby Pin »** par tentative sauf si kit (« Lock Pick Set »/« Electronic Lockpicker ») ; bloqué si ni épingle ni kit. Complication (20) → épingle cassée. Bouton **OK** pour valider (le résultat reste affiché). Résultat journalisé pour le MJ.

---

## État santé (badge fiche + tableau MJ)
`fpHealthStatus(pct)` (shared.js) — graduel : **OK** ≥60 % · **BLESSÉ** 35-59 · **GRAVEMENT BLESSÉ** 15-34 · **CRITIQUE** <15. Utilisé par fiche_perso (badge `bdg`) et mj.js (badge `jc-badge`, classes ok/blesse/grave/critique).

---

## Variables CSS (common/style.css)
`--g` vert · `--gd`/`--gk` verts foncés · `--bg`/`--p`/`--p2` fonds · `--b`/`--b2` bordures · `--t`/`--td`/`--tb` textes · `--am` ambre · `--rd`/`--rdk` rouge · `--scan` scanline.

## Personnages de test
`gogo`, `zinzin`, `mongolo`, `kuma`.
