import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://opti.drml.int.yt",
  integrations: [
    starlight({
      title: "OptiPrune Docs",
      logo: { src: "./src/assets/optiprune-logo.svg", alt: "OptiPrune" },
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        { label: "Start here", items: ["docs/getting-started", "docs/workflow"] },
        { label: "Reference", items: ["docs/configuration", "docs/plugins", "docs/ci"] },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/optiprune/core" }],
    }),
  ],
});
