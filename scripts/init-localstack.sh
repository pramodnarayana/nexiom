#!/bin/bash
# Creates all SQS queues and a KMS key required by the application.
# Runs automatically inside LocalStack on startup via the init scripts mechanism.
# See: https://docs.localstack.cloud/references/init-hooks/
#
# Uses `awslocal` (the LocalStack CLI wrapper) which automatically injects the
# correct endpoint and region — no explicit --endpoint-url / --region needed.

set -euo pipefail

echo "[init-localstack] Creating SQS queues..."

QUEUES=(
  "inbound-queue"
  "replica-queue"
  "normalized-queue"
  "delivery-queue"
  "gitops-queue"
  "tenant-provision-queue"
)

# Step 1: Create all DLQs first (no redrive policy); idempotent — ignore
# QueueAlreadyExists by creating without attributes then setting them.
for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="${QUEUE}-dlq"
  awslocal sqs create-queue --queue-name "$DLQ_NAME" > /dev/null
  echo "[init-localstack]   ✓ $DLQ_NAME"
done

# Step 2: Create main queues and apply redrive policies pointing to their DLQs.
# Two-step approach (create then set-queue-attributes) avoids failure when the
# queue already exists with different attributes (QueueAlreadyExists error).
for QUEUE in "${QUEUES[@]}"; do
  DLQ_NAME="${QUEUE}-dlq"

  DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$DLQ_NAME" --query 'QueueUrl' --output text)
  DLQ_ARN=$(awslocal sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

  # Get existing queue URL; create only when missing so CreateQueue never sees
  # a QueueAlreadyExists-with-different-attributes error.
  if ! QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "$QUEUE" --query 'QueueUrl' --output text 2>/dev/null); then
    awslocal sqs create-queue --queue-name "$QUEUE" > /dev/null
    QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "$QUEUE" --query 'QueueUrl' --output text)
  fi

  REDRIVE_POLICY_JSON=$(printf '{"RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' "$DLQ_ARN")
  awslocal sqs set-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attributes "$REDRIVE_POLICY_JSON" > /dev/null
  echo "[init-localstack]   ✓ $QUEUE (redrive → $DLQ_NAME)"
done

echo "[init-localstack] Creating KMS key..."
# Idempotent: reuse the existing alias/nexiom-local key if it already exists.
KEY_ID=$(awslocal kms list-aliases \
  --query "Aliases[?AliasName=='alias/nexiom-local'].TargetKeyId | [0]" \
  --output text)

if [ "$KEY_ID" = "None" ] || [ -z "$KEY_ID" ]; then
  KEY_ID=$(awslocal kms create-key --description "nexiom-local-dev-key" --query 'KeyMetadata.KeyId' --output text)
  awslocal kms create-alias --alias-name "alias/nexiom-local" --target-key-id "$KEY_ID"
fi
echo "[init-localstack]   ✓ alias/nexiom-local → $KEY_ID"

echo "[init-localstack] Done."
