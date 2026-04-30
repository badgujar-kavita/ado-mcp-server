#!/bin/bash
# Build script for Vercel deployment
# Creates the distribution tarball for ado-testforge MCP

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBSITE_DIR="$REPO_ROOT/website"
OUTPUT_DIR="$WEBSITE_DIR/public"
TARBALL="$OUTPUT_DIR/ado-testforge.tar.gz"

echo "📦 Installing dependencies..."
cd "$REPO_ROOT"
npm install --silent --no-fund --no-audit

echo "🔨 Building distribution package..."
npm run build:dist
echo "✅ Distribution package built to dist-package/"

echo "📦 Creating distribution tarball..."

# Create tarball from dist-package
cd "$REPO_ROOT/dist-package"
tar -czf "$TARBALL" .

SIZE=$(ls -lh "$TARBALL" | awk '{print $5}')
echo "✅ Created: ado-testforge.tar.gz ($SIZE)"

echo ""
echo "🎉 Build complete! Ready for Vercel deployment."
