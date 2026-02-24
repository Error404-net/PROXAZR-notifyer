# Entra app registration + Graph permissions + admin consent

1. Register an application in Entra ID.
2. Create a client secret (or certificate) and store securely.
3. Add **Application permissions** in Microsoft Graph:
   - For email sending: `Mail.Send`
   - For Teams Graph mode (if used): permissions to post channel messages (tenant-dependent; verify latest Graph requirements and support for app-only in your tenant).
4. Grant **admin consent** for the tenant.
5. Configure Function App settings:
   - `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`
   - `SENDER_UPN`
   - `ALLOWED_RECIPIENTS`
6. Optional Teams Graph dedicated identity:
   - `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`
