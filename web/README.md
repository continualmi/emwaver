# EMWaver Web

This static Next.js app owns the public EMWaver product surface for `emwaver.ai`.

## Development

```bash
npm ci
npm run dev
npm run build:static-sites
npm run start
```

Local dev URL: `http://localhost:3300/`

The static export is deployed at the domain root for `emwaver.ai`. Older `/emwaver/...` compatibility paths are intentionally not generated; the Azure deploy workflow deletes stale `emwaver/*` blobs before upload so old prefixed pages cannot linger in storage.

## Deployment

The repository workflow `.github/workflows/deploy-emwaver-ai-site.yml` (`Deploy emwaver.ai site`) builds this app from `web/` and uploads `web/out-emwaver` to the Azure Storage static website that serves `emwaver.ai`.

Download buttons point to GitHub Release assets under `releases/latest/download` instead of serving binary installers from the static site. GitHub resolves this against the release marked **Latest**, not merely the newest tag; public release tags should use bare SemVer such as `1.0.2`.
