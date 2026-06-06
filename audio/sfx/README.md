# 🔊 Effets sonores d'interface (SFX)

Dépose ici tes fichiers `.mp3` (ou `.ogg`/`.wav`), puis associe-les aux événements
dans [`../../data/sfx.json`](../../data/sfx.json).

## Événements disponibles

| Clé      | Quand le son se joue                                  |
|----------|-------------------------------------------------------|
| `tab`    | changement d'onglet (Général, Inventaire, Carte…)     |
| `click`  | clic sur un bouton de l'interface                     |
| `open`   | ouverture d'une fenêtre (butin, messagerie, boutique) |
| `close`  | fermeture d'une fenêtre                               |
| `equip`  | équiper / déséquiper un objet                         |
| `lvlup`  | ouverture de la montée de niveau                      |
| `alert`  | (réservé)                                             |

## Exemple

```json
{
  "folder": "audio/sfx",
  "volume": 0.5,
  "sounds": {
    "tab":   "pip_tab.mp3",
    "click": "pip_click.mp3",
    "open":  "pip_open.mp3",
    "close": "pip_close.mp3",
    "equip": "pip_equip.mp3"
  }
}
```

- Laisse une valeur **vide `""`** pour ne pas jouer de son sur cet événement.
- `volume` : 0 à 1 (volume global des SFX).
- Garde des fichiers **courts et légers** (clics < 50 Ko).
- Le joueur peut couper les SFX (bouton 🔈 en bas à gauche) — réglage mémorisé.
