#!/usr/bin/env bash
set -euo pipefail

# Copy only the files needed to run this Electron app on Windows.
# Default destination: C:\Users\<detected-user>\dev\<project-name>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "$SCRIPT_DIR")"

choose_default_dest() {
  local users_root="/c/Users"
  local detected_user="paulh"

  if [[ ! -d "$users_root" ]]; then
    return 1
  fi

  # Try to infer from current Linux username first.
  if [[ -d "$users_root/$USER" ]]; then
    detected_user="$USER"
  else
    # Otherwise choose the first non-system profile directory.
    while IFS= read -r name; do
      case "$name" in
        "All Users"|"Default"|"Default User"|"Public"|"defaultuser0") continue ;;
      esac
      detected_user="$name"
      break
    done < <(ls -1 "$users_root")
  fi

  if [[ -z "$detected_user" ]]; then
    return 1
  fi

  printf '%s\n' "$users_root/$detected_user/dev/$PROJECT_NAME"
}

if [[ $# -ge 1 ]]; then
  DEST_DIR="$1"
else
  if ! DEST_DIR="$(choose_default_dest)"; then
    echo "Could not auto-detect your Windows user directory under /mnt/c/Users."
    echo "Pass destination explicitly, for example:"
    echo "  ./copy_to_win11.sh /mnt/c/Users/<your-windows-user>/dev/$PROJECT_NAME"
    exit 1
  fi
fi

if [[ "$DEST_DIR" == /mnt/c/* && ! -d /mnt/c ]]; then
  echo "Windows C: drive is not mounted at /mnt/c."
  echo "Run this script from WSL with C: mounted, or pass a destination on an available mount."
  exit 1
fi

mkdir -p "$DEST_DIR"

echo "Copying required Electron files to: $DEST_DIR"

rsync -av --delete \
  --include='/flashcard.html' \
  --include='/main.js' \
  --include='/preload.js' \
  --include='/package.json' \
  --include='/package-lock.json' \
  --include='/.env.example' \
  --include='/words.json' \
  --include='/src/***' \
  --exclude='*' \
  "$SCRIPT_DIR/" "$DEST_DIR/"

echo
echo "Done. Next steps on Windows (PowerShell):"
echo "  cd $DEST_DIR"
echo "  npm install"
echo "  copy .env.example .env   # then set GEMINI_API_KEY"
echo "  npm start"
