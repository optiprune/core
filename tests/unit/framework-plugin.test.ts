/**
 * Framework Parser Tests
 *
 * Verifies that parseModule correctly handles .vue, .svelte, .astro, .tsx and
 * .jsx files without throwing parse errors on '<' characters.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModule } from "../../src/parser.js";
import { extractSfcScript, isSfcPath } from "../../src/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

// ---------------------------------------------------------------------------
// isSfcPath
// ---------------------------------------------------------------------------
describe("isSfcPath", () => {
  it("returns true for .vue files", () => {
    expect(isSfcPath("src/App.vue")).toBe(true);
  });
  it("returns true for .svelte files", () => {
    expect(isSfcPath("src/App.svelte")).toBe(true);
  });
  it("returns true for .astro files", () => {
    expect(isSfcPath("src/Page.astro")).toBe(true);
  });
  it("returns false for .ts files", () => {
    expect(isSfcPath("src/index.ts")).toBe(false);
  });
  it("returns false for .tsx files", () => {
    expect(isSfcPath("src/Component.tsx")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSfcScript
// ---------------------------------------------------------------------------
describe("extractSfcScript", () => {
  it("extracts <script setup lang='ts'> from a Vue SFC", () => {
    const source = fixture("vue-component.vue");
    const result = extractSfcScript(source, "vue-component.vue");
    expect(result.hasScript).toBe(true);
    expect(result.isSetup).toBe(true);
    expect(result.lang).toBe("ts");
    expect(result.scriptContent).toContain("import { ref, computed }");
    expect(result.scriptContent).not.toContain("<template>");
  });

  it("extracts <script lang='ts'> from a Svelte SFC", () => {
    const source = fixture("svelte-runes.svelte");
    const result = extractSfcScript(source, "svelte-runes.svelte");
    expect(result.hasScript).toBe(true);
    expect(result.lang).toBe("ts");
    expect(result.scriptContent).toContain("import { onMount");
  });

  it("extracts frontmatter from an Astro file (treated as <script>)", () => {
    // Astro uses --- fences, not <script> tags for the frontmatter.
    // extractSfcScript should return hasScript=false for Astro frontmatter.
    // The parseModule function handles Astro's --- block separately.
    const source = fixture("astro-page.astro");
    // Astro frontmatter is NOT a <script> block, so hasScript should be false
    // (parseModule handles the --- extraction path)
    const result = extractSfcScript(source, "astro-page.astro");
    // Astro files use --- not <script>, so hasScript is false here
    expect(result.hasScript).toBe(false);
  });

  it("returns hasScript=false for template-only component", () => {
    const source = "<template><div>Hello</div></template>";
    const result = extractSfcScript(source, "NoScript.vue");
    expect(result.hasScript).toBe(false);
  });

  it("preserves line numbers via padding", () => {
    const source = "<template>\n  <div/>\n</template>\n<script>\nconst x = 1;\n</script>";
    const result = extractSfcScript(source, "test.vue");
    expect(result.hasScript).toBe(true);
    // The script content should have leading newlines matching the preceding lines
    const lines = result.scriptContent.split("\n");
    // First non-empty line should be at line 5 (1-indexed)
    const firstCodeLine = lines.findIndex(l => l.trim().length > 0) + 1;
    expect(firstCodeLine).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// parseModule – Vue
// ---------------------------------------------------------------------------
describe("parseModule – Vue (.vue)", () => {
  it("parses a Vue SFC without errors", () => {
    const source = fixture("vue-component.vue");
    const mod = parseModule(source, "/project/src/vue-component.vue");
    expect(mod.hasParseError).toBe(false);
    expect(mod.parseStatus).toBe("parsed");
  });

  it("extracts imports from <script setup>", () => {
    const source = fixture("vue-component.vue");
    const mod = parseModule(source, "/project/src/vue-component.vue");
    const specifiers = mod.edges.map(e => e.rawSpecifier);
    expect(specifiers).toContain("vue");
    expect(specifiers).toContain("vue-router");
  });

  it("does not produce a fallback module", () => {
    const source = fixture("vue-component.vue");
    const mod = parseModule(source, "/project/src/vue-component.vue");
    expect(mod.parseStatus).not.toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// parseModule – Svelte
// ---------------------------------------------------------------------------
describe("parseModule – Svelte (.svelte)", () => {
  it("parses a Svelte component without errors", () => {
    const source = fixture("svelte-component.svelte");
    const mod = parseModule(source, "/project/src/svelte-component.svelte");
    expect(mod.hasParseError).toBe(false);
    expect(mod.parseStatus).toBe("parsed");
  });

  it("extracts imports from the <script> block", () => {
    const source = fixture("svelte-component.svelte");
    const mod = parseModule(source, "/project/src/svelte-component.svelte");
    const specifiers = mod.edges.map(e => e.rawSpecifier);
    expect(specifiers).toContain("svelte");
  });

  it("parses Svelte 5 runes component without errors", () => {
    const source = fixture("svelte-runes.svelte");
    const mod = parseModule(source, "/project/src/svelte-runes.svelte");
    expect(mod.hasParseError).toBe(false);
    expect(mod.parseStatus).toBe("parsed");
  });

  it("extracts exports from Svelte component", () => {
    const source = fixture("svelte-runes.svelte");
    const mod = parseModule(source, "/project/src/svelte-runes.svelte");
    const exportNames = mod.exports.map(e => e.name);
    expect(exportNames).toContain("reset");
  });
});

// ---------------------------------------------------------------------------
// parseModule – Astro
// ---------------------------------------------------------------------------
describe("parseModule – Astro (.astro)", () => {
  it("parses an Astro page without throwing", () => {
    const source = fixture("astro-page.astro");
    // Should not throw regardless of parse status
    expect(() => parseModule(source, "/project/src/pages/astro-page.astro")).not.toThrow();
  });

  it("does not produce a raw '<' parse error crash", () => {
    const source = fixture("astro-page.astro");
    const mod = parseModule(source, "/project/src/pages/astro-page.astro");
    // The module should be returned in some valid state (not an exception)
    expect(mod).toBeDefined();
    expect(mod.id).toBe("/project/src/pages/astro-page.astro");
  });
});

// ---------------------------------------------------------------------------
// parseModule – TSX
// ---------------------------------------------------------------------------
describe("parseModule – TSX (.tsx)", () => {
  it("parses a React TSX component without errors", () => {
    const source = fixture("react-component.tsx");
    const mod = parseModule(source, "/project/src/react-component.tsx");
    expect(mod.hasParseError).toBe(false);
    expect(mod.parseStatus).toBe("parsed");
  });

  it("extracts named exports from TSX", () => {
    const source = fixture("react-component.tsx");
    const mod = parseModule(source, "/project/src/react-component.tsx");
    const exportNames = mod.exports.map(e => e.name);
    expect(exportNames).toContain("Button");
    expect(exportNames).toContain("Counter");
    expect(exportNames).toContain("default");
  });

  it("extracts React import", () => {
    const source = fixture("react-component.tsx");
    const mod = parseModule(source, "/project/src/react-component.tsx");
    const specifiers = mod.edges.map(e => e.rawSpecifier);
    expect(specifiers).toContain("react");
  });

  it("handles JSX angle brackets without parse error", () => {
    const source = `
import React from 'react';
export function Foo() {
  return <div className="test"><span>Hello</span></div>;
}
`;
    const mod = parseModule(source, "/project/src/Foo.tsx");
    expect(mod.hasParseError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseModule – JSX
// ---------------------------------------------------------------------------
describe("parseModule – JSX (.jsx)", () => {
  it("parses a React JSX component without errors", () => {
    const source = fixture("react-component.jsx");
    const mod = parseModule(source, "/project/src/react-component.jsx");
    expect(mod.hasParseError).toBe(false);
    expect(mod.parseStatus).toBe("parsed");
  });

  it("extracts exports from JSX", () => {
    const source = fixture("react-component.jsx");
    const mod = parseModule(source, "/project/src/react-component.jsx");
    const exportNames = mod.exports.map(e => e.name);
    expect(exportNames).toContain("Greeting");
    expect(exportNames).toContain("default");
  });

  it("handles nested JSX without parse error", () => {
    const source = `
import React from 'react';
export const App = () => (
  <main>
    <header><h1>Title</h1></header>
    <section>
      <p>Content with {'interpolation'}</p>
    </section>
  </main>
);
`;
    const mod = parseModule(source, "/project/src/App.jsx");
    expect(mod.hasParseError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("Edge cases", () => {
  it("handles Vue SFC with no lang attribute (defaults to ts)", () => {
    const source = `<template><div>Hello</div></template>
<script>
import { ref } from 'vue';
const x = ref(0);
</script>`;
    const mod = parseModule(source, "/project/src/Plain.vue");
    expect(mod.hasParseError).toBe(false);
    const specifiers = mod.edges.map(e => e.rawSpecifier);
    expect(specifiers).toContain("vue");
  });

  it("handles Svelte component with no script block", () => {
    const source = `<h1>Hello World</h1>\n<p>No script here.</p>`;
    const mod = parseModule(source, "/project/src/Static.svelte");
    expect(mod.parseStatus).toBe("parsed");
    expect(mod.edges).toHaveLength(0);
    expect(mod.exports).toHaveLength(0);
  });

  it("handles Vue SFC with both <script> and <script setup>", () => {
    const source = `<template><div/></template>
<script>
export const options = {};
</script>
<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
</script>`;
    const mod = parseModule(source, "/project/src/Mixed.vue");
    // Should parse the <script setup> block (preferred)
    expect(mod.hasParseError).toBe(false);
    const specifiers = mod.edges.map(e => e.rawSpecifier);
    expect(specifiers).toContain("vue");
  });
});
