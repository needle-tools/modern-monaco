import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import ts from 'typescript';
import { resolveNeedlePropertyTypeInfo } from '../src/lsp/typescript/propertyTypeInfo.js';

test('property queries retain presentation annotations on nested array members', () => {
    const source = `class Marker {
        /**
         * Physical width.
         * @range 0.1 1
         * @unit m
         */
        widthInMeters!: number;
    }
    class Tracking { trackedImages!: Marker[]; }`;
    const file = '/tracking.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const query = name => resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf(name + '!'), {propertyName: name});
    const presentation = ({min, max, unit}) => ({min, max, unit});
    const expected = {min: 0.1, max: 1, unit: 'm'};
    assert.deepEqual(presentation(query('trackedImages').container.elementMembers.find(member => member.name === 'widthInMeters')), expected);
    assert.deepEqual(presentation(query('widthInMeters')), expected);
});

test('optional event arguments expose all fields of an intersection type', () => {
    const source = `type FitCameraOptions = { padding?: number };
        type OrbitFitCameraOptions = FitCameraOptions & { immediate?: boolean };
        declare const options: OrbitFitCameraOptions | undefined;`;
    const file = '/fit-camera.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const info = resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf('options:'), {propertyName: 'options'});
    assert.deepEqual(info.objectMembers?.map(member => member.name), ['padding', 'immediate']);
});

test('collection element unions and readonly membership survive type queries', () => {
    const source = 'class Settings { entries!: Map<string, {kind: "a"; amount: number} | {kind: "b"; text: string}>; locked!: ReadonlySet<string>; list!: readonly number[]; lockedRules!: Readonly<Record<string, number>>; flag!: boolean; mixedFlag!: boolean | boolean[]; }';
    const file = '/collections.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const query = name => resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf(name + '!'), {propertyName: name});
    assert.equal(query('entries').container.valueOptions.length, 2);
    assert.equal(query('locked').container.readonly, true);
    assert.equal(query('list').container.kind, 'array');
    assert.equal(query('list').container.readonly, true);
    assert.equal(query('lockedRules').container.readonly, true);
    assert.equal(query('flag').unionOptions, undefined);
    assert.deepEqual(query('mixedFlag').unionOptions.map(branch => branch.type).sort(), ['boolean', 'boolean[]']);
});

test('mixed and discriminated unions preserve every branch rather than a partial enum', () => {
    const source = `type Choice = {kind: "amount"; value: number} | {kind: "text"; value: string};
        class Settings { choice!: Choice | null; mixed!: number | "auto"; }`;
    const file = '/union.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const query = name => resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf(name + '!'), {propertyName: name});
    const choice = query('choice');
    assert.equal(choice.unionOptions.length, 3);
    assert.equal(choice.unionOptions.some(branch => branch.type === 'null'), true);
    assert.deepEqual(choice.unionOptions.filter(branch => branch.type !== 'null').map(branch => branch.objectMembers.find(field => field.name === 'value').type).sort(), ['number', 'string']);
    assert.deepEqual(query('mixed').unionOptions.map(branch => branch.type).sort(), ['"auto"', 'number']);
    assert.equal(query('mixed').enumOptions, undefined);
});

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


test('nested property queries retain enums, containers and constructible unions', () => {
    const source = `
        export class Red { strength = 1; }
        export class Blue { enabled = true; }
        export interface Entry {
            /** Render mode. */
            readonly mode?: "solid" | "wire";
        }
        export class Settings {
            nested!: { entries: Entry[]; choice: Red | Blue | null; missing?: Entry; };
        }
    `;
    const file = '/settings.ts';
    const options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    host.readFile = name => name === file ? source : readFile(name);
    const program = ts.createProgram([file], options, host);
    const result = resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file,
        source.indexOf('nested!'), {propertyName: 'nested'});
    const entries = result.objectMembers.find(member => member.name === 'entries');
    const mode = entries.container.elementMembers.find(member => member.name === 'mode');
    assert.equal(mode.description, 'Render mode.');
    assert.equal(mode.readonly, true);
    assert.equal(mode.optional, true);
    assert.deepEqual(mode.enumOptions.map(option => option.value).sort(), ['solid', 'wire']);
    const choice = result.objectMembers.find(member => member.name === 'choice');
    assert.deepEqual(choice.constructorOptions.map(option => option.typeName).sort(), ['Blue', 'Red']);
    assert.equal(Object.hasOwn(choice, 'constructor') && choice.constructor !== undefined, false);
    assert.match(choice.type, /null/);
});


test('quoted property queries retain the original field type, docs and readonly flag', () => {
    const source = `interface Owner {
        /** Quoted mode. */
        readonly "mode-with-dash"?: "solid" | "wire";
    }
    declare const owner: Owner;
    owner["mode-with-dash"];`;
    const file = '/quoted.ts';
    const service = ts.createLanguageService({
        getCompilationSettings: () => ({strict: true, noLib: true}),
        getScriptFileNames: () => [file], getScriptVersion: () => '1',
        getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined,
        getCurrentDirectory: () => '/', getDefaultLibFileName: () => '/lib.d.ts',
        fileExists: name => name === file, readFile: name => name === file ? source : undefined,
    });
    try {
        const info = resolveNeedlePropertyTypeInfo(ts, service, file, source.lastIndexOf('mode-with-dash') + 1,
            {propertyName: 'mode-with-dash', typeName: 'Owner'});
        assert.equal(info?.readonly, true);
        assert.equal(info.optional, true);
        assert.equal(info.description, 'Quoted mode.');
        assert.deepEqual(info.enumOptions.map(option => option.value).sort(), ['solid', 'wire']);
    } finally {service.dispose();}
});


test('nullish union branches survive aliases, nested fields and collection entries', () => {
    const source = 'type Maybe = {amount: number} | null | undefined; class Settings { value!: Maybe; values!: Maybe[]; nested!: {value: Maybe}; }';
    const file = '/nullable-alias.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const query = name => resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf(name + '!'), {propertyName: name});
    const nullish = options => options.filter(branch => ['null', 'undefined'].includes(branch.type)).map(branch => branch.type).sort();
    assert.deepEqual(nullish(query('value').unionOptions), ['null', 'undefined']);
    assert.deepEqual(nullish(query('values').container.elementOptions), ['null', 'undefined']);
    assert.deepEqual(nullish(query('nested').objectMembers.find(member => member.name === 'value').unionOptions), ['null', 'undefined']);
});


test('URL format hints survive direct and nested property type queries', () => {
    const source = `class Link {
/** @format url */
endpoint = 'https://example.com'; }
        class Example {
/** @format url */
website = 'https://example.com'; links!: Link[]; }`;
    const file = '/url-hints.ts', options = {strict: true, target: ts.ScriptTarget.ES2022};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
    host.readFile = name => name === file ? source : read(name);
    const program = ts.createProgram([file], options, host);
    const query = name => resolveNeedlePropertyTypeInfo(ts, {getProgram: () => program}, file, source.indexOf(name), {propertyName: name});
    assert.equal(query('website').stringFormat, 'url');
    assert.equal(query('links').container.elementMembers.find(member => member.name === 'endpoint').stringFormat, 'url');
});

test('property metadata queries share one alias index per TypeScript program', () => {
    const file = '/flags.ts';
    const source = 'type Callback = (string & { tag: 1 }) | (string & { tag: 2 }); export class Flags { first!: Callback; second!: Callback; }';
    for (let revision = 0; revision < 2; revision++) {
        const options = {strict:true, noLib:true};
        const host = ts.createCompilerHost(options);
        host.readFile = name => name === file ? source : undefined;
        const program = ts.createProgram([file], options, host);
        program.getTypeChecker();
        const getFiles = program.getSourceFiles.bind(program);
        let scans = 0;
        program.getSourceFiles = () => { scans++; return getFiles(); };
        for (const name of ['first', 'second', 'first']) {
            const result = resolveNeedlePropertyTypeInfo(ts, {getProgram:() => program}, file, source.indexOf(name), {propertyName:name});
            assert.equal(result.type, 'Callback');
        }
        assert.equal(scans, 1);
    }
});
