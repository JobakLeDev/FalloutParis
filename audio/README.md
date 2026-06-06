# 🎵 Audio — Radio

Dépose ici tes fichiers `.mp3` (ou `.ogg`/`.m4a`), puis liste-les dans
[`../data/radio.json`](../data/radio.json).

## Comment ajouter des morceaux

1. Copie le fichier dans ce dossier, ex. `audio/civilisation.mp3`.
2. Ouvre `data/radio.json` et ajoute le **nom du fichier** dans la station voulue :

```json
{
  "folder": "audio",
  "stations": [
    {
      "id": "libre",
      "name": "Radio Libre Paris",
      "desc": "Chansons d'avant-guerre",
      "tracks": ["civilisation.mp3", "uranium-fever.mp3"]
    }
  ]
}
```

3. Commit + push. La radio apparaît dans l'onglet **RADIO** de la fiche joueur.

Notes :
- `folder` = le nom de ce dossier (ne pas changer sauf si tu le renommes).
- Un `track` peut aussi être une URL complète (`https://…`) si l'hébergeur l'autorise (CORS).
- Évite les noms avec accents/espaces compliqués ; sinon ça marche quand même mais reste prudent.
- Droits : n'utilise que des fichiers que tu as le droit d'héberger.
