# G1-Test-UnOfficial 1

## Run locally

Set admin credentials before starting the server:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "use-a-long-private-password"
node server.js
```

Open the practice page at `http://localhost:8000/` and the protected admin page at `http://localhost:8000/admin`.

The public practice page can submit responses, but viewing or deleting responses requires the admin username and password. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as private environment variables on your hosting provider; never commit them to GitHub.

## Email notifications

To email the admin whenever a response is submitted, configure these private environment variables before starting the server:

```powershell
$env:ADMIN_EMAIL = "nashit.mohammad@gmail.com"
$env:SMTP_HOST = "smtp.example.com"
$env:SMTP_PORT = "587"
$env:SMTP_SECURE = "false"
$env:SMTP_USER = "smtp-user"
$env:SMTP_PASSWORD = "use-your-smtp-password"
$env:SMTP_FROM = "G1 Practice <noreply@example.com>"
node server.js
```

`SMTP_SECURE` should be `true` for SMTP providers that require TLS from the start, commonly port 465. The response is saved even if email delivery is temporarily unavailable; delivery errors are logged by the server.

## Scheduled health check

`.github/workflows/keepalive.yml` calls the public `/health` endpoint every three days. The endpoint verifies that the Render app can reach Supabase without exposing the service-role key to GitHub Actions.

GitHub scheduled workflows can be delayed or disabled after long periods of repository inactivity, and this does not override Supabase free-tier pause policies. Use UptimeRobot as a second monitor if continuous checks are important.
