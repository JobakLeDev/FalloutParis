# Fallout Paris — JDR 2D20

App web pour jouer à Fallout 2D20 en ligne. MJ + joueurs connectés en temps réel via Firebase.

---

## ⚠️ Règle Claude — à lire en premier

**Mettre à jour `CLAUDE.md` à chaque modification significative du code** : structure de fichiers, nouvelles fonctions clés, changement du schéma Firebase, nouvelles règles importantes, fonctionnalités implémentées. Committer CLAUDE.md dans le même commit que les changements.

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

---

## Structure des fichiers

```
FalloutParis/
├── index.html                          → redirect vers accueil
├── CLAUDE.md
├── data/                               → données statiques JSON (source unique)
│   ├── weapons.json                   → 24 armes {n,t,a,dmg,eff,dt,fr,rng,w,sk}
│   ├── armor.json                     → 56 pièces d'armure {n,t,ph,en,rad,z,w}
│   ├── ammo.json                      → types de munitions (array de strings)
│   ├── ammo_loot.json                 → table loot 2D20 munitions [{min,max,ammo,base,cd,mult,scavenger?}]
│   ├── npc_xp.json                    → XP par niveau PNJ {perLevel[{lvl,normal,mighty,legendary}], above20}
│   ├── zones.json                     → zones {key:{label, pool:{ennemi:poids}}} — "none" = pas de rencontre
│   ├── zone_variations.json           → variations {key:{multipliers?, add?}} (irradiated, flooded…)
│   ├── zone_occupation.json           → occupation faction {key:{multipliers?, add?}} (republique, raiders…)
│   ├── zone_threat.json               → niveau menace {key:{multipliers?, add?}} — pilote le poids de "none" (DRAFT)
│   ├── factions.json                  → 6 factions {key:{label,tier,category,color,structure,units[],roles[],valeurs[],traits[],desc}}
│   ├── npc_roles.json                 → templates d'unités {role:{baseId,label,spawnWeight,tags[]}} — baseId = fiche enemies.json réutilisée
│   ├── items.json                     → {food,drinks,drugs,stuff}
│   ├── enemies.json                   → ENNEMIS_DB format officiel (voir schéma ennemis)
│   ├── perks.json                     → 57 perks {max,lvl,req[],desc}
│   └── npc.json                       → PNJ nommés (structure vide à remplir)
├── common/
│   ├── shared.js                      → firebaseConfig + XP_TABLE + SKILLS_DEF (sync, chargé en 1er)
│   ├── db.js                          → charge /data/*.json → window.DB + window.DB_READY
│   ├── style.css                      → variables CSS globales
│   ├── firebase.js                    → sync Firebase + listener combat (fiche joueur uniquement)
│   └── data.js                        → stub vide (conservé pour compatibilité)
└── pages/
    ├── accueil/
    ├── creation_perso/
    ├── setup_perso/                   → config SPECIAL/skills/perks après création
    ├── fiche_perso/                   → fiche joueur (vue joueur)
    ├── admin_perso/                   → éditeur MJ des personnages (code: 1234)
    └── mj/
        ├── mj_shared.js              → fonctions partagées pages MJ (SK_ATTR, FACES_CD, getHpMax, rollDice, getTN, enemyInstanceFromDB, getNpcXP)
        ├── zones.js                  → moteur rencontres pondérées (resolveZonePool, rollEncounter, generateEncounters)
        ├── mj.html / mj.js / mj.css → tableau de bord MJ (code: 1234)
        ├── combat.html / combat.js / combat.css  → écran combat MJ
        ├── combat_sync.js            → sync Firebase état combat
        ├── combat_joueur.html / combat_joueur.js / combat_joueur.css → vue combat joueur
```

### Ordre de chargement des scripts

| Page | Ordre |
|------|-------|
| Toutes | `shared.js` → `db.js` → scripts spécifiques |
| `fiche_perso.html` | `shared.js` → `db.js` → `fiche_perso.js` → `firebase.js` |
| `combat.html` | `shared.js` → `db.js` → `mj_shared.js` → `combat_sync.js` → `combat.js` |
| `combat_joueur.html` | `shared.js` → `db.js` → `mj_shared.js` → `combat_joueur.js` |
| `mj.html` | `shared.js` → `db.js` → `mj_shared.js` → `zones.js` → `mj.js` |
| `admin_perso.html` | `shared.js` → `db.js` → `admin_perso.js` |

**Règles de chargement :**
- `firebase.js` uniquement sur `fiche_perso.html` et `accueil.html` — pas sur les pages MJ
- `db.js` utilise `document.currentScript.src` pour calculer le chemin vers `/data/` — fonctionne local ET GH Pages
- Toutes les fonctions `init()` attendent `window.DB_READY` avant de s'exécuter

---

## Données statiques

Les données sont dans `/data/*.json`, chargées par `common/db.js` au démarrage.

### `window.DB` (après DB_READY)
```javascript
DB.weapons[]   // armes : {n, t, a, dmg, eff, dt, fr, rng, w, sk}
DB.armor[]     // armures : {n, t, ph, en, rad, z, w}
DB.food[]      // nourriture
DB.drinks[]    // boissons
DB.drugs[]     // drogues/médicaments
DB.stuff[]     // objets divers
DB.ammo[]      // types de munitions (array de strings) — calibres dispo
```

### Globals exposés par `db.js`
```javascript
window.DB          // objet ci-dessus
window.DB_READY    // Promise — attendre avant tout init
window.PERKS_DEF   // {nom: {max, lvl, req[], desc}} — 57 perks
window.ENNEMIS_DB  // {nom: fiche officielle} — voir schéma ennemis ci-dessous
window.WEAPONS_DB  // {nom: {t, dmg, eff, fr, rng, sk}} — construit depuis weapons.json
window.NPC_DB      // array PNJ nommés
window.AMMO_LOOT   // table loot munitions 2D20 [{min,max,ammo,base,cd,mult,scavenger?}]
window.NPC_XP      // XP par niveau PNJ {perLevel:[{lvl,normal,mighty,legendary}], above20:{...}}
```

### Table de loot munitions (`AMMO_LOOT`)
Jet **2D20** (somme 2→40). Trouver l'entrée où `min ≤ roll ≤ max`.
Quantité obtenue = `(base + somme de cd dés de combat) × mult`.
Dé de combat pour quantité : faces valent `1,2,0,0,1,1` (mêmes que `FACES_CD`).
- `scavenger:"missile"` → perk Scavenger : +1 Missile par rang seulement
- `scavenger:"none"`    → perk Scavenger : aucun bonus (Fusion Core, Mini-Nuke)
Système de loot à implémenter plus tard — pour l'instant data seule.

### `common/shared.js` (synchrone)
```javascript
firebaseConfig     // config Firebase (source unique)
XP_TABLE[]         // seuils XP par niveau (0→20)
SKILLS_DEF[]       // [{name, attr, key}] — 17 compétences
```

### `pages/mj/mj_shared.js`
```javascript
SK_ATTR{}      // {skKey: attrLettre} — mapping compétence → attribut
FACES_CD[]     // ['1','2','—','—','★','★'] — faces dés combat
COMBATS_COLL   // 'combats' — collection multi-sessions Firebase
getHpMax(d)    // calcul PV max depuis données joueur Firebase
rollDice(expr) // lance un dé type '2D+4', retourne int
getTN(d,skKey) // retourne {total, attrVal, rang, tag}
getNpcXP(level, cat) // XP PNJ par niveau — cat: 'normal'|'mighty'|'legendary', extrapole >20
enemyInstanceFromDB(nom, lvl) // construit une instance de combat depuis ENNEMIS_DB
```

### Schéma ennemi (`enemies.json` / `ENNEMIS_DB`)
Bestiaire officiel Fallout 2D20 — **55 créatures/PNJ** (bêtes, goules, robots, super mutants, synths, tourelles, factions Confrérie/Pillards/Gunners/Institut…). Construit des **instances de combat** via `enemyInstanceFromDB()`.
```javascript
"Bloodbug": {
  level, type, category:'swarm'|'normal'|'elite'|'boss', xp,
  attrs: {body, mind, melee, guns, other},  // null si non applicable
  hp,            // PV fixes (pas en dés)
  initiative,
  defense,
  dr: {phys, energy, rad, poison},          // nombre, "immune", OU string RD localisée ("4 tête / 3 jambes...")
  attacks: [{name, attr, skill, tn, dmg, dmgType, eff, range?, fireRate?, special?}],  // dmg = nb dés de combat
  abilities: [{name, desc}],                // capacités spéciales
  inventory: [{name, desc}],                // optionnel (dépeçage, récupération…)
  desc
}
```
`enemyInstanceFromDB(nom, lvl)` → instance combat : `{nom, pvMax, pvCur, atq:'XD', rd, initiative, xp, body, mind, tn, dmgType, eff, dr, defense, level, category}`.
Scaling niveau : `hp ×(1+(lvl-1)·0.25)`, `rd phys +⌊(lvl-1)/2⌋`. Si `dr.phys` est une string, `rd` prend le 1er nombre (parseInt).
Les ZONES de `mj.js` référencent ces noms pour la génération aléatoire — garder la cohérence si on renomme.

### Système de zones / rencontres pondérées (`zones.js`)
Arborescence : **zone** (pool pondéré de base) + couches de modificateurs appliquées dans l'ordre **variation → occupation → menace**.
Chaque couche `{multipliers?, add?}` : applique d'abord `multipliers` (× le poids des entrées existantes), puis `add` (poids ajouté/créé). `"none"` = poids de « pas de rencontre ».
```javascript
resolveZonePool(zoneKey, {variation, occupation, threat})  // → {nom: poids} (>0)
rollEncounter(pool)                                         // → nom tiré (ou "none")
generateEncounters(zoneKey, opts, count, excludeNone)       // → [noms]
zonePoolProbabilities(zoneKey, opts)                        // → [{nom, poids, pct}] (aperçu)
```
DRAFT en cours : certains noms de pool (Marchand, Mongrel, Republic Patrol, NNFP Militant…) n'ont pas encore de fiche dans `enemies.json` — `enemyInstanceFromDB` renvoie `null` pour eux (ignorés en combat). `zone_threat.json` est une 1re ébauche (menace = fréquence via `none`). Pas encore branché à l'UI mj.html.

### Factions (`factions.json` / `window.FACTIONS`)
6 factions Fallout Paris. **La clé de faction === clé `zone_occupation`** (republique, commune, nnfp, reseau, zazous, ultras) → une faction qui occupe une zone injecte ses unités dans le pool de rencontres.
```javascript
"republique": {
  label, tier:'principale'|'intermediaire', category, color, structure,
  militarized, presence:[], valeurs:[], traits:[],
  units:[],   // noms de PNJ correspondants dans enemies.json (à créer)
  desc
}
```
Lien à venir avec les personnages : un perso pourra référencer `faction: "<key>"` (+ réputation par faction). Le champ `units` relie faction → PNJ → pools de zones. `color` = couleur de badge pour l'UI.

### Génération d'unités par faction (`npc_roles.json` + `zones.js`)
Une faction recrute des **rôles** (`factions.json: roles[]`). Chaque rôle (`npc_roles.json`) a un `baseId` = fiche stats d'`enemies.json` à réutiliser, un `label`, un `spawnWeight` (pondération) et des `tags`. Une unité générée = instance du `baseId` relabellisée avec l'identité de la faction.
```javascript
factionRolePool(factionKey, filterTags?)        // → {roleKey: poids} (filtrable par tags)
generateFactionUnit(factionKey, {lvl, filterTags})  // → instance combat enrichie {nom:"Soldat (La République)", faction, factionColor, role, roleLabel, tags, ...}
generateFactionSquad(factionKey, count, opts)   // → [unités] avec id unique
```
La répartition `roles[]` par faction est un **DRAFT** (basé sur le thème). Les baseId pointent vers des fiches existantes (Raider, Brotherhood *, Synth *, Protectron/Assaultron/Sentry Bot) — pas besoin de créer des fiches dédiées par unité.

---

## Firebase

**Collections Firestore :**
- `/joueurs/{id}` — données personnage
- `/combats/{combatId}` — état d'un combat (multi-sessions)
- `/combats/current` — pointeur vers le combat actif `{combatId, lastUpdate}`

**API compat v9 — règle critique :**
```javascript
snap.exists      // ✓ CORRECT (sans parenthèses)
snap.exists()    // ✗ FAUX
```

---

## Système de combat

### Initiative
- **Joueurs** : `PER + AGI + (Action Boy/Girl × 2)`
- **Ennemis** : `body + mind` (depuis `enemies.json`)

### Actions par tour
| Type | Coût | Source | Limite |
|------|------|--------|--------|
| Action mineure | gratuite | — | 1/tour |
| Action majeure | gratuite | — | 1/tour |
| +1 mineure bonus | −1 PA individuel | actionsState.pa | max 2 total |
| +1 majeure bonus | −2 PA individuel | actionsState.pa | max 2 total |
| +1 mineure (joueur) | −1 AP groupe | apPool | max 2 total |
| +1 majeure (joueur) | −2 AP groupe | apPool | max 2 total |
| Luck 🍀 | dépenser 1 LCK | — | s'insérer après actif |

### Système AP groupe
- **`apPool`** : pool partagé (max 6), visible MJ + joueurs, persisté Firebase
- **`mjApPool`** : pool MJ séparé, masqué des joueurs, init à N joueurs × 1
- Généré par : succès excédentaires après un lancer (conversion proposée)
- Achat de dés bonus : 3D20 = −1AP, 4D20 = −3AP, 5D20 = −6AP (AVANT lancer)
- Dégâts bonus mêlée/jet : +1/2/3 DC après lancer réussi (−1/2/3AP)
- Dépenses joueur : +action, info MJ, réduction temps, donner AP au MJ

### Fonctions clés
```javascript
// mj.js — gestion sessions multi-room
genCombatId()                            → génère un ID court unique
createCombatSession(data, ids, zone)     → crée doc Firebase + sessionStorage.currentCombatId
joinCombat(combatId)                     → set sessionStorage + redirect combat.html
terminerCombatSession(combatId)          → passe meta.status à 'termine'
lancerCombat()                           → lit sessionStorage, appelle createCombatSession, redirect
renderCombatsActifs()                    → affiche liste des combats actifs dans #combats-actifs-list

// combat.js / combat_sync.js
finDeTour()            → avance le tour + syncCombatToFirebase()
finCombat()            → stopCombat() → Firebase actif:false
syncCombatToFirebase() → sync état combat vers Firestore
chAPPool(delta)        → modifie apPool groupe + Firebase
chMJAP(delta)          → modifie mjApPool + Firebase
initMJPool()           → init mjApPool = nbJoueurs en combat

// combat_joueur.js — actions joueur (écrivent dans /combat/fallout-paris)
depenseActionJoueur(type)    → dépense mineure ou majeure (actionsState)
actionBonusJoueur(type)      → +action via actionsState.pa individuel
bonusActionGroupeJ(type)     → +action via apPool groupe
demanderInfoJ()              → −1AP groupe + notification MJ via infoRequest
donnerAPMJ()                 → −1AP groupe, +1AP MJ
convertExcessToAPJ()         → succès excéd. → apPool groupe
// Déclaration d'actions (subcollection)
renderActionsDeclarees()     → affiche boutons MINOR/MAJOR_ACTIONS selon état actionState
prepareAction(cat,type)      → ouvre panneau confirmation
submitActionDeclaree()       → écrit pending dans subcollection
dismissRefused(cat)          → efface une action refusée

// combat.js — validation MJ
renderActionsMJ()            → affiche en temps réel les actions en attente dans #actions-joueurs-notif
validerAction(jId, cat)      → valide pending → moved to used[], décrémente actionsState
refuserAction(jId, cat)      → passe pending.status à 'refused' + motif
resetActionsDeclarees()      → (combat_sync.js) reset tous les docs actions en batch
```

### Document Firebase `/combats/{combatId}`
```javascript
{
  actif: bool,
  numRound: int,
  tourActif: int,           // index dans ordreInitiative
  ordreInitiative: [],      // [{id, nom, type:'joueur'|'ennemi', init, eid?}]
  actionsState: {},         // {[id]: {mineure, majeure, pa, paMax}}
  ennemis: [],              // [{id, nom, pvCur, pvMax, atq, rd, initiative}]
  apPool: int,              // pool AP groupe (max 6)
  mjApPool: int,            // pool AP MJ (masqué joueurs)
  infoRequest: {joueur, ts} | null,  // notification info joueur → MJ
  meta: {createdAt, status:'active'|'termine', joueurs:[], round:N, zone:''},
  lastUpdate: timestamp
}

// Subcollection combats/{combatId}/actions/{joueurId}
{
  mineure: { used: ['Move'], pending: null },   // pending: {type, details, requestedAt, status:'waiting'|'refused', refusalReason?}
  majeure: { used: [], pending: {type:'Attack', details:'...', status:'waiting'} },
  mouvement_used: bool   // true si Move ou Sprint validé ce tour
}
```

---

## Calculs importants

```javascript
// PV max (getHpMax dans mj_shared.js, hpMax() dans fiche_perso.js)
hpMax = LCK + END + (niveau - 1) + (Life Giver × END)

// Résistances localisées
getLocRD(zone)
// zone='Body' → couvre bras/jambes/torse (PAS la tête)
// zone='All'  → couvre tout

// TN compétence (getTN dans mj_shared.js retourne {total, attrVal, rang, tag})
TN = attribut_lié + rang + (TAG ? 2 : 0) + (persoBonus ? 2 : 0)

// Charge max
chargeMax = (150 + FOR×10) / 2.2046  ×  (powerArmor ? 1.5 : 1) + (powerArmor ? 200 : 0)
```

---

## Variables CSS globales (`common/style.css`)

```css
--g    : #5dbe5d   /* vert principal */
--gd   : #3a7a3a   /* vert foncé */
--gk   : #1a3a1a   /* vert très foncé (bg boutons) */
--bg   : #0c150c   /* fond page */
--p    : #111d11   /* fond panel */
--p2   : #162016   /* fond panel 2 */
--b    : #253825   /* bordure */
--b2   : #3a5c3a   /* bordure claire */
--t    : #7ed87e   /* texte principal */
--td   : #4a7a4a   /* texte discret */
--tb   : #b0f0b0   /* texte bright */
--am   : #e8a820   /* ambre (actions, PA) */
--rd   : #e04040   /* rouge (danger, ennemis) */
--rdk  : #1a0505   /* rouge très foncé */
--scan : repeating-linear-gradient(...)  /* effet scanline CRT */
```

---

## Personnages de test

| ID | Description |
|----|-------------|
| `gogo` | personnage test |
| `zinzin` | personnage test |
| `mongolo` | personnage test |
| `kuma` | personnage test |

---

## État actuel — Ce qui fonctionne ✓

- Fiche joueur complète avec sync Firebase temps réel
- Page MJ : actions rapides sur joueurs, générateur de rencontres, déplacements
- Écran combat MJ (`combat.html`) :
  - Tracker de tour interactif, dés 2D20 multi-dés (2→5D20)
  - Pool AP groupe + pool AP MJ (barre dédiée)
  - Dégâts joueurs/ennemis, attaque ennemis avec cible et DC
  - Sélecteur de dés bonus (−AP groupe), conversion succès → AP
  - Dégâts bonus mêlée (−AP groupe)
- Vue combat joueur (`combat_joueur.html`) : layout 3 colonnes
  - Ma fiche (armes cliquables, PV, RAD)
  - Alliés (HP live, armes équipées, indicateur de tour) + Ennemis
  - Initiative compacte à droite
  - Barre du bas : gestionnaire d'actions (min/maj/PA) + jets de dés
  - Pool AP groupe visible, boutons dépenses, sélecteur dés bonus
- Bandeau combat sur fiche joueur avec "C'EST TON TOUR"
- Transmission joueurs MJ → écran combat via `sessionStorage`
- Toutes les données statiques en JSON (`/data/`) chargées async via `db.js`
- **Sessions combat multi-room** : `combats/{combatId}` dans Firebase, liste des combats actifs dans `mj.html`, lien joueur avec `?combat={combatId}`
- **Système de déclaration d'actions** : subcollection `combats/{combatId}/actions/{joueurId}`, boutons par action (mineure/majeure) côté joueur, panneau validation MJ en temps réel dans `combat.html`

## Prochaines étapes

- [ ] Page carte
- [ ] Journal de session
- [ ] Données body/mind ennemis officielles (depuis livre de règles)
- [ ] Popup combat inline sur fiche joueur
