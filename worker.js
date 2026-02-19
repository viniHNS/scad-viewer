/* ═══════════════════════════════════════════
   worker.js — OpenSCAD WASM Web Worker
   Loads openscad-wasm, compiles .scad → STL
   Creates a fresh WASM instance per compilation
   Supports BOSL2 library auto-loading from CDN
   ═══════════════════════════════════════════ */

const OPENSCAD_CDN = 'https://cdn.jsdelivr.net/npm/openscad-wasm@0.0.4/openscad.js';
const BOSL2_VERSION = 'master';
const BOSL2_CDN_BASE = `https://cdn.jsdelivr.net/gh/BelfrySCAD/BOSL2@${BOSL2_VERSION}/`;
const BOSL2_API = `https://data.jsdelivr.com/v1/packages/gh/BelfrySCAD/BOSL2@${BOSL2_VERSION}?structure=flat`;

let createOpenSCAD = null;
let bosl2Cache = null; // { files: Map<filename, content> }

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
 * Check if the source code uses BOSL2 library.
 */
function needsBOSL2(source) {
    return /(?:include|use)\s*<\s*BOSL2\//.test(source);
}

/**
 * Load BOSL2 library files from jsDelivr CDN (cached after first load).
 * Returns a Map of filename → content.
 */
async function loadBOSL2() {
    if (bosl2Cache) return bosl2Cache;

    log('Carregando biblioteca BOSL2…');

    // 1. Get file listing from jsDelivr API
    let fileList;
    try {
        const resp = await fetch(BOSL2_API);
        const data = await resp.json();
        fileList = data.files
            .map(f => f.name.startsWith('/') ? f.name.slice(1) : f.name)
            .filter(name => name.endsWith('.scad'));
    } catch (err) {
        log(`Erro ao listar arquivos BOSL2: ${err.message}`, 'error');
        throw err;
    }

    log(`BOSL2: ${fileList.length} arquivos encontrados. Baixando…`);

    // 2. Fetch all .scad files in parallel (in batches to avoid overwhelming)
    const BATCH_SIZE = 15;
    const files = new Map();
    let downloaded = 0;

    for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
        const batch = fileList.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(async (name) => {
                try {
                    const resp = await fetch(BOSL2_CDN_BASE + name);
                    if (!resp.ok) return null;
                    const text = await resp.text();
                    return { name, text };
                } catch {
                    return null;
                }
            })
        );

        for (const result of results) {
            if (result) {
                files.set(result.name, result.text);
                downloaded++;
            }
        }

        // Progress update every batch
        if (i + BATCH_SIZE < fileList.length) {
            log(`BOSL2: ${downloaded}/${fileList.length} arquivos baixados…`);
        }
    }

    log(`BOSL2 carregada: ${files.size} arquivos.`, 'success');
    bosl2Cache = files;
    return files;
}

/**
 * Write BOSL2 library files to the Emscripten virtual FS.
 */
function writeBOSL2ToFS(instance, bosl2Files) {
    // Write to /BOSL2/ at root — same dir as /input.scad
    // so include <BOSL2/std.scad> resolves directly
    try { instance.FS.mkdir('/BOSL2'); } catch (_) { }

    for (const [name, content] of bosl2Files) {
        // Handle subdirectories (if any)
        const parts = name.split('/');
        if (parts.length > 1) {
            let dir = '/BOSL2';
            for (let i = 0; i < parts.length - 1; i++) {
                dir += '/' + parts[i];
                try { instance.FS.mkdir(dir); } catch (_) { }
            }
        }
        instance.FS.writeFile('/BOSL2/' + name, content);
    }
}

/**
 * Build -D argument strings for parameter overrides.
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
 * Auto-loads BOSL2 if detected in source.
 */
async function compile(scadSource, params) {
    const factory = await loadFactory();

    // Check for BOSL2 and load if needed
    let bosl2Files = null;
    if (needsBOSL2(scadSource)) {
        bosl2Files = await loadBOSL2();
    }

    log('Inicializando instância OpenSCAD…');

    // Create a fresh instance for each compilation
    const scad = await factory({
        print: (text) => log(text),
        printErr: (text) => log(text, 'error'),
    });

    const instance = scad.getInstance();

    // Write BOSL2 to virtual FS if needed
    if (bosl2Files) {
        writeBOSL2ToFS(instance, bosl2Files);
    }

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
        if (callErr && callErr.status !== undefined) {
            exitCode = callErr.status;
        } else {
            throw callErr;
        }
    }

    // Read the generated STL
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
