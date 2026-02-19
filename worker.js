/* ═══════════════════════════════════════════
   worker.js — OpenSCAD WASM Web Worker
   Loads openscad-wasm, compiles .scad → STL
   Creates a fresh WASM instance per compilation
   Uses -D flags for parameter overrides
   ═══════════════════════════════════════════ */

const OPENSCAD_CDN = 'https://cdn.jsdelivr.net/npm/openscad-wasm@0.0.4/openscad.js';

let createOpenSCAD = null;

/**
 * Post a log message back to main thread.
 */
function log(text, level = 'info') {
    self.postMessage({ type: 'log', text, level });
}

/**
 * Load the createOpenSCAD factory (cached, loaded only once).
 */
async function loadFactory() {
    if (createOpenSCAD) return createOpenSCAD;

    log('Carregando OpenSCAD WASM (~7 MB)…');
    try {
        const module = await import(OPENSCAD_CDN);
        createOpenSCAD = module.createOpenSCAD;
        log('OpenSCAD WASM carregado com sucesso.', 'success');
        return createOpenSCAD;
    } catch (err) {
        log(`Erro ao carregar OpenSCAD WASM: ${err.message}`, 'error');
        throw err;
    }
}

/**
 * Build -D argument strings for parameter overrides.
 * OpenSCAD -D flag: openscad -D 'name=value' ...
 */
function buildDFlags(params) {
    const args = [];
    for (const p of params) {
        let expr;
        if (p.type === 'string') {
            expr = `${p.name}="${p.value}"`;
        } else if (p.type === 'bool') {
            expr = `${p.name}=${p.value ? 'true' : 'false'}`;
        } else {
            expr = `${p.name}=${p.value}`;
        }
        args.push('-D', expr);
    }
    return args;
}

/**
 * Compile a .scad source string into STL binary data.
 * Creates a FRESH instance each time.
 * Uses -D flags to override parameters.
 */
async function compile(scadSource, params) {
    const factory = await loadFactory();

    log('Inicializando instância OpenSCAD…');

    // Create a fresh instance for each compilation
    const scad = await factory({
        print: (text) => log(text),
        printErr: (text) => log(text, 'error'),
    });

    const instance = scad.getInstance();

    // Write the SCAD source to the virtual filesystem.
    instance.FS.writeFile('/input.scad', scadSource);

    // Build command-line arguments
    const mainArgs = ['/input.scad', '-o', '/output.stl'];

    // Add -D flags for parameter overrides
    if (params && params.length > 0) {
        const dFlags = buildDFlags(params);
        mainArgs.push(...dFlags);
        log(`Overrides: ${dFlags.filter((_, i) => i % 2 === 1).join(', ')}`);
    }

    log('Compilando…');

    // Run OpenSCAD
    let exitCode;
    try {
        exitCode = instance.callMain(mainArgs);
    } catch (callErr) {
        // Emscripten throws ExitStatus for non-zero exit codes.
        if (callErr && callErr.status !== undefined) {
            exitCode = callErr.status;
        } else {
            throw callErr;
        }
    }

    // Read the generated STL from the virtual filesystem.
    let stlData;
    try {
        stlData = instance.FS.readFile('/output.stl');
    } catch (e) {
        throw new Error('Arquivo STL de saída não foi gerado. Verifique seu código .scad.');
    }

    log(`Compilação concluída — STL: ${(stlData.byteLength / 1024).toFixed(1)} KB`, 'success');
    return stlData;
}

/* ── Message handler ── */
self.addEventListener('message', async (e) => {
    const { type, scadSource, params } = e.data;

    if (type === 'compile') {
        try {
            const stlData = await compile(scadSource, params || []);
            // Transfer the underlying buffer for zero-copy.
            const buffer = stlData.buffer.slice(
                stlData.byteOffset,
                stlData.byteOffset + stlData.byteLength,
            );
            self.postMessage({ type: 'result', stl: buffer }, [buffer]);
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
});
