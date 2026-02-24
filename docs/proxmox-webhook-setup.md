# Proxmox webhook configuration

1. In Proxmox notifications settings, create a webhook target.
2. Set URL to your function endpoint:
   - `https://<your-function-app>.azurewebsites.net/api/proxmox/webhook`
3. Method: `POST`
4. Header name/value:
   - Name: `x-proxmox-secret` (or your `SECRET_HEADER_NAME`)
   - Value: same value as `PROXMOX_WEBHOOK_SECRET`
5. Ensure payload content type is JSON.
6. Send test notification and verify Function logs.
