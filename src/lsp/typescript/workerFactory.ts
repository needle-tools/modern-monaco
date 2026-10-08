/** A host can supply a bundled worker instead of the package-relative URL. */
export type TypeScriptWorkerFactory = () => Worker | null;

export function createTypeScriptWorker(workerUrl: URL, factory?: TypeScriptWorkerFactory): Worker {
  if (factory) {
    const worker = factory();
    if (!worker) throw new Error('TypeScript worker factory did not create a worker');
    return worker;
  }
  if (workerUrl.origin !== location.origin) {
    return new Worker(
      URL.createObjectURL(new Blob([`import ${JSON.stringify(workerUrl.href)}`], { type: 'application/javascript' })),
      { type: 'module', name: 'typescript-worker' },
    );
  }
  return new Worker(workerUrl, { type: 'module', name: 'typescript-worker' });
}
