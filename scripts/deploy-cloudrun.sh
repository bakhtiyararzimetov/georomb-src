#!/usr/bin/env bash
# Выкладка API в Google Cloud Run (запускать в Cloud Shell или там, где есть gcloud).
#   API_KEYS=gr_… bash scripts/deploy-cloudrun.sh
# Необязательно: REGION (europe-west1), SERVICE (georomb-api), RATE_LIMIT (60).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${API_KEYS:?Задайте ключ: API_KEYS=gr_… (создать — npm run api-key)}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-georomb-api}"

# --allow-unauthenticated: вход проверяет сам сервер по ключу API (бот не умеет входить через Google).
# --max-instances 1: один экземпляр — лимит запросов считается верно и счёт не вырастет неожиданно.
# Разделитель ^@^ — чтобы запятые между ключами не ломали --set-env-vars.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 \
  --max-instances 1 \
  --timeout 120 \
  --set-env-vars "^@^API_KEYS=${API_KEYS}@TRUST_PROXY=1@RATE_LIMIT=${RATE_LIMIT:-60}"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
echo
echo "Готово: $URL/docs"
