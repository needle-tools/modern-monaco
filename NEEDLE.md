# Maintained Needle variant

Upstream: https://github.com/esm-dev/modern-monaco, tag `v0.3.8`, commit
`daf46c001e7f792a455fe49b589f3a9e70f7631d`. The original MIT licence is retained.

Package: `@needle-tools/modern-monaco@0.3.8-needle.1`.

The editor previously changed generated dependency files through the repository's
root `patch-package` step. This package moves those capabilities into maintained
source so installed consumers receive the same worker behavior and property-type
query RPC. Generated `dist` files remain ignored; packaging builds them from source.

The setup API accepts a sixth `workerFactory` argument. Core passes its emitted
worker factory directly; no global factory hook or consumer patch step is needed.
The worker also exposes `resolveNeedlePropertyTypeInfo`, implemented in
`src/lsp/typescript/propertyTypeInfo.js` and covered by editor regression tests.

For standalone development, run `npm ci` using this fork's package-lock.json.
In the editor workspace, install through the editor's root npm lockfile. npm's `prepare`
lifecycle builds the package with Node; `npm run build:monaco` rebuilds it from
the repository root. `npm pack` also builds through `prepack`. No Bun installation
is required for these paths. Build scripts resolve hoisted dependencies and use
filesystem paths on Windows. Generated declarations and bundled TypeScript
libraries are produced during the build. CI rebuilds after restoring dependencies
because the generated package output is not included in its dependency cache.

Run `npm test` in this directory for the maintained property-query and worker
factory tests. They use Node, TypeScript and esbuild without editor test helpers.

Fork: https://github.com/needle-tools/modern-monaco, branch `feature/needle-editor`.
The package has not been published. The editor repository tracks consumer
verification and publication requirements in `plans/engine-as-extension.md`.
