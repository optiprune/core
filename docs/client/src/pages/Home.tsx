/* Calm docs system: the root route is a welcoming product landing page; detailed reference content lives under /docs. */
import { ArrowRight, ArrowUpRight, Github, Package, Terminal } from "lucide-react";

const links = {
  docs: "/docs/getting-started",
  core: "https://github.com/optiprune/core",
  cli: "https://github.com/optiprune/cli",
  wrapper: "https://github.com/optiprune/cli",
  npm: "https://www.npmjs.com/package/@optiprune/cli",
  vscode: "https://marketplace.visualstudio.com/items?itemName=dreamlongyt.optiprune-vscode",
  reference: "/docs/quick-reference",
};

export default function Home() {
  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <a className="welcome-brand" href="/">
          <img src="/optiprune-animation.svg" alt="OptiPrune logo" />
          <span>
            <b>OPTI</b>
            <em>PRUNE</em>
          </span>
        </a>
        <nav>
          <a href={links.docs}>Docs</a>
          <a
            className="skill-link"
            aria-label="GitHub"
            href={links.core}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=github" alt="GitHub" />
          </a>
          <a
            className="skill-link"
            aria-label="npm"
            href={links.npm}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=npm" alt="npm" />
          </a>
          <a
            className="skill-link"
            aria-label="VS Code extension"
            href={links.vscode}
            target="_blank"
            rel="noreferrer"
          >
            <img src="https://skillicons.dev/icons?i=vscode" alt="VS Code" />
          </a>
        </nav>
      </header>
      <main className="welcome-main">
        <section className="welcome-hero">
          <div className="welcome-copy">
            <h1>
              Stop guessing.
              <br />
              <span>Start proving.</span>
            </h1>
            <p>
              OptiPrune finds unreachable files, exports, dependencies, and logic in TypeScript and
              JavaScript workspaces—then gives you the context to decide what goes.
            </p>
            <div className="welcome-actions">
              <a className="welcome-primary" href={links.docs}>
                Read the docs <ArrowRight size={16} />
              </a>
              <a className="welcome-secondary" href={links.reference}>
                Search the reference <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="welcome-badges">
              <img
                src="https://img.shields.io/npm/v/%40optiprune%2Fcore?label=core&color=6d4aff"
                alt="Core npm version"
              />
              <img
                src="https://img.shields.io/npm/v/%40optiprune%2Fcli?label=CLI&color=6d4aff"
                alt="CLI npm version"
              />
            </div>
          </div>
          <div className="welcome-art">
            <div className="welcome-art-visual">
              <img
                className="welcome-art-logo"
                src="/optiprune-animation.svg"
                alt="OptiPrune logo"
              />
              <img
                className="welcome-art-animation"
                src="/optiprune-logo.svg"
                alt="OptiPrune analyzer animation"
              />
            </div>
            <div className="welcome-art-caption">
              <span>
                <i /> Open Source
              </span>
              <span>Made by DreamLongYT</span>
            </div>
          </div>
        </section>
        <section className="welcome-links">
          <a href={links.docs}>
            <span className="welcome-link-number">01</span>
            <span>
              <strong>Explore the documentation</strong>
              <small>Getting started, configuration, CLI, API, plugins, and more.</small>
            </span>
            <ArrowRight size={17} />
          </a>
          <a href={links.core} target="_blank" rel="noreferrer">
            <span className="welcome-link-number">02</span>
            <span>
              <strong>Read the source</strong>
              <small>Follow the Core engine and built-in plugin implementations on GitHub.</small>
            </span>
            <Github size={17} />
          </a>
          <a href={links.wrapper} target="_blank" rel="noreferrer">
            <span className="welcome-link-number">03</span>
            <span>
              <strong>Choose your package</strong>
              <small>Use the headless Core or the CLI package.</small>
            </span>
            <Package size={17} />
          </a>
        </section>
      </main>
      <footer className="welcome-footer">
        <span>
          <Terminal size={14} /> npm install --save-dev @optiprune/cli
        </span>
        <span>MIT License · made by DreamLongYT</span>
      </footer>
    </div>
  );
}
