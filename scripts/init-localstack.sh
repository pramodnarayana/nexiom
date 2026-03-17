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
)

# Step 1: Create all DLQs first (no redrive policy)
for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="${QUEUE}-dlq"
  $AWS sqs create-queue --queue-name "$DLQ_NAME" > /dev/null
  echo "[init-localstack]   ✓ $DLQ_NAME"
done

# Step 2: Create main queues with redrive policies pointing to their DLQs
for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="${QUEUE}-dlq"

  DLQ_URL=$($AWS sqs get-queue-url --queue-name "$DLQ_NAME" --query 'QueueUrl' --output text)
  DLQ_ARN=$($AWS sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

  REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"

  $AWS sqs create-queue \
    --queue-name "$QUEUE" \
    --attributes "RedrivePolicy=${REDRIVE_POLICY}" > /dev/null
  echo "[init-localstack]   ✓ $QUEUE (redrive → $DLQ_NAME)"
done

echo "[init-localstack] Creating KMS key..."
KEY_ID=$($AWS kms create-key --description "nexiom-local-dev-key" --query 'KeyMetadata.KeyId' --output text)
$AWS kms create-alias --alias-name "alias/nexiom-local" --target-key-id "$KEY_ID"
echo "[init-localstack]   ✓ alias/nexiom-local → $KEY_ID"

echo "[init-localstack] Done."
