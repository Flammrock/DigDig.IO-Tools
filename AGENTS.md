# Instructions for agents

These instructions apply to the entire repository, including analysis tools, userscripts, and the future desktop app.

## Critical constraint: never modify the game's WASM

The project owner reports that modifying WASM instructions can trigger an immediate game ban. Preserving the original game WASM is a mandatory project requirement.

- Never patch, rewrite, instrument, optimize, reassemble, or replace the game's WASM binary or instructions. This also applies to copies used during development: do not build a modified game module.
- Keep original game `.wasm` files and downloaded response bytes unchanged. Never substitute modified bytes or a reconstructed module in `WebAssembly.compile`, `compileStreaming`, `instantiate`, `instantiateStreaming`, or `new WebAssembly.Instance`.
- Do not alter the module's code, sections, imports, exports, or function tables to inject behavior.
- JavaScript observation hooks may capture the original module, instance, and memory. They must forward the original arguments and preserve the original results and errors without replacing the game's imports or executable functions.
- Instruction signatures and pattern matching are for **reading instructions and resolving memory addresses only**. A successful signature match must never become an instruction patch.

## Permitted analysis and memory access

- Read-only inspection, hashing, disassembly to WAT, decoded-instruction matching, and diagnostic reports are allowed. Store derived output separately from the original game files.
- Reads and writes to data locations in the live game's **`WebAssembly.Memory` linear memory** are permitted within the requested task. Keep diagnostics read-only unless the task calls for a data write.
- A byte buffer holding a `.wasm` binary is **not** runtime linear memory. Permission to write memory data never authorizes modifying that byte buffer or instructions.
- Resolve and validate memory locations for the actual game build; historical addresses are reference evidence, not automatically valid offsets.
- Independently authored synthetic WASM fixtures may be compiled for tests. They must remain separate from the game's modules and must never replace the game module.

## Live report housekeeping

- Manage `reports/live/` autonomously as part of ongoing work. The project owner authorizes cleaning up redundant reports and renaming interesting reports without asking for confirmation each time.
- Read reports before deciding what to keep. Preserve useful milestones, distinct failures, new game build fingerprints, and evidence needed for unresolved investigations. Keep the latest useful game capture and fixture results; remove duplicates and superseded intermediate reports when they add no useful evidence.
- Give retained reports descriptive filenames that include their original UTC timestamp and the finding or milestone. Preserve the report contents, including timestamps, client IDs, hashes, and diagnostic evidence.
- Leave newly arriving, incomplete, or actively written reports alone. Limit cleanup to inspected files inside `reports/live/`; this authorization does not cover reference reports elsewhere, original game snapshots, or `.old/`.
- Briefly summarize meaningful cleanup and the evidence retained when reporting back to the user.

## Repository context

- `.old/` preserves the original project as a reference; keep it unchanged.
- Use npm and Nx for the new workspace. The future desktop application uses Tauri.
- When changing capture or analysis code, check that original game bytes and execution arguments remain unchanged, and run the relevant existing tests.
