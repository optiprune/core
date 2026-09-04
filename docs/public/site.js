const app = document.querySelector("#app");

const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const safeHtml = (s) => {
  const t = document.createElement("template");
  t.innerHTML = s;
  t.content.querySelectorAll("script,iframe,object,embed,style,form").forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((n) =>
    [...n.attributes].forEach((a) => {
      if (
        /^on/i.test(a.name) ||
        ((a.name === "href" || a.name === "src") && /^javascript:/i.test(a.value))
      )
        n.removeAttribute(a.name);
    }),
  );
  return t.innerHTML;
};

const authors = (post) => {
  const value = post?.authors ?? post?.author;
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .map((author) => {
      if (typeof author === "string") return author.trim();
      if (author && typeof author === "object")
        return String(
          author.name || author.displayName || author.username || author.email || "",
        ).trim();
      return "";
    })
    .filter(Boolean);
};

const authorMeta = (post) => {
  const names = authors(post);
  return names.length ? ` · By ${esc(names.join(", "))}` : "";
};
const inline = (source = "") => {
  const htmlTokens = [];
  const protectedSource = String(source).replace(/<\/?[a-z][^>]*>/gi, (tag) => {
    const index = htmlTokens.push(safeHtml(tag)) - 1;
    return `\u0000HTML${index}\u0000`;
  });
  let output = esc(protectedSource)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    )
    .replace(/  \n/g, "<br>");
  return output.replace(/\u0000HTML(\d+)\u0000/g, (_, index) => htmlTokens[Number(index)] || "");
};

const md = (source = "") => {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inline(paragraph.join("\n"))}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (list) {
      output.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (code) {
        const langClass = code.language ? ` class="language-${esc(code.language)}"` : "";
        output.push(`<pre><code${langClass}>${esc(code.text.replace(/\n$/, ""))}</code></pre>`);
        code = null;
      } else {
        flushParagraph();
        closeList();
        code = { text: "", language: fence[1].trim() };
      }
      continue;
    }

    if (code) {
      code.text += `${line}\n`;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      closeList();
      output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const item = line.match(/^\s*([-*+] |\d+[.] )(.*)$/);
    if (item) {
      flushParagraph();
      const type = /^\d/.test(item[1]) ? "ol" : "ul";
      if (list !== type) {
        closeList();
        list = type;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inline(item[2])}</li>`);
      continue;
    }

    if (
      /^\s*<(?:(?:article|aside|div|figure|p|section|table|ul|ol|h[1-6]|blockquote|pre|details|hr)\b|!--)/i.test(
        line,
      )
    ) {
      flushParagraph();
      closeList();
      output.push(safeHtml(line));
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  if (code) {
    const langClass = code.language ? ` class="language-${esc(code.language)}"` : "";
    output.push(`<pre><code${langClass}>${esc(code.text.replace(/\n$/, ""))}</code></pre>`);
  }
  return safeHtml(output.join(""));
};

const layout = (content, kicker, title, lede = "") =>
  `<div class="page"><div class="kicker">${kicker}</div><div class="section-head"><div><h1 class="article-title">${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</div></div>${content}</div>`;

const home = () =>
  `<div class="page"><section class="hero"><div><div class="kicker">A static Code Analyzer</div><h1>Stop guessing.<br><em>Start proving.</em></h1><p class="lede">OptiPrune builds a dependency graph from your real entry points and shows what is never reached — files, imports, exports, packages, and logic.</p><div class="actions"><a class="button primary" href="/docs">Read the docs →</a><a class="button secondary" href="/plugins">Explore plugins</a></div><p class="blog-meta">npm install --save-dev @optiprune/cli · inspect first, fix deliberately</p></div><div class="hero-art"><img src="/assets/optiprune-animation.svg" alt="OptiPrune dependency graph animation" /></div></section><section class="section"><div class="section-head"><div><div class="kicker">Why OptiPrune</div><h2>Understand your codebase.</h2></div><p>Designed for safe cleanup: inspect the graph, review confidence, then remove only what your codebase can prove is unreachable.</p></div><div class="feature-grid"><div class="card"><span class="number">01 / GRAPH</span><h3>Reachability, not heuristics</h3><p>Entry points create a real module graph instead of relying on naming guesses or arbitrary percentages.</p></div><div class="card"><span class="number">02 / CONTEXT</span><h3>Context-aware findings</h3><p>Dynamic dispatch, test conventions, generated files, and package metadata stay visible in the analysis.</p></div><div class="card"><span class="number">03 / CONTROL</span><h3>Dry-run first</h3><p>Every fix is explicit. Preview changes, use confidence gates, and keep a clean audit trail in CI.</p></div></div></section><section class="section"><div class="section-head"><div><div class="kicker">A small proof</div><h2>Scan. Verify. Prune.</h2></div></div><div class="terminal"><div>$ npx @optiprune/cli analyze</div><div class="warn">✖ [high] src/legacy/orphan.ts — unreachable-file</div><div class="warn">⚠ [medium] src/legacy/index.ts — unused-export: legacyFn</div><div class="ok">Analysis complete · review findings before applying fixes</div></div></section></div>`;

const docs = () =>
  layout(
    `<div class="docs-layout"><aside class="toc"><a href="#install">01 Install</a><a href="#workflow">02 Workflow</a><a href="#config">03 Config</a><a href="#plugins">04 Plugins</a><a href="#guides">05 Guides</a></aside><article class="article"><section id="install"><h2>Install</h2><p>OptiPrune is a headless analyzer for TypeScript and JavaScript workspaces. Use the CLI for a quick scan or import Core when you need programmatic control.</p><pre>npm install --save-dev @optiprune/cli\nnpm install @optiprune/core</pre><p>Run from the workspace root:</p><pre>npx optiprune ./src --entry src/index.ts --dry-run</pre></section><section id="workflow"><h2>A predictable workflow</h2><p>Start with a dry run, inspect high-confidence findings, then widen the scope. OptiPrune keeps analysis and mutation separate so a CI check cannot silently rewrite your repository.</p><div class="feature-grid"><div class="card"><span class="number">1</span><h3>Discover</h3><p>Declare entry points and let the graph reveal reachable modules.</p></div><div class="card"><span class="number">2</span><h3>Review</h3><p>Use high, medium, and low confidence as a review queue.</p></div><div class="card"><span class="number">3</span><h3>Fix</h3><p>Apply only approved changes with a reproducible command.</p></div></div></section><section id="config"><h2>Configuration</h2><p>Keep configuration close to the project. Plugin overrides let you force-enable a detector or disable one that does not match your runtime conventions.</p><pre>{\n  "entry": ["src/index.ts"],\n  "plugins": { "nextjs-plugin": true, "nestjs-plugin": false },\n  "failOn": "high"\n}</pre></section><section id="plugins"><h2>Plugins</h2><p>Plugins add framework, test-runner, and tooling conventions to the graph. Browse the full inventory on the <a href="/plugins">Plugins page</a>, including source links and lifecycle hooks.</p></section><section id="guides"><h2>Guides and reference</h2><p>For CI, use JSON or SARIF reporters. For monorepos, define workspace boundaries explicitly. For custom integrations, import the headless Core API and keep file mutation behind your own approval step.</p></section></article></div>`,
    "Documentation / Core + CLI",
    "A clear path from first scan to safe cleanup.",
    "No empty “go here” pages: the essentials, commands, configuration model, plugin behavior, and next steps live together.",
  );

async function pluginsPage() {
  const data = await fetch("/plugins.json")
    .then((r) => r.json())
    .catch(() => []);
  return layout(
    `<div class="plugin-toolbar"><input id="plugin-search" placeholder="Filter plugins…" aria-label="Filter plugins" /><select id="plugin-category" aria-label="Filter by category"><option value="">All categories</option>${[
      ...new Set(data.map((x) => x.category)),
    ]
      .sort()
      .map((x) => `<option>${esc(x)}</option>`)
      .join(
        "",
      )}</select></div><p class="blog-meta">${data.length} plugins shipped from the current Core source tree.</p><div class="plugin-grid" id="plugin-grid">${data.map(pluginCard).join("")}</div>`,
    "Ecosystem / Plugin registry",
    "Plugins that understand your stack.",
    "Frameworks, test runners, build tools, and project conventions — documented with source links instead of vague promises.",
  );
}

const pluginCard = (p) =>
  `<article class="card plugin-card" data-name="${esc(p.name)}" data-category="${esc(p.category)}"><span class="tag">${esc(p.category)}</span><span class="version">v${esc(p.version || "1.0.0")}</span><h3>${esc(p.name)}</h3><p>${esc(p.summary || "Framework-aware reachability support for this tool.")}</p><a href="${esc(p.source)}" target="_blank" rel="noreferrer">View source ↗</a></article>`;

async function blogPage() {
  const posts = await fetch("/api/blog")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return layout(
    posts.length
      ? `<div class="blog-grid">${posts.map((p) => `<a class="card blog-card" href="/blog/${encodeURIComponent(p.id)}"><span class="kicker">${esc(p.category || "Engineering")}</span><h3>${esc(p.title)}</h3><p>${esc(p.excerpt || "Read the latest from OptiPrune.")}</p><div class="blog-meta">${new Date(p.published_at || p.created_at).toLocaleDateString()}${authorMeta(p)} · Read more →</div></a>`).join("")}</div>`
      : `<div class="empty">No Posts are here yet</div>`,
    "Journal / Updates",
    "The OptiPrune blog.",
    "Release notes, architecture notes, and practical cleanup patterns.",
  );
}

async function blogDetail(id) {
  const p = await fetch("/api/blog/" + encodeURIComponent(id))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!p)
    return layout(
      '<div class="empty">This post could not be found.</div>',
      "Blog / 404",
      "Post not found.",
    );
  return layout(
    `<article class="article blog-post"><div class="blog-meta">${new Date(p.published_at || p.created_at).toLocaleDateString()} · ${esc(p.category || "Engineering")}${authorMeta(p)}</div><div>${md(p.body || p.content || "")}</div></article>`,
    "Blog / " + esc(p.category || "Update"),
    esc(p.title),
    esc(p.excerpt || ""),
  );
}

async function show() {
  const rawPath = window.location.pathname;
  const path = rawPath === "/" ? "/" : rawPath.replace(/\/+$/, "") || "/";

  if (path === "/") {
    if (app) app.innerHTML = home();
  } else if (path === "/docs") {
    if (app) app.innerHTML = docs();
  } else if (path === "/plugins") {
    if (app) app.innerHTML = await pluginsPage();
    bindPlugins();
  } else if (path === "/blog") {
    if (app) app.innerHTML = await blogPage();
  } else if (path.startsWith("/blog/")) {
    if (app) app.innerHTML = await blogDetail(decodeURIComponent(path.slice(6)));
  } else if (app) {
    app.innerHTML = layout(
      '<div class="empty">The page you requested does not exist.</div>',
      "404",
      "Not found.",
    );
  }

  fetch("/api/blog")
    .then((r) => (r.ok ? r.json() : []))
    .then((posts) => {
      const fresh = posts.find(
        (p) =>
          p.show_on_website &&
          Date.now() - new Date(p.published_at || p.created_at).getTime() < 172800000,
      );
      const a = document.querySelector("#announcement");
      if (a) {
        const allowedPaths = ["/", "/blog", "/docs"];
        if (fresh && allowedPaths.includes(path)) {
          a.hidden = false;
          a.innerHTML = `↗ ${esc(fresh.title)} <a href="/blog/${encodeURIComponent(fresh.id)}">Learn more →</a>`;
        } else {
          a.hidden = true;
          a.innerHTML = "";
        }
      }
    })
    .catch(() => {});
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (link.target || link.hasAttribute("download") || event.metaKey || event.ctrlKey) return;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/blog/")) return;

  event.preventDefault();
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  show();
});

window.addEventListener("popstate", show);

function bindPlugins() {
  const q = document.querySelector("#plugin-search"),
    c = document.querySelector("#plugin-category");
  if (!q || !c) return;

  const filter = () =>
    document.querySelectorAll(".plugin-card").forEach((x) => {
      const matchesSearch =
        !q.value || x.dataset.name.toLowerCase().includes(q.value.toLowerCase());
      const matchesCategory = !c.value || x.dataset.category === c.value;
      x.style.display = matchesSearch && matchesCategory ? "" : "none";
    });

  q.oninput = filter;
  c.onchange = filter;

  const count = document.querySelector("#plugin-count");
  if (count) count.textContent = document.querySelectorAll(".plugin-card").length;
}

const themeToggle = document.querySelector("[data-theme-toggle]");
if (themeToggle) {
  themeToggle.onclick = () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === "dark" ? "" : "dark";
  };
}

fetch("/plugins.json")
  .then((r) => r.json())
  .then((items) => {
    const count = document.querySelector("#plugin-count");
    if (count) count.textContent = items.length;
  })
  .catch(() => {});

show();
