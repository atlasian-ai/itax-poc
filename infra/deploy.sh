#!/usr/bin/env bash
# One-time Azure infrastructure setup.
# Run this locally once to create all Azure resources.
#
# Prerequisites:
#   - az CLI installed and logged in (az login)
#   - All environment variables below set in your shell
#
# Usage:
#   export GHCR_PAT=<your GitHub PAT with read:packages scope>
#   export ANTHROPIC_API_KEY=<your key>
#   export SUPABASE_URL=<your supabase url>
#   export SUPABASE_SERVICE_ROLE_KEY=<your key>
#   export ADMIN_EMAIL=<your admin email>
#   export ADMIN_PASSWORD=<your admin password>
#   export JWT_SECRET=<a long random string>
#   bash infra/deploy.sh

set -euo pipefail

GITHUB_REPO="atlasian-ai/itax-poc"
RESOURCE_GROUP="itax-rg"
LOCATION="koreacentral"
ENVIRONMENT="itax-env"
APP_NAME="itax-backend"
STATIC_APP_NAME="itax-frontend"

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
  --registry-username "${GITHUB_ACTOR:-atlasian-ai}" \
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
    "admin-email=${ADMIN_EMAIL}" \
    "admin-password=${ADMIN_PASSWORD}" \
    "jwt-secret=${JWT_SECRET}"

echo "==> Setting environment variables (referencing secrets)"
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    "ANTHROPIC_API_KEY=secretref:anthropic-api-key" \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" \
    "ADMIN_EMAIL=secretref:admin-email" \
    "ADMIN_PASSWORD=secretref:admin-password" \
    "JWT_SECRET=secretref:jwt-secret"

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

FRONTEND_URL=$(az staticwebapp show \
  --name "$STATIC_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "defaultHostname" -o tsv)

echo ""
echo "==> Done! Next steps:"
echo ""
echo "  1. Add CORS_ORIGINS secret to Container App:"
echo "     az containerapp secret set --name $APP_NAME --resource-group $RESOURCE_GROUP \\"
echo "       --secrets cors-origins=https://${FRONTEND_URL}"
echo "     az containerapp update --name $APP_NAME --resource-group $RESOURCE_GROUP \\"
echo "       --set-env-vars CORS_ORIGINS=secretref:cors-origins"
echo ""
echo "  2. Add these GitHub Secrets (Settings → Secrets → Actions):"
echo "     VITE_API_BASE_URL   = https://${BACKEND_URL}"
echo "     AZURE_STATIC_WEB_APPS_API_TOKEN  = (from Azure portal → Static Web App → Manage token)"
echo "     AZURE_CLIENT_ID     = (from service principal — see README)"
echo "     AZURE_TENANT_ID     = (from service principal)"
echo "     AZURE_SUBSCRIPTION_ID = $(az account show --query id -o tsv)"
echo ""
echo "  3. Push any change to main to trigger the first CI/CD build"
