#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[Hypotheca] Node.js bulunamadi."
  echo "Lutfen https://nodejs.org adresinden LTS surumunu kurup tekrar deneyin."
  echo ""
  read -r -p "Kapatmak icin Enter tusuna basin..." _
  exit 1
fi

node scripts/kurulum.mjs

echo ""
read -r -p "Kapatmak icin Enter tusuna basin..." _
