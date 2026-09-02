import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://opti.drml.int.yt",
  outDir: "./dist/public",
  integrations: [
    starlight({
      title: "OptiPrune Docs",
      logo: { src: "./src/assets/optiprune-logo.svg", alt: "OptiPrune" },
      sidebar: [
        {
          label: "Start here",
          items: ["docs", "docs/getting-started", "docs/quickstart", "docs/workflow"],
        },
        {
          label: "Core concepts",
          items: ["docs/architecture", "docs/reachability", "docs/confidence"],
        },
        {
          label: "Reference",
          items: ["docs/configuration", "docs/cli", "docs/reporters", "docs/plugins"],
        },
        {
          label: "Guides",
          items: ["docs/ci", "docs/monorepos", "docs/troubleshooting", "docs/api"],
        },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/optiprune/core" }],
    }),
  ],
});
