import type * as monaco from './monaco.d.ts';
import type { Workspace } from './workspace.d.ts';
import type { FormatOptions } from './lsp.d.ts';

/** Supplies the host's bundled language worker; null fails startup explicitly. */
export type TypeScriptWorkerFactory = () => Worker | null;

export function setup(
    editor: typeof monaco,
    languageId: string,
    languageSettings?: Record<string, unknown>,
    formattingOptions?: FormatOptions,
    workspace?: Workspace,
    workerFactory?: TypeScriptWorkerFactory,
): Promise<void>;
