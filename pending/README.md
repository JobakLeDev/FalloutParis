# /pending — Code débranchement temporaire

Ce répertoire contient les fonctionnalités et données qui ont été **débranchées** de la branche de production, mais dont on veut garder le code pour les réactiver plus tard.

## Contenu

### `pages/encyclopedie/`
Page d'encyclopédie — fonctionnalité de lore/bestiaire.

**Raison du débranches** : À déclarer au MJ en attendant une refonte du contenu.

**Code supprimé/commenté** :
- Lien "📚 Encyclo." supprimé de :
  - `pages/admin_perso/admin_perso.html`
  - `pages/carte/carte.html`
  - `pages/journal/journal.html`
- Tab "ENCYCLO" supprimé de `pages/fiche_perso/fiche_perso.html`
- Chargement commenté dans `common/db.js` (placeholder ajouté pour ne pas casser l'indexage)
- Code Firebase commenté dans :
  - `pages/carte/carte.js` (`revealEncyLieu`)
  - `pages/creation_perso/creation_perso.js` (initialisation faction)

### `data/encyclopedie.json`
Contenu statique de l'encyclopédie (lieux, personnages, bestiaire, timeline).

## Réactivation

Pour réactiver l'encyclopédie, il faut :
1. Restaurer les fichiers depuis ce répertoire
2. Dé-commenter le code Firebase
3. Ajouter les liens/tabs back
4. Recharger `common/db.js`

---

**État** : À l'état de repos depuis 2026-07-22
