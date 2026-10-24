export const RESOLVER_VERSION: 'wasm-patterns-1';
export const MAX_WASM_BYTES: number;
export interface LayoutRecipe {
  memoryExport: string;
  mapX: number; mapY: number; mapRadius: number;
  cameraPointer?: number;
  cameraOffset: number;
  cameraVtable?: number;
  cameraX: number; cameraY: number; cameraScale: number;
  viewWidth: number; viewHeight: number;
  scaleMode: 'divide-f32' | 'legacy-reciprocal';
  terrain: {
    sourceWidth: number; sourceHeight: number;
    worldGridSpacing: number; worldDrawSize: number; worldDrawInset: number;
    paletteProfile: string;
  };
}
export type ResolutionResult =
  | { status: 'candidate'; layout: LayoutRecipe; evidence: Record<string, unknown> }
  | { status: 'unsupported'; message: string; evidence: Record<string, unknown> };
/** Decode and inspect only; the supplied game module is never instantiated or rewritten. */
export function resolveWasm(bytes: Uint8Array): Promise<ResolutionResult>;
