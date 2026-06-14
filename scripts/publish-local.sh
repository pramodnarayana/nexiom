#!/bin/bash
set -e

echo "Publishing workspace packages to local Verdaccio (http://localhost:4873)..."

export NPM_PUBLISH_REGISTRY="http://localhost:4873/"

# Loop through the specific packages and publish them
# We are publishing them one by one to ensure dependencies are handled correctly
packages=(
  "@soopa/piece-framework"
  "@soopa/domain-tms"
  "@soopa/piece-salesforce"
  "@soopa/application-salesforce-revenova"
  "@soopa/piece-quickbooks"
)

for pkg in "${packages[@]}"; do
  echo "----------------------------------------"
  echo "🚀 Publishing $pkg..."
  echo "----------------------------------------"
  # Using pnpm --filter to target each package
  pnpm --filter="$pkg" publish --registry http://localhost:4873 --no-git-checks
done

echo "✅ All packages published to local Verdaccio!"
