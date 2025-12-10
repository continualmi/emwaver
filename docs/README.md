# EMWaver Documentation

This directory contains the EMWaver documentation built with MkDocs, plus a static HTML news/blog section.

## Structure

- `docs/` - Markdown documentation files (processed by MkDocs)
- `news/` - Static HTML news/blog (copied as-is, no MkDocs processing)
- `index.html` - Custom homepage (copied as-is)
- `mkdocs.yml` - MkDocs configuration

## Building

```bash
# Build everything (MkDocs + copy news)
./build.sh

# Or manually:
mkdocs build
cp -r news site/news
```

## Serving Locally

```bash
# Use the serve script (ensures news is copied)
./serve.sh

# Or manually:
mkdocs serve
# Then in another terminal:
cp -r news site/news
```

## How It Works

1. **MkDocs processes** markdown files in `docs/` → `site/`
2. **MkDocs copies** `index.html` automatically → `site/index.html`
3. **Build script copies** `news/` folder → `site/news/` (MkDocs doesn't do this automatically)

## GitHub Pages Deployment

The `.github/workflows/deploy-docs.yml` workflow:
1. Builds MkDocs
2. Copies news folder
3. Deploys `site/` to GitHub Pages

Both your docs and news will be available:
- `/` - Homepage
- `/docs/` - Documentation pages
- `/news/` - News/blog
