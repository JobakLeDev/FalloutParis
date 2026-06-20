# Bot Discord — Fallout Paris

Bot Discord pour la campagne *Fallout 2d20 Paris*. Lit la base **Firestore** de la webapp (collection `joueurs`) et gère fiches, notifications et archives de sessions.

## Fonctionnalités

| Commande / Fonction | Description |
|---|---|
| `/fiche personnage:<nom>` | Embed synthétique : faction, niveau/XP, PV, rad, caps, S.P.E.C.I.A.L, compétences taguées, armes/armure équipées, image (si `image`/`portrait`/`img`/`avatar` présent dans la fiche). Autocomplétion par nom. |
| **#fiches-live** (auto) | À chaque modification d'une fiche, poste un message synthétique (seulement les champs qui changent — pas de spam). |
| `/archive-session [nom] [campagne]` | Archive dans **#archives-sessions** les **nouvelles entrées du journal de l'app** (Firestore `journal/<campagne>`) depuis la dernière archive : en-tête (nb, types, période in-game) + **thread** listant les entrées. Mémorise les ids archivés dans `discordBot/state`. Idéal pour des parties en vocal : on note dans le journal de la webapp, le bot en fait l'archive Discord par session. |
| Images | Embeds d'images/maps : upload Discord classique ; `/fiche` affiche le portrait stocké en base. |

## Prérequis

- **Node.js ≥ 18**
- Une **application Discord** (bot) : https://discord.com/developers/applications
  - Onglet **Bot** → copier le **Token**.
  - Aucun intent privilégié requis (l'archive lit le journal Firestore, pas les messages Discord).
  - Inviter le bot avec les scopes `bot` + `applications.commands` et les permissions : *Envoyer des messages*, *Créer des fils publics*.
- Une **clé de service Firebase** (Admin SDK) : Console Firebase → Paramètres du projet → Comptes de service → *Générer une nouvelle clé privée* → enregistrer en `service-account.json` dans ce dossier.

## Installation

```bash
cd discord-bot
npm install
cp .env.example .env      # puis remplir les valeurs
# placer service-account.json ici (ou utiliser FIREBASE_SERVICE_ACCOUNT_JSON)
npm run deploy            # enregistre les commandes slash sur le serveur
npm start                # lance le bot
```

## Variables d'environnement (`.env`)

Voir `.env.example`. En résumé : `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `FICHES_CHANNEL_ID`, `ARCHIVES_CHANNEL_ID`, `SESSION_CHANNEL_ID`, et la clé Firebase (`FIREBASE_SERVICE_ACCOUNT_PATH` **ou** `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID=fallout-paris`).

Pour récupérer les IDs de salons : Discord → Paramètres → Avancés → **Mode développeur**, puis clic droit sur un salon → *Copier l'identifiant*.

## Notes

- Le bot lit la structure Firestore **telle quelle** (`/joueurs/{id}` : `nom, faction, niveau, xp, hp, rad, caps, special{}, taggedSkills[], inventory[], customTitle, campaign, …`).
- L'Admin SDK **ignore les security rules** : aucune modification des règles Firestore n'est nécessaire. Le bot n'écrit que dans `discordBot/state` (suivi des archives).
- PV max affiché = approximation `LCK + END + (niveau-1)` (les perks type *Life Giver* ne sont pas recalculées côté bot).
- Multi-campagnes : `/fiche` affiche la campagne en pied d'embed ; l'autocomplétion indique `[camp]` pour les persos hors Campagne 1.
- Déploiement 24/7 : héberger sur un petit VPS / Railway / Fly.io / Raspberry Pi. Garder le token et la clé de service **hors du repo** (déjà gitignorés).
