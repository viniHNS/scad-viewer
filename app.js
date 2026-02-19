/* ═══════════════════════════════════════════
   app.js — Main Thread Orchestrator
   File upload · Parameter parser · Worker comms · Three.js viewer
   ═══════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

/* ─────────────── DOM refs ─────────────── */
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const fileInfoCard = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const btnCompile = document.getElementById('btn-compile');
const btnLabel = btnCompile.querySelector('.btn-label');
const btnSpinner = btnCompile.querySelector('.spinner');
const logOutput = document.getElementById('log-output');
const btnClearLog = document.getElementById('btn-clear-log');
const viewerCanvas = document.getElementById('viewer-canvas');
const viewerOverlay = document.getElementById('viewer-overlay');
const compileProgress = document.getElementById('compile-progress');
const btnResetCam = document.getElementById('btn-reset-cam');
const btnDownload = document.getElementById('btn-download');
const paramsEmpty = document.getElementById('params-empty');
const paramsList = document.getElementById('params-list');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

/* ─────────────── State ─────────────── */
let currentScadSource = null;   // original source from file
let currentParams = [];     // parsed parameters
let currentStlBuffer = null;
let isCompiling = false;
let worker = null;

/* ═══════════════ TABS ═══════════════ */

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

/* ═══════════════ LOGGING ═══════════════ */

function appendLog(text, level = 'info') {
    const span = document.createElement('span');
    span.className = `log-${level}`;
    span.textContent = text + '\n';
    logOutput.appendChild(span);
    logOutput.scrollTop = logOutput.scrollHeight;
}

btnClearLog.addEventListener('click', () => {
    logOutput.innerHTML = '';
});

/* ═══════════════ PARAMETER PARSER ═══════════════
 *
 * Parses OpenSCAD Customizer-style variables:
 *
 *   // [Section Header]
 *   height = 10;           // [1:100]        → slider  min:1 max:100
 *   width  = 20;           // [5:0.5:50]     → slider  min:5 step:0.5 max:50
 *   shape  = "round";      // [round, square] → dropdown
 *   show   = true;                            → checkbox toggle
 *   name   = "test";                          → text input
 *   count  = 5;                               → number input
 *   size   = 10;           // Description text → number with description
 *
 * ═══════════════════════════════════════════════ */

/**
 * Parse .scad source and extract customizer parameters.
 * Returns { params: [...], sections: [...] }
 */
function parseParameters(source) {
    const params = [];
    const lines = source.split('\n');

    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Section header: // [Section Name]
        const sectionMatch = line.match(/^\/\/\s*\[([^\]]+)\]\s*$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            continue;
        }

        // Stop parsing at the first module/function definition
        if (/^\s*(module|function)\s+/.test(line)) break;

        // Variable assignment: name = value; // optional comment
        const varMatch = line.match(
            /^(\w+)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/
        );
        if (!varMatch) continue;

        const name = varMatch[1];
        let rawValue = varMatch[2].trim();
        const comment = varMatch[3] ? varMatch[3].trim() : '';

        // Skip internal/special variables
        if (name.startsWith('$')) continue;

        // Determine value type and parse
        const param = {
            name,
            section: currentSection,
            line: i,
            rawLine: lines[i],
            comment,
            description: '',
            type: 'number',   // default
            value: null,
            options: null,     // for dropdowns
            min: null,
            max: null,
            step: null,
        };

        // Parse the value
        if (rawValue === 'true' || rawValue === 'false') {
            param.type = 'bool';
            param.value = rawValue === 'true';
        } else if (/^".*"$/.test(rawValue)) {
            param.type = 'string';
            param.value = rawValue.slice(1, -1);
        } else {
            const numVal = parseFloat(rawValue);
            if (!isNaN(numVal)) {
                param.type = 'number';
                param.value = numVal;
            } else {
                // Expression — skip, not user-editable
                continue;
            }
        }

        // Parse comment for constraints
        if (comment) {
            // Try [option1, option2, ...] — dropdown
            const dropdownMatch = comment.match(/^\[([^\]]+)\]$/);
            if (dropdownMatch) {
                const inner = dropdownMatch[1];
                // Check if it's a range (numbers with colons)
                const rangeMatch = inner.match(/^(-?[\d.]+)\s*:\s*(?:(-?[\d.]+)\s*:\s*)?(-?[\d.]+)$/);
                if (rangeMatch) {
                    // Range: [min:max] or [min:step:max]
                    param.min = parseFloat(rangeMatch[1]);
                    if (rangeMatch[2] !== undefined) {
                        param.step = parseFloat(rangeMatch[2]);
                        param.max = parseFloat(rangeMatch[3]);
                    } else {
                        param.max = parseFloat(rangeMatch[3]);
                    }
                    param.type = 'number';
                    param.options = null;
                } else {
                    // Dropdown options
                    param.options = inner.split(',').map(o => o.trim().replace(/^"|"$/g, ''));
                    if (param.type === 'number') {
                        // Numeric dropdown
                        param.options = param.options.map(o => {
                            const n = parseFloat(o);
                            return isNaN(n) ? o : n;
                        });
                    }
                }
            } else {
                // Plain description comment
                param.description = comment;
            }
        }

        params.push(param);
    }

    return params;
}

/**
 * Build the SCAD source with current parameter values replaced.
 */
function buildModifiedSource(originalSource, params) {
    const lines = originalSource.split('\n');

    for (const p of params) {
        const original = lines[p.line];
        // Find the assignment and replace the value, keeping the rest of the line
        let newValue;
        if (p.type === 'bool') {
            newValue = p.value ? 'true' : 'false';
        } else if (p.type === 'string') {
            newValue = `"${p.value}"`;
        } else {
            newValue = String(p.value);
        }

        // Replace: name = OLD_VALUE; // comment → name = NEW_VALUE; // comment
        const replaced = original.replace(
            /^(\s*\w+\s*=\s*).+?(\s*;.*)$/,
            `$1${newValue}$2`
        );
        lines[p.line] = replaced;
    }

    return lines.join('\n');
}

/**
 * Render parameter UI into the params panel.
 */
function renderParams(params) {
    paramsList.innerHTML = '';

    if (params.length === 0) {
        paramsEmpty.hidden = false;
        paramsList.hidden = true;
        return;
    }

    paramsEmpty.hidden = true;
    paramsList.hidden = false;

    let lastSection = null;

    for (let i = 0; i < params.length; i++) {
        const p = params[i];

        // Section header
        if (p.section && p.section !== lastSection) {
            const header = document.createElement('div');
            header.className = 'param-section-header';
            header.textContent = p.section;
            paramsList.appendChild(header);
            lastSection = p.section;
        }

        const group = document.createElement('div');
        group.className = 'param-group';

        if (p.type === 'bool') {
            // Boolean toggle
            const row = document.createElement('div');
            row.className = 'param-bool-row';

            const label = document.createElement('label');
            label.textContent = p.name;

            const toggle = document.createElement('label');
            toggle.className = 'param-toggle';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = p.value;
            checkbox.addEventListener('change', () => {
                p.value = checkbox.checked;
            });
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';
            toggle.appendChild(checkbox);
            toggle.appendChild(slider);

            row.appendChild(label);
            row.appendChild(toggle);
            group.appendChild(row);

        } else if (p.options) {
            // Dropdown
            const label = document.createElement('label');
            label.textContent = p.name;
            group.appendChild(label);

            if (p.description) {
                const desc = document.createElement('div');
                desc.className = 'param-desc';
                desc.textContent = p.description;
                group.appendChild(desc);
            }

            const select = document.createElement('select');
            for (const opt of p.options) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (String(opt) === String(p.value)) option.selected = true;
                select.appendChild(option);
            }
            select.addEventListener('change', () => {
                if (p.type === 'number') {
                    p.value = parseFloat(select.value);
                } else {
                    p.value = select.value;
                }
            });
            group.appendChild(select);

        } else if (p.type === 'number' && p.min !== null && p.max !== null) {
            // Range slider
            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'param-value-display';
            valueDisplay.textContent = p.value;

            const label = document.createElement('label');
            label.textContent = p.name;
            label.appendChild(valueDisplay);
            group.appendChild(label);

            if (p.description) {
                const desc = document.createElement('div');
                desc.className = 'param-desc';
                desc.textContent = p.description;
                group.appendChild(desc);
            }

            const range = document.createElement('input');
            range.type = 'range';
            range.min = p.min;
            range.max = p.max;
            range.step = p.step || ((p.max - p.min) <= 10 ? 0.1 : 1);
            range.value = p.value;
            range.addEventListener('input', () => {
                p.value = parseFloat(range.value);
                valueDisplay.textContent = p.value;
            });
            group.appendChild(range);

        } else if (p.type === 'number') {
            // Plain number input
            const label = document.createElement('label');
            label.textContent = p.name;
            group.appendChild(label);

            if (p.description) {
                const desc = document.createElement('div');
                desc.className = 'param-desc';
                desc.textContent = p.description;
                group.appendChild(desc);
            }

            const input = document.createElement('input');
            input.type = 'number';
            input.value = p.value;
            input.step = 'any';
            input.addEventListener('change', () => {
                p.value = parseFloat(input.value);
            });
            group.appendChild(input);

        } else {
            // String text input
            const label = document.createElement('label');
            label.textContent = p.name;
            group.appendChild(label);

            if (p.description) {
                const desc = document.createElement('div');
                desc.className = 'param-desc';
                desc.textContent = p.description;
                group.appendChild(desc);
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.value = p.value;
            input.addEventListener('change', () => {
                p.value = input.value;
            });
            group.appendChild(input);
        }

        paramsList.appendChild(group);
    }
}

/* ═══════════════ FILE UPLOAD ═══════════════ */

function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.scad')) {
        appendLog('Erro: selecione um arquivo .scad', 'error');
        return;
    }

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatSize(file.size);
    fileInfoCard.hidden = false;

    const reader = new FileReader();
    reader.onload = () => {
        currentScadSource = reader.result;
        btnCompile.disabled = false;
        appendLog(`Arquivo carregado: ${file.name} (${formatSize(file.size)})`, 'info');

        // Parse parameters and render UI
        currentParams = parseParameters(currentScadSource);
        renderParams(currentParams);

        if (currentParams.length > 0) {
            // Switch to params tab
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            document.querySelector('[data-tab="params"]').classList.add('active');
            document.getElementById('tab-params').classList.add('active');
            appendLog(`${currentParams.length} parâmetro(s) encontrado(s).`, 'success');
        }
    };
    reader.onerror = () => {
        appendLog('Erro ao ler o arquivo.', 'error');
    };
    reader.readAsText(file);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// Click to open file picker
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
});

// Drag-and-drop
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

/* ═══════════════ WORKER ═══════════════ */

function getWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js', { type: 'module' });

    worker.addEventListener('message', (e) => {
        const msg = e.data;

        switch (msg.type) {
            case 'log':
                appendLog(msg.text, msg.level);
                break;

            case 'result':
                currentStlBuffer = msg.stl;
                setCompiling(false);
                btnDownload.disabled = false;
                appendLog('Modelo pronto! Use o mouse para girar/zoom.', 'success');
                loadSTLIntoViewer(msg.stl);
                break;

            case 'error':
                setCompiling(false);
                appendLog(`Erro de compilação:\n${msg.message}`, 'error');
                break;
        }
    });

    worker.addEventListener('error', (err) => {
        setCompiling(false);
        appendLog(`Erro no worker: ${err.message}`, 'error');
    });

    return worker;
}

/* ═══════════════ COMPILE ═══════════════ */

function setCompiling(state) {
    isCompiling = state;
    btnCompile.disabled = state;
    btnLabel.textContent = state ? 'Compilando…' : 'Compilar';
    btnSpinner.hidden = !state;
    compileProgress.classList.toggle('active', state);
}

btnCompile.addEventListener('click', () => {
    if (!currentScadSource || isCompiling) return;
    setCompiling(true);
    appendLog('─'.repeat(40));

    // Log parameter overrides
    if (currentParams.length > 0) {
        const overrides = currentParams.map(p => {
            if (p.type === 'string') return `${p.name}="${p.value}"`;
            return `${p.name}=${p.value}`;
        });
        appendLog(`Parâmetros: ${overrides.join(', ')}`, 'info');
    }

    // Switch to console tab to show compilation progress
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="console"]').classList.add('active');
    document.getElementById('tab-console').classList.add('active');

    // Send source + parameter overrides to worker
    const paramOverrides = currentParams.map(p => ({
        name: p.name,
        value: p.value,
        type: p.type,
    }));
    getWorker().postMessage({ type: 'compile', scadSource: currentScadSource, params: paramOverrides });
});

/* ═══════════════ THREE.JS VIEWER ═══════════════ */

let scene, camera, renderer, controls, currentMesh;

function initViewer() {
    // Scene
    scene = new THREE.Scene();

    // Subtle gradient background
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 2; bgCanvas.height = 256;
    const ctx = bgCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1a1d2e');
    grad.addColorStop(1, '#0c0e14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    scene.background = bgTex;

    // Camera
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(50, 50, 50);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: viewerCanvas,
        antialias: true,
        alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(60, 100, 80);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x88aaff, 0.5);
    dirLight2.position.set(-40, -30, -60);
    scene.add(dirLight2);

    // Grid helper
    const grid = new THREE.GridHelper(200, 40, 0x2a2d3e, 0x1a1d2e);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    scene.add(grid);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1;
    controls.maxDistance = 5000;

    // Handle resize
    const ro = new ResizeObserver(() => resizeViewer());
    ro.observe(viewerCanvas.parentElement);
    resizeViewer();

    // Render loop
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

function resizeViewer() {
    const container = viewerCanvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
}

/* ─── Load STL into viewer ─── */
function loadSTLIntoViewer(stlBuffer) {
    // Remove previous mesh
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        currentMesh.material.dispose();
        currentMesh = null;
    }

    // Parse STL
    const loader = new STLLoader();
    const geometry = loader.parse(stlBuffer);
    geometry.computeVertexNormals();

    // Material — metallic gradient feel
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x06b6d4,
        metalness: 0.15,
        roughness: 0.35,
        clearcoat: 0.3,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.6,
    });

    currentMesh = new THREE.Mesh(geometry, material);

    // Center the model
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    // Shift so it sits on the grid (Y = 0 at bottom)
    const sizeY = box.max.y - box.min.y;
    geometry.translate(0, sizeY / 2, 0);

    scene.add(currentMesh);

    // Fit camera
    fitCamera(geometry);

    // Hide placeholder
    viewerOverlay.classList.add('hidden');
}

function fitCamera(geometry) {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    const r = sphere.radius || 10;
    const dist = r / Math.tan((camera.fov * Math.PI) / 360) * 1.4;
    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    controls.target.copy(sphere.center);
    controls.update();
    camera.near = r * 0.01;
    camera.far = r * 100;
    camera.updateProjectionMatrix();
}

/* ─── Reset camera ─── */
btnResetCam.addEventListener('click', () => {
    if (currentMesh) {
        fitCamera(currentMesh.geometry);
    } else {
        camera.position.set(50, 50, 50);
        controls.target.set(0, 0, 0);
        controls.update();
    }
});

/* ─── Download STL ─── */
btnDownload.addEventListener('click', () => {
    if (!currentStlBuffer) return;
    const blob = new Blob([currentStlBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileNameEl.textContent || 'model').replace(/\.scad$/i, '') + '.stl';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

/* ═══════════════ INIT ═══════════════ */
initViewer();
