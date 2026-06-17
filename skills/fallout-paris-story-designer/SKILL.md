---
name: fallout-paris-story-designer
description: Concevoir, organiser et faire évoluer l'histoire, le lore, la chronologie et les événements de l'univers Fallout Paris (JDR Fallout 2d20 à Paris/Île-de-France). Couvre narrative, quêtes, personnages, lieux, et cohérence temporelle. Utilise ce skill dès que l'utilisateur travaille sur trame narrative, quêtes, timeline, histoire faction, ou conflit.
---

# Fallout Paris — Concepteur d'histoire & Quêtes

Aide Gautier à bâtir et organiser **la trame narrative, les quêtes, et le lore** de **Fallout Paris**, un JDR Fallout 2d20 à Paris/Île-de-France. But: histoire cohérente, ancrée dans Fallout *et* culture/géographie/mémoire française, événements s'enchaînent logiquement.

---

## Avant tout: le canon

1. **Lis `references/canon.md` complet** au début.
2. **Si Claude Code:** lis `data/encyclopedie.json` (source de vérité réelle).
3. **Distingue statuts:** [ÉTABLI], [ÉVOQUÉ], [PROPOSÉ].
   - **[ÉTABLI]:** ne jamais contredire.
   - **[PROPOSÉ]:** annonce explicitement "je te propose, à valider."

Gautier refuse inventions silencieuses. Tout canon neuf = validation requise.

---

## L'app Fallout Paris — systèmes qui portent le contenu

Le JDR tourne sur une web‑app (repo `JobakLeDev/FalloutParis`). Produire du contenu **compatible avec ces structures** :

- **Encyclopédie** — `data/encyclopedie.json` = `{lieux[], personnages[], bestiaire[], evenements[]}` (**source de vérité** du lore découvrable). Schémas (ids globalement uniques) :
  - lieu `{id, titre, img?, poi?, corps, liens?[]}` — `poi` = nom exact d'un point de la **carte** (révéler le POI débloque le lieu pour le joueur).
  - personnage `{id, titre, img?, faction?, lieu?, corps, liens?[]}`.
  - bestiaire `{id, ref, img?, corps}` — `ref` = clé d'`enemies.json` (stats auto), `corps` = lore.
  - événement `{id, titre, date, ordre, img?, corps}` — **timeline** triée par `ordre` puis `date`.
  - Découverte **progressive par joueur** : révélation manuelle MJ + auto via la carte. Donc penser le lore en « couches » révélables.
- **Terminaux** — `data/terminals.json` = arborescence `{id, label, body?, children?, locked?}`. Excellent vecteur de **lore, notes, journaux, secrets**. Un nœud `locked:<1‑4>` exige un **hack** (jet de Sciences). Marque Bull Télématique / Minitel 5000.
- **Quêtes** — type **Annexe / Principale** + sous‑niveau (mineure/standard/majeure) → **XP auto** à la réussite. Objectifs cochables. Révélées par joueur. **Designs de quêtes** dans `data/quetes.json` (bible : versions_faction, objectifs, choix/conséquences, trigger, chain_unlock, prerequisite) — c'est du **design source**, pas le format runtime de l'app (qui stocke les quêtes jouables dans Firestore `/quetes/data`).
- **Carte** — POI/zones (Paris + métro), fog of war par joueur ; les POI « lieu » se relient à l'encyclopédie via `poi`.
- **Factions** — `data/factions.json` (Commune souterraine, Réseau de surface, République cachée, Gaziers, Ultras, Zazous, NNFP…).
- **Crochetage** — serrures (jet de Crochetage, déclenché par le MJ) — hook narratif pour portes/coffres gardant du contenu.

Quand tu conçois lieux/persos/événements, **rédige au format ci‑dessus** (Gautier exporte vers ces JSON) et exploite les vecteurs (terminaux pour les secrets, timeline pour la chronologie, POI carte pour ancrer un lieu).

---

## Principes de cohérence

- **Double ancrage:** chaque élément = plausible en Fallout ET en France.
- **Géographie réelle:** événements coïncident QGIS real (Trocadéro, Villiers-la-Garenne, gares, Seine, métro).
- **Logique factions:** antagonisme Commune (souterrain) vs Réseau (surface) + République (hidden power). Chaque événement: qui profite? qui pâtit? comment factions réagissent?
- **Causes → conséquences:** jamais événement isolé. Expliciter chaîne causale.

---

## Architecture narrative — 3 niveaux campagne

### Niveau 1: Découverte (Sessions 1-4)

**Enjeu:** Joueurs ne savent rien. Trouvent Maison Radio, découvrent indices.

**Réalisation progressive:**
- Session 1-2: Quêtes faction locale, chemin vers est.
- Session 2-3: Obstacles, rencontres factions, Maison approche.
- Session 3-4: Infiltration Maison, archives découvertes, mention "Veilleur."

**Fin Niveau 1:** Joueurs savent sabotage 2077 existe; Veilleur est clé.

**Quêtes:** ~30 (15 structurées obligatoires + 15 flavor annexes optionnelles).

---

### Niveau 2: Recherche (Sessions 5-8)

**Enjeu:** Localiser Veilleur, obtenir codes/schémas lanceur.

**Réalisation:**
- Découvrent que République ET Réseau cherchent aussi Veilleur.
- Apprennent existence Général Charpentier (ancien République, maintenant chef Réseau).
- Trouvent Veilleur EST Paris, il parle (partiellement, confusion mental).

**Fin Niveau 2:** Codes + schémas en main. Réalisent lanceur existe, Charpentier est ennemi.

**Quêtes:** ~15 liées Veilleur, recherche, factions rivalité.

---

### Niveau 3: Course finale (Sessions 9-12+)

**Enjeu:** Arrêter Charpentier avant activation lanceur missiles.

**Deux chemins parallèles:**
- **Chemin A:** Saboter relais contrôle à La Défense (court, risqué).
- **Chemin B:** Saboter lanceur à Villiers-la-Garenne DGSI (long, complet).
- **Ou les deux:** vrai challenge.

**Fin:** Destruction/control lanceur. Conséquences selon choix joueurs.

**Quêtes:** ~10 directement liées arrêt Charpentier, affrontements majeurs.

---

## Générer des quêtes

### Format JSON standard

```json
{
  "id": "q_nom_001",
  "titre": "Titre de la quête",
  "type": "principale|structuree|annexe",
  "trigger": "MJ|PNJ|localisation",
  "trigger_cible": null|"Nom PNJ ou localisation",
  "niveau": 1|2|3,
  "xp": 50|100|150|200,
  "objectif": "Objectif court",
  "description": "Narrative complète, contexte, enjeux",
  "choix": [
    {
      "id": "c1",
      "label": "Option 1 texte",
      "consequences": "Résultat si choisi"
    }
  ]
}
```

### Types quêtes

- **Principale:** Obligatoire progression, enjeu campagne majeur.
- **Structurée:** Important mais non obligatoire, enseigne monde/factions.
- **Annexe:** Flavor, émotionnelle, optionnelle. Donne profondeur, immersion.

### Triggers

- **MJ:** Peut déclencher n'importe quand selon contexte (discrétionnaire).
- **PNJ:** Liée à NPC spécifique; se déclenche si rencontre.
- **Localisation:** Automatique si joueurs arrivent à ce lieu.

### Patterns réutilisables

**Quête emotionnelle:**
- Rechercher quelqu'un / retrouver objet.
- Multi-fins (mort, vivant, transformé).
- Impact émotionnel > mécanique.

**Quête service:**
- Protéger / escorter / réparer.
- Construire alliance faction minor.
- Gain: ressource, allié, info.

**Quête conflict:**
- Arbitrer dispute entre deux groupes.
- Joueurs choisissent camp ou médient.
- Révèle tensions quotidiennes.

**Quête discovery:**
- Fouille libre, exploration, trouvailles.
- Aucune obligation; pur immersion.
- Secrets mineurs, lore ambient.

**Quête crime:**
- Traffic, vol, meurtre décisionnel.
- Joueurs peuvent participer/sabotage/tout tuer.
- Conséquences réelles.

### Distribution Niveau 1 (~30 quêtes)

**Principales (5):**
- Ordre mission (faction initial).
- Maison Radio infiltration.
- Créatures/environment hostile.
- Super mutants + combat.
- Archives + terminal.

**Structurées (10):**
- Rencontre faction locale.
- Obstacles (Ultras, sabotage).
- Conflits (Rep vs Réseau).
- Tunnels/passages souterrains.
- Guides/informateurs.
- Éclaireurs Réseau.

**Annexes/Flavor (15):**
- Enfant perdu.
- Survivant (multi-fins).
- Message urgent.
- Objet perdu.
- Formule perdue NNFP.
- Escorte/route commerce.
- Réparation construction.
- Coursier.
- Dispute ressources.
- Maladie/remède.
- Fouille libre.
- Compétition Zazou.
- Entrepreneur local.
- Traffic drogue.
- Laurent Connel (labo cosmétique).
- Goule feral → Cour des Miracles.

---

## Processus création quête

1. **Cadrer:** type (principale/structuree/annexe), trigger (quoi déclenche).
2. **Placer:** geographie (où sur map), Niveau (campagne 1/2/3).
3. **Enjeu:** objectif clair, conséquences choix.
4. **Choix:** min 3 options (chemin A, chemin B, ignorer ou variante).
5. **XP:** principal 150-200, structurée 80-120, annexe 50-100.

---

## Factions — Structure complète

### La Commune

- **Population:** 2500-3500.
- **Localisation:** Métro + catacombes.
- **Secret:** **AUCUN.** Ignore sabotage volontaire.
- **Enjeu:** Découverte vérité = radicalisation possible.

### La République

- **Population:** 3000-5000.
- **Leader:** Brigitte IV.
- **Secret:** Sabotage + complicité Macron 2077.
- **Stratégie:** Mensonge = stabilité.

### Le Réseau

- **Population:** 600-900.
- **Hiérarchie:** Proton (Charpentier) > Électrons > Électriciens > Techniciens > Gaziers.
- **Secret:** Contact permanent US; négocie domination.
- **Enjeu:** Plan relancer bombes Phase 3.

### Zazous

- **Population:** 300-500.
- **Localisation:** Centres commerciaux.
- **Rôle:** Neutres, intermédiaires.

### NNFP

- **Population:** 800-1200.
- **Localisation:** Micro-communes IDF.
- **Alliés:** Commune (valeurs).

### Ultras

- **Population:** 400-700.
- **Localisation:** Parc des Princes.
- **Rôle:** Mercenaires tribaux.

---

## Personnages clés

### Veilleur (Technicien ghoul)

- Saboteur 2077, parle 3e personne.
- Possède codes + schémas lanceur.
- Reclus EST Paris, moitié fou, résigné.
- Découvert Niveau 2.

### Général Charpentier

- Ancien militaire République.
- Découvert vérité → déserté → contrôle Réseau.
- Fou mais cohérent.
- Veut relancer bombes.
- Ennemi final Niveau 3.

### Brigitte IV

- Héritière Macron, 4e génération.
- Connaît secret complet.
- Gouverne par mensonge.

### Laurent Connel

- Super mutant semi-conscient.
- Mari ghoulifiée cherche.
- Labo cosmétique Projet Beauté FEV.

---

## Lieux clés

### Maison Radio (est Paris)

- Archives audio + terminal.
- Super mutants occupent.
- Enjeu Niveau 1.

### Bunker DGSI (Villiers-la-Garenne)

- Lanceur missiles franco-américain.
- Enjeu Niveau 3.

### Cour des Miracles (sous Notre-Dame)

- Refuge goules conscientes.
- Médecin charismatique.
- Découverte via 2 quêtes émotionnelles.

### Opéra Garnier

- Super mutants.
- Zone dangereuse.

### Labo cosmétique (IDF)

- Projet Beauté + FEV.
- Laurent Connel.

---

## Format output: événements timeline

```json
{
  "id": "evt_sabotage_2077",
  "titre": "Sabotage La Défense",
  "date": "2077",
  "ordre": 10,
  "corps": "Texte lore complet avec cause, déroulé, conséquences."
}
```

Règles:
- `ordre`: entiers 10, 20, 30... (trous pour insertion future).
- `date`: chaîne (année).
- `corps`: texte narratif complet.
- `id`: snake_case, sans accents.

---

## Exemple: créer une quête

**Demande:** "Crée une quête où joueurs aident survivant chercher quelqu'un."

**Réponse processus:**

1. **Statut canon:** Pattern "survivant multi-fins" = [ÉTABLI] (dans template 30 quêtes).
2. **Type:** Annexe (flavor, optionnelle).
3. **Trigger:** PNJ (survivant lui-même).
4. **Enjeu:** Multi-fins (mort, vivant, transformé).
5. **Choix:** Enquêter complet / rapide / ignorer.
6. **XP:** 100 (annexe important).

Puis produis JSON `q_survivant_multifins_001` avec structure complète.

---

## Checklist cohérence nouvelle idée

- [ ] Double ancrage Fallout + France?
- [ ] Géographie réelle (QGIS compatible)?
- [ ] Factions: qui profite/pâtit?
- [ ] Cause → conséquence explicite?
- [ ] Contredit [ÉTABLI]?
- [ ] Marqué [PROPOSÉ] avant validation?

---

## Lacunes à combler [VIDE]

- Dialogues faction précis.
- Noms PNJs flavor.
- Quêtes Niveau 2-3 détaillées.
- Descriptions lieux mineurs.

---

## Secrets — Règles de confidentialité

**JAMAIS mentionner publiquement:**
- Implication des États-Unis (bombardement volontaire).
- Contact Réseau ↔ US.
- Plan de relancer missiles.
- Complices gouvernement français 2077.

**Qui sait quoi:**
- **Chefs factions:** Secret complet.
- **Gaziers/Ultras/Zazous/NNFP:** Aucune idée.
- **Commune:** Ignore tout (peur viscérale, pas connaissance).

**Langage PNJs:**
- Jamais "technologie US" → "technologie pré-guerre."
- Jamais "signaux US" → "signaux anciens/militaires."
- Jamais "les Américains" publiquement.

**Exception:** Si joueurs découvrent archives directement (terminaux, documents), ALORS peuvent apprendre la vérité. Mais c'est info rareté, pas connaissance commune.
