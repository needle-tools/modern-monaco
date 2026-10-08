import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// [patch-1] replace the default command history storage (which is in-memory) of Monaco Editor with a browser localStorage-based one
const commandHistoryStorageJs = `{
  get: (key, _scope, defaultValue) => localStorage.getItem('monaco:' + key) ?? defaultValue,
  getNumber: (key, _scope, defaultValue) => Number(localStorage.getItem('monaco:' + key) ?? defaultValue) || defaultValue,
  store: (key, value) => localStorage.setItem('monaco:' + key, String(value)),
  onWillSaveState: (callback) => {
    window.addEventListener('beforeunload', () => {
      callback({ reason: WillSaveStateReason.SHUTDOWN });
    });
  },
};
`;
{
    const path = require.resolve("monaco-editor-core/esm/vs/platform/quickinput/browser/commandsQuickAccess.js");
    const js = await readFile(path, 'utf8');
    const arr = js.split("this.storageService = storageService;");
    if (arr.length === 2) {
        await writeFile(path, arr[0] + "// Added by modern-monaco\nthis.storageService = " + commandHistoryStorageJs + arr[1]);
        console.log("[patch-1]", path.slice("node_modules/".length));
    }
}
// [patch-2] add keybindings for the quick pick navigation on macOS
const registerQuickPickCommandAndKeybindingRulesJS = `
// Added by modern-monaco
if (isMacintosh) {
  registerQuickPickCommandAndKeybindingRule({ id: 'quickInput.Next', primary: 256 /* KeyMod.WinCtrl */ + 44 /* KeyCode.N */, handler: focusHandler(QuickPickFocus.Next) });
  registerQuickPickCommandAndKeybindingRule({ id: 'quickInput.Previous', primary: 256 /* KeyMod.WinCtrl */ + 46 /* KeyCode.P */, handler: focusHandler(QuickPickFocus.Previous) });
}
`;
{
    const path = require.resolve("monaco-editor-core/esm/vs/platform/quickinput/browser/quickInputActions.js");
    const js = await readFile(path, 'utf8');
    if (!js.includes(registerQuickPickCommandAndKeybindingRulesJS)) {
        await writeFile(path, js + registerQuickPickCommandAndKeybindingRulesJS);
        console.log("[patch-2]", path.slice("node_modules/".length));
    }
}
// [patch-3] fix type definitions for createModel and getModel to accept `string | URL | Uri` type for the `uri` parameter
{
    const path = require.resolve("monaco-editor-core/esm/vs/editor/editor.api.d.ts");
    const diffs = [
        [
            "export function createModel(value: string, language?: string, uri?: Uri): ITextModel;",
            "export function createModel(value: string, language?: string, uri?: string | URL | Uri): ITextModel;",
        ],
        [
            "export function getModel(uri: Uri): ITextModel | null;",
            "export function getModel(uri: string | URL | Uri): ITextModel | null;",
        ],
    ];
    const addon = "\nexport * from './vscode';\n";
    let dts = await readFile(path, 'utf8');
    let patched = false;
    for (const [search, replace] of diffs) {
        if (!dts.includes(replace)) {
            dts = dts.replace(search, replace);
            patched = true;
        }
    }
    if (!dts.includes(addon)) {
        const pathOrgi = "types/vscode.d.ts";
        const pathDest = new URL("./vscode.d.ts", pathToFileURL(require.resolve("monaco-editor-core/esm/vs/editor/editor.api.d.ts")));
        await writeFile(pathDest, (await readFile(pathOrgi, 'utf8')).replace("./monaco.d.ts", "./editor.api.d.ts"));
        dts += addon;
        patched = true;
    }
    if (patched) {
        await writeFile(path, dts);
        console.log("[patch-3]", path.slice("node_modules/".length));
    }
}
// [patch-4] fix the issue of `maxDigitWidth` not being set correctly in SSR mode
{
    const path = require.resolve("monaco-editor-core/esm/vs/editor/common/config/editorOptions.js");
    const js = await readFile(path, 'utf8');
    const search = "maxDigitWidth: env.fontInfo.maxDigitWidth,";
    const replace = "maxDigitWidth: globalThis.__monaco_maxDigitWidth || env.fontInfo.maxDigitWidth,";
    if (!js.includes(replace)) {
        await writeFile(path, js.replace(search, replace));
        console.log("[patch-4]", path.slice("node_modules/".length));
    }
}
// [patch-5] fix folding icon size
{
    const path = require.resolve("monaco-editor-core/esm/vs/editor/contrib/folding/browser/folding.css");
    const css = await readFile(path, 'utf8');
    const search = "font-size: 140%;";
    const replace = "font-size: 100%;";
    if (css.includes(search)) {
        await writeFile(path, css.replace(search, replace));
        console.log("[patch-5]", path.slice("node_modules/".length));
    }
}
// [patch-6] fix clipboard IProductService silent error in standalone mode
{
    const path = require.resolve("monaco-editor-core/esm/vs/editor/contrib/clipboard/browser/clipboard.js");
    let js = await readFile(path, 'utf8');
    let patched = false;
    const teleBlock = `                    if (productService.quality !== 'stable') {
                        const duration = sw.elapsed();
                        telemetryService.publicLog2('editorAsyncPaste', { duration });
                    }`;
    const removals = [
        "import { StopWatch } from '../../../../base/common/stopwatch.js';",
        "import { IProductService } from '../../../../platform/product/common/productService.js';",
        "import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';",
        "const telemetryService = accessor.get(ITelemetryService);",
        "const productService = accessor.get(IProductService);",
        "const sw = StopWatch.create(true);",
        teleBlock,
    ];
    for (const search of removals) {
        if (js.includes(search)) {
            js = js.replace(search + "\n", "");
            patched = true;
        }
    }
    if (patched) {
        await writeFile(path, js);
        console.log("[patch-6]", path.slice("node_modules/".length));
    }
}
