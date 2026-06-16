#!/bin/bash
set -e

echo "Publishing workspace packages to local Verdaccio (http://localhost:4873)..."

export NPM_PUBLISH_REGISTRY="http://localhost:4873/"

# Loop through the specific packages and publish them
# We are publishing them one by one to ensure dependencies are handled correctly
packages=(
  "@soopa/domain-tms"
  "@soopa/piece-salesforce"
  "@soopa/application-salesforce-revenova"
  "@soopa/piece-quickbooks"
)

for pkg in "${packages[@]}"; do
  echo "----------------------------------------"
  echo "🚀 Publishing $pkg..."
  echo "----------------------------------------"
  # Unpublish first to remove the conflict in Verdaccio
  npm unpublish --registry http://localhost:4873 "$pkg" --force 2>/dev/null || true
  
  # Using pnpm --filter to target each package and --force to override existing versions in Verdaccio
  pnpm --filter="$pkg" publish --registry http://localhost:4873 --no-git-checks --force
done

echo "✅ All packages published to local Verdaccio!"
