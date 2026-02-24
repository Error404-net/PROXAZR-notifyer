# Teams Incoming Webhook setup (high-level)

1. In Microsoft Teams, open the target channel.
2. Add/configure **Incoming Webhook** connector (or modern replacement workflow where applicable).
3. Copy webhook URL.
4. Store it as an app setting (`TEAMS_WEBHOOK_URLS`) or in Key Vault reference.
5. Keep URL secret and rotate if exposed.
6. Optionally set `TEAMS_ALLOWED_HOST_PATTERNS` for strict host allow-listing.
