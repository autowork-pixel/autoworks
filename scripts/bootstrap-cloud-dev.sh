#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-autoworks-c9a6a}"
REGION="${REGION:-asia-northeast3}"
RUNTIME_ACCOUNT_ID="autoworks-api-runtime"
CALLER_ACCOUNT_ID="autoworks-task-caller"
KEYRING="autoworks"
KEY="provider-credentials"
QUEUE="brand-search"
BUDGET_TOPIC="autoworks-budget-alerts"

if [[ "${1:-}" != "APPLY_DEV" ]]; then
  cat <<EOF
개발 인프라 적용 전 확인:
  프로젝트: $PROJECT_ID
  리전: $REGION
  실행 계정: $RUNTIME_ACCOUNT_ID
  호출 계정: $CALLER_ACCOUNT_ID
  KMS: $KEYRING/$KEY
  Tasks 큐: $QUEUE
  예산 알림 topic: $BUDGET_TOPIC

실제 생성은 다음처럼 명시적으로 실행하세요.
  bash scripts/bootstrap-cloud-dev.sh APPLY_DEV
EOF
  exit 0
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
[[ -n "$ACTIVE_ACCOUNT" ]] || { echo "활성 gcloud 계정이 없습니다."; exit 1; }
gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' | grep -qx True || {
  echo "$PROJECT_ID 프로젝트에 결제 계정을 먼저 연결해야 합니다."
  exit 1
}

gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudtasks.googleapis.com cloudkms.googleapis.com cloudscheduler.googleapis.com \
  secretmanager.googleapis.com pubsub.googleapis.com --project "$PROJECT_ID"

ensure_service_account() {
  local id="$1" display="$2"
  local email="$id@$PROJECT_ID.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$email" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$id" --project "$PROJECT_ID" --display-name "$display"
  fi
}
ensure_service_account "$RUNTIME_ACCOUNT_ID" "Autoworks API runtime"
ensure_service_account "$CALLER_ACCOUNT_ID" "Autoworks Tasks and Scheduler caller"

RUNTIME_EMAIL="$RUNTIME_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"
CALLER_EMAIL="$CALLER_ACCOUNT_ID@$PROJECT_ID.iam.gserviceaccount.com"
gcloud beta services identity create --service pubsub.googleapis.com --project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$CALLER_EMAIL" --project "$PROJECT_ID" \
  --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --quiet
gcloud iam service-accounts add-iam-policy-binding "$CALLER_EMAIL" --project "$PROJECT_ID" \
  --member "serviceAccount:$RUNTIME_EMAIL" \
  --role roles/iam.serviceAccountUser --quiet
for role in roles/datastore.user roles/cloudtasks.enqueuer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$RUNTIME_EMAIL" --role "$role" --condition=None --quiet
done

if ! gcloud kms keyrings describe "$KEYRING" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud kms keyrings create "$KEYRING" --location "$REGION" --project "$PROJECT_ID"
fi
if ! gcloud kms keys describe "$KEY" --keyring "$KEYRING" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  NEXT_ROTATION="$(date -u -d '+90 days' '+%Y-%m-%dT%H:%M:%SZ')"
  gcloud kms keys create "$KEY" --keyring "$KEYRING" --location "$REGION" \
    --purpose encryption --rotation-period 7776000s --next-rotation-time "$NEXT_ROTATION" --project "$PROJECT_ID"
fi
gcloud kms keys add-iam-policy-binding "$KEY" --keyring "$KEYRING" --location "$REGION" \
  --project "$PROJECT_ID" --member "serviceAccount:$RUNTIME_EMAIL" \
  --role roles/cloudkms.cryptoKeyEncrypterDecrypter --quiet

if ! gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud tasks queues create "$QUEUE" --location "$REGION" --project "$PROJECT_ID" \
    --max-dispatches-per-second 2 --max-concurrent-dispatches 2
fi
if ! gcloud pubsub topics describe "$BUDGET_TOPIC" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub topics create "$BUDGET_TOPIC" --project "$PROJECT_ID"
fi

KMS_KEY_NAME="projects/$PROJECT_ID/locations/$REGION/keyRings/$KEYRING/cryptoKeys/$KEY"
cat <<EOF

개발 인프라 준비 완료. GitHub development 환경 변수:
  CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT=$RUNTIME_EMAIL
  CLOUD_RUN_TASK_SERVICE_ACCOUNT=$CALLER_EMAIL
  CLOUD_RUN_KMS_KEY_NAME=$KMS_KEY_NAME

Cloud Billing 예산 표시 이름을 autoworks-development-monthly-50000 으로 만들고
projects/$PROJECT_ID/topics/$BUDGET_TOPIC 을 프로그램 알림 topic으로 연결하세요.
EOF

