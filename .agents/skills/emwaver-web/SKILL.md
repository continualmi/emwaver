---
name: emwaver-web
description: Use when working on EMWaver public static pages now housed in the Society repo under /emwaver, or when updating EMWaver repo docs after static-web changes.
---

# EMWaver Web

The standalone `emwaver/web` app has been retired.

Public EMWaver static pages now live in the Society repo:

- Routes: [`/Users/luisml/continualmi/society/app/emwaver`](/Users/luisml/continualmi/society/app/emwaver)
- Components: [`/Users/luisml/continualmi/society/components/emwaver`](/Users/luisml/continualmi/society/components/emwaver)
- Data/helpers: [`/Users/luisml/continualmi/society/lib/emwaver`](/Users/luisml/continualmi/society/lib/emwaver)
- Assets: [`/Users/luisml/continualmi/society/public/emwaver`](/Users/luisml/continualmi/society/public/emwaver)

Read first:

1. [`/Users/luisml/continualmi/society/README.md`](/Users/luisml/continualmi/society/README.md)
2. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)
3. [`/Users/luisml/continualmi/emwaver/PLANNING.md`](/Users/luisml/continualmi/emwaver/PLANNING.md)

## Scope

- Society owns the static export and Azure Storage deployment for public pages.
- EMWaver pages are generated under `/emwaver/*` and are linked from the Society top navigation.
- Runtime, firmware, gateway, app code, local hardware control, and Agent API clients remain in the EMWaver repo.

## Guardrails

- Do not reintroduce a standalone `emwaver/web` app or EMWaver-specific Azure static-site workflow.
- Do not add same-origin backend APIs, hosted relay behavior, cloud script storage, account/session state, Stripe/Firebase/Postgres, or product auth to the EMWaver static pages.
- Keep local hardware control in `gateway/` or native apps.
- Keep paid Agent behavior pointed at the future Continual MI/MGPT Agent API backend.

## Validation

From `/Users/luisml/continualmi/society`:

```bash
npm run build
npm run lint
```
