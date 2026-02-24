# Exchange Online Application Access Policy commands

Use these commands to restrict which mailbox(es) an app can access for `Mail.Send`.

```powershell
Connect-ExchangeOnline

# Restrict app access to mailboxes in a mail-enabled security group
New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId <group> -AccessRight RestrictAccess

# Validate access for sender mailbox
Test-ApplicationAccessPolicy -AppId <CLIENT_ID> -Identity <SENDER_UPN>
```

Recommended: create a dedicated mail-enabled security group containing only allowed sender mailbox(es).
