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

The repository workflow `.github/workflows/deploy-emwaver-static-to-azure.yml` builds this app from `web/` and uploads `web/out-emwaver` to the Azure Storage static website that serves `emwaver.ai`.

Download buttons point to GitHub Release assets under `releases/latest/download` instead of serving binary installers from the static site.
