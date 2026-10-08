import fs from "node:fs/promises";
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, basename, resolve } from 'node:path';
import esbuild from "esbuild";
import { grammars as shikiGrammars, injections } from 'tm-grammars';
import { themes as shikiThemes } from 'tm-themes';
import { wasmBinary } from '@shikijs/engine-oniguruma/wasm-inlined';
const require = createRequire(import.meta.url);
const bundleTypescriptLibs = async () => {
    const libRoot = dirname(require.resolve('typescript'));
    const dtsFiles = (await fs.readdir(libRoot)).filter(name => /^lib\..*\.d\.ts$/.test(name)).map(name => resolve(libRoot, name));
    dtsFiles.sort();
    const libs = Object.fromEntries(await Promise.all(dtsFiles.map(async (path) => [basename(path), await fs.readFile(path, 'utf8')])));
    await fs.writeFile("dist/lsp/typescript/libs.mjs", "export default " + JSON.stringify(libs, undefined, 2));
};
const modifyEditorCore = async () => {
    const js = await fs.readFile("dist/editor-core.mjs", 'utf8');
    const ret = await esbuild.build({
        entryPoints: ["dist/editor-core.css"],
        minify: true,
        write: false,
    });
    const css = ret.outputFiles[0].text;
    const addonCss = `.monaco-inputbox input{outline:1px solid var(--vscode-focusBorder)} .rename-box input{color:inherit;font-family:inherit;font-size:100%;}.monaco-editor .rename-box .rename-input-with-button{width:auto}`;
    await fs.writeFile("dist/editor-core.mjs", js + "\nexport const cssBundle = " + JSON.stringify(css + addonCss));
};
const copyDts = (...files) => {
    return Promise.all(files.map(([src, dest]) => fs.copyFile(require.resolve(src), `types/${dest}`)));
};
const tmDefine = () => {
    const keys = ["name", "scopeName", "aliases", "embedded", "embeddedIn", "injectTo"];
    // add aliases for javascript and typescript
    shikiGrammars.find((g) => g.name === "javascript").aliases = ["js", "mjs", "cjs"];
    shikiGrammars.find((g) => g.name === "typescript").aliases = ["ts", "mts", "cts"];
    // update embedded grammars
    shikiGrammars.find((g) => g.name === "html").embedded = ["json", "css", "javascript"];
    for (const id of ["javascript", "typescript", "jsx", "tsx"]) {
        shikiGrammars.find((v) => v.name === id).embedded = ["html", "css"];
    }
    const grammars = shikiGrammars.map((v) => Object.fromEntries(keys.map((k) => [k, v[k]])));
    const injections_grammars = injections.map((v) => Object.fromEntries(keys.map((k) => [k, v[k]])));
    return {
        tmGrammarsVersion: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.resolve('tm-grammars')), 'utf8')).version),
        tmThemesVersion: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.resolve('tm-themes')), 'utf8')).version),
        SHIKI_THEMES: JSON.stringify(shikiThemes.map((v) => v.name)),
        SHIKI_GRAMMARS: JSON.stringify([...grammars, ...injections_grammars]),
    };
};
const buildEditorCore = async () => {
    await runBuild([
        "src/editor-core.ts",
        "src/editor-worker.ts",
        "src/editor-worker-main.ts",
    ]);
    await modifyEditorCore();
    await Promise.all(['dist/editor-core.css', 'dist/editor-core.css.map'].map(path => fs.rm(path, { force: true })));
};
const buildDist = async () => {
    await runBuild([
        "src/cache.ts",
        "src/index.ts",
        "src/core.ts",
        "src/shiki-wasm.ts",
        "src/util.ts",
        "src/workspace.ts",
        "src/ssr/index.ts",
        "src/ssr/workerd.ts",
        "src/lsp/index.ts",
        "src/lsp/css/setup.ts",
        "src/lsp/css/worker.ts",
        "src/lsp/html/setup.ts",
        "src/lsp/html/worker.ts",
        "src/lsp/json/setup.ts",
        "src/lsp/json/worker.ts",
        "src/lsp/client.ts",
        "src/lsp/typescript/setup.ts",
        "src/lsp/typescript/worker.ts",
    ]);
    await runBuild(["src/shiki.ts"], tmDefine());
};
const buildTypes = async () => {
    await copyDts(["monaco-editor-core/esm/vs/editor/editor.api.d.ts", "monaco.d.ts"], ["vscode-json-languageservice/lib/esm/jsonSchema.d.ts", "jsonSchema.d.ts"]);
    await fs.writeFile("types/textmate.d.ts", [
        "export type TextmateThemeName = " + shikiThemes.map((v) => JSON.stringify(v.name)).join(" | ") + ";",
        "export type TextmateGrammarName = " + shikiGrammars.map((v) => JSON.stringify(v.name)).join(" | ") + ";",
    ].join("\n"));
};
const runBuild = (entryPoints, define) => {
    return esbuild.build({
        target: "es2022",
        format: "esm",
        platform: "browser",
        outdir: "dist",
        bundle: true,
        treeShaking: true,
        logLevel: "info",
        define,
        loader: {
            ".ttf": "dataurl",
        },
        outExtension: {
            ".js": ".mjs",
        },
        plugins: [
            {
                name: "external",
                setup(build) {
                    build.onResolve({ filter: /.*/ }, (args) => {
                        if (args.path === "typescript" || args.path.endsWith(".wasm")) {
                            return {
                                path: args.path,
                                external: true,
                            };
                        }
                        if (args.path.endsWith(".js") && args.path.startsWith(".")
                            && args.resolveDir.startsWith(fileURLToPath(new URL('../src', import.meta.url)))) {
                            return {
                                path: args.path.replace(".js", ".mjs"),
                                external: true,
                            };
                        }
                        return {};
                    });
                },
            },
        ],
        entryPoints,
    });
};
const debounce = (fn, ms) => {
    let timer = null;
    return () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn();
        }, ms);
    };
};
export async function build(dev) {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    if (resolve(process.cwd()) !== resolve(packageRoot))
        throw new Error('Run the build from the modern-monaco package directory');
    await import('./patch.mjs');
    await fs.rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
    await buildEditorCore();
    await buildDist();
    await buildTypes();
    await bundleTypescriptLibs();
    await fs.writeFile("dist/onig.wasm", wasmBinary);
    dev && watch();
}
export async function watch() {
    const queueBuildDist = debounce(() => buildDist().catch(err => console.error(err)), 500);
    const queueBuildEditorCore = debounce(() => buildEditorCore().catch(err => console.error(err)), 500);
    const watcher = fs.watch("src", { recursive: true });
    console.log("Watching for file changes...");
    for await (const { filename } of watcher) {
        if (filename === null)
            continue;
        if (filename.endsWith("/src/editor-core.ts") || filename.endsWith("/src/editor-worker.ts")) {
            queueBuildEditorCore();
        }
        else {
            queueBuildDist();
        }
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await build(process.argv.includes("--watch"));
}
