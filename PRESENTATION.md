# Fallout Paris — Présentation détaillée de l'application

> Document de référence pour expliquer ce que fait l'app, fonction par fonction.
> Pour chaque module : ce qui est possible **côté joueur** et **côté Maître du Jeu (MJ)**.

---

## Vue d'ensemble

**Fallout Paris** est une application web pour jouer au jeu de rôle *Fallout 2D20* en ligne, en temps réel. Un **Maître du Jeu** anime la partie depuis un tableau de bord ; les **joueurs** vivent l'aventure chacun sur sa fiche de personnage. Tout est synchronisé instantanément : un changement chez le MJ apparaît immédiatement chez les joueurs, et inversement.

- **Sans installation** : c'est un site web (lien partagé).
- **Multi-écrans** : MJ sur son poste, joueurs sur ordinateur/tablette/téléphone.
- **Temps réel** via une base de données en ligne (Firebase).
- **Esthétique « terminal Fallout »** : interface verte, écran cathodique, scanlines.

Les pages principales : Accueil (connexion) · Création de personnage · Fiche (Pip-Boy) · Carte · Combat · Quêtes · Journal · Encyclopédie · Terminal · plus le tableau de bord MJ et l'admin des personnages.

---

## 1. Accès & connexion

**Côté joueur**
- Se connecter avec un **identifiant** + un **code à 4 chiffres**.
- Créer un nouveau personnage depuis l'accueil.
- Atterrit directement sur sa fiche (Pip-Boy).

**Côté MJ**
- Accès dédié protégé par un **code MJ**.
- Lien d'accès MJ discret depuis l'accueil.

---

## 2. Création de personnage

**Côté joueur**
- Choix de l'**identifiant** et du **code** de connexion, et du **nom** du personnage.
- **Questionnaire « Qui suis-je ? »** : 7 mises en situation déterminent l'**origine** et la **faction de départ** (Abri 74, Bourg-de-Bois, Zazous ou Ultras). Possibilité de refaire le test.
- Le personnage est créé avec des valeurs de base (SPECIAL à 5, compétences à 0, équipement de départ : combinaison d'abri, arme légère, Stimpak) ; le MJ peut compléter ensuite.
- L'entrée d'encyclopédie de sa faction est automatiquement débloquée.

**Côté MJ**
- Récupère un personnage prêt à finaliser (attributs, compétences, perks, équipement) via l'**Admin persos** (voir §17).

---

## 3. Fiche de personnage (Pip-Boy)

La fiche est le cœur de l'expérience joueur. Elle s'organise en onglets : **Général · Inventaire · Perks & Compét. · Carte · Quêtes · Journal · Encyclopédie**. Un en-tête permanent affiche PV, RAD, LUCK et les badges d'état.

### 3.1 En-tête & état
**Côté joueur**
- Voir en permanence : **PV** (actuels/max), **radioactivité**, **points de Chance (Luck)**, **état de santé** (badge gradué : OK / Blessé / Gravement blessé / Critique).
- Voir le **nom**, la **faction**, le **niveau**, l'**XP**.
- Voir l'**horloge de campagne** et son **groupe** si assigné.
- Icône **messagerie** avec pastille de notification.
- Mini-lecteur **radio** (volume, coupure) quand le MJ diffuse.

**Côté MJ** (via tableau de bord)
- Modifier PV, RAD, XP, Luck, caps, blessures, etc. en direct (voir §16).

### 3.2 Onglet Général
**Côté joueur**
- **S.P.E.C.I.A.L** : consulter et modifier ses 7 attributs.
- **CAPS** : voir son or.
- **Effets actifs** : buffs en cours (nourriture, chems) avec leur durée/effet.
- **Mon personnage** : silhouette Vault Boy avec l'**armure équipée par localisation** (tête, torse, bras, jambes).
- **Survie** : jauges de **faim / soif / sommeil**.
- **Armes équipées** : récap rapide des armes prêtes à l'emploi (repliable).
- **Compagnons** : liste des PNJ qui accompagnent le joueur (s'il y en a).

### 3.3 Onglet Inventaire
**Côté joueur**
- **Barre de charge** (poids transporté / charge max), recalculée automatiquement.
- Filtres : **Tout / Armes / Armure & tenues / Aide / Divers / Munitions**.
- Pour chaque arme : type, dégâts, effets, cadence, **seuil de réussite (TN)**, quantité, poids, état équipé.
- Pour l'armure : zone couverte, **réduction de dégâts (RD)**, équiper/déséquiper.
- Pour les objets d'**aide** (nourriture/chems) : soin, effet, rads, **consommer** (applique les buffs ; un même consommable ne cumule pas son buff, seuls les PV gagnés s'ajoutent).
- Gestion des **slots d'armes** : si pleins, on choisit quelle arme remplacer.
- Munitions : gérées par le MJ, **consommées automatiquement en combat**.

### 3.4 Onglet Perks & Compétences
**Côté joueur**
- **Perks actives** : liste avec descriptions.
- **17 compétences** avec leur rang et leur statut **TAG** (compétence de prédilection).
- **Effets calculés** : récap des bonus issus des perks (résistances, etc.).

### 3.5 Montée de niveau
**Côté joueur**
- Quand le perso gagne assez d'XP, une **alerte « Montée de niveau »** apparaît.
- L'assistant applique **+1 PV max**, fait **améliorer une compétence** (+1, max 6) et **choisir une perk**.
- Peut être reporté (« Plus tard »).

### 3.6 Localisations & Power Armor
**Côté joueur**
- Marquer les **blessures par zone** du corps.
- Activer/désactiver la **Power Armor** (charge ×1.5 +200 kg).
- Voir les **résistances** apportées par les perks.

---

## 4. Carte interactive de Paris

Basée sur un plan de Paris (Leaflet). Trois onglets : **Paris · Métro · Lieux**. La carte est aussi intégrée dans la fiche du joueur (onglet Carte).

**Côté joueur**
- Explorer la carte de Paris avec **brouillard de guerre** : on ne voit que ce qu'on a découvert.
- Voir les **points d'intérêt (POI)** et **zones** révélés pour soi.
- Onglet **Métro** : lignes et stations qui se débloquent au fil de l'exploration.
- Onglet **Lieux** : plans de bâtiments accessibles.
- Partage des découvertes **au sein de son groupe** (fusion de fog of war).
- **Échanges entre joueurs sur la carte** : proposer/recevoir un **don d'objets** (modale d'acceptation/refus).

**Côté MJ** (mode MJ via code)
- **Révéler par joueur** lieux et zones (chaque joueur a son propre brouillard).
- **Ping joueurs** : signaler un point sur la carte.
- **Édition** : ajouter des **POI** (choix d'un pictogramme puis clic), **dessiner des zones**, **placer des jetons**, **ajouter des lieux/plans de bâtiment**.
- **Caractériser une zone** : nom, type (pool de rencontres), **faction occupante**, **variation**, **niveau de menace**, **radiation à l'entrée**.
- Voir la **position des joueurs** par zone.
- **Maintenance carte** (nettoyage/outils).
- Hooks automatiques : découvrir un lieu **alimente le journal** et **débloque la fiche d'encyclopédie** correspondante.

---

## 5. Système de combat

Le combat tactique se joue sur deux écrans synchronisés : l'**écran MJ** (orchestration) et l'**écran joueur** (actions individuelles), reliés par une battlemap commune.

### 5.1 Mise en place
**Côté MJ**
- **Générer une battlemap** (grille avec terrain, murs, fenêtres, portes), la **resynchroniser** chez les joueurs ou la retirer.
- **Ajouter des ennemis** depuis la base (choix de l'ennemi, du nombre, du niveau 1-5).
- Ajouter **alliés/compagnons**.
- **Lancer l'initiative** (joueurs : PER+AGI ; ennemis : body+mind).
- **Partager** le lien de combat aux joueurs.

### 5.2 Déroulé du tour
**Côté joueur**
- Voir le **tracker d'initiative** et de quel combattant c'est le tour (**halo** sur le jeton actif).
- **Déclarer ses actions** (mineure/majeure) — validées par le MJ.
- Se **déplacer sur la grille** (Move/Sprint), avec affichage des cases atteignables, des **portées d'armes**, des **lignes de visée** (murs et portes bloquent ; **les fenêtres laissent voir et tirer à travers**).
- **Ouvrir une porte** : action mineure (clic sur une porte adjacente) validée par le MJ.
- **Lancer ses dés** : test 2D20 contre son **TN** calculé, puis **dés de dégâts (CD)** ; relances **Aim** et **Miss Fortune** sur échec.
- **Points d'action de groupe (AP)** : acheter des dés bonus (3D/4D/5D = −1/−3/−6 AP).
- **Chance (Luck)** : capacités **Lucky Timing**, **Luck of the Draw**, et la perk **Étranger Mystérieux** (1 fois par combat).
- Popup **« Mes jets »** ancré sur le bloc d'actions (sans masquer la carte), bouton OK pour fermer.
- Voir ses **alliés** et **terminer son tour**.

**Côté MJ**
- **Bloc de jets** : sélectionner un joueur + une arme + une cible → dégâts calculés automatiquement au CD.
- Gérer les **AP de groupe** et les **AP du MJ** (init, dépenses bonus mineure/majeure).
- Déplacer/masquer/démasquer/faire pivoter les **jetons** (menu latéral au clic d'un jeton).
- Cartes repliables (joueurs/alliés/ennemis), indicateur du combattant actif.
- Valider les **demandes d'actions** des joueurs (file en temps réel).
- **Journal de combat** intégré (effaçable).

### 5.3 Effets & finitions
- **Effets visuels rétro** synchronisés sur les deux écrans : **traceur d'attaque** attaquant→cible (ambre si touché, gris si raté), **clignotement** de la cible, **ligne de visée** pointillés→plein pendant le jet.
- **Sons** (attaque, Étranger Mystérieux, fin de combat avec sons d'XP/niveau).
- **Jetons illustrés** pour les ennemis (image détourée selon le type).
- **Compagnons** jouables, agissant avec leur joueur.

---

## 6. Quêtes

Page dédiée + intégrée dans la fiche du joueur (onglet Quêtes, avec pastille de notification).

**Côté joueur**
- Voir **uniquement les quêtes qui lui sont révélées**.
- Filtres par statut : **Toutes / En cours / Terminées / Échouées**.
- Pour chaque quête : titre, type (principale/annexe), **objectifs**, **choix et conséquences**.
- **Texte adapté à sa faction** : deux joueurs ayant la même mission de factions différentes voient chacun la version de leur faction.
- **Réduire/développer** chaque quête.
- **XP automatique** : terminer une quête récompense les joueurs concernés (échelle proportionnelle au niveau, montée de niveau gérée).

**Côté MJ**
- **Créer** des quêtes, les **révéler joueur par joueur**.
- **Importer** les quêtes pré-écrites depuis `data/quetes.json` (ignore les doublons).
- Définir type **principale/annexe**, sous-niveau d'importance, objectifs, choix, **versions par faction**, déclencheur, **chaînage** (une quête en débloque une autre).
- **Filtre par type** (principales/annexes) + boutons **Tout réduire / Tout développer**.
- Marquer une quête **Réussie/Échouée** (déclenche l'XP et le chaînage).

---

## 7. Journal de campagne

Page dédiée + intégrée dans la fiche (onglet Journal, avec pastille de notification).

**Côté joueur**
- Lire la **frise des événements révélés** : rencontres PNJ, lieux découverts, quêtes, infos.
- **Filtres** : Tout / PNJ / Lieux / Quêtes / Infos.
- **Mes notes** : bloc-notes personnel (ajouter/consulter ses propres notes).
- Affiche l'**horloge de campagne**.

**Côté MJ**
- **Ajouter une entrée** (type info/PNJ/lieu/quête + titre).
- Entrées **alimentées automatiquement** par la carte (lieux découverts, quêtes).

---

## 8. Encyclopédie

Base de connaissances de l'univers, dévoilée progressivement. Catégories : **Lieux · Personnages · Factions · Bestiaire · Timeline**. Page dédiée + onglet dans la fiche (pastille de notification). Recherche intégrée.

**Côté joueur**
- Consulter **uniquement ce qui a été découvert**.
- **Lieux** : se débloquent automatiquement via l'exploration de la carte.
- **Factions** : voir la fiche de base + son **rapport** avec chaque faction (Allié / Neutre / Ennemi) ; la base de **sa propre faction** est visible d'office.
- **Bestiaire** : fiches d'ennemis avec leurs **statistiques réelles** (reprises du jeu) + lore.
- **Timeline** : frise chronologique des événements.

**Côté MJ**
- Voir **tout le contenu**.
- **Révéler par joueur** chaque entrée, et chaque **sous-entrée** indépendante (fragments de lore débloqués un à un — utile pour les factions, par ex.).

---

## 9. Terminaux (mini-jeu)

Terminaux rétro façon Minitel / « Bull Télématique » (écran cathodique, boot animé, easter egg). Page autonome + modale dans la fiche.

**Côté joueur**
- **Allumer/éteindre** le terminal (bouton POWER, sons de démarrage/arrêt).
- Naviguer dans une **arborescence de menus** (drill-down + retour), texte affiché à la machine à écrire.
- **Hacker** un nœud verrouillé : jet de **Sciences** (2D20 contre la difficulté du nœud) avec animation de décryptage ; réussite = déverrouillage, échec = re-verrouillage (réinitialisé à l'extinction).

**Côté MJ**
- **Déclencher un terminal** précis vers les joueurs sélectionnés (sélection du terminal + ouverture).
- **Fermer** les terminaux ouverts.

---

## 10. Crochetage de serrures (mini-jeu)

**Côté joueur**
- Alerte + modale avec **serrure animée**.
- Tenter le **crochetage** : jet de **Crochetage (PER)** 2D20 contre la difficulté.
- **Consomme une épingle (Bobby Pin)** par tentative — sauf si on possède un **kit** (Lock Pick Set / Electronic Lockpicker) ; bloqué si ni épingle ni kit.
- **Complication** (échec critique) → épingle cassée.
- Bouton **OK** pour valider (le résultat reste affiché).

**Côté MJ**
- **Déclencher un crochetage** vers les joueurs sélectionnés : intitulé de la serrure + **difficulté D1 à D4**.
- **Annuler** la demande.
- Résultat **journalisé** pour le MJ.

---

## 11. Butin / Fouille

**Côté joueur**
- Alerte **« Butin à portée »** quand le MJ ouvre l'accès.
- Ouvrir la **fouille** et **récupérer des objets** dans son inventaire.

**Côté MJ**
- **Générer du butin** selon l'échelle du lieu (placard → grande zone), par catégories.
- **Catalogue d'objets** : ajouter manuellement au pool, ou **directement à un joueur**.
- **Ouvrir/fermer l'accès** au butin par joueur (bandeau sur leur fiche).

---

## 12. Boutique / Marchand

**Côté joueur**
- Alerte **« Un marchand est disponible »**.
- **Acheter/vendre** dans la boutique (paiement en caps).

**Côté MJ**
- **Créer une boutique** : nom, **marge de prix**, nombre d'articles.
- **Générer le stock** automatiquement par rareté.
- **Ouvrir aux joueurs sélectionnés / Fermer / Supprimer**.

---

## 13. Messagerie

**Côté joueur**
- **PIP-MESSAGER** : conversations avec les contacts dont on a le numéro.
- Pastille de **notification** de nouveaux messages.

**Côté MJ**
- **Écrire aux joueurs** (modale messagerie avec liste de contacts).
- **Lier des contacts** entre eux (« échange de numéros ») pour autoriser une conversation joueur↔joueur.
- Pastille de notification côté MJ.

---

## 14. Radio (ambiance)

**Côté joueur**
- Lecteur radio dans l'en-tête : **volume**, **couper/reprendre**, nom de station + titre en cours, **diffusion synchronisée** par le MJ.

**Côté MJ**
- **Diffuser** une station/chanson à tous (lecture synchronisée).
- Contrôles **précédent / lecture / suivant**, **couper la radio pour tous**, volume d'écoute MJ local.

---

## 15. Échanges entre joueurs

**Côté joueur**
- **Don d'objets** via la carte : proposer des objets à un autre joueur, qui reçoit une **proposition** à accepter/refuser.
- **Échange de groupe** : fenêtre dédiée pour partager du matériel entre membres.

**Côté MJ**
- Met en place les groupes et les liens permettant ces échanges (voir §16.3).

---

## 16. Tableau de bord MJ

Écran central du MJ, avec un **bandeau de navigation unifié** vers toutes les pages.

### 16.1 Actions rapides (sur les joueurs sélectionnés)
- **Sélection** : tous / aucun / individuelle.
- **Combat** : infliger des dégâts, soigner (montant ou complet), **purger les effets**.
- **Radiation** : irradier, soigner les rads, tout retirer.
- **Expérience** : donner un montant d'XP, +500, +1000.
- **Chance (Luck)** : initialiser (= LCK), récupérer.
- **Repos** : repos court (+END PV), repos long (PV max), **bien reposé** (+2 PV max), effacer blessures.
- **Caps** : donner / retirer.
- **Lanceur de dés** : ND faces, ou **dés CD**.
- **Lancer public** : test 2D20 sur une compétence, ou jet de dés libre → résultat envoyé aux joueurs qui **lancent eux-mêmes** leurs dés (alerte « Lancer » sur leur fiche).

### 16.2 Rencontres & déplacements
- Choix **Zone / Occupation / Variation / Menace**, nombre de **créneaux** et d'**unités de déplacement**.
- **Générer une rencontre** pondérée, **déplacement**, **aperçu des probabilités** du pool.
- **Ouvrir l'écran de combat** depuis la rencontre générée.
- Panneau **Combats actifs**.

### 16.3 Calendrier, groupes & horloge
- **Horloge de campagne** partagée (avance du temps).
- **Groupes** : créer des groupes, assigner des joueurs (gère le partage de fog of war et les échanges).

### 16.4 Journal d'actions
- Historique en direct de toutes les actions appliquées (effaçable).

*(La messagerie, la radio, les terminaux et le crochetage sont aussi pilotés depuis ce tableau de bord — voir §9, §10, §13, §14.)*

---

## 17. Admin des personnages

**Côté MJ**
- Éditer **toute la fiche** d'un personnage : nom, **faction d'origine**, **rapport aux factions** (Allié/Neutre/Ennemi pour chacune des 8 factions), niveau, XP, attributs, compétences, perks, équipement, code.
- Finaliser un personnage fraîchement créé.

---

## 18. Aspects transversaux

- **Temps réel** : tout passe par Firebase (Firestore). Combats, butin, boutiques, terminaux, crochetage, carte, quêtes, journal, messagerie, radio, horloge sont synchronisés en direct.
- **Alertes contextuelles** sur la fiche du joueur : montée de niveau, butin, proposition d'un joueur, boutique, terminal, crochetage, combat.
- **Notifications** (pastilles) sur les onglets Quêtes/Journal/Encyclopédie tant que le joueur n'a pas ouvert le contenu nouvellement révélé, et sur la messagerie.
- **Révélation par joueur** généralisée : carte, quêtes, encyclopédie — chacun ne voit que ce qui le concerne.
- **Calculs automatiques** selon les règles *Fallout 2D20* : PV max, charge, seuils de réussite, réduction de dégâts par zone, XP/niveaux, survie.
- **Responsive** : s'adapte aux différentes tailles d'écran.

---

## Les 8 factions de l'univers

| Faction | Rôle |
|---|---|
| **La République** | Organisation étatique, ordre et reconstruction |
| **La Commune** | Communautés populaires autonomes |
| **Le NNFP** | Coalition militante et idéologique |
| **Le Réseau** | Réseau clandestin du métro, espionnage/information |
| **Les Zazous** | Contre-culture du jazz et de la mode |
| **Les Ultras** | Bandes violentes et territoriales |
| **L'Abri 74** | Communauté d'abri préservée (faction mineure) |
| **Bourg-de-Bois** | Colonie indépendante de survivants (faction mineure) |

---

## Déroulé d'une partie type

1. Les joueurs **créent leur personnage** (questionnaire d'origine + fiche).
2. Le MJ ouvre la session, fait **avancer le temps** et **dévoile la carte** au fil de l'exploration.
3. À l'arrivée quelque part : **rencontre générée** ou **combat** → bascule sur la battlemap synchronisée.
4. Entre les combats : **quêtes**, **dialogues**, **terminaux à hacker**, **serrures à crocheter**, **butin**, **boutiques**, **échanges** entre joueurs.
5. Les découvertes alimentent le **journal** et l'**encyclopédie** ; les quêtes terminées rapportent de l'**XP** et font monter les personnages en niveau.

---

## En résumé

Fallout Paris transforme une partie de JDR *Fallout* en une **expérience en ligne complète, synchronisée et immersive** : le MJ orchestre tout depuis son tableau de bord, les joueurs vivent l'aventure sur leur Pip-Boy, et l'application gère pour eux les règles, les calculs, les dés, la carte, les combats et la mémoire du monde.
