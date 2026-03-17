#!/bin/bash
# Creates all SQS queues and a KMS key required by the application.
# Runs automatically inside LocalStack on startup via the init scripts mechanism.
# See: https://docs.localstack.cloud/references/init-hooks/

set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

AWS="aws --endpoint-url=$ENDPOINT --region=$REGION"

echo "[init-localstack] Creating SQS queues..."

QUEUES=(
  "inbound-queue"
  "replica-queue"
  "normalized-queue"
  "delivery-queue"
  "inbound-queue-dlq"
  "replica-queue-dlq"
  "normalized-queue-dlq"
  "delivery-queue-dlq"
)

for QUEUE in "${QUEUES[@]}"; do
  $AWS sqs create-queue --queue-name "$QUEUE" > /dev/null
  echo "[init-localstack]   ✓ $QUEUE"
done

echo "[init-localstack] Creating KMS key..."
KEY_ID=$($AWS kms create-key --description "nexiom-local-dev-key" --query 'KeyMetadata.KeyId' --output text)
$AWS kms create-alias --alias-name "alias/nexiom-local" --target-key-id "$KEY_ID"
echo "[init-localstack]   ✓ alias/nexiom-local → $KEY_ID"

echo "[init-localstack] Done."
