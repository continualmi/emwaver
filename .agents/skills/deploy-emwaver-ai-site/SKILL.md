---
name: deploy-emwaver-ai-site
description: Use when the user asks to deploy, publish, or update the public emwaver.ai website/static pages by kicking off the GitHub Actions workflow only.
---

# Deploy emwaver.ai Site

Use this skill only to start the deployment workflow for the public `emwaver.ai` static site.

## Command

From the EMWaver repo root, run:

```bash
gh workflow run deploy-emwaver-ai-site.yml --ref main
```

## Rules

- Kick off the workflow only; do not monitor, wait for, or summarize workflow progress unless the user explicitly asks.
- Do not rebuild the site locally for a deployment request unless the user asks for local validation.
- Do not change Azure secrets or storage settings.
- If `gh` is not authenticated or the command fails, report the failure briefly and stop.
