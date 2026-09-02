# Astro/Starlight deployment notes

## Official sources

- Starlight: https://starlight.astro.build/
  - Starlight provides navigation, search, internationalization, SEO, typography, code highlighting, dark mode, Markdown/Markdoc/MDX support, and framework-agnostic extensibility.
- Cloudflare Pages Astro guide: https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/
  - Cloudflare’s Pages guide uses `npm run build` with `dist` for a standard Astro project.
  - Astro can use the Cloudflare adapter for server-side rendering and runtime bindings; static output needs no adapter.
  - Cloudflare Pages Functions and bindings are available for server-side APIs.
- Astro Cloudflare deployment guide: https://docs.astro.build/en/guides/deploy/cloudflare/
  - Astro’s current documentation recommends Cloudflare Workers for new projects, while Pages remains relevant for existing Pages projects.
  - Static Astro output uses a Wrangler assets directory; on-demand rendering uses the Cloudflare adapter.

## Applied deployment decision

This branch is intentionally configured as a Cloudflare Pages project with the repository root set to `docs/`. Astro writes the static website to `docs/dist/public`, so the Pages dashboard should use build command `npm run build` and output directory `dist/public`.
