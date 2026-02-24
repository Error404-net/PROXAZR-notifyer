# PROXAZR-notifyer

Production-ready Azure Function (Node.js, Azure Functions v4) that receives Proxmox webhook notifications and forwards them to:
- **Email via Microsoft Graph (app-only)**
- **Microsoft Teams** via Incoming Webhook or Graph channel message

## File tree

```text
.
├── .env.example
├── .github/workflows/deploy.yml
├── .gitignore
├── eslint.config.js
├── host.json
├── package.json
├── src/functions/proxmoxWebhook.js
└── docs
    ├── azure-oidc-setup.md
    ├── entra-graph-setup.md
    ├── exchange-app-access-policy.md
    ├── proxmox-webhook-setup.md
    └── teams-webhook-setup.md
```

## App behavior

- Route: `POST /api/proxmox/webhook`
- Accepts only POST
- Validates shared secret header (`SECRET_HEADER_NAME`, default `x-proxmox-secret`)
- Parses JSON and normalizes to:
  - `{ title, severity, source, details, rawJson?, eventId? }`
- Delivery channels from `CHANNELS=email,teams`
- Returns clear status codes:
  - `401` for bad secret
  - `400/415` for validation
  - `502` delivery errors

## Required app settings

### Core
- `PROXMOX_WEBHOOK_SECRET`
- `SECRET_HEADER_NAME` (optional, default `x-proxmox-secret`)
- `CHANNELS` (`email`, `teams`, or both)
- `SUBJECT_PREFIX` (optional, default `[Proxmox]`)
- `DEBUG` (optional)

### Email (Graph app-only)
- `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`
- `SENDER_UPN`
- `ALLOWED_RECIPIENTS` (CSV)

### Teams
- `TEAMS_MODE=webhook|graph`
- Webhook mode:
  - `TEAMS_WEBHOOK_URLS` (CSV of approved URLs)
  - optional `TEAMS_ALLOWED_HOST_PATTERNS`
- Graph mode:
  - `TEAMS_TENANT_ID` / fallback to `TENANT_ID`
  - `TEAMS_CLIENT_ID` / fallback to `CLIENT_ID`
  - `TEAMS_CLIENT_SECRET` / fallback to `CLIENT_SECRET`
  - `TEAMS_TEAM_ID`, `TEAMS_CHANNEL_ID`
  - `ALLOWED_TEAMS_TARGETS` as `teamId:channelId,teamId:channelId`

## Security controls implemented

### Email controls
- Sender must equal `SENDER_UPN`
- Recipients must be subset of `ALLOWED_RECIPIENTS`
- Subject must start with `SUBJECT_PREFIX`
- Text body only
- Body capped and truncated safely (`MAX_BODY_CHARS`, default 10k)

### Teams controls
- **Webhook mode (default):**
  - URL must match explicit allow-list (`TEAMS_WEBHOOK_URLS`)
  - Hostname must match allowed patterns (`TEAMS_ALLOWED_HOST_PATTERNS`)
- **Graph mode:**
  - `(teamId, channelId)` must match `ALLOWED_TEAMS_TARGETS`

### Operational security
- Never log tokens or secrets
- Webhook URLs are redacted in logs
- Keep secrets only in Azure App Settings / Key Vault / GitHub Secrets

## Local test (curl)

```bash
curl -i -X POST "http://localhost:7071/api/proxmox/webhook" \
  -H "Content-Type: application/json" \
  -H "x-proxmox-secret: replace-with-strong-random-secret" \
  -d '{
    "id": "evt-123",
    "severity": "warning",
    "node": "pve-01",
    "message": "VM backup completed",
    "vmid": 101,
    "status": "ok",
    "timestamp": "2026-01-01T00:00:00Z"
  }'
```

## CI/CD

GitHub Actions workflow at `.github/workflows/deploy.yml`:
- Runs on push to `main`
- `npm ci`, optional lint/test
- Logs into Azure via **OIDC federated identity** (`azure/login`)
- Deploys with `Azure/functions-action@v1`

See setup docs:
- [Azure OIDC setup](docs/azure-oidc-setup.md)
- [Entra app + Graph permissions](docs/entra-graph-setup.md)
- [Exchange Online Application Access Policy](docs/exchange-app-access-policy.md)
- [Teams webhook setup](docs/teams-webhook-setup.md)
- [Proxmox webhook setup](docs/proxmox-webhook-setup.md)

## Microsoft 365 restrictions (important)

### Restrict “send as” scope for email app
Use Exchange Online Application Access Policy to limit mailboxes:

```powershell
New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId <group> -AccessRight RestrictAccess
Test-ApplicationAccessPolicy -AppId <CLIENT_ID> -Identity <SENDER_UPN>
```

### Restrict “send to”
Graph permissions do not reliably enforce per-recipient constraints. Enforce in app via `ALLOWED_RECIPIENTS` and/or send only to one distribution group.

### Teams guidance
- Incoming webhook URLs are secrets; protect in App Settings/Key Vault.
- Graph posting requires tenant-specific app permissions and admin consent; keep code-side allow-lists enabled.
