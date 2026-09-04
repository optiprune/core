import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://opti.drml.int.yt",
  outDir: "./dist",
  output: "static",
  adapter: cloudflare({
    imageService: "passthrough", // Avoids reserving internal image/assets worker bindings
    platformProxy: {
      enabled: false, // Prevents wrangler runtime collision during Pages build
    },
  }),
  vite: {
    ssr: {
      external: ["@bruits/satteri-wasm32-wasi", "satteri"],
    },
    build: {
      rollupOptions: {
        external: ["@bruits/satteri-wasm32-wasi"],
      },
    },
  },
  integrations: [
    starlight({
      title: "OptiPrune Docs",
      logo: { src: "./src/assets/optiprune-logo.svg", alt: "OptiPrune" },
      favicon: "./src/assets/favicon.svg",
      components: { Banner: "./src/components/DocsBanner.astro" },
      sidebar: [
        {
          label: "Start here",
          items: ["docs", "docs/getting-started", "docs/quickstart", "docs/workflow"],
        },
        {
          label: "Core concepts",
          items: ["docs/architecture", "docs/reachability", "docs/confidence", "docs/output"],
        },
        {
          label: "Reference",
          items: [
            "docs/configuration",
            "docs/cli",
            "docs/quick-reference",
            "docs/reporters",
            "docs/headless-api",
            "docs/cache",
            "docs/language-server",
            "docs/plugins",
          ],
        },
        {
          label: "Guides",
          items: [
            "docs/ci",
            "docs/monorepos",
            "docs/fixes",
            "docs/plugin-authoring",
            "docs/troubleshooting",
          ],
        },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/optiprune/core" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@optiprune/cli" },
      ],
    }),
  ],
});
