import { MAX_WASM_BYTES, resolveWasm } from '@digdig/layout-resolver';

// This worker decodes an unchanged copy. It never instantiates the game module.
// WABT itself is an independently built analysis tool bundled with the app.
self.onmessage = async (event: MessageEvent<{ wasmBase64: string }>) => {
  try {
    const encoded = event.data.wasmBase64;
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_WASM_BYTES / 3) * 4) {
      throw new Error('The game module exceeds the analysis limit.');
    }
    const binary = atob(encoded);
    if (!binary.length || binary.length > MAX_WASM_BYTES) throw new Error('Invalid game module size.');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    self.postMessage(await resolveWasm(bytes));
  } catch (error) {
    self.postMessage({ status: 'unsupported', message: `Module analysis failed: ${String(error).slice(0, 500)}`, evidence: {} });
  }
};
