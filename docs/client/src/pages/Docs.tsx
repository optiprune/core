/* Calm OptiPrune docs system: retain the editorial right-rail layout while making reference pages practical, source-backed, and free from implementation internals. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Menu,
  Search,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import { plugins, type PluginRecord } from "@/lib/pluginData";

const groups = [
  {
    label: "Start here",
    items: [
      ["getting-started", "Getting Started"],
      ["how-it-works", "How OptiPrune works"],
      ["why-optiprune", "Why use OptiPrune?"],
    ],
  },
  {
    label: "Configuration & discovery",
    items: [
      ["configuration", "Configuration"],
      ["entry-files", "Entry files"],
      ["monorepos", "Monorepos & workspaces"],
      ["integrations", "Integrations"],
    ],
  },
  {
    label: "Reference",
    items: [
      ["cli", "CLI commands & options"],
      ["fixes", "Automated fixes"],
      ["core-api", "Core functions"],
      ["analysis", "Analysis & findings"],
      ["reporters", "Reporters & output"],
      ["cache", "Cache commands"],
      ["plugins", `Plugins (${plugins.length})`],
      ["quick-reference", "Search the reference"],
    ],
  },
  {
    label: "Contributing",
    items: [
      ["writing-a-plugin", "Plugin guidance"],
      ["source", "Source repositories"],
    ],
  },
];

const sourceLinks = {
  core: "https://github.com/optiprune/core",
  cli: "https://github.com/optiprune/cli",
  npmCli: "https://www.npmjs.com/package/@optiprune/cli",
  npmCore: "https://www.npmjs.com/package/@optiprune/core",
  vscode:
    "https://marketplace.visualstudio.com/items?itemName=dreamlongyt.optiprune-vscode",
};

const schemaUrl =
  "https://raw.githubusercontent.com/optiprune/core/main/schema.json";
const orderedDocs = groups.flatMap((group) => group.items);

const cliOptions = [
  ["-r, --rootDir <path>", "Choose the project directory to analyze."],
  [
    "-e, --entry <patterns...>",
    "Set one or more entry files, paths, or glob patterns.",
  ],
  [
    "-x, --extensions <exts...>",
    "Replace the default list of source extensions.",
  ],
  ["-i, --ignore <patterns...>", "Exclude matching paths from analysis."],
  ["--no-report-unused-exports", "Turn off unused-export findings."],
  ["--no-conventional-entries", "Do not infer conventional entry files."],
  [
    "--include-entry-exports",
    "Include unused exports declared directly in entry files.",
  ],
  ["--cycles", "Print detected dependency cycles."],
  ["--ignore-tests", "Ignore test files and test directories."],
  [
    "--ignore-unknown-import",
    "Do not retain uncertain dynamic-import paths as possible reachability evidence.",
  ],
  [
    "--fail-on <confidence>",
    "Exit non-zero from the selected confidence level.",
  ],
  ["--json", "Write the structured analysis report as JSON."],
  ["--sarif", "Write SARIF output for code-scanning workflows."],
  ["--skip-3 / --skip-4", "Skip the SMT or concolic proof pass."],
  [
    "-v, --verbose",
    "Include execution diagnostics; with JSON output, diagnostics are structured under debug.",
  ],
  [
    "--fix <rules...>",
    "Select files, exports, dependencies, devDependencies, conditions, or json fixes.",
  ],
  [
    "--fix-json",
    "Safely repair recoverable package.json JSON syntax; shorthand for --fix json.",
  ],
  [
    "--node-llama-cpp",
    "Enable the specialized node-llama-cpp analysis plugin explicitly.",
  ],
  [
    "--confidence <level>",
    "Set the minimum confidence for fixes: high, medium+, low+, or all.",
  ],
  [
    "--force",
    "Allow a selected fix where the source edit would otherwise be treated as unsafe.",
  ],
  ["--dry-run", "Show planned fixes without writing files."],
  [
    "--cache-from / --cache-to <path>",
    "Import a cache before analysis or export the resulting cache afterward.",
  ],
] as const;

const coreFunctions = [
  [
    "analyze(options)",
    "Runs the complete analysis and returns an AnalysisReport with findings, graph information, entries, and summary counters.",
  ],
  [
    "shouldFail(report, failOn)",
    "Answers whether a report reaches the configured CI failure threshold.",
  ],
  [
    "applyFixes(report, rootDir, fixConfig)",
    "Applies explicitly requested, confidence-gated fixes to a completed report.",
  ],
  [
    "exportCache(rootDir, targetPath)",
    "Writes the project cache to a portable JSON file.",
  ],
  [
    "importCache(rootDir, sourcePath)",
    "Loads a compatible cache JSON file into the project cache.",
  ],
] as const;

const schemaPreview = `{
  "$schema": "https://raw.githubusercontent.com/optiprune/core/main/schema.json",
  "entry": ["src/index.ts"],
  "ignore": ["**/*.test.ts", "**/dist/**"],
  "failOn": "high",
  "plugins": { "nextjs-plugin": true }
}`;

function CodeBlock({
  code,
  label = "Terminal",
}: {
  code: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="docs-code">
      <div>
        <span>{label}</span>
        <button onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="docs-eyebrow">{eyebrow}</div>
      <h1 className="docs-title">{title}</h1>
      <p className="docs-lede">{children}</p>
    </>
  );
}

function LinkCard({
  href,
  title,
  text,
  next = true,
}: {
  href: string;
  title: string;
  text: string;
  next?: boolean;
}) {
  return (
    <a className="docs-link-card" href={href}>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      {next ? <ArrowRight size={16} /> : <ArrowUpRight size={16} />}
    </a>
  );
}

function Table({ rows }: { rows: readonly (readonly string[])[] }) {
  return (
    <div className="docs-table">
      {rows.map((row) => (
        <div key={row[0]}>
          <b>
            <code>{row[0]}</code>
          </b>
          <span>
            {row[1]}
            {row[2] ? <small>{row[2]}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function SchemaReference() {
  const [schema, setSchema] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(schemaUrl)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setSchema)
      .catch(() => setError(true));
  }, []);

  const fields = schema ? Object.entries(schema.properties ?? {}) : [];

  return (
    <section className="schema-reference">
      <h2>Configuration fields</h2>
      <p>
        This reference reads <code>schema.json</code> from the Core repository.
        The example is intentionally short; each field below explains its
        purpose, accepted values, and default where the schema provides one.
      </p>
      <CodeBlock label="optiprune.json" code={schemaPreview} />
      <div className="docs-callout">
        <strong>Schema source</strong>
        <span>
          <a
            className="docs-inline"
            href={schemaUrl}
            target="_blank"
            rel="noreferrer"
          >
            schema.json in optiprune/core
          </a>{" "}
          supplies validation and editor completion metadata.
        </span>
      </div>
      {error ? (
        <div className="docs-callout">
          <strong>Schema unavailable</strong>
          <span>
            The source link above remains available; refresh this page to retry
            the field reference.
          </span>
        </div>
      ) : schema ? (
        <div className="docs-table">
          {fields.map(([name, rawValue]) => {
            const value = rawValue as any;
            const nested = value.properties
              ? Object.entries(value.properties)
              : [];
            const metadata = [
              value.type,
              value.oneOf
                ? value.oneOf
                    .map((item: any) => item.type || "variant")
                    .join(" or ")
                : "",
              value.default !== undefined
                ? `default: ${JSON.stringify(value.default)}`
                : "",
              value.enum ? `values: ${value.enum.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div key={name} className="schema-field">
                <b>
                  <code>{name}</code>
                </b>
                <span>
                  {value.description ||
                    "No description is defined in the schema."}
                  <small>{metadata}</small>
                  {nested.map(([childName, childRaw]) => {
                    const child = childRaw as any;
                    return (
                      <small key={`${name}.${childName}`}>
                        <code>
                          {name}.{childName}
                        </code>{" "}
                        — {child.description || "Nested configuration field."}
                        {child.default !== undefined
                          ? ` · default: ${JSON.stringify(child.default)}`
                          : ""}
                        {child.enum
                          ? ` · values: ${child.enum.join(", ")}`
                          : ""}
                      </small>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p>Loading configuration fields from schema.json…</p>
      )}
    </section>
  );
}

function pluginTitle(name: string) {
  const special: Record<string, string> = {
    nextjs: "Next.js",
    nestjs: "NestJS",
    vuejs: "Vue.js",
    "node-llama-cpp": "node-llama-cpp",
    "onnxruntime-node": "ONNX Runtime Node",
    tensorflowjs: "TensorFlow.js",
    transformersjs: "Transformers.js",
    "vercel-ai-sdk": "Vercel AI SDK",
    "graphql-runtime": "GraphQL Runtime",
    langchainjs: "LangChain.js",
    openapi: "OpenAPI",
    "github-actions": "GitHub Actions",
    "react-native": "React Native",
    "svelte-kit": "SvelteKit",
    vitepress: "VitePress",
    pnpm: "pnpm",
    nx: "Nx",
    pm2: "PM2",
    zod: "Zod",
  };
  const bare = name.replace(/-plugin$/, "");
  if (special[bare]) return special[bare];
  return bare
    .split("-")
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : `${part[0].toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

// Only plugins identified as having a graphical logo in pasted_content_3 receive an image.
// Wordmark-only and plain-text plugins deliberately render without a visual mark.
const officialPluginIcons: Record<string, string> = {
  "openclaw-plugin": "svgl:openclaw",
  "node-llama-cpp-plugin": "iconify:logos:meta-icon",
  "angular-plugin": "angular",
  "astro-plugin": "astro",
  "ava-plugin": "iconify:logos:ava",
  "babel-plugin": "babel",
  "biome-plugin": "biome",
  "bun-plugin": "bun",
  "capacitor-plugin": "capacitor",
  "changesets-plugin": "iconify:vscode-icons:folder-type-changesets",
  "commitlint-plugin": "commitlint",
  "convex-plugin": "convex",
  "cypress-plugin": "cypress",
  "dependency-cruiser-plugin": "iconify:lucide:ship",
  "docker-plugin": "docker",
  "docusaurus-plugin": "docusaurus",
  "drizzle-plugin": "drizzle",
  "eleventy-plugin": "eleventy",
  "esbuild-plugin": "esbuild",
  "eslint-plugin": "eslint",
  "expo-plugin": "expo",
  "fastify-plugin": "fastify",
  "fumadocs-plugin": "iconify:selfhst:fumadocs",
  "gatsby-plugin": "gatsby",
  "graphql-codegen-plugin": "graphql",
  "graphql-runtime-plugin": "graphql",
  "hardhat-plugin": "iconify:logos:hardhat",
  "heroku-plugin": "iconify:logos:heroku",
  "hono-plugin": "hono",
  "husky-plugin": "iconify:token-branded:husky",
  "jest-plugin": "jest",
  "jetbrains-plugin": "jetbrains",
  "karma-plugin": "iconify:logos:karma",
  "knex-plugin": "iconify:logos:knex",
  "knip-plugin": "knip",
  "ladle-plugin": "iconify:solar:ladle-bold",
  "lefthook-plugin": "lefthook",
  "lit-plugin": "lit",
  "marko-plugin": "marko",
  "mdx-plugin": "mdx",
  "metro-plugin": "metro",
  "mocha-plugin": "mocha",
  "moonrepo-plugin": "moonrepo",
  "msw-plugin": "iconify:logos:msw",
  "nestjs-plugin": "nestjs",
  "netlify-plugin": "netlify",
  "nextjs-plugin": "nextdotjs",
  "nitro-plugin": "iconify:unjs:nitro",
  "nuxtjs-plugin": "svgl:nuxt",
  "nx-plugin": "nx",
  "oclif-plugin": "oclif",
  "openapi-plugin": "openapiinitiative",
  "openapi-ts": "openapiinitiative",
  "panda-css-plugin": "iconify:mdi:panda",
  "parcel-plugin": "iconify:logos:parcel",
  "payload-cms-plugin": "payloadcms",
  "playwright-plugin": "iconify:logos:playwright",
  "github-actions-plugin": "githubactions",
  "pnpm-plugin": "pnpm",
  "postcss-plugin": "postcss",
  "prettier-plugin": "prettier",
  "prisma-plugin": "prisma",
  "quasar-plugin": "quasar",
  "qwik-plugin": "qwik",
  "raycast-plugin": "raycast",
  "react-plugin": "react",
  "react-native-plugin": "react",
  "react-cosmos-plugin": "iconify:lucide:orbit",
  "react-email-plugin": "react",
  "remix-plugin": "remix",
  "rolldown-plugin": "rolldown",
  "rollup-plugin": "rollupdotjs",
  "rsbuild-plugin": "svgl:rsbuild",
  "rspack-plugin": "svgl:rspack",
  "sanity-plugin": "sanity",
  "sentry-plugin": "sentry",
  "serverless-plugin": "serverless",
  "size-limit-plugin": "iconify:lucide:gauge",
  "sst-plugin": "sst",
  "storybook-plugin": "storybook",
  "stryker-plugin": "stryker",
  "stylelint-plugin": "stylelint",
  "svelte-plugin": "svelte",
  "svelte-kit-plugin": "svelte",
  "svgo-plugin": "svgo",
  "swc-plugin": "swc",
  "tailwind-plugin": "tailwindcss",
  "tauri-plugin": "tauri",
  "temporal-io-plugin": "temporal",
  "travis-ci-plugin": "travisci",
  "trpc-plugin": "trpc",
  "typeorm-plugin": "typeorm",
  "unocss-plugin": "unocss",
  "vercel-plugin": "vercel",
  "vercel-ai-sdk-plugin": "vercel",
  "vite-plugin": "vite",
  "vite-specialized-plugin": "vite",
  "vitepress-plugin": "vite",
  "vitest-plugin": "vitest",
  "vscode-plugin": "iconify:logos:visual-studio-code",
  "vuejs-plugin": "vuedotjs",
  "webdriver-io-plugin": "webdriverio",
  "webpack-plugin": "webpack",
  "wireit-plugin": "iconify:lucide:network",
  "wrangler-plugin": "cloudflare",
  "cloudflare-wrangler-plugin": "cloudflare",
  "yarn-plugin": "yarn",
  "zod-plugin": "zod",
  "tanstack-router": "tanstack",
  "tanstack-router-plugin": "tanstack",
  "langchainjs-plugin": "langchain",
  "onnxruntime-node-plugin": "onnx",
  "tensorflowjs-plugin": "tensorflow",
};

// Only the explicit emoji marks in pasted_content_3 receive an emoji badge.
const emojiPluginMarks: Record<string, string> = {
  "transformersjs-plugin": "🤗",
  "changelogen-plugin": "💅",
  "changelogithub-plugin": "✨",
  "cucumber-plugin": "🥒",
  "lint-staged-plugin": "🚫💩",
  "orval-plugin": "🍺",
  "plop-plugin": "🍬",
  "release-it-plugin": "🚀",
  "semantic-release-plugin": "🚀📦",
  "xo-plugin": "❤️",
};

function pluginIcon(name: string) {
  return officialPluginIcons[name] ?? null;
}

function pluginLogoSrc(icon: string) {
  if (icon.startsWith("svgl:"))
    return `https://api.svgl.app/svg/${icon.slice("svgl:".length)}.svg`;
  if (icon.startsWith("iconify:"))
    return `https://api.iconify.design/${icon.slice("iconify:".length)}.svg`;
  return `https://cdn.simpleicons.org/${icon}`;
}

function pluginEmoji(name: string) {
  return emojiPluginMarks[name] ?? null;
}

function PluginLogo({ plugin }: { plugin: PluginRecord }) {
  const [failed, setFailed] = useState(false);
  const title = pluginTitle(plugin.name);
  const icon = pluginIcon(plugin.name);
  const emoji = pluginEmoji(plugin.name);

  // Text-only entries, including wordmarks, intentionally do not receive a badge.
  if (!icon && !emoji) return null;

  if (emoji) {
    return (
      <span
        className="docs-plugin-mark docs-plugin-logo"
        role="img"
        aria-label={`${title} emoji mark`}
      >
        {emoji}
      </span>
    );
  }

  // A failed graphical asset falls back to text-only; initials are never substituted.
  if (failed) return null;

  return (
    <span
      className="docs-plugin-mark docs-plugin-logo"
      role="img"
      aria-label={`${title} logo`}
    >
      <img src={pluginLogoSrc(icon)} alt="" onError={() => setFailed(true)} />
    </span>
  );
}

type PluginNarrative = {
  summary: string;
  activation: string;
  looksFor: string;
  behavior: string;
};

function pluginNarrative(plugin: PluginRecord): PluginNarrative {
  const title = pluginTitle(plugin.name);
  const specific: Record<string, PluginNarrative> = {
    "nextjs-plugin": {
      summary:
        "Makes Next.js route, metadata, middleware, configuration, and MDX conventions visible to the analysis engine.",
      activation:
        "It turns on when it finds a Next.js configuration file, a Next dependency paired with Next scripts, or an App/Pages Router project structure.",
      looksFor:
        "It examines route and layout files, route handlers, middleware, Next metadata exports, MDX providers, Next imports, and Next-related scripts.",
      behavior:
        "It preserves framework-owned routes and runtime exports that may not have ordinary local import references, and checks whether an observed Next configuration is backed by the declared dependency.",
    },
    "node-llama-cpp-plugin": {
      summary:
        "Adds semantic awareness for node-llama-cpp model and sequence usage.",
      activation:
        "It turns on when node-llama-cpp is declared and source files contain compatible package usage.",
      looksFor:
        "It examines ESM and CommonJS package imports, model and sequence calls, and resource-handling patterns around the runtime.",
      behavior:
        "It keeps observed node-llama-cpp usage connected to the package declaration and can identify a mismatch between imported runtime code and package metadata.",
    },
    "onnxruntime-node-plugin": {
      summary:
        "Adds awareness for server-side ONNX Runtime inference sessions.",
      activation: "It turns on when the workspace declares onnxruntime-node.",
      looksFor:
        "It examines imports or require calls, session and inference-resource usage, and the dependency declaration.",
      behavior:
        "It treats genuine ONNX Runtime usage as runtime evidence so inference dependencies are not removed simply because the pattern is indirect.",
    },
    "tensorflowjs-plugin": {
      summary:
        "Adds awareness for TensorFlow.js inference and tensor lifecycle code.",
      activation:
        "It turns on when a TensorFlow.js package is declared in the workspace.",
      looksFor:
        "It examines TensorFlow.js imports, tensor-producing calls, disposal-oriented lifecycle patterns, and package usage.",
      behavior:
        "It connects model-runtime code to its dependencies and retains evidence that would otherwise be hard to infer from a plain import graph.",
    },
    "transformersjs-plugin": {
      summary:
        "Adds awareness for Transformers.js package usage and inference calls.",
      activation:
        "It turns on when @huggingface/transformers is declared in the project.",
      looksFor:
        "It examines package imports, compatible CommonJS access, and inference-oriented calls.",
      behavior:
        "It recognizes the package as runtime evidence when the surrounding model pipeline is reachable through the application’s execution paths.",
    },
    "vercel-ai-sdk-plugin": {
      summary:
        "Adds awareness for Vercel AI SDK generation and streaming flows.",
      activation:
        "It turns on when the ai or @ai-sdk/ai package is declared in the workspace.",
      looksFor:
        "It examines imports, compatible require calls, and AI SDK generation-oriented APIs.",
      behavior:
        "It keeps observed AI SDK runtime usage aligned with package declarations so valid generation flows are not mistaken for unused dependency code.",
    },
    "openapi-plugin": {
      summary: "Recognizes OpenAPI contracts as a first-class project surface.",
      activation:
        "It turns on when it finds openapi.yaml, openapi.yml, openapi.json, or matching project package evidence.",
      looksFor:
        "It examines OpenAPI specification files, nested OpenAPI folders, and packages that consume or generate API contracts.",
      behavior:
        "It retains contract files and their supporting package usage when they are part of the API workflow rather than ordinary imported application modules.",
    },
    "langchainjs-plugin": {
      summary:
        "Adds awareness for LangChain.js model, tool, and loader integrations.",
      activation:
        "It turns on when compatible LangChain packages are declared by the workspace.",
      looksFor:
        "It examines package imports, loader and chain construction, tool calls, and related runtime dependency evidence.",
      behavior:
        "It treats the model-pipeline conventions as meaningful runtime usage, reducing false unused-dependency reports for indirect AI integrations.",
    },
    "graphql-runtime-plugin": {
      summary:
        "Adds awareness for GraphQL runtime packages and execution paths.",
      activation:
        "It turns on when GraphQL runtime packages are declared or used by the workspace.",
      looksFor:
        "It examines runtime imports, resolver and schema-oriented usage, and compatible package evidence.",
      behavior:
        "It keeps GraphQL runtime dependencies and convention-owned execution surfaces connected to the analysis result.",
    },
  };

  if (specific[plugin.name]) return specific[plugin.name];

  const categoryCopy: Record<string, string> = {
    Frameworks:
      "framework entry files, configuration, route or component conventions, runtime imports, and public framework exports",
    "Testing & QA":
      "test-runner configuration, test-owned files, fixtures, test scripts, and package imports",
    "Testing & quality":
      "test-runner configuration, test-owned files, fixtures, test scripts, and package imports",
    "Tooling & ecosystem":
      "tool configuration, package scripts, generated artifacts, and package imports",
    "Libraries & APIs":
      "library configuration, API contracts, package imports, and convention-owned source files",
    "Project conventions":
      "repository metadata, convention files, package scripts, and project-owned runtime files",
    "AI & machine learning":
      "model-runtime package usage, indirect execution calls, configuration, and dependency declarations",
  };

  const focus =
    categoryCopy[plugin.category] ||
    "project metadata, configuration, imports, and file conventions";
  return {
    summary: `${title} awareness for OptiPrune’s static analysis.`,
    activation: `It turns on automatically when it finds ${title}-specific project evidence, such as a declared package, configuration file, script, or naming convention.`,
    looksFor: `It examines ${focus}.`,
    behavior:
      plugin.category === "Frameworks"
        ? "It protects framework-owned files and exports that are valid runtime surfaces even when a local import graph does not fully explain them."
        : "It keeps tool-owned files and valid package usage connected to the analysis result when ordinary source imports alone are not enough evidence.",
  };
}

function PluginsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = [
    "All",
    ...Array.from(new Set(plugins.map((plugin) => plugin.category))),
  ];

  const filtered = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          `${plugin.name} ${pluginTitle(plugin.name)} ${pluginNarrative(plugin).summary} ${plugin.category}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (category === "All" || plugin.category === category),
      ),
    [query, category],
  );

  return (
    <>
      <PageIntro eyebrow="Reference / Plugins" title="Plugins">
        Plugins with an official visual mark or an explicit emoji display it
        here; wordmark-only and plain-text plugins remain text-only. Each entry
        explains the project evidence it recognizes, when it activates, and how
        that evidence changes analysis.
      </PageIntro>
      <div className="docs-callout">
        <strong>{plugins.length} Core plugins</strong>
        <span>
          Search by package, plugin name, or category. Open any item for its
          activation criteria, search focus, and behavior.
        </span>
      </div>
      <div className="plugin-controls">
        <label>
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plugins or packages"
          />
        </label>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="plugin-count">
        {filtered.length} of {plugins.length} plugins
      </div>
      <div className="docs-plugin-list">
        {filtered.map((plugin) => {
          const narrative = pluginNarrative(plugin);
          return (
            <article key={plugin.name} className="docs-plugin">
              <div className="docs-plugin-main">
                <PluginLogo plugin={plugin} />
                <div>
                  <h2>{pluginTitle(plugin.name)}</h2>
                  <div className="docs-plugin-meta">
                    {plugin.category} · {plugin.version}
                  </div>
                  <p>{narrative.summary}</p>
                </div>
              </div>
              <div className="docs-plugin-detail">
                <span>
                  <b>Activates on</b>
                  {narrative.activation}
                </span>
                <span>
                  <b>Searches for</b>
                  {narrative.looksFor}
                </span>
                <a
                  href={`/docs/plugins/${encodeURIComponent(plugin.name.replace(/-plugin$/, ""))}`}
                >
                  View details <ArrowRight size={13} />
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function PluginDetailPage({ plugin }: { plugin: PluginRecord }) {
  const narrative = pluginNarrative(plugin);
  return (
    <>
      <PageIntro
        eyebrow={`Plugins / ${plugin.category}`}
        title={pluginTitle(plugin.name)}
      >
        {narrative.summary}
      </PageIntro>
      <div className="docs-callout">
        <strong>Package</strong>
        <span>
          <code>{plugin.name}</code> · Version {plugin.version} · Activate or
          disable this plugin directly in the{" "}
          <a className="docs-inline" href="/docs/configuration">
            configuration
          </a>
          .
        </span>
      </div>
      <div className="plugin-detail-grid">
        <section>
          <span>Activates when</span>
          <p>{narrative.activation}</p>
        </section>
        <section>
          <span>Searches for</span>
          <p>{narrative.looksFor}</p>
        </section>
        <section>
          <span>What it changes</span>
          <p>{narrative.behavior}</p>
        </section>
      </div>
      <h2>Configuration override</h2>
      <p>
        Plugins are detected automatically, but the schema also supports an
        explicit override. Set the plugin to <code>true</code> to require it or{" "}
        <code>false</code> to keep it disabled for this project.
      </p>
      <CodeBlock
        label="optiprune.json"
        code={`{\n  "plugins": {\n    "${plugin.name}": true\n  }\n}`}
      />
      <div className="docs-next-grid">
        <LinkCard
          href="/docs/plugins"
          title="Back to plugins"
          text="Search the complete Core plugin catalog."
        />
        <LinkCard
          href="/docs/configuration"
          title="Configuration reference"
          text="See every schema-backed configuration field."
        />
      </div>
    </>
  );
}

function CliPage() {
  return (
    <>
      <PageIntro eyebrow="Reference / CLI" title="CLI commands & options">
        The <code>@optiprune/cli</code> package runs the Core engine from the
        command line. The default command is <code>analyze</code>; command-line
        values take precedence over file configuration.
      </PageIntro>
      <CodeBlock
        label="Commands"
        code={
          "npx @optiprune/cli analyze [options]\n" +
          "npx @optiprune/cli export-cache <targetPath>\n" +
          "npx @optiprune/cli import-cache <sourcePath>\n" +
          "npx @optiprune/cli --help\n" +
          "npx @optiprune/cli --version"
        }
      />
      <h2>Analyze options</h2>
      <Table rows={cliOptions} />
      <h2>Cache subcommands</h2>
      <Table
        rows={[
          [
            "export-cache <targetPath>",
            "Export the local analysis cache to JSON.",
          ],
          [
            "import-cache <sourcePath>",
            "Import a cache JSON file into the current project cache.",
          ],
          [
            "-r, --rootDir <path>",
            "Use a different project root with either cache command.",
          ],
        ]}
      />
      <div className="docs-callout">
        <strong>Safe fixes first</strong>
        <span>
          <code>--confidence</code>, <code>--force</code>, and{" "}
          <code>--dry-run</code> work with <code>--fix</code> or{" "}
          <code>--fix-json</code>. Use a dry run before allowing any file
          changes.
        </span>
      </div>
    </>
  );
}

function ConfigPage() {
  return (
    <>
      <PageIntro eyebrow="Configuration & discovery" title="Configuration">
        Place an OptiPrune configuration beside your project, or use the{" "}
        <code>optiprune</code> field in <code>package.json</code>. Core merges
        it with its defaults; command-line options are explicit overrides.
      </PageIntro>
      <h2>Where configuration is read</h2>
      <Table
        rows={[
          ["1", "optiprune.json"],
          ["2", "optiprune.jsonc", "Allows comments and trailing commas"],
          ["3", "optiprune.config.ts", "TypeScript default export"],
          ["4", "optiprune.config.js", "JavaScript ESM default export"],
          ["5", "optiprune.config.mjs", "JavaScript ESM default export"],
          ["6", "package.json#optiprune", "Fallback package field"],
        ]}
      />
      <h2>How options are merged</h2>
      <p>
        Command-line options override file values. Ignore patterns are combined
        with built-in ignores; nested rules, plugins, and layers are merged by
        key. The source of truth for every valid field is the Core{" "}
        <code>schema.json</code> reference below.
      </p>
      <SchemaReference />
    </>
  );
}

function FixesPage() {
  return (
    <>
      <PageIntro eyebrow="Reference / fixes" title="Automated fixes">
        Fixes are opt-in and confidence-gated. Begin with a dry run, review the
        proposed changes, then run the same command without{" "}
        <code>--dry-run</code> only when the result is acceptable.
      </PageIntro>
      <CodeBlock
        label="CLI"
        code={
          "npx @optiprune/cli analyze --fix files dependencies --dry-run\n" +
          "npx @optiprune/cli analyze --fix exports --confidence medium+\n" +
          "npx @optiprune/cli analyze --fix-json"
        }
      />
      <h2>Fix targets</h2>
      <Table
        rows={[
          ["files", "Verified unreachable files."],
          ["exports", "Verified unused exports and members."],
          ["dependencies", "Unused runtime dependencies."],
          ["devDependencies", "Unused development dependencies."],
          ["conditions", "Verified constant conditions."],
          [
            "json",
            "Safe recovery of malformed package.json syntax where the repair is unambiguous.",
          ],
        ]}
      />
      <div className="docs-callout">
        <strong>Safety boundary</strong>
        <span>
          <code>--force</code> changes the safety decision for a selected fix;
          it does not make an unverified finding correct.
        </span>
      </div>
    </>
  );
}

function CoreApiPage() {
  return (
    <>
      <PageIntro eyebrow="Reference / Core" title="Core functions">
        Use <code>@optiprune/core</code> when the CLI is not the right
        integration boundary. The package returns structured results for CI,
        editors, dashboards, and custom developer tooling.
      </PageIntro>
      <CodeBlock
        label="TypeScript / ESM"
        code={
          'import { analyze, shouldFail, applyFixes } from "@optiprune/core";\n\n' +
          "const report = await analyze({\n" +
          "  rootDir: process.cwd(),\n" +
          '  entry: ["src/index.ts"],\n' +
          '  output: "json",\n' +
          "});\n\n" +
          'if (shouldFail(report, "high")) process.exitCode = 1;'
        }
      />
      <h2>Public functions</h2>
      <Table rows={coreFunctions} />
      <h2>Report result</h2>
      <p>
        An <code>AnalysisReport</code> contains the project root, discovered
        entry points, findings, summary counters, module records, export
        information, dependency edges, and strongly connected components.
      </p>
    </>
  );
}

function AnalysisPage() {
  return (
    <>
      <PageIntro eyebrow="Reference / engine" title="Analysis & findings">
        Core combines source parsing, module graphs, dynamic-path analysis,
        project metadata, and optional proof layers to decide what is reachable
        in a JavaScript or TypeScript workspace.
      </PageIntro>
      <div className="layer-list">
        {[
          [
            "01",
            "Source & graph",
            "Parses supported files, connects imports and exports, and establishes reachability roots.",
          ],
          [
            "02",
            "Control flow",
            "Finds unreachable statements, constant conditions, and contradictory guards.",
          ],
          [
            "03",
            "Constraint proof",
            "Uses the optional SMT pass for conditions that need stronger proof.",
          ],
          [
            "04",
            "Isolated proof",
            "Uses the optional concolic execution pass for selected dynamic-path evidence.",
          ],
          [
            "05",
            "Project context",
            "Examines manifests, scripts, dependencies, workspaces, and public package surfaces.",
          ],
          [
            "06",
            "Framework context",
            "Uses plugins to understand convention-owned paths and externally managed runtime surfaces.",
          ],
        ].map(([number, title, text]) => (
          <div className="layer-row" key={number}>
            <span>{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <h2>Finding families</h2>
      <Table
        rows={[
          [
            "Reachability",
            "Unused exports or members, unreachable files, and unreachable statements.",
          ],
          [
            "Logic",
            "Constant conditions, contradictory guards, and unreachable dynamic paths.",
          ],
          [
            "Imports",
            "Unresolved imports, unknown dynamic imports, and parse recovery information.",
          ],
          [
            "Project metadata",
            "Missing, unused, or non-existent dependencies and missing script targets.",
          ],
          ["Contracts", "Protected contracts and schema-impossible guards."],
        ]}
      />
    </>
  );
}

function ReportersPage() {
  return (
    <>
      <PageIntro eyebrow="Reference / output" title="Reporters & output">
        Core separates analysis from presentation. Choose the format that
        matches a local review, automation, or code-scanning workflow.
      </PageIntro>
      <Table
        rows={[
          ["terminal", "Human-readable analysis output."],
          ["json", "Machine-readable AnalysisReport JSON written to stdout."],
          ["sarif", "SARIF 2.1 output for CI and code-scanning workflows."],
        ]}
      />
      <CodeBlock
        code={
          "npx @optiprune/cli analyze\nnpx @optiprune/cli analyze --json\nnpx @optiprune/cli analyze --sarif > optiprune.sarif"
        }
      />
    </>
  );
}

function CachePage() {
  return (
    <>
      <PageIntro eyebrow="Reference / cache" title="Cache commands">
        Use JSON cache files to reuse analysis work locally or in CI. Cache
        import and export are available from the CLI and the public Core API.
      </PageIntro>
      <CodeBlock
        label="CLI"
        code={
          "npx @optiprune/cli analyze --cache-from .optiprune/cache.json --cache-to .optiprune/cache.json\n" +
          "npx @optiprune/cli export-cache .optiprune/cache.json\n" +
          "npx @optiprune/cli import-cache .optiprune/cache.json"
        }
      />
      <Table
        rows={[
          ["--cache-from <path>", "Import a JSON cache before analysis."],
          ["--cache-to <path>", "Export the resulting cache after analysis."],
          [
            "exportCache",
            "Core helper that writes a portable cache JSON file.",
          ],
          ["importCache", "Core helper that loads a portable cache JSON file."],
        ]}
      />
    </>
  );
}

function QuickReferencePage() {
  const [query, setQuery] = useState("");
  const entries = [
    ...cliOptions.map(([name, text]) => ({
      kind: "CLI",
      name,
      text,
      href: "/docs/cli",
    })),
    ...coreFunctions.map(([name, text]) => ({
      kind: "Core",
      name,
      text,
      href: "/docs/core-api",
    })),
    ...[
      "rootDir",
      "entry",
      "extensions",
      "ignore",
      "externalContracts",
      "reportUnusedExports",
      "includeConventionalEntries",
      "failOn",
      "verbose",
      "fix",
      "output",
      "rules",
      "plugins",
      "layers",
    ].map((name) => ({
      kind: "Config",
      name,
      text: "Schema-backed configuration field",
      href: "/docs/configuration",
    })),
  ];

  const filtered = entries.filter((item) =>
    `${item.kind} ${item.name} ${item.text}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <>
      <PageIntro eyebrow="Reference / search" title="Search the reference">
        Search current CLI flags, public Core functions, and configuration
        fields without leaving the documentation.
      </PageIntro>
      <div className="plugin-controls">
        <label>
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, functions, or fields"
          />
        </label>
      </div>
      <div className="plugin-count">
        {filtered.length} matches · {entries.length} indexed entries
      </div>
      <div className="docs-table">
        {filtered.map((item) => (
          <div key={`${item.kind}-${item.name}`}>
            <b>
              <code>{item.name}</code>
            </b>
            <span>
              <small>{item.kind}</small>
              {item.text}{" "}
              <a className="docs-inline" href={item.href}>
                Open reference <ArrowRight size={12} />
              </a>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function DocsArticle({ slug }: { slug: string }) {
  if (slug === "plugins") return <PluginsPage />;
  if (slug === "configuration") return <ConfigPage />;
  if (slug === "cli") return <CliPage />;
  if (slug === "fixes") return <FixesPage />;
  if (slug === "core-api") return <CoreApiPage />;
  if (slug === "analysis") return <AnalysisPage />;
  if (slug === "reporters") return <ReportersPage />;
  if (slug === "cache") return <CachePage />;
  if (slug === "quick-reference") return <QuickReferencePage />;
  if (slug === "getting-started") {
    return (
      <>
        <PageIntro eyebrow="Start here" title="Getting Started">
          Install the CLI, run an analysis, then use this reference to choose
          the configuration, Core, fix, cache, or plugin surface that fits your
          workflow.
        </PageIntro>
        <h2>Install and run</h2>
        <CodeBlock
          code={
            "npm install --save-dev @optiprune/cli\nnpx @optiprune/cli analyze"
          }
        />
        <div className="docs-next-grid">
          <LinkCard
            href="/docs/configuration"
            title="Configure a project"
            text="Use the schema-backed configuration reference."
          />
          <LinkCard
            href="/docs/plugins"
            title="Browse plugins"
            text="See what each Core plugin recognizes and changes."
          />
        </div>
      </>
    );
  }
  if (slug === "how-it-works") {
    return (
      <>
        <PageIntro eyebrow="Start here" title="How OptiPrune works">
          OptiPrune combines parser-backed source data, module reachability,
          optional proof layers, dependency analysis, and plugin context to
          identify unreachable code with evidence.
        </PageIntro>
        <LinkCard
          href="/docs/analysis"
          title="Analysis & findings"
          text="Understand the sources of analysis evidence."
        />
      </>
    );
  }
  if (slug === "why-optiprune") {
    return (
      <>
        <PageIntro eyebrow="Start here" title="Why use OptiPrune?">
          Use OptiPrune when import graphs alone cannot explain framework entry
          points, package scripts, dynamic imports, contracts, workspace
          topology, or safe cleanup boundaries.
        </PageIntro>
        <div className="reason-grid">
          <div>
            <strong>Context-aware</strong>
            <p>
              Plugins recognize frameworks and tools that own runtime files
              outside conventional imports.
            </p>
          </div>
          <div>
            <strong>Traceable fixes</strong>
            <p>
              Fixes are explicit, confidence-gated, and can be reviewed with
              dry-run first.
            </p>
          </div>
          <div>
            <strong>Headless first</strong>
            <p>
              Use Core directly in CI, dashboards, editor integrations, and
              custom tooling.
            </p>
          </div>
        </div>
      </>
    );
  }
  if (slug === "integrations") {
    return (
      <>
        <PageIntro eyebrow="Integration" title="Integrations">
          Run the CLI locally or in CI, upload SARIF to code scanning, or embed
          Core in custom developer tooling.
        </PageIntro>
        <div className="integration-list">
          <a href={sourceLinks.vscode} target="_blank" rel="noreferrer">
            <strong>VS Code extension</strong>
            <span>Review findings close to the code you are editing.</span>
            <ArrowUpRight size={15} />
          </a>
          <a href={sourceLinks.core} target="_blank" rel="noreferrer">
            <strong>Core package</strong>
            <span>Embed structured analysis in custom developer tooling.</span>
            <ArrowUpRight size={15} />
          </a>
          <a href={sourceLinks.cli} target="_blank" rel="noreferrer">
            <strong>CLI package</strong>
            <span>
              Run analysis, JSON output, SARIF, and cache commands from
              automation.
            </span>
            <ArrowUpRight size={15} />
          </a>
        </div>
      </>
    );
  }
  if (slug === "writing-a-plugin") {
    return (
      <>
        <PageIntro eyebrow="Contributing" title="Plugin guidance">
          A useful plugin documents three things clearly: the project evidence
          that activates it, the files or APIs it recognizes, and the behavior
          it contributes to analysis. Keep recognition narrow enough that
          unrelated projects are not affected.
        </PageIntro>
        <Table
          rows={[
            [
              "Activation",
              "Use unmistakable project evidence such as a declared package, configuration file, framework route, or known script.",
            ],
            [
              "Recognition",
              "Describe the files, imports, exports, package metadata, and runtime patterns that matter to the integration.",
            ],
            [
              "Behavior",
              "Explain which valid runtime surfaces should remain connected to reachability and which metadata mismatches deserve a diagnostic.",
            ],
          ]}
        />
        <LinkCard
          href="/docs/plugins"
          title="Inspect current plugins"
          text={`${plugins.length} current Core integrations show this format.`}
        />
      </>
    );
  }
  if (slug === "source") {
    return (
      <>
        <PageIntro eyebrow="Contributing / source" title="Source repositories">
          The reference tracks the public Core and CLI repositories, with
          configuration fields read from the Core schema.
        </PageIntro>
        <div className="integration-list">
          <a href={sourceLinks.core} target="_blank" rel="noreferrer">
            <strong>optiprune/core</strong>
            <span>
              Headless analysis engine, schema, public functions, reporters,
              cache helpers, and built-in plugins.
            </span>
            <ArrowUpRight size={15} />
          </a>
          <a href={sourceLinks.cli} target="_blank" rel="noreferrer">
            <strong>optiprune/cli</strong>
            <span>
              Command-line package and option definitions for local and CI
              workflows.
            </span>
            <ArrowUpRight size={15} />
          </a>
          <a href={sourceLinks.npmCore} target="_blank" rel="noreferrer">
            <strong>@optiprune/core</strong>
            <span>Install the headless package for programmatic analysis.</span>
            <ArrowUpRight size={15} />
          </a>
          <a href={sourceLinks.npmCli} target="_blank" rel="noreferrer">
            <strong>@optiprune/cli</strong>
            <span>
              Install the command-line package as a development dependency.
            </span>
            <ArrowUpRight size={15} />
          </a>
        </div>
      </>
    );
  }
  if (slug === "monorepos") {
    return (
      <>
        <PageIntro
          eyebrow="Configuration & discovery"
          title="Monorepos & workspaces"
        >
          Core inspects workspace packages, manifests, scripts, exported
          surfaces, and package boundaries. Place the configuration at the
          workspace root and use <code>entry</code>, <code>ignore</code>, and{" "}
          <code>externalContracts</code> to clarify project-specific boundaries.
        </PageIntro>
        <LinkCard
          href="/docs/configuration"
          title="Configuration reference"
          text="Review the schema-backed fields and their defaults."
        />
      </>
    );
  }
  return (
    <>
      <PageIntro eyebrow="Configuration & discovery" title="Entry files">
        OptiPrune begins from explicit entries, package metadata, exports, bins,
        scripts, conventional framework files, and workspace topology.
      </PageIntro>
      <CodeBlock
        code={
          'npx @optiprune/cli analyze --entry src/index.ts\nnpx @optiprune/cli analyze --entry "apps/*/src/main.ts"'
        }
      />
      <p>
        Use <code>externalContracts</code> for public symbols and{" "}
        <code>includeConventionalEntries</code> to control discovery of familiar
        application roots.
      </p>
    </>
  );
}

export default function Docs() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const parts = location.split("/").filter(Boolean);
  const slug = parts[1] || "getting-started";
  const pluginSlug = parts[2] ? decodeURIComponent(parts[2]) : undefined;
  const pluginDetail =
    slug === "plugins" && pluginSlug
      ? plugins.find(
          (plugin) => plugin.name.replace(/-plugin$/, "") === pluginSlug,
        )
      : undefined;
  const currentIndex = Math.max(
    0,
    orderedDocs.findIndex(([item]) => item === slug),
  );
  const active = pluginDetail
    ? pluginTitle(pluginDetail.name)
    : orderedDocs[currentIndex]?.[1] || "Getting Started";
  const previous = orderedDocs[currentIndex - 1];
  const next = orderedDocs[currentIndex + 1];

  return (
    <div className="docs-app">
      <header className="docs-topbar">
        <a className="docs-brand" href="/">
          <img src="/optiprune-logo.svg" alt="OptiPrune logo" />
          <span>
            <b>OPTI</b>
            <em>PRUNE</em>
          </span>
        </a>
        <button
          className="docs-mobile-menu"
          onClick={() => setMobileOpen(true)}
          aria-label="Open documentation navigation"
        >
          <Menu size={18} />
        </button>
        <nav className="docs-top-actions">
          <a href="/">Home</a>
          <a
            className="skill-link"
            aria-label="GitHub"
            href={sourceLinks.core}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=github" alt="GitHub" />
          </a>
          <a
            className="skill-link"
            aria-label="npm"
            href={sourceLinks.npmCli}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=npm" alt="npm" />
          </a>
          <a
            className="skill-link"
            aria-label="VS Code extension"
            href={sourceLinks.vscode}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=vscode" alt="VS Code" />
          </a>
        </nav>
      </header>
      <div className={`docs-frame ${mobileOpen ? "nav-open" : ""}`}>
        <aside className="docs-nav">
          <div className="docs-nav-head">
            <span>DOCUMENTATION</span>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
          </div>
          {groups.map((group) => (
            <div className="docs-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(([item, label]) => (
                <a
                  key={item}
                  className={slug === item ? "active" : ""}
                  href={`/docs/${item}`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </a>
              ))}
            </div>
          ))}
        </aside>
        <main className="docs-main">
          <div className="docs-breadcrumb">
            <a href="/">OptiPrune</a>
            <ArrowRight size={13} />
            <span>Docs</span>
            <ArrowRight size={13} />
            <strong>{active}</strong>
          </div>
          <article className="docs-article">
            {pluginDetail ? (
              <PluginDetailPage plugin={pluginDetail} />
            ) : (
              <DocsArticle slug={slug} />
            )}
          </article>
          <footer className="docs-footer">
            {previous ? (
              <a href={`/docs/${previous[0]}`}>
                <ArrowLeft size={14} /> {previous[1]}
              </a>
            ) : (
              <span />
            )}
            {next ? (
              <a href={`/docs/${next[0]}`}>
                {next[1]} <ArrowRight size={14} />
              </a>
            ) : (
              <span />
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}
