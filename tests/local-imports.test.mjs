import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const bundled = build({
    entryPoints: [fileURLToPath(new URL('../src/lsp/typescript/worker.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['typescript'],
    plugins: [{ name: 'worker-host', setup(builder) {
        builder.onResolve({ filter: /(?:editor-worker|libs)\.js$/ }, args => ({ path: args.path, namespace: 'worker-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'worker-host' }, args => ({
            contents: args.path.endsWith('libs.js') ? 'export default {}' : 'export function initializeWorker() {}',
        }));
    } }],
}).then(result => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports.TypeScriptWorker;
});

const mirror = (uri, source = 'export const value = 1;') => ({
    uri: { toString: () => uri }, _versionId: 1, get version() { return this._versionId; }, getValue: () => source,
});
const options = { allowJs: true, noLib: true, strict: true, module: 'esnext', moduleResolution: 'bundler' };

test('local imports use TypeScript extension substitution and source precedence', async () => {
    const Worker = await bundled;
    for (const [specifier, sources, expected] of [
        ['./progressive.js', ['progressive.ts'], 'progressive.ts'],
        ['./progressive.js', ['progressive.js', 'progressive.ts'], 'progressive.ts'],
        ['./progressive.mjs', ['progressive.mts'], 'progressive.mts'],
        ['./progressive.cjs', ['progressive.cts'], 'progressive.cts'],
        ['./progressive', ['progressive.ts'], 'progressive.ts'],
        ['./loaders', ['loaders/index.ts'], 'loaders/index.ts'],
        ['./actual.js', ['actual.js'], 'actual.js'],
    ]) {
        const models = sources.map(path => mirror('file:///project/' + path));
        const worker = new Worker({ getMirrorModels: () => models, host: {} }, {
            compilerOptions: options, types: {}, importMap: { $baseURL: 'file:///', imports: {}, scopes: {} },
        });
        const result = worker.resolveModuleNameLiterals([ts.factory.createStringLiteral(specifier)],
            'file:///project/bootstrap.ts', undefined, {}, undefined, undefined);
        assert.equal(result[0].resolvedModule?.resolvedFileName, 'file:///project/' + expected, specifier);
    }
});

test('a .js import opens the unopened TypeScript workspace file and retains type checking', async () => {
    const Worker = await bundled;
    const uri = 'file:///project/bootstrap.ts';
    const models = [mirror(uri, 'import { value } from "./progressive.js"; export const result: number = value;')];
    const opened = [];
    const worker = new Worker({ getMirrorModels: () => models, host: {
        openModel: async path => {
            opened.push(path);
            if (path !== 'file:///project/progressive.ts') return false;
            models.push(mirror(path, 'export const value = "wrong type";'));
            return true;
        },
        refreshDiagnostics: async () => {},
    } }, { fs: ['/project/bootstrap.ts', '/project/progressive.ts'], compilerOptions: options, types: {},
        importMap: { $baseURL: 'file:///', imports: {}, scopes: {} } });
    await worker.doValidation(uri);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(opened, ['file:///project/progressive.ts']);
    assert.deepEqual((await worker.doValidation(uri)).map(d => d.code), [2322]);
});

test('local import-map targets honor compiler moduleSuffixes', async () => {
    const Worker = await bundled;
    const worker = new Worker({ getMirrorModels: () => [
        mirror('file:///project/progressive.ts'), mirror('file:///project/progressive.browser.ts'),
    ], host: {} }, {
        compilerOptions: { ...options, moduleSuffixes: ['.browser', ''] }, types: {},
        importMap: { $baseURL: 'file:///', imports: { 'project/': 'file:///project/' }, scopes: {} },
    });
    const result = worker.resolveModuleNameLiterals([ts.factory.createStringLiteral('project/progressive.js')],
        'file:///project/bootstrap.ts', undefined, {}, undefined, undefined);
    assert.equal(result[0].resolvedModule?.resolvedFileName, 'file:///project/progressive.browser.ts');
});

test('a missing local import still reports a module resolution error', async () => {
    const Worker = await bundled;
    const uri = 'file:///project/bootstrap.ts';
    const models = [mirror(uri, 'import { value } from "./missing.js"; export { value };')];
    const worker = new Worker({ getMirrorModels: () => models,
        host: { openModel: async () => false, refreshDiagnostics: async () => {} },
    }, { fs: ['/project/bootstrap.ts'], compilerOptions: options, types: {},
        importMap: { $baseURL: 'file:///', imports: {}, scopes: {} } });
    await worker.doValidation(uri);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await worker.doValidation(uri)).map(d => d.code), [2307]);
});

test('workspace create/remove notifications use the same file URLs as the initial file list', async () => {
    const Worker = await bundled;
    const worker = new Worker({ getMirrorModels: () => [], host: {} }, {
        fs: [], compilerOptions: options, types: {}, importMap: { $baseURL: 'file:///', imports: {}, scopes: {} },
    });
    await worker.fsNotify('create', '/project/progressive.ts', 1);
    assert.deepEqual(worker.readDir('file:///project/'), [['progressive.ts', 1]]);
    await worker.fsNotify('remove', '/project/progressive.ts', 1);
    assert.deepEqual(worker.readDir('file:///project/'), []);
});
