import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { queryApiSymbols } from '../src/lsp/typescript/apiSymbols.js';

function query(symbol, limit = 20) {
    const files = {
        '/query.ts': 'import * as api from "./api";',
        '/api.ts': `export { Base as Camera } from './base';
            /** Creates lighting. @deprecated Use a pipeline. */
            export function light(value: number): number;
            export function light(value: string): string;
            export function light(value: number | string) { return value; }
            export interface Options { intensity: number; }
            export type Context = { options: Options };`,
        '/base.ts': `class Parent {
            /** Advance time. */
            update(delta: number): void {}
        }
            /** A test camera. */ export class Base extends Parent { fov = 50; }`,
    };
    const service = ts.createLanguageService({
        getCompilationSettings: () => ({ strict: true, noLib: true, moduleResolution: ts.ModuleResolutionKind.Node10 }),
        getScriptFileNames: () => Object.keys(files), getScriptVersion: () => '1',
        getScriptSnapshot: name => files[name] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[name]),
        getCurrentDirectory: () => '/', getDefaultLibFileName: () => '/lib.d.ts',
        fileExists: name => name in files, readFile: name => files[name],
    });
    try { return queryApiSymbols(ts, service, '/query.ts', { symbol, limit }); }
    finally { service.dispose(); }
}

test('lists real module exports with bounded results', () => {
    const result = query(undefined, 2);
    assert.equal(result.status, 'resolved');
    assert.equal(result.total, 4);
    assert.equal(result.truncated, true);
    assert.equal(result.exports.length, 2);
});

test('follows reexports and inherited instance members to their declarations', () => {
    const camera = query('Camera');
    assert.match(camera.documentation, /test camera/);
    assert.deepEqual(camera.members.map(value => value.name).sort(), ['fov', 'update']);
    const member = query('Camera.update');
    assert.match(member.signatures[0], /delta: number/);
    assert.equal(member.documentation, 'Advance time.');
    assert.equal(member.definitions[0].uri, '/base.ts');
    assert.ok(member.definitions[0].line > 0);
});

test('reports all overloads and JSDoc tags rather than inventing signatures', () => {
    const result = query('light');
    assert.equal(result.signatures.length, 2);
    assert.match(result.signatures[0], /value: number/);
    assert.match(result.signatures[1], /value: string/);
    assert.equal(result.documentation, 'Creates lighting.');
    assert.equal(result.tags[0].name, 'deprecated');
});

test('resolves type-only APIs and reports unknown symbols explicitly', () => {
    assert.match(query('Options.intensity').type, /number/);
    assert.equal(query('ssgi').status, 'not-found');
    assert.equal(query('Camera.missing').status, 'not-found');
});

test('follows type aliases when looking up context members', () => {
    assert.notEqual(query('Options').type, 'any');
    assert.notEqual(query('Context').type, 'any');
    assert.match(query('Context.options.intensity').type, /number/);
});
