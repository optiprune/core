import { describe, expect, it } from "vitest";
import { extractSfcScript, parseModule } from "../../src/parser.js";

describe("Astro self-closing script tags", () => {
  it("does not let a self-closing script swallow the next script block", () => {
    const source = [
      "---",
      'import { greet } from "./greet";',
      "const schema = { name: greet() };",
      "---",
      '<script type="application/ld+json" set:html={JSON.stringify(schema)} />',
      "",
      "<script>",
      'import { track } from "./analytics";',
      "track();",
      "</script>",
      "",
    ].join("\n");

    const extracted = extractSfcScript(source, "src/page.astro");
    expect(extracted.hasScript).toBe(true);
    expect(extracted.scriptContent).toContain("./analytics");
    expect(extracted.scriptContent).not.toContain("<script");

    const module = parseModule(source, "src/page.astro");
    const specifiers = module.edges.map((edge) => edge.rawSpecifier);
    expect(specifiers).toEqual(expect.arrayContaining(["./greet", "./analytics"]));
  });

  it("keeps a template-only Astro file with a self-closing script free of script edges", () => {
    const source = [
      "<div>hello</div>",
      '<script type="application/ld+json" set:html={JSON.stringify({})} />',
      "",
    ].join("\n");

    const extracted = extractSfcScript(source, "src/static.astro");
    expect(extracted.hasScript).toBe(false);
    expect(extracted.scriptContent.trim()).toBe("");
  });

  it("skips a self-closing tag when whitespace appears before the slash", () => {
    const source = [
      '<script type="application/ld+json" set:html={data} / >',
      "",
      '<script>import { track } from "./analytics";</script>',
      "",
    ].join("\n");

    const extracted = extractSfcScript(source, "src/page.astro");
    expect(extracted.hasScript).toBe(true);
    expect(extracted.scriptContent).toContain("./analytics");
    expect(extracted.scriptContent).not.toContain("set:html");
  });

  it("still extracts a regular script block that follows a self-closing tag in Vue", () => {
    const source = [
      "<template><div>{{ value }}</div></template>",
      '<script set:html="{}" />',
      '<script setup lang="ts">',
      'import { ref } from "vue";',
      "const value = ref(1);",
      "</script>",
      "",
    ].join("\n");

    const extracted = extractSfcScript(source, "src/Widget.vue");
    expect(extracted.hasScript).toBe(true);
    expect(extracted.isSetup).toBe(true);
    expect(extracted.scriptContent).toContain('from "vue"');
  });
});
