# Deploying MBAL BI on the office network

MBAL BI runs on one always-on Windows machine in the office (Orion is on-prem), behind HTTPS, and
only MBAL staff can open it: everyone signs in with their MBAL Microsoft 365 account.

```
 office PC ──https──▶ Caddy :443 (bi.mbal.local) ──http──▶ MBAL BI :3000 (127.0.0.1 only) ──▶ Orion
                                                            Windows service "MbalBi"
```

Who does what:

| Step                                      | Who             |
| ----------------------------------------- | --------------- |
| 1. Register the app in Microsoft Entra ID | IT (M365 admin) |
| 2. Create the read-only Orion user        | DBA             |
| 3. DNS name and certificate               | IT              |
| 4. Install the app as a service           | IT / manager    |
| 5. HTTPS reverse proxy (Caddy)            | IT              |
| Updating, backing out, logs               | IT / manager    |

**Never** run the server in oracle mode without sign-in: it refuses to (it shows "Sign-in is not
configured" and serves no data), and the figures are confidential.

## Prerequisites on the server

- Windows 10/11 or Windows Server 2019+, always on, on the office network (it must reach Orion).
- [Node.js 22 LTS](https://nodejs.org) or newer (`node --version`), installed for all users.
- [Git for Windows](https://git-scm.com/download/win).
- An elevated PowerShell (Run as Administrator) for installing and updating.
- A clone of this repository, for example `git clone https://github.com/alifadl-mbal/AI-Software-Factory C:\MbalBI-src`.
  The scripts deploy from it; the running app lives in `C:\MbalBI`.

## 1. Register the app in Microsoft Entra ID

In the [Entra admin center](https://entra.microsoft.com):

1. **Identity → Applications → App registrations → New registration**
   - Name: `MBAL BI`
   - Supported account types: **Accounts in this organizational directory only (single tenant)**
   - Redirect URI: platform **Web**, `https://bi.mbal.local/api/auth/callback/microsoft-entra-id`
     (use your real hostname; Entra only accepts `https://` here, except for `http://localhost`).
2. On the app's **Overview**, copy:
   - **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID_ID`
   - **Directory (tenant) ID** → `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`
3. **Certificates & secrets → New client secret** (24 months). Copy the **Value** (not the
   Secret ID) → `AUTH_MICROSOFT_ENTRA_ID_SECRET`. Put a reminder in the calendar to renew it
   before it expires; sign-in stops working the day it does.
4. **API permissions**: keep Microsoft Graph **User.Read** (delegated) and click **Grant admin
   consent for MBAL**, so staff are not asked to consent.
5. _Optional, to let in only one group_ (`AUTH_ALLOWED_GROUP`):
   - Create (or pick) a security group, e.g. `MBAL BI users`, and copy its **Object ID** →
     `AUTH_ALLOWED_GROUP`.
   - In the app registration, **Token configuration → Add groups claim**, tick **Groups assigned
     to the application** (recommended), token type **ID**, format **Group ID**.
   - **Enterprise applications → MBAL BI → Users and groups → Add user/group** → add the group.
     Assigning groups needs Entra ID P1 (included in Microsoft 365 Business Premium). Without
     P1, tick **Security groups** in the groups claim instead; that works for users in fewer than
     200 groups.
   - Optionally also set **Enterprise applications → MBAL BI → Properties → Assignment required**
     to **Yes**, so Microsoft itself turns away everyone else.

   Anyone in the tenant who is not in the group sees a friendly "You don't have access yet"
   page. Membership is checked at sign-in, so a change applies from the user's next sign-in (at
   the latest after a working day, when every session ends). Leave `AUTH_ALLOWED_GROUP` empty to
   let in any account in MBAL's tenant.

Each sign-in is written to the app log with the user and the time (never tokens).

## 2. Create the read-only Orion user (DBA)

Production must not use `MBALI`. Create a user that can only log in and read the views the app
uses. Run as a DBA (SQL\*Plus or SQL Developer), choosing a strong password:

```sql
-- Optional but recommended: a profile so the app's password doesn't expire under it (ORA-28001).
CREATE PROFILE MBAL_BI_APP LIMIT
  PASSWORD_LIFE_TIME UNLIMITED
  FAILED_LOGIN_ATTEMPTS 10
  PASSWORD_LOCK_TIME 1/24;

CREATE USER MBAL_BI_RO IDENTIFIED BY "<strong password>"
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA 0 ON USERS
  PROFILE MBAL_BI_APP;

GRANT CREATE SESSION TO MBAL_BI_RO;

-- Exactly the views MBAL BI reads (lib/server/queries/*.ts), and nothing else.
GRANT SELECT ON MBALI.ZF_CSL_BI                  TO MBAL_BI_RO; -- Sales, Overview, company filter
GRANT SELECT ON MBALI.ZF_F_T_DETAIL_BI           TO MBAL_BI_RO; -- Finance
GRANT SELECT ON MBALI.ZF_CURR_STK_BI             TO MBAL_BI_RO; -- Inventory: current stock
GRANT SELECT ON MBALI.ZF_STK_MTH_SUMM_BI         TO MBAL_BI_RO; -- Inventory: month-end
GRANT SELECT ON MBALI.ZF_ITEM                    TO MBAL_BI_RO; -- Inventory: item master
GRANT SELECT ON MBALI.ZF_PO_PENDING_BI           TO MBAL_BI_RO; -- Purchasing: pending POs
GRANT SELECT ON MBALI.ZF_CPR_BI                  TO MBAL_BI_RO; -- Purchasing: receipts
GRANT SELECT ON MBALI.ZF_SO_BI                   TO MBAL_BI_RO; -- Sales orders
GRANT SELECT ON MBALI.ZF_SOA_DETL_CUST_INV_SM_BI TO MBAL_BI_RO; -- Receivables
GRANT SELECT ON MBALI.ZF_SOAP_DETL_BI            TO MBAL_BI_RO; -- Payables
```

The app always writes `MBALI.ZF_...` in full, so no synonyms are needed. If a grant fails with
`ORA-01720` ("grant option does not exist"), that view reads a table in another schema: that
schema's owner first runs `GRANT SELECT ON <owner>.<table> TO MBALI WITH GRANT OPTION`.

Check it, logged in as `MBAL_BI_RO`:

```sql
SELECT COUNT(*) FROM MBALI.ZF_ITEM;          -- works
DELETE FROM MBALI.ZF_ITEM WHERE 1 = 0;       -- must fail: ORA-01031 insufficient privileges
```

When a dashboard starts reading a new view, its pull request adds the `GRANT` here and the DBA
runs it before the update is deployed.

## 3. DNS name and certificate (IT)

1. Give the server a fixed IP and add an internal DNS **A record**: `bi.mbal.local` → that IP.
2. Issue a certificate for `bi.mbal.local` (subject alternative name) from MBAL's internal CA
   (AD CS, "Web Server" template). Office PCs already trust that CA, so there is no warning.
3. Caddy needs PEM files. From an exported `.pfx` (OpenSSL comes with Git for Windows,
   `C:\Program Files\Git\usr\bin\openssl.exe`):

   ```powershell
   openssl pkcs12 -in bi.pfx -nokeys -out C:\caddy\certs\bi.mbal.local.crt
   openssl pkcs12 -in bi.pfx -nocerts -nodes -out C:\caddy\certs\bi.mbal.local.key
   ```

   Then allow only Administrators and SYSTEM to read the key file.

No internal CA? Caddy can be its own CA (`tls internal` in the Caddyfile). Then install Caddy's
root certificate (`C:\Windows\System32\config\systemprofile\AppData\Roaming\Caddy\pki\authorities\local\root.crt`
when Caddy runs as a service) on every PC as a trusted root, for example with a Group Policy.

## 4. Install the app as a Windows service

In an elevated PowerShell, in the source clone:

```powershell
cd C:\MbalBI-src
.\deploy\install.ps1 -WhatIf          # dry run: prints every step, changes nothing
.\deploy\install.ps1                  # first run creates C:\MbalBI\.env.production.local and stops
notepad C:\MbalBI\.env.production.local
.\deploy\install.ps1                  # builds, registers and starts the service
```

Options: `-InstallDir` (default `C:\MbalBI`), `-Port` (default `3000`), `-ListenAddress`
(default `127.0.0.1`: only the reverse proxy on this machine can reach the app),
`-ServiceName` (default `MbalBi`).

### The config file

`C:\MbalBI\.env.production.local` holds every setting, documented in `.env.example`. The
install script creates it from that template, readable only by Administrators and SYSTEM. It is
never in git (`.gitignore` excludes `.env.*`). For production:

```ini
MBAL_DATA_SOURCE=oracle
ORACLE_USER=MBAL_BI_RO
ORACLE_PASSWORD=<from the DBA>
ORACLE_DSN=<orion host>:1521/orcl

AUTH_SECRET=<random, see below>
AUTH_URL=https://bi.mbal.local
AUTH_MICROSOFT_ENTRA_ID_ID=<Application (client) ID>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<client secret value>
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=<Directory (tenant) ID>
AUTH_ALLOWED_GROUP=<group Object ID, or empty>

CRON_SECRET=<random, for scheduled jobs>
```

Make `AUTH_SECRET` and `CRON_SECRET` random, one each:

```powershell
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Changing `AUTH_SECRET` signs everyone out. After editing the file, restart the service:
`Restart-Service MbalBi`.

### What the install does

1. Checks Node ≥ 22 and git, and that the port is free.
2. Checks out the current commit into `C:\MbalBI\releases\<commit>` (a git worktree) and runs
   `npm ci` and `npm run build` there.
3. Downloads [WinSW](https://github.com/winsw/winsw) v2.12.0 into `C:\MbalBI\service\MbalBi.exe`,
   checks its SHA-256, writes `MbalBi.xml` beside it, and registers the service: automatic
   (delayed) start on boot, restart 10 s / 30 s / 60 s after a crash, logs rolled at 10 MB.
4. Starts it and waits for `/api/health`.

**Why WinSW:** it is maintained (MIT, regular releases), one self-contained exe with a readable
XML config, and it does exactly what we need: start on boot, restart on crash, rolling logs. NSSM
has had no release since 2017 and is often flagged by antivirus; `node-windows` is a wrapper
around WinSW with an extra npm dependency; pm2 is not a real Windows service.

The service runs as LocalSystem (WinSW's default). To use a dedicated low-privilege account
instead, add `<serviceaccount>` to `C:\MbalBI\service\MbalBi.xml` (see the WinSW docs), give that
account read access to `C:\MbalBI` and write access to `C:\MbalBI\logs`, and reinstall the
service (`MbalBi.exe uninstall`, `MbalBi.exe install`).

## 5. HTTPS reverse proxy (Caddy, recommended)

The app listens on `127.0.0.1:3000` only; [Caddy](https://caddyserver.com) serves
`https://bi.mbal.local` and forwards to it. We ship a ready config: `deploy/Caddyfile`.

**Why Caddy over IIS:** one exe and a 30-line config; it redirects http to https, and sets the
`X-Forwarded-Proto/Host` headers sign-in needs, out of the box. IIS needs URL Rewrite and ARR
installed, proxying enabled, `preserveHostHeader` turned on and server variables allow-listed
before it does the same.

1. Download `caddy_<version>_windows_amd64.zip` from
   [Caddy's releases](https://github.com/caddyserver/caddy/releases) and put `caddy.exe` in
   `C:\caddy`.
2. Copy `deploy\Caddyfile` to `C:\caddy\Caddyfile`; check the hostname, certificate paths and
   port. Then `C:\caddy\caddy.exe validate --config C:\caddy\Caddyfile`.
3. Register Caddy as a service and start it:

   ```powershell
   sc.exe create caddy start= auto binPath= "C:\caddy\caddy.exe run --config C:\caddy\Caddyfile"
   sc.exe failure caddy reset= 86400 actions= restart/5000/restart/5000/restart/5000
   Start-Service caddy
   ```

4. Open the firewall for https (and http, which Caddy redirects) on the domain network only:

   ```powershell
   New-NetFirewallRule -DisplayName "MBAL BI (Caddy)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Domain
   ```

5. From an office PC open `https://bi.mbal.local`: you should get the Microsoft sign-in.

<details>
<summary>Using IIS instead</summary>

Install the **URL Rewrite** and **Application Request Routing** modules. In IIS Manager, select
the server → Application Request Routing Cache → Server Proxy Settings → **Enable proxy**. Run
`appcmd set config -section:system.webServer/proxy /preserveHostHeader:true /commit:apphost`.
Create a site bound to `https://bi.mbal.local:443` with the certificate, add a reverse-proxy rule
to `http://127.0.0.1:3000`, allow the server variable `HTTP_X_FORWARDED_PROTO` and set it to
`https` in the rule. Add an http site that redirects to https.

</details>

## Updating

```powershell
cd C:\MbalBI-src
.\deploy\update.ps1 -WhatIf     # dry run
.\deploy\update.ps1
```

It pulls `main`, builds the new commit in its own `releases\<commit>` folder while the current
version keeps serving, then restarts the service on the new build (a few seconds of downtime)
and checks `/api/health`. If the build fails, nothing changes and the old version keeps running.
If the new version doesn't come up, the script switches back to the previous one by itself. The
three newest releases are kept (`-Keep`).

## Backing out

- **To the previous version:** `.\deploy\update.ps1 -Rollback`.
- **Take it offline:** `Stop-Service MbalBi` (and `Set-Service MbalBi -StartupType Disabled`).
- **Remove it:** `.\deploy\uninstall.ps1` removes the service; `-RemoveReleases` also deletes the
  builds and the service wrapper. The config and logs stay; delete `C:\MbalBI` by hand if you
  mean to. Remove the Caddy service with `Stop-Service caddy; sc.exe delete caddy`.
- **Revoke access:** disable the Entra app (Enterprise applications → MBAL BI → Properties →
  Enabled for users to sign in: No), and have the DBA `DROP USER MBAL_BI_RO`.

Every script takes `-WhatIf` and prints what it would do without changing anything.

## Logs and monitoring

| What                                                  | Where                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| App output: sign-ins, Orion query errors (with codes) | `C:\MbalBI\logs\MbalBi.out.log`, `MbalBi.err.log`                              |
| Service starts, stops and crash restarts              | `C:\MbalBI\logs\MbalBi.wrapper.log`, Event Viewer → Windows Logs → Application |
| Every https request                                   | `C:\caddy\logs\access.log`                                                     |

Logs roll over at 10 MB and the last 10 files are kept.

`GET https://bi.mbal.local/api/health` needs no sign-in, for a monitoring tool:

- `200 {"status":"ok","version":"0.1.0","commit":"…","dataSource":"oracle","orion":"up"}`
- `503 {"status":"unavailable",…,"orion":"down"}` when Orion doesn't answer within 5 s.

It never contains hostnames, users or error details; those are in the app log.

## Scheduled jobs

Anything under `/api/cron/` skips sign-in and instead needs `Authorization: Bearer <CRON_SECRET>`.
Without `CRON_SECRET` every call is refused. Check a scheduler's token with:

```powershell
Invoke-RestMethod https://bi.mbal.local/api/cron/ping -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```
