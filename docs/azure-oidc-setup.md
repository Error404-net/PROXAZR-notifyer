# Azure OIDC federated credentials setup for GitHub Actions

1. Create Azure resources:
   - Resource Group
   - Storage Account
   - Function App (Linux, Node 20, Functions v4)
2. Create or reuse an Entra app registration for GitHub OIDC deployment identity.
3. In Entra app, add **Federated credential**:
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:<ORG>/<REPO>:ref:refs/heads/main`
   - Audience: `api://AzureADTokenExchange`
4. Assign RBAC role to this service principal on Function App scope:
   - `Contributor` (or narrower custom role allowing deploy + app settings update).
5. Add GitHub repository secrets:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `AZURE_FUNCTIONAPP_NAME`
6. Push to `main`; workflow deploys automatically.
