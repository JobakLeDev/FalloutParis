# Fallout Paris — JDR 2D20

App web pour jouer à Fallout 2D20 en ligne. MJ + joueurs connectés en temps réel via Firebase.

---

## Stack

- **HTML/CSS/JS vanilla** — pas de framework
- **Firebase Firestore** (compat v9) pour la persistance et le temps réel
- **GitHub Pages** pour l'hébergement
- **Repo** : `JobakLeDev/FalloutParis`
- **URL prod** : `https://jobakledev.github.io/FalloutParis/`

---

## Structure des fichiers

```
FalloutParis/
├── index.html                          → redirect vers accueil
├── CLAUDE.md
├── common/
│   ├── shared.js                      → firebaseConfig + XP_TABLE (chargé en 1er partout)
│   ├── style.css                      → variables CSS globales
│   ├── firebase.js                    → sync Firebase + listener combat temps réel (fiche joueur)
│   └── data.js                        → DB statique (armes, armures, items, PERKS_DEF, SKILLS_DEF)
└── pages/
    ├── accueil/
    │   ├── accueil.html               → page de connexion joueur
    │   ├── accueil.css
    │   └── accueil.js
    ├── creation_perso/
    │   ├── creation_perso.html
    │   ├── creation_perso.css
    │   └── creation_perso.js
    ├── setup_perso/
    │   ├── setup_perso.html           → config SPECIAL/skills/perks après création
    │   ├── setup_perso.css
    │   └── setup_perso.js
    ├── fiche_perso/
    │   ├── fiche_perso.html           → fiche joueur (vue joueur)
    │   ├── fiche_perso.css
    │   └── fiche_perso.js
    ├── admin_perso/
    │   ├── admin_perso.html           → éditeur MJ des personnages (code: 1234)
    │   ├── admin_perso.css
    │   └── admin_perso.js
    └── mj/
        ├── mj_shared.js               → constantes+fonctions partagées pages MJ (chargé avant les autres)
        ├── mj.html                    → tableau de bord MJ (code: 1234)
        ├── mj.css
        ├── mj.js
        ├── combat.html                → écran combat MJ
        ├── combat.css
        ├── combat.js
        ├── combat_sync.js             → sync Firebase état combat (partagé combat.html)
        ├── combat_joueur.html         → vue combat joueur temps réel
        ├── combat_joueur.css
        └── combat_joueur.js
```

### Ordre de chargement des scripts

| Page | Ordre |
|------|-------|
| Toutes | `shared.js` → scripts spécifiques |
| `fiche_perso.html` | `shared.js` → `data.js` → `fiche_perso.js` → `firebase.js` |
| `combat.html` | `shared.js` → `mj_shared.js` → `combat_sync.js` → `combat.js` |
| `combat_joueur.html` | `shared.js` → `mj_shared.js` → `combat_joueur.js` |
| `mj.html` | `shared.js` → `mj_shared.js` → `mj.js` |
| `admin_perso.html` | `shared.js` → `data.js` → `admin_perso.js` |

> `firebase.js` ne doit **PAS** être chargé sur les pages MJ ni sur `creation_perso`/`setup_perso` — ces pages ont leur propre init Firebase.

---

## Firebase

Config centralisée dans `common/shared.js` (source unique).

**Collections Firestore :**
- `/joueurs/{id}` — données personnage
- `/combat/fallout-paris` — état du combat en cours

**API compat v9 — règle critique :**
```javascript
snap.exists      // ✓ CORRECT (sans parenthèses)
snap.exists()    // ✗ FAUX
```

---

## Règles importantes

- Toujours wrapper `init()` dans `DOMContentLoaded`
- Éviter `font-family:'Share Tech Mono'` dans les strings JS — utiliser `monospace`
- Toujours vérifier la syntaxe JS avec `node --check fichier.js` avant de livrer
- Branching : travailler sur `locale`, merger sur `main` pour aller en prod

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

## Système de combat

### Initiative
- **Joueurs** : `PER + AGI + (Action Boy/Girl × 2)`
- **Ennemis** : `Body + Mind` (définis dans `ENNEMIS_DB` dans `mj_shared.js`)

### Actions par tour
| Type | Coût | Limite |
|------|------|--------|
| Action mineure | gratuite | 1 (max 2 avec PA) |
| Action majeure | gratuite | 1 (max 2 avec PA) |
| +1 mineure bonus | -1 PA | max 2 total |
| +1 majeure bonus | -2 PA + difficulté +1 | max 2 total |
| Luck 🍀 | dépenser 1 LCK | s'insérer après combattant actif |

### Fonctions clés
```javascript
finDeTour()            → avance le tour + syncCombatToFirebase()
finCombat()            → stopCombat() → Firebase actif:false
syncCombatToFirebase() → sync état combat vers Firestore (combat_sync.js)

// combat_joueur.js — actions joueur (écrivent dans /combat/fallout-paris)
depenseActionJoueur(type)  → dépense min ou maj
actionBonusJoueur(type)    → +action en dépensant PA
chPAJoueur(delta)          → modifie les PA
```

### Document Firebase `/combat/fallout-paris`
```javascript
{
  actif: bool,
  numRound: int,
  tourActif: int,           // index dans ordreInitiative
  ordreInitiative: [],      // [{id, nom, type:'joueur'|'ennemi', init, eid?}]
  actionsState: {},         // {[id]: {mineure, majeure, pa, paMax}}
  ennemis: [],              // [{id, nom, pvCur, pvMax, atq, rd, initiative}]
  lastUpdate: timestamp
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

## Données statiques

### `common/data.js`
```javascript
DB.weapons[]   // armes : {n, t, a, dmg, eff, dt, fr, rng, w, sk}
DB.armor[]     // armures : {n, t, ph, en, rad, z, w}
DB.food[]      // nourriture
DB.drinks[]    // boissons
DB.drugs[]     // drogues/médicaments
DB.stuff[]     // objets divers

SKILLS_DEF[]   // [{name, attr, key}] — 17 compétences
PERKS_DEF{}    // {nom: {max, desc}} — perks disponibles
```

### `common/shared.js`
```javascript
firebaseConfig  // config Firebase (source unique)
XP_TABLE[]      // seuils XP par niveau (0→20)
```

### `pages/mj/mj_shared.js`
```javascript
WEAPONS_DB{}   // sous-ensemble armes pour pages combat (dmg, eff, sk, t, fr, rng)
ENNEMIS_DB{}   // {nom: {pvd, atq, rd, xp, body, mind, desc}}
SK_ATTR{}      // {skKey: attrLettre} — mapping compétence → attribut
FACES_CD[]     // ['1','2','—','—','★','★'] — faces dés combat
COMBAT_DOC     // 'fallout-paris'
getHpMax(d)    // calcul PV max depuis données joueur Firebase
rollDice(expr) // lance un dé type '2D+4', retourne int
getTN(d,skKey) // retourne {total, attrVal, rang, tag}
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
- Page MJ avec actions rapides, générateur de rencontres
- Écran combat MJ : tracker de tour, dés, dégâts joueurs/ennemis, attaque ennemis
- Vue combat joueur (`combat_joueur.html`) : 3 colonnes
  - Ma fiche avec armes cliquables
  - Coéquipiers (HP live, indicateur de tour)
  - Gestionnaire d'actions interactif (min/maj/PA, sync Firebase)
  - Dés compacts + initiative compacte
- Bandeau combat sur fiche joueur avec "C'EST TON TOUR"
- Transmission joueurs sélectionnés MJ → écran combat via `sessionStorage`

## Prochaines étapes

- [ ] Règles PA détaillées (achat D20, dégâts bonus mêlée)
- [ ] Données officielles body/mind ennemis (depuis Excel livre de règles)
- [ ] Page carte
- [ ] Journal de session
- [ ] Popup combat sur fiche joueur (chantier 2)
