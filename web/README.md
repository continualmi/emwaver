# EMWaver Web

This static Next.js app owns the public EMWaver product surface for `emwaver.ai`.

## Development

```bash
npm ci
npm run dev
npm run build:static-sites
npm run start
```

Local dev URL: `http://localhost:3300/emwaver`

The static export keeps the route available both at the domain root for `emwaver.ai` and under `/emwaver` for compatibility with old Continual MI links.

## Deployment

The repository workflow `.github/workflows/deploy-emwaver-static-to-azure.yml` builds this app from `web/` and uploads `web/out-emwaver` to the Azure Storage static website container.

The workflow prefers `AZURE_EMWAVER_STORAGE_CONNECTION_STRING` in GitHub Actions secrets and falls back to the existing `AZURE_STORAGE_CONNECTION_STRING` secret during migration. Secret names are safe to keep in this open-source repository; credential values must stay only in GitHub Secrets or move to Azure OIDC/federated credentials later.
