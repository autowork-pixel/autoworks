#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="autoworks-c9a6a"
REGION="asia-northeast3"
SERVICE="autoworks-api-dev"
RUNTIME_SERVICE_ACCOUNT="autoworks-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ "${APPLY_DEV:-}" != "APPLY_DEV" ]]; then
  echo "Refusing to change development resources. Re-run with APPLY_DEV=APPLY_DEV." >&2
  exit 2
fi

declare -A SECRET_ENV=(
  [NAVER_OAUTH_CLIENT_ID]="autoworks-naver-oauth-client-id"
  [NAVER_OAUTH_CLIENT_SECRET]="autoworks-naver-oauth-client-secret"
  [KAKAO_OAUTH_CLIENT_ID]="autoworks-kakao-oauth-client-id"
  [KAKAO_OAUTH_CLIENT_SECRET]="autoworks-kakao-oauth-client-secret"
)

secret_bindings=()
for env_name in NAVER_OAUTH_CLIENT_ID NAVER_OAUTH_CLIENT_SECRET KAKAO_OAUTH_CLIENT_ID KAKAO_OAUTH_CLIENT_SECRET; do
  secret_name="${SECRET_ENV[$env_name]}"
  gcloud secrets describe "$secret_name" --project "$PROJECT_ID" >/dev/null
  enabled_version="$(gcloud secrets versions list "$secret_name" \
    --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')"
  [[ -n "$enabled_version" ]] || { echo "No enabled version for $secret_name" >&2; exit 1; }
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project "$PROJECT_ID" \
    --member "serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
    --role roles/secretmanager.secretAccessor \
    --quiet >/dev/null
  secret_bindings+=("${env_name}=${secret_name}:latest")
done

binding_csv="$(IFS=,; echo "${secret_bindings[*]}")"
gcloud run services update "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-secrets "$binding_csv" \
  --quiet

service_url="$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
[[ "$service_url" == https://* ]] || { echo "Cloud Run URL not found" >&2; exit 1; }
curl --fail --silent --show-error "$service_url/health-check" >/dev/null
echo "OAuth secret references are connected and the public health check passed. Secret values were not read."
