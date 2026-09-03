import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://opti.drml.int.yt",
  outDir: "./dist",
  integrations: [
    starlight({
      title: "OptiPrune Docs",
      logo: { src: "./src/assets/optiprune-logo.svg", alt: "OptiPrune" },
      favicon: "./src/assets/favicon.svg",
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
          items: ["docs/ci", "docs/monorepos", "docs/fixes", "docs/plugin-authoring", "docs/troubleshooting"],
        },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/optiprune/core" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@optiprune/cli" },
      ],
    }),
  ],
});
