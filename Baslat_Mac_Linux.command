#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[Hypotheca] Node.js bulunamadi. Lutfen https://nodejs.org adresinden kurun."
  read -r -p "Kapatmak icin Enter tusuna basin..." _
  exit 1
fi

if [ ! -f ".dev.vars" ] || [ ! -f "dist/index.html" ] || [ ! -f "mcp-server/dist/index.js" ]; then
  echo "[Hypotheca] Ilk kullanim algilandi, otomatik kurulum calistiriliyor..."
  node scripts/kurulum.mjs --auto
fi

echo ""
echo "[Hypotheca] Web paneli baslatiliyor -> http://127.0.0.1:8787"
echo "(Durdurmak icin bu pencereyi kapatabilir veya Ctrl+C tuslayabilirsiniz.)"
npm run worker:dev
