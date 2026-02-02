#!/bin/bash
# Deploy the agent-worker container to Azure Container Registry
set -e

# Configuration from Terraform outputs
ACR_NAME="claudeswarmdevigbagp"
ACR_URL="${ACR_NAME}.azurecr.io"
IMAGE_NAME="claude-agent-worker"
TAG="${1:-latest}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DEPLOYING CLAUDE AGENT WORKER                           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Registry: $ACR_URL"
echo "║  Image:    $IMAGE_NAME:$TAG"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Login to Azure Container Registry
echo "🔐 Logging into Azure Container Registry..."
az acr login --name "$ACR_NAME"

# Step 2: Build the container
echo ""
echo "🔨 Building container..."
docker build -t "$IMAGE_NAME:$TAG" -f services/agent-worker/Dockerfile .

# Step 3: Tag for ACR
echo ""
echo "🏷️  Tagging for ACR..."
docker tag "$IMAGE_NAME:$TAG" "$ACR_URL/$IMAGE_NAME:$TAG"

# Step 4: Push to ACR
echo ""
echo "📤 Pushing to Azure Container Registry..."
docker push "$ACR_URL/$IMAGE_NAME:$TAG"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ DEPLOYMENT COMPLETE                                   ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Image: $ACR_URL/$IMAGE_NAME:$TAG"
echo "║                                                          ║"
echo "║  The Container Apps Job will use this image on next run ║"
echo "╚══════════════════════════════════════════════════════════╝"
