# Release process

The package uses [`release-it`](https://github.com/release-it/release-it) with the Conventional Changelog plugin. Releases are started manually from **GitHub Actions → Release → Run workflow** by selecting `patch`, `minor`, or `major`.

The workflow checks out the complete history, installs dependencies, runs the build and test suite, then executes `release-it` in CI mode. `release-it` updates `package.json` and `package-lock.json`, writes `CHANGELOG.md`, commits the version bump as `chore: release vX.Y.Z`, creates and pushes tag `vX.Y.Z`, and creates the corresponding GitHub release. The existing `npm-publish.yml` workflow publishes the package after that GitHub release is published, so npm is not published twice.

The release workflow only needs the standard `GITHUB_TOKEN` permissions declared in `.github/workflows/release.yml`. npm publishing is intentionally handled by the existing `npm-publish.yml` workflow after the GitHub release is published. That workflow uses npm provenance via `id-token: write` and `npm publish --provenance`. Configure npm Trusted Publishing for this GitHub Actions workflow in the npm package settings; no registry secret is needed.

After the release is created, `scripts/comment-release-items.mjs` queries merged pull requests on `main` since the previous version tag. It comments on each included pull request with the released version. When a pull request title or body contains `Fixes #123`, `Closes #123`, or `Resolves #123` (including their grammatical variants), the corresponding issue receives a separate **Patched in @optiprune/core@X.Y.Z** comment. HTML markers make both operations idempotent, so rerunning the hook does not create duplicate comments for the same release.

The public report version is loaded from the package located beside the built output. There is no numeric fallback anymore: if `package.json` cannot provide a version, the package fails immediately with a descriptive error. This keeps the built-in core version aligned with the version being released.
