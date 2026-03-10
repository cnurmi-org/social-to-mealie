#!/bin/bash
# register.sh - Register this project service with homeserver repo
# Usage: ./deploy/register.sh [path-to-homeserver-repo]

set -e

HOMESERVER="${1:-$HOME/repo/homeserver}"
PROJECT=$(basename "$(pwd)")
SERVICE_FILE="$HOMESERVER/compose/\$HOSTNAME/$PROJECT.yml"
COMPOSE_FILE="$HOMESERVER/docker-compose-mediasrv.yml"

echo ""
echo "═══════════════════════════════════════"
echo "  📦 Registering: $PROJECT"
echo "═══════════════════════════════════════"
echo ""

# Validate paths
if [ ! -d "$HOMESERVER" ]; then
    echo "❌ Error: Homeserver repo not found at: $HOMESERVER"
    echo "   Usage: ./deploy/register.sh /path/to/homeserver"
    exit 1
fi

if [ ! -f "deploy/service.yml" ]; then
    echo "❌ Error: deploy/service.yml not found"
    echo "   Run this script from the project root directory"
    exit 1
fi

# Copy service file to homeserver (using literal $HOSTNAME in path)
TARGET_DIR="$HOMESERVER/compose/mediasrv"
mkdir -p "$TARGET_DIR"
cp "deploy/service.yml" "$TARGET_DIR/$PROJECT.yml"
echo "✅ Copied service.yml → compose/mediasrv/$PROJECT.yml"

# Check if already in compose include list
INCLUDE_LINE="  - compose/\$HOSTNAME/$PROJECT.yml"
if grep -qF "$INCLUDE_LINE" "$COMPOSE_FILE"; then
    echo "✅ Already registered in docker-compose-mediasrv.yml"
else
    # Add to include list (append to end of file)
    echo "$INCLUDE_LINE" >> "$COMPOSE_FILE"
    echo "✅ Added to docker-compose-mediasrv.yml"
fi

# Check for secrets referenced in service file
echo ""
echo "🔍 Checking for Docker secrets..."
# Extract secrets from the secrets: section
SECRETS=$(sed -n '/secrets:/,/environment:/p' "deploy/service.yml" | grep -E '^\s+- [a-z_]+' | sed 's/.*- //' || true)
if [ -n "$SECRETS" ]; then
    echo "   Secrets required:"
    for secret in $SECRETS; do
        # Check if secret is already defined in compose file
        if grep -qP "^  $secret:" "$COMPOSE_FILE"; then
            echo "   ✅ $secret (already defined)"
        else
            echo "   ⚠️  $secret (needs to be added to docker-compose-mediasrv.yml)"
            echo "       Add this under the secrets: section:"
            echo "       $secret:"
            echo "         file: \$DOCKERDIR/secrets/$secret"
        fi
    done
fi

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ Registration complete!"
echo "═══════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Review changes: cd $HOMESERVER && git diff"
echo "  2. Commit changes: git add -A && git commit -m 'Add $PROJECT service'"
echo "  3. Push to mediasrv: git push origin main"
echo "  4. Deploy on mediasrv:"
echo "     ssh mediasrv 'cd /home/cnurmi/docker && \\"
echo "       git pull && \\"
echo "       docker compose -f docker-compose-mediasrv.yml build $PROJECT && \\"
echo "       docker compose -f docker-compose-mediasrv.yml up -d $PROJECT'"
echo ""
