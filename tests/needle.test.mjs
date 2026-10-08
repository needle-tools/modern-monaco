import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import ts from 'typescript';
import { resolveNeedlePropertyTypeInfo } from '../src/lsp/typescript/propertyTypeInfo.js';

test('property queries retain readonly, optional, enum and documentation metadata', () => {
    const source = `export class Settings {
        /** Preferred mode. */
        readonly mode?: "solid" | "wire";
    }`;
    const file = '/settings.ts';
    const service = ts.createLanguageService({
        getCompilationSettings: () => ({ strict: true, noLib: true }),
        getScriptFileNames: () => [file], getScriptVersion: () => '1',
        getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined,
        getCurrentDirectory: () => '/', getDefaultLibFileName: () => '/lib.d.ts',
        fileExists: name => name === file, readFile: name => name === file ? source : undefined,
    });
    try {
        const result = resolveNeedlePropertyTypeInfo(ts, service, file, source.indexOf('mode?'), { propertyName: 'mode' });
        assert.equal(result.name, 'mode');
        assert.equal(result.ownerType, 'Settings');
        assert.equal(result.readonly, true);
        assert.equal(result.optional, true);
        assert.equal(result.description, 'Preferred mode.');
        assert.deepEqual(result.enumOptions.map(option => option.value).sort(), ['solid', 'wire']);
    } finally { service.dispose(); }
});

test('explicit worker creation does not fall back when the factory fails', async () => {
    const source = await readFile(new URL('../src/lsp/typescript/workerFactory.ts', import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'ts', format: 'esm' });
    const { createTypeScriptWorker } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const url = new URL('https://example.invalid/worker.js');
    const worker = {};
    assert.equal(createTypeScriptWorker(url, () => worker), worker);
    assert.throws(() => createTypeScriptWorker(url, () => null), /factory did not create a worker/);
    const failure = new Error('host worker failure');
    assert.throws(() => createTypeScriptWorker(url, () => { throw failure; }), error => error === failure);
});
