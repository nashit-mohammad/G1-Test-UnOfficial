# G1-Test-UnOfficial

## Run locally

Set admin credentials before starting the server:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "use-a-long-private-password"
node server.js
```

Open the practice page at `http://localhost:8000/` and the protected admin page at `http://localhost:8000/admin`.

The public practice page can submit responses, but viewing or deleting responses requires the admin username and password. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as private environment variables on your hosting provider; never commit them to GitHub.
