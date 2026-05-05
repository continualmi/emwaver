# EMWaver Public Web Surface (`/web`)

`web/` is now the static public EMWaver site: build/board references, docs, install guidance, hardware pages, news, videos, and script examples.

It must not own EMWaver accounts, auth sessions, subscription checks, hosted relay behavior, cloud script storage, device provisioning, hosted Agent conversations, Stripe/Firebase/Postgres integration, or local hardware control. Local hardware control belongs in `gateway/`; paid Agent behavior belongs in the future Continual MI/MGPT Agent API backend.

## Stack

- Next.js `16.x` App Router
- React `19.x`
- TypeScript
- TailwindCSS 4 + custom CSS
- Static export support through `npm run build:static`

## Scripts

- `npm run dev` - local development server on `http://localhost:3920`
- `npm run build` - regular Next build
- `npm run build:static` - static export build
- `npm run start` - serve a production Next build locally
- `npm run lint` - ESLint

## Folder Map

- `src/app/` - public pages and layouts
- `src/components/` - static site components and protocol-neutral EMW UI preview components
- `src/lib/` - catalog, docs/news, static path, and example-script helpers
- `public/` - static assets
- `legacy-static/` - historical static artifacts kept for reference

There is no `src/server/`, custom `server.ts`, `/v1/*`, `/api/auth/*`, `/cloud`, `/account`, `/signin`, `/order`, `/pro`, or provisioning route surface in the public web app.

## Current Public Routes

- `/` - EMWaver landing page
- `/build` - compatibility route for the Build catalog
- `/build/[slug]`
- `/docs`
- `/docs/...`
- `/hardware`
- `/hardware/[slug]`
- `/install`
- `/news`
- `/news/[slug]`
- `/pinout`
- `/scripts`
- `/videos`

Society/community links point directly to the external Society surface.

## Local Development

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3920`.

## Static Export

```bash
cd web
npm run build:static
```

The export writes static output to `out/`.

## Guardrails

- Do not add same-origin backend APIs to `web/`.
- Do not add account/session state, Firebase, Stripe, Postgres, `continual-core`, or WebSocket relay dependencies here.
- Keep scripts and core local state on the user's device by default.
- Keep hardware-control UI and `.emw` run loops in `gateway/` or native apps.
- Link to external Agent/API setup when that product exists; do not recreate an EMWaver cloud runtime in this folder.
