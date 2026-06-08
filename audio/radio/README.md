# Radios — pistes audio

Chaque station de radio a son **dossier** ici :

| Station        | Dossier                  |
|----------------|--------------------------|
| Radio République | `audio/radio/republique` |
| Radio NNFP       | `audio/radio/nnfp`       |
| Radio Zazous     | `audio/radio/zazous`     |
| Ambiance         | `audio/radio/ambiance`   |

## Ajouter une chanson à une radio

1. Dépose le fichier `.mp3` (ou `.ogg` / `.m4a`) dans le dossier de la station.
2. Ajoute le **nom du fichier** dans la liste `tracks` de cette station dans **`data/radio.json`**.
   > GitHub Pages ne peut pas lister automatiquement le contenu d'un dossier : il faut donc déclarer chaque piste dans `radio.json`.
3. Commit + push (sur `dev`) → la piste est disponible dans le panneau Radio du MJ.

### Exemple (`data/radio.json`)
```json
{
  "id": "republique",
  "name": "Radio République",
  "folder": "audio/radio/republique",
  "tracks": ["discours_president.mp3", "marche_militaire.mp3"]
}
```

## Ajouter une NOUVELLE radio
1. Crée un dossier `audio/radio/<id>/`.
2. Ajoute une entrée station dans `data/radio.json` avec `id`, `name`, `folder` (= le dossier) et `tracks`.

Le MJ diffuse une station/piste depuis l'écran MJ (panneau **Radio**) ; les joueurs la suivent en temps réel (`/radio/current`).
