# QA notes

The local preview at `http://localhost:8788/` renders completely after the escape fix. The header navigation, hero with OptiPrune animation, violet/orange editorial styling, grid and ambient background, CTA buttons, metric bar, feature cards, and terminal example were checked in the browser. No visible rendering error was reported. The homepage plugin counter now loads the generated `plugins.json` value.

The Plugins page displays 163 plugins from `src/plugins`; categories, source links, and search filtering were checked in the browser. Searching for `astro` correctly reduces the view to `astro-plugin`. The design remains readable and responsive with the full card set.

The Docs page was fully checked: Install, Workflow, Config, Plugins, and Guides are visible with a table of contents and code examples. The Blog page shows a clear empty state without login and explains `show_on_website: true`.
