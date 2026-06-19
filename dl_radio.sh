#!/usr/bin/env bash
# ============================================================
# dl_radio.sh — Télécharge des vidéos YouTube en MP3 dans ./radio/
# Nécessite : yt-dlp + ffmpeg.
#   Installation (Windows) : winget install --source winget yt-dlp.yt-dlp Gyan.FFmpeg
# Note : l'environnement intercepte le TLS → --no-check-certificates.
# ============================================================
set -uo pipefail

OUT_DIR="./radio"
mkdir -p "$OUT_DIR"

URLS=(
  "https://youtu.be/-1HZGZNP_bU"
  "https://youtu.be/zLtntRFuyZs"
  "https://youtu.be/tjYXmAvbZeM"
  "https://youtu.be/v0nlnUDKT1s"
  "https://youtu.be/_sCjV4sLeqA"
  "https://youtu.be/qKDg54liJjs"
  "https://youtu.be/IhZzxR-I8lE"
)

# --- Localiser yt-dlp ---
YTDLP="$(command -v yt-dlp || true)"
[ -z "$YTDLP" ] && for c in \
  "/c/Users/$USER/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe/yt-dlp.exe" \
  "./yt-dlp.exe"; do [ -x "$c" ] && YTDLP="$c" && break; done
if [ -z "$YTDLP" ]; then echo "❌ yt-dlp introuvable (winget install --source winget yt-dlp.yt-dlp)"; exit 1; fi

# --- Localiser ffmpeg (dossier bin) ---
FF_ARG=()
FFEXE="$(command -v ffmpeg || true)"
if [ -n "$FFEXE" ]; then FF_ARG=(--ffmpeg-location "$(dirname "$FFEXE")"); else
  FFBIN="$(find "/c/Users/$USER/AppData/Local/Microsoft/WinGet/Packages" -iname ffmpeg.exe 2>/dev/null | head -1)"
  [ -n "$FFBIN" ] && FF_ARG=(--ffmpeg-location "$(dirname "$FFBIN")")
fi

echo "▶ yt-dlp : $YTDLP"
"$YTDLP" --no-check-certificates --no-playlist -x --audio-format mp3 --audio-quality 0 \
  "${FF_ARG[@]}" -o "$OUT_DIR/%(title)s.mp3" "${URLS[@]}"

echo ""
echo "============================================================"
echo "Terminé. MP3 dans : $(cd "$OUT_DIR" && pwd)"
ls -1 "$OUT_DIR"/*.mp3 2>/dev/null || echo "(aucun .mp3)"
