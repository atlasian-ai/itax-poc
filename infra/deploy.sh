#!/usr/bin/env bash
# One-time Azure infrastructure setup.
# Run this locally once to create all Azure resources.
# Prerequisites: az CLI logged in, GITHUB_REPO set.
#
# Usage:
#   export GITHUB_REPO=your-github-username/korean-tax-poc
#   bash infra/deploy.sh

set -euo pipefail

RESOURCE_GROUP="korean-tax-rg"
LOCATION="koreacentral"
ENVIRONMENT="korean-tax-env"
APP_NAME="korean-tax-backend"
STATIC_APP_NAME="korean-tax-frontend"

echo "==> Creating resource group"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

echo "==> Creating Container Apps environment (consumption — scales to zero)"
az containerapp env create \
  --name "$ENVIRONMENT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

echo "==> Creating Container App (backend)"
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT" \
  --image "ghcr.io/${GITHUB_REPO}/backend:latest" \
  --registry-server "ghcr.io" \
  --registry-username "${GITHUB_ACTOR:-your-github-username}" \
  --registry-password "${GHCR_PAT}" \
  --target-port 8000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1.0Gi

echo "==> Setting secrets on Container App"
az containerapp secret set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "anthropic-api-key=${ANTHROPIC_API_KEY}" \
    "supabase-url=${SUPABASE_URL}" \
    "supabase-service-role-key=${SUPABASE_SERVICE_ROLE_KEY}" \
    "cors-origins=${CORS_ORIGINS}"

echo "==> Setting environment variables (referencing secrets)"
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    "ANTHROPIC_API_KEY=secretref:anthropic-api-key" \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" \
    "CORS_ORIGINS=secretref:cors-origins"

echo "==> Creating Static Web App (frontend) — free tier"
az staticwebapp create \
  --name "$STATIC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "eastasia" \
  --sku Free \
  --source "https://github.com/${GITHUB_REPO}" \
  --branch main \
  --app-location "frontend" \
  --output-location "dist" \
  --login-with-github

BACKEND_URL=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "==> Done!"
echo "    Backend URL : https://${BACKEND_URL}"
echo "    Set VITE_API_BASE_URL=https://${BACKEND_URL} in GitHub Secrets"
echo "    Set CORS_ORIGINS=https://<your-static-web-app-url> as Container App secret"
