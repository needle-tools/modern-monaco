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

`queryNeedleApiSymbols` queries that same language-service program for module
exports, dotted members, overloads, JSDoc and definition locations. Each transient
query has its own import-map scope; configuration refreshes retain active query
scopes, which are removed after completion. The editor supplies project-selected
declarations rather than a separate AI type resolver. Maintained tests cover
aliases, inherited members, type-only contexts and asynchronous declaration loads.

`validateNeedleProject` drains asynchronous declaration imports without a fixed
layer count. Its default 60-second loading deadline reports unresolved request
URLs and releases the validation scope/queue on failure. Settled-promise loops
also check elapsed time, so microtasks cannot bypass the deadline. Fetches already
in flight remain shared cache work; validation does not continue in the background
after its deadline. The optional third argument can shorten the deadline for
internal callers/tests. API queries retain their separate resolution policy.

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
