import { invoke, isTauri } from '@tauri-apps/api/core';

interface LayoutJob { id: string; wasmSha256: string; wasmBase64: string }

/** Analyze at most one module in a disposable worker, outside the render loop. */
export function startLayoutAnalysis() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let worker: Worker | undefined;
  let cancel: (() => void) | undefined;
  let reportedFailure = false;

  function analyze(job: LayoutJob): Promise<unknown> {
    return new Promise(resolve => {
      let active: Worker;
      try {
        active = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
      } catch {
        resolve({ status: 'unsupported', message: 'The bundled game-build analyzer could not start.', evidence: {} });
        return;
      }
      worker = active;
      let finished = false;
      const timeout = setTimeout(() => finish({ status: 'unsupported', message: 'Game build analysis exceeded its time limit.', evidence: {} }), 30_000);
      function finish(result: unknown) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        active.terminate();
        if (worker === active) worker = undefined;
        cancel = undefined;
        resolve(result);
      }
      cancel = () => finish({ status: 'unsupported', message: 'Game build analysis was interrupted.', evidence: {} });
      active.onmessage = event => finish(event.data);
      active.onerror = event => {
        event.preventDefault();
        finish({ status: 'unsupported', message: 'The bundled game-build analyzer could not start.', evidence: {} });
      };
      active.onmessageerror = () => finish({ status: 'unsupported', message: 'The game-build analyzer returned an unreadable result.', evidence: {} });
      active.postMessage({ wasmBase64: job.wasmBase64 });
    });
  }

  async function tick() {
    if (stopped) return;
    try {
      const job = await invoke<LayoutJob | null>('take_layout_job');
      if (job && !stopped) {
        const result = await analyze(job);
        if (!stopped) await invoke('finish_layout_job', { jobId: job.id, result });
      }
      reportedFailure = false;
    } catch (error) {
      if (!stopped && !reportedFailure) console.warn('[DigDig layout analysis]', error);
      reportedFailure = true;
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), 1000);
    }
  }
  if (isTauri()) void tick();
  return { dispose() { stopped = true; clearTimeout(timer); cancel?.(); worker?.terminate(); } };
}
