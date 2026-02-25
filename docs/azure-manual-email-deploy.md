# Manual Azure deployment (email notifications only)

Use this guide if you want to deploy manually in Azure Portal/CLI without GitHub Actions and only send email notifications.

## 1) Prerequisites

- Azure subscription with permission to create resources.
- A Microsoft 365 tenant (Entra ID) where you can register an app and grant admin consent.
- A mailbox to send from (`SENDER_UPN`).
- Local tools:
  - Azure CLI (`az`)
  - Azure Functions Core Tools v4 (`func`)
  - Node.js 20+

## 2) Create Azure resources

Example variables:

```bash
RG=rg-proxazr-notifyer
LOC=eastus
ST=stproxazrnotifyer01
PLAN=asp-proxazr-notifyer
APP=func-proxazr-notifyer
```

Create the resource group, storage, App Service plan, and function app:

```bash
az group create -n "$RG" -l "$LOC"
az storage account create -g "$RG" -n "$ST" -l "$LOC" --sku Standard_LRS
az functionapp plan create -g "$RG" -n "$PLAN" --location "$LOC" --sku B1 --is-linux
az functionapp create \
  -g "$RG" \
  -n "$APP" \
  --storage-account "$ST" \
  --plan "$PLAN" \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4
```

> Notes:
> - Consumption or Elastic Premium plans also work.
> - If your org requires VNet/private endpoints, apply those controls before exposing webhook endpoints.

## 3) Configure Entra app for Graph Mail.Send

Follow the Graph setup guide in this repo, then come back here:

- `docs/entra-graph-setup.md`
- `docs/exchange-app-access-policy.md` (recommended restriction)

At minimum for email mode:
- Application permission: `Mail.Send`
- Admin consent granted
- Client secret created

Record:
- `TENANT_ID`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `SENDER_UPN`

## 4) Set Function App settings (email only)

Set `CHANNELS=email` and do not enable Teams settings.

```bash
az functionapp config appsettings set -g "$RG" -n "$APP" --settings \
  PROXMOX_WEBHOOK_SECRET='replace-with-strong-random-secret' \
  SECRET_HEADER_NAME='x-proxmox-secret' \
  CHANNELS='email' \
  SUBJECT_PREFIX='[Proxmox]' \
  TENANT_ID='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \
  CLIENT_ID='yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy' \
  CLIENT_SECRET='your-client-secret' \
  SENDER_UPN='alerts@contoso.com' \
  ALLOWED_RECIPIENTS='ops@contoso.com' \
  MAX_BODY_CHARS='10000'
```

Optional hardening:
- `DEBUG=false`
- `INCLUDE_RAW_JSON=false`

## 5) Deploy the function code manually

From the repository root:

```bash
npm ci
func azure functionapp publish "$APP" --javascript
```

## 6) Validate endpoint and test delivery

Get the function base URL:

```bash
az functionapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv
```

Send a test event:

```bash
curl -i -X POST "https://<FUNCTION_HOST>/api/proxmox/webhook" \
  -H "Content-Type: application/json" \
  -H "x-proxmox-secret: replace-with-strong-random-secret" \
  -d '{
    "id": "evt-manual-001",
    "severity": "warning",
    "node": "pve-01",
    "message": "Manual Azure deployment test",
    "vmid": 101,
    "status": "ok",
    "timestamp": "2026-01-01T00:00:00Z"
  }'
```

Expected result:
- HTTP `200` from the function.
- Email received by addresses in `ALLOWED_RECIPIENTS`.

## 7) Point Proxmox webhook to Azure

In Proxmox webhook target settings:
- URL: `https://<FUNCTION_HOST>/api/proxmox/webhook`
- Method: `POST`
- Header: `x-proxmox-secret: <same secret as PROXMOX_WEBHOOK_SECRET>`
- Content type: `application/json`

Use `docs/proxmox-webhook-setup.md` for detailed Proxmox-side steps.

## 8) Operations checklist

- Store secrets in Key Vault and reference them from App Settings when possible.
- Restrict mailbox scope using Exchange Application Access Policy.
- Keep `ALLOWED_RECIPIENTS` minimal (distribution list preferred).
- Enable Application Insights and alerting on 4xx/5xx responses.
- Rotate `PROXMOX_WEBHOOK_SECRET` and `CLIENT_SECRET` periodically.
