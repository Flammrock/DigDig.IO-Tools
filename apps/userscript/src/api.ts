import type { CaptureState } from './capture.ts';
import type { DrawObserver } from './canvas-observer.ts';

export interface DevelopmentApi {
  readonly capture: CaptureState;
  readonly page: Window & typeof globalThis;
  readonly clientId: string;
  readonly revision: string;
  observeDrawImage?(observer: DrawObserver): () => void;
  report(kind: string, report: unknown): Promise<void>;
  requestLayout?(route: '/layouts/resolve' | '/layouts/validate', body: unknown): Promise<unknown>;
  log(message: string): void;
}

export interface RuntimeController {
  report(): Promise<void>;
  dispose(): void;
}

export interface RuntimeModule {
  activate(api: DevelopmentApi): RuntimeController;
}
