import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Acme Platform",
      customCss: ["@fontsource/inter", "./src/styles/docs.css"],
    }),
  ],
});
