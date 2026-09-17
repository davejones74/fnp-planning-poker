<#
.SYNOPSIS
    Provision free-tier Azure resources for the Planning Poker app and print
    the Static Web Apps deployment token.

.DESCRIPTION
    Creates:
      - Resource group
      - Cosmos DB account (Table API, free/shared throughput capable)
      - Web PubSub (Free_F1)
      - Static Web App (managed, linked to nothing)

    Then wires the API's environment settings into the Static Web App so the
    Functions backend can reach Cosmos and Web PubSub, and finally prints the
    SWA deployment token. Paste that token into the GitHub secret named
    AZURE_STATIC_WEB_APPS_API_TOKEN (Settings > Secrets and variables >
    Actions) and push to master - the workflow in
    .github/workflows/azure-static-web-apps.yml deploys.

.PARAMETER NamePrefix
    Short lowercase prefix used to build globally unique resource names.

.PARAMETER ResourceGroup
    Name of the resource group to create. Defaults to "planning-poker".

.PARAMETER Location
    Azure region for Cosmos DB and Web PubSub, e.g. uksouth. Defaults to uksouth.

.PARAMETER SwaLocation
    Azure region for the Static Web App. Static Web Apps are only available in a
    few regions (e.g. eastus2), which can differ from Cosmos/Web PubSub.
    Defaults to eastus2.

.PARAMETER Hub
    Web PubSub hub name the app connects through. Defaults to fnp.

.EXAMPLE
    ./azure-setup.ps1
#>
param(
    [string]$NamePrefix = "fnppoker",
    [string]$ResourceGroup = "planning-poker",
    [string]$Location = "uksouth",
    [string]$SwaLocation = "eastus2",
    [string]$Hub = "fnp"
)

$ErrorActionPreference = "Continue"

# az provider register writes a "Registering is still on-going" WARNING to stderr
# even on success. Under $ErrorActionPreference="Stop" PowerShell 5.1 escalates
# that stderr output to a terminating error, aborting the script. We keep
# "Continue" and rely on the explicit $LASTEXITCODE checks after each az call.

function Get-Name([string]$suffix) {
    $n = "$NamePrefix$suffix"
    if ($n.Length -gt 24) { $n = $n.Substring(0, 24) }
    return $n
}

Write-Host "Checking Azure CLI login..." -ForegroundColor Cyan
az account show --output none | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Not signed in. Run 'az login' first."
}

# Some commands (webpubsub) ship as CLI extensions. Install them silently so the
# script never blocks on an interactive "install now?" prompt.
Write-Host "Installing required Azure CLI extensions..." -ForegroundColor Cyan
az extension add --name webpubsub --allow-preview true --yes --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install the 'webpubsub' CLI extension. Run 'az extension add -n webpubsub --allow-preview true -y' manually."
}

# Fresh personal subscriptions often have their resource providers unregistered;
# creating a resource before the provider is "Registered" fails with
# MissingSubscriptionRegistration. Register each and wait for it to finish.
$providers = @("Microsoft.DocumentDB", "Microsoft.SignalRService", "Microsoft.Web")
foreach ($provider in $providers) {
    Write-Host "Registering resource provider $provider..." -ForegroundColor Cyan
    az provider register --namespace $provider --output none 2>$null
    $deadline = (Get-Date).AddMinutes(5)
    $state = ""
    while ($state -ne "Registered" -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $state = az provider show --namespace $provider --query registrationState --output tsv
    }
    if ($state -ne "Registered") {
        throw "Resource provider $provider did not finish registering in 5 minutes. Re-run this script."
    }
}

Write-Host "Creating resource group $ResourceGroup..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to create resource group." }

$cosmosName  = Get-Name "cosmos"
$wpsName     = Get-Name "wps"
$swaName     = Get-Name "swa"

az cosmosdb show --name $cosmosName --resource-group $ResourceGroup --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Cosmos account $cosmosName already exists, skipping creation." -ForegroundColor DarkGray
} else {
    Write-Host "Creating Cosmos DB Table API account $cosmosName..." -ForegroundColor Cyan
    az cosmosdb create `
        --name $cosmosName `
        --resource-group $ResourceGroup `
        --locations regionName=$Location failoverPriority=0 `
        --capabilities EnableTable `
        --enable-free-tier `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Cosmos account." }
}

az webpubsub show --name $wpsName --resource-group $ResourceGroup --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Web PubSub $wpsName already exists, skipping creation." -ForegroundColor DarkGray
} else {
    Write-Host "Creating Web PubSub $wpsName..." -ForegroundColor Cyan
    az webpubsub create `
        --name $wpsName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Free_F1 `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Web PubSub." }
}

az staticwebapp show --name $swaName --resource-group $ResourceGroup --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Static Web App $swaName already exists, skipping creation." -ForegroundColor DarkGray
} else {
    Write-Host "Creating Static Web App $swaName..." -ForegroundColor Cyan
    az staticwebapp create `
        --name $swaName `
        --resource-group $ResourceGroup `
        --location $SwaLocation `
        --sku Free `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Static Web App." }
}

Write-Host "Collecting connection strings..." -ForegroundColor Cyan
$cosmosCs = az cosmosdb keys list `
    --name $cosmosName `
    --resource-group $ResourceGroup `
    --type connection-strings `
    --query "connectionStrings[?contains(description, 'Table')].connectionString" `
    --output tsv | Select-Object -First 1
if (-not $cosmosCs) {
    $cosmosCs = az cosmosdb keys list `
        --name $cosmosName `
        --resource-group $ResourceGroup `
        --type connection-strings `
        --query "connectionStrings[0].connectionString" `
        --output tsv
}
if (-not $cosmosCs) { throw "Could not read Cosmos Table connection string." }

$wpsCs = az webpubsub key show `
    --name $wpsName `
    --resource-group $ResourceGroup `
    --query primaryConnectionString `
    --output tsv
if (-not $wpsCs) { throw "Could not read Web PubSub connection string." }

Write-Host "Setting app settings on $swaName..." -ForegroundColor Cyan
az staticwebapp appsettings set `
    --name $swaName `
    --resource-group $ResourceGroup `
    --setting-names "COSMOS_TABLE_CONNECTION_STRING=$cosmosCs" "WEB_PUBSUB_CONNECTION_STRING=$wpsCs" "WEB_PUBSUB_HUB=$Hub" `
    --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to set app settings." }

$defaultHost = az staticwebapp show `
    --name $swaName `
    --resource-group $ResourceGroup `
    --query defaultHostname `
    --output tsv
if (-not $defaultHost) { throw "Could not read the Static Web App hostname." }

# Presence (online/offline dots) and connection accounting depend on Web PubSub
# delivering connect/disconnect events to the API. Without this hub event
# handler the app works but every participant stays "online" forever.
Write-Host "Configuring Web PubSub hub '$Hub' event handlers..." -ForegroundColor Cyan
az webpubsub hub show --name $wpsName --resource-group $ResourceGroup --hub-name $Hub --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    az webpubsub hub update `
        --name $wpsName `
        --resource-group $ResourceGroup `
        --hub-name $Hub `
        --allow-anonymous false `
        --event-handler "url-template=https://$defaultHost/api/pubsub/events" "system-event=connected" "system-event=disconnected" `
        --output none
} else {
    az webpubsub hub create `
        --name $wpsName `
        --resource-group $ResourceGroup `
        --hub-name $Hub `
        --allow-anonymous false `
        --event-handler "url-template=https://$defaultHost/api/pubsub/events" "system-event=connected" "system-event=disconnected" `
        --output none
}
if ($LASTEXITCODE -ne 0) { throw "Failed to configure the Web PubSub hub event handler." }

$token = az staticwebapp secrets list `
    --name $swaName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" `
    --output tsv
if (-not $token) { throw "Could not read deployment token." }

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Provisioning complete." -ForegroundColor Green
Write-Host "  Site will be at: https://$defaultHost" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps (only the token is secret - do not commit it):" -ForegroundColor Cyan
Write-Host "  1. GitHub repo  >  Settings  >  Secrets and variables  >  Actions" -ForegroundColor Yellow
Write-Host "  2. New repository secret: AZURE_STATIC_WEB_APPS_API_TOKEN" -ForegroundColor Yellow
Write-Host "  3. Paste the token below as the value." -ForegroundColor Yellow
Write-Host "  4. Push to 'master' - the workflow .github/workflows/azure-static-web-apps.yml deploys." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Deployment token: $token" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Optional: Jira integration is not configured. To enable, add" -ForegroundColor DarkGray
Write-Host "  JIRA_CLIENT_ID, JIRA_CLIENT_SECRET, JIRA_REDIRECT_URI and JIRA_HOST" -ForegroundColor DarkGray
Write-Host "  via: az staticwebapp appsettings set ... --setting-names ..." -ForegroundColor DarkGray