# Cell-Shaded GLB Viewer — Stage 2: Extended Features

<!-- TINS Specification v1.0 -->
<!-- ZS:COMPLEXITY:HIGH -->
<!-- ZS:PRIORITY:HIGH -->
<!-- ZS:PLATFORM:WEB -->
<!-- ZS:LANGUAGE:JAVASCRIPT -->
<!-- ZS:STAGE:2 -->
<!-- ZS:DEPENDS_ON:cell-shaded-glb-jsx-plan.md -->

---

## Description

Stage 2 extends the completed Stage 1 `CellShadedViewer` JSX component with four production-quality features: drag-and-drop GLB file upload, selective Anime-mode rim bloom via `UnrealBloomPass`, a shadow-casting ground plane that activates in Toon and Anime modes, and a one-click PNG frame export.

This document is self-contained. It restates every interface boundary, ref name, and function signature from Stage 1 that Stage 2 touches, so an implementor can apply all changes from this document alone without re-reading Stage 1. All additions are **additive** — no Stage 1 logic is deleted; only new code is inserted and specific existing functions are extended at clearly marked splice points.

The audience is the same developer who completed Stage 1. The differentiator is precision: every new uniform, every pass insertion order, and every CSS transition is specified with concrete values so the implementation is unambiguous.

---

## Functionality

### Updated Layout

```
+--------------------------------------------------------------+
|  [Top Bar]  GLB Viewer — Cell Shaded          [📷 Export]   |
+--------------------------------------------------------------+
|                                                              |
|  +-- Drop Zone overlay (visible when no model loaded) ----+ |
|  |                                                         | |
|  |        ⬇  Drop a .glb file here                        | |
|  |           or click to browse                            | |
|  |                                                         | |
|  +---------------------------------------------------------+ |
|                                                              |
|               [ 3D Canvas — model + shadow plane ]           |
|                                                              |
+--------------------+------------------+---------------------+
| Time of Day        | Global Illum.    | Shader Mode         |
| [====O=========]   | [====O=========] | [Flat][Toon][Anime] |
+--------------------+------------------+---------------------+
|  Animation: [Idle v]  ▶  ⏸   Speed [=O=]                   |
+--------------------------------------------------------------+
```

Changes from Stage 1 layout:
- `[📷 Export]` button appears in the top bar, right-aligned.
- Drop Zone overlay covers the entire canvas area when no model is loaded. Once a model loads the overlay is hidden; it never reappears unless the user explicitly clicks it again to swap models.
- A persistent thin `[📂 Replace model]` link sits in the top-left corner of the canvas at all times post-load for swap access.

### Feature 1 — Drag-and-Drop GLB Upload

**Drop zone behaviour:**
- On mount with no `glbUrl` prop (or `glbUrl` is `null`/`undefined`), the canvas area is fully covered by the drop zone overlay.
- The overlay background is `rgba(17, 17, 34, 0.92)` with a dashed `2px` border in `#5566ff`, border-radius `12px`, centred icon `⬇` at `48px`, and two lines of text: `"Drop a .glb file here"` (`18px`, `#eee`) and `"or click to browse"` (`13px`, `#aaa`).
- When the user drags a file over the overlay the border colour transitions to `#88aaff` and background to `rgba(40,40,100,0.95)` via CSS `transition: 0.15s`.
- On `dragover`: `e.preventDefault()`, set `dragActive` state `true`.
- On `dragleave`: set `dragActive` state `false`.
- On `drop`: call `handleFileDrop(e)`.
- On click: programmatically trigger the hidden `<input type="file" accept=".glb">` ref.

**`handleFileDrop(e)` logic:**
```javascript
const handleFileDrop = (e) => {
  e.preventDefault();
  setDragActive(false);
  const file = e.dataTransfer?.files?.[0] ?? e.target?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    setLoadError('Only .glb files are supported.');
    return;
  }
  // Revoke any previous object URL to avoid memory leak
  if (objectUrlRef.current) {
    URL.revokeObjectURL(objectUrlRef.current);
  }
  const url = URL.createObjectURL(file);
  objectUrlRef.current = url;
  // Clear existing model from scene
  clearModel();
  loadModel(url);
  setDropZoneVisible(false);
};
```

**`clearModel()` function** — disposes and removes the current model before loading a new one:
```javascript
const clearModel = () => {
  if (!modelRef.current) return;
  // Stop animations
  if (mixerRef.current) {
    mixerRef.current.stopAllAction();
    mixerRef.current = null;
  }
  // Dispose geometries and materials
  modelRef.current.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material?.dispose();
      }
      if (child.userData.outlineMesh) {
        child.userData.outlineMesh.geometry?.dispose();
        child.userData.outlineMesh.material?.dispose();
      }
    }
  });
  sceneRef.current.remove(modelRef.current);
  modelRef.current = null;
  setAnimations([]);
  setCurrentClip('');
};
```

**`[📂 Replace model]` link** — a small `<button>` overlaid at `position: absolute; top: 8px; left: 8px` inside the canvas container. `onClick` it sets `dropZoneVisible(true)` and focuses the hidden file input. It is rendered only when `modelRef.current !== null`.

**Hidden file input JSX:**
```jsx
<input
  ref={fileInputRef}
  type="file"
  accept=".glb"
  style={{ display: 'none' }}
  onChange={handleFileDrop}
/>
```

**New state and refs for this feature:**
```javascript
const [dragActive,       setDragActive]       = useState(false);
const [dropZoneVisible,  setDropZoneVisible]   = useState(!props.glbUrl);
const objectUrlRef  = useRef(null);   // tracks current object URL for revocation
const fileInputRef  = useRef(null);   // hidden <input type="file">
```

**Cleanup on unmount** — revoke object URL in the existing `useEffect` cleanup:
```javascript
return () => {
  cancelAnimationFrame(rafRef.current);
  renderer.dispose();
  container.current?.removeChild(renderer.domElement);
  if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); // ADD THIS LINE
};
```

---

### Feature 2 — Bloom on Anime Rim Light

**Goal:** apply a selective glow to the rim light contribution only in Anime shader mode, without blooming the full scene (which would wash out the clean cel shading on albedo bands).

**Approach — dual render targets + masked bloom:**

The technique uses two `WebGLRenderTarget` buffers:
1. `mainTarget` — full scene rendered normally (all Anime shader output).
2. `rimTarget` — scene rendered a second time with a `RimOnlyMaterial` that outputs `vec4(0)` for everything except the rim contribution, which it outputs at full brightness. This isolates the rim channel as a luminance mask.

`UnrealBloomPass` is applied to `rimTarget` only. Its result is additively composited onto `mainTarget` via a final `ShaderPass` (additive blend). This keeps the toon bands crisp while the rim glows.

**New import (add to existing import block):**
```javascript
import { UnrealBloomPass } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass';
```

**New refs:**
```javascript
const rimTargetRef    = useRef(null);   // WebGLRenderTarget for rim-only pass
const bloomComposerRef = useRef(null);  // secondary EffectComposer for rim bloom
```

**Rim-only material GLSL** — mirrors the Anime fragment shader but zeroes out everything except the rim term:

```glsl
// RIM-ONLY VERTEX  (identical to Anime vertex, uIsOutlinePass always false here)
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal  = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir   = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}

// RIM-ONLY FRAGMENT
uniform vec3  uRimColor;
uniform float uRimStrength;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);
  // Only output rim above a threshold to avoid noise in shadow areas
  float rimMask = rim * uRimStrength;
  gl_FragColor = vec4(uRimColor * rimMask, 1.0);
}
```

```javascript
const makeRimOnlyMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    uRimColor:    { value: new THREE.Color(0.4, 0.6, 1.0) },
    uRimStrength: { value: 0.6 },
  },
  vertexShader:   RIM_ONLY_VERT,
  fragmentShader: RIM_ONLY_FRAG,
});
```

**Bloom composer setup** — called inside `applyShaderMode` when switching to `'anime'`:

```javascript
const setupBloomComposer = () => {
  const renderer = rendererRef.current;
  const W = renderer.domElement.width;
  const H = renderer.domElement.height;

  // Render target for rim-only pass
  const rimTarget = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });
  rimTargetRef.current = rimTarget;

  // Bloom composer reads rimTarget, writes to its own buffer
  const bloomComposer = new EffectComposer(renderer, rimTarget);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(sceneRef.current, cameraRef.current));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(W, H),
    /*strength*/  1.2,   // bloom intensity
    /*radius*/    0.4,   // bloom spread
    /*threshold*/ 0.9    // luminance threshold — only very bright rim pixels bloom
  );
  bloomComposer.addPass(bloomPass);
  bloomComposerRef.current = bloomComposer;
};
```

**Additive composite `ShaderPass`** — added to the main `composerRef` after the `RenderPass`, composites the bloom texture on top:

```glsl
// ADDITIVE BLEND VERTEX
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }

// ADDITIVE BLEND FRAGMENT
uniform sampler2D tDiffuse;    // main scene (from RenderPass)
uniform sampler2D tBloom;      // bloom result
void main() {
  vec4 base  = texture2D(tDiffuse, vUv);
  vec4 bloom = texture2D(tBloom,   vUv);
  gl_FragColor = vec4(base.rgb + bloom.rgb, base.a);
}
```

```javascript
const AdditiveBlendShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom:   { value: null },
  },
  vertexShader:   ADDITIVE_VERT,
  fragmentShader: ADDITIVE_FRAG,
};

const addBloomCompositePass = () => {
  const blendPass = new ShaderPass(AdditiveBlendShader);
  blendPass.uniforms['tBloom'].value = bloomComposerRef.current.renderTarget2.texture;
  blendPass.renderToScreen = true;
  composerRef.current.addPass(blendPass);
  blendPassRef.current = blendPass;
};
```

**Per-frame render order for Anime mode** — replace the single `composer.render()` call in `animate()` with mode-aware logic:

```javascript
const renderFrame = () => {
  if (shaderModeRef.current === 'anime' && bloomComposerRef.current) {
    // 1. Swap every mesh to rim-only material
    applyTemporaryMaterials(rimOnlyMatRef.current);
    // 2. Render rim-only scene into rimTarget
    bloomComposerRef.current.render();
    // 3. Restore anime materials
    restoreAnimeMaterials();
    // 4. Render full scene + additive bloom composite
    composerRef.current.render();
  } else {
    composerRef.current.render();
  }
};
```

**`applyTemporaryMaterials` / `restoreAnimeMaterials`:**
```javascript
const applyTemporaryMaterials = (mat) => {
  modelRef.current?.traverse((child) => {
    if (child.isMesh && !child.userData.isOutlineMesh) {
      child.userData._savedMat = child.material;
      child.material = mat;
    }
  });
};

const restoreAnimeMaterials = () => {
  modelRef.current?.traverse((child) => {
    if (child.isMesh && child.userData._savedMat) {
      child.material = child.userData._savedMat;
      delete child.userData._savedMat;
    }
  });
};
```

**Teardown** — when switching away from Anime mode, `teardownBloom()` disposes the rim target and clears the bloom composer:

```javascript
const teardownBloom = () => {
  rimTargetRef.current?.dispose();
  rimTargetRef.current = null;
  bloomComposerRef.current = null;
  // Remove additive blend pass from main composer
  if (blendPassRef.current) {
    const passes = composerRef.current.passes;
    const idx = passes.indexOf(blendPassRef.current);
    if (idx !== -1) passes.splice(idx, 1);
    blendPassRef.current = null;
  }
};
```

Call `teardownBloom()` at the top of `applyShaderMode` before building the new mode's passes:
```javascript
// Inside applyShaderMode(mode, model), first lines:
teardownBloom();          // always safe; no-ops if bloom was not active
```

**Resize handling** — bloom target must resize with the canvas. In the `ResizeObserver` callback:
```javascript
if (rimTargetRef.current) {
  rimTargetRef.current.setSize(W, H);
}
if (bloomComposerRef.current) {
  bloomComposerRef.current.setSize(W, H);
}
```

---

### Feature 3 — Shadow Ground Plane

**Goal:** display a contact shadow below the model that responds to the sun directional light. Active only in `'toon'` and `'anime'` shader modes. Hidden (not just invisible — fully removed from the render) in `'flat'` mode.

**Ground plane geometry:**
- `THREE.PlaneGeometry(20, 20)` rotated `-Math.PI / 2` around X so it lies flat on `y = 0`.
- Material: `THREE.ShadowMaterial({ opacity: 0.35, transparent: true })`.
- `receiveShadow = true`.

**Directional light shadow camera** — the existing `dirLight` from Stage 1 gains a shadow camera:
```javascript
// Add after dirLight construction in useEffect:
dirLight.castShadow = true;
dirLight.shadow.mapSize.width  = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near   = 0.5;
dirLight.shadow.camera.far    = 50;
dirLight.shadow.camera.left   = -3;
dirLight.shadow.camera.right  =  3;
dirLight.shadow.camera.top    =  3;
dirLight.shadow.camera.bottom = -3;
dirLight.shadow.bias          = -0.001;  // prevents shadow acne
```

**Enable shadow map on renderer** — in the renderer setup block:
```javascript
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
// NOTE: Stage 1 set shadowMap.enabled = false.
// Stage 2 overrides this to true. The antialias:false setting is unchanged.
```

**Model shadow casting** — after `loadModel` places the model in the scene, traverse and enable casting:
```javascript
// Inside loadModel(), after sceneRef.current.add(model):
model.traverse((child) => {
  if (child.isMesh) {
    child.castShadow    = true;
    child.receiveShadow = false; // model does not self-shadow (avoids shader conflict)
  }
});
```

**Ground plane management** — create once, add/remove per shader mode change:

```javascript
// Create once in useEffect, store in ref, do NOT add to scene yet:
const groundGeo  = new THREE.PlaneGeometry(20, 20);
const groundMat  = new THREE.ShadowMaterial({ opacity: 0.35, transparent: true });
const groundPlane = new THREE.Mesh(groundGeo, groundMat);
groundPlane.rotation.x  = -Math.PI / 2;
groundPlane.position.y  = 0;
groundPlane.receiveShadow = true;
groundPlane.name = 'shadowGroundPlane';
groundPlaneRef.current = groundPlane;
```

```javascript
// New ref:
const groundPlaneRef = useRef(null);
```

**`updateGroundPlane(mode)`** — called at the end of `applyShaderMode`:
```javascript
const updateGroundPlane = (mode) => {
  const plane  = groundPlaneRef.current;
  const scene  = sceneRef.current;
  if (!plane || !scene) return;

  const shouldShow = mode === 'toon' || mode === 'anime';
  const inScene    = scene.getObjectByName('shadowGroundPlane') !== undefined;

  if (shouldShow && !inScene)  scene.add(plane);
  if (!shouldShow && inScene)  scene.remove(plane);

  // Also toggle shadow casting on the directional light
  if (dirLightRef.current) dirLightRef.current.castShadow = shouldShow;
};
```

**`applyShaderMode` splice point** — add as the final call:
```javascript
// End of applyShaderMode(mode, model):
updateGroundPlane(mode);
```

**Shadow camera follows sun** — the shadow camera frustum must track the directional light's position each frame so shadows remain correct through the full day cycle. Add to `updateLightFromTimeOfDay()` after setting `dirLight.position`:

```javascript
// After dirLightRef.current.position.set(x*10, y*10, z*10):
dirLightRef.current.shadow.camera.updateProjectionMatrix();
```

**Night suppression** — when `fade === 0` (night), also hide the ground plane shadow to avoid an ugly black splat with no apparent light source:
```javascript
// In updateLightFromTimeOfDay(), after computing fade:
if (groundPlaneRef.current) {
  groundMatRef.current.opacity = 0.35 * fade;  // fades shadow at dusk/dawn
}
```

```javascript
// New ref to mutate opacity without re-creating material:
const groundMatRef = useRef(null);
// Set in useEffect: groundMatRef.current = groundMat;
```

**Edge case — model partially below y=0** — the Stage 1 `loadModel` code already lifts the model so `box.min.y === 0` after normalisation. The ground plane at `y = 0` therefore always sits exactly at the model's feet. No additional offset is needed.

**Edge case — very small model** — `PlaneGeometry(20, 20)` covers ±10 world units. Stage 1 normalises all models to height `2.0`, so the plane always extends well beyond the model footprint.

---

### Feature 4 — Export Frame

**Goal:** a single `[📷 Export]` button in the top bar that captures the current rendered frame as a PNG and triggers a browser download named `cellshade-export-YYYY-MM-DD-HH-MM-SS.png`.

**Constraint:** Three.js `WebGLRenderer` by default clears the drawing buffer after each frame (`renderer.preserveDrawingBuffer = false`). `toDataURL()` called outside the render loop returns a blank canvas. The solution is to set `preserveDrawingBuffer: true` at renderer creation, or to trigger the capture synchronously inside the render loop on the next frame.

**Chosen approach — `preserveDrawingBuffer: true`** (simpler, no frame-timing complexity):
```javascript
// In useEffect, renderer creation — change Stage 1 line:
// BEFORE: const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
// AFTER:
const renderer = new THREE.WebGLRenderer({
  antialias:             false,
  alpha:                 false,
  preserveDrawingBuffer: true,   // required for toDataURL() to work outside rAF
});
```

**Export handler:**
```javascript
const handleExport = () => {
  const renderer = rendererRef.current;
  if (!renderer) return;

  // Force one render to ensure the buffer is current
  composerRef.current.render();

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Build filename with timestamp
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
             + `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `cellshade-export-${ts}.png`;

  // Trigger download
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
```

**Export button JSX** — placed inside the top bar `<div>`, right-aligned via `marginLeft: 'auto'`:
```jsx
<div style={{
  display: 'flex', alignItems: 'center', padding: '0 16px',
  height: 40, background: '#0d0d1a',
  borderBottom: '1px solid #222244',
}}>
  <span style={{ fontSize: 14, fontWeight: 600, color: '#aabbff', letterSpacing: '0.05em' }}>
    GLB Viewer — Cell Shaded
  </span>
  <button
    onClick={handleExport}
    title="Export current frame as PNG"
    style={{
      marginLeft: 'auto',
      background: '#222244',
      border: '1px solid #5566ff',
      borderRadius: 6,
      color: '#eee',
      padding: '5px 14px',
      cursor: 'pointer',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}
  >
    📷 Export
  </button>
</div>
```

**Visual feedback** — the button briefly changes background to `#5566ff` for `400ms` on click to confirm the capture:
```javascript
const [exporting, setExporting] = useState(false);

const handleExport = () => {
  setExporting(true);
  setTimeout(() => setExporting(false), 400);
  // ... rest of export logic above ...
};

// In button style, conditionally:
background: exporting ? '#5566ff' : '#222244',
```

**New state:**
```javascript
const [exporting, setExporting] = useState(false);
```

**Edge case — no model loaded** — button remains enabled. It will capture whatever is in the canvas (sky background and drop zone overlay in that case). This is intentional; the user may want to export the empty canvas for debugging.

**Edge case — bloom active (Anime mode)** — `composerRef.current.render()` in the handler triggers the full bloom composite, so the export correctly includes the rim glow.

---

## Technical Implementation

### Revised Architecture

The following additions are made to the Stage 1 component tree. Only new nodes are shown; the Stage 1 structure is unchanged except where noted.

```
CellShadedViewer (React component)
├── useEffect → bootstraps Three.js scene
│   ├── WebGLRenderer  preserveDrawingBuffer: true  ← CHANGED from Stage 1
│   │                  shadowMap.enabled: true       ← CHANGED from Stage 1
│   │                  shadowMap.type: PCFSoftShadowMap ← NEW
│   ├── DirectionalLight  castShadow: true           ← EXTENDED
│   │   └── shadow.camera  (near/far/frustum/bias)   ← NEW
│   ├── groundPlane  (ShadowMaterial, y=0)           ← NEW, not in scene yet
│   └── cleanup: URL.revokeObjectURL(objectUrlRef)   ← NEW
│
├── React state (additions)
│   ├── dragActive:      boolean
│   ├── dropZoneVisible: boolean
│   └── exporting:       boolean
│
├── Refs (additions)
│   ├── objectUrlRef     — current blob URL
│   ├── fileInputRef     — hidden <input type="file">
│   ├── groundPlaneRef   — THREE.Mesh (shadow plane)
│   ├── groundMatRef     — THREE.ShadowMaterial
│   ├── rimTargetRef     — WebGLRenderTarget (bloom rim)
│   ├── bloomComposerRef — secondary EffectComposer
│   ├── blendPassRef     — additive ShaderPass
│   └── rimOnlyMatRef    — RimOnlyMaterial instance
│
├── New functions
│   ├── handleFileDrop(e)
│   ├── clearModel()
│   ├── setupBloomComposer()
│   ├── addBloomCompositePass()
│   ├── teardownBloom()
│   ├── applyTemporaryMaterials(mat)
│   ├── restoreAnimeMaterials()
│   ├── updateGroundPlane(mode)
│   └── handleExport()
│
├── Modified functions
│   ├── loadModel()          — adds castShadow traversal
│   ├── applyShaderMode()    — calls teardownBloom(), updateGroundPlane()
│   ├── updateLightFromTimeOfDay() — updates shadow camera, fades groundMat.opacity
│   └── renderFrame()        — replaces composer.render() with mode-aware logic
│
└── JSX additions
    ├── Top bar with [📷 Export] button
    ├── Drop zone overlay (conditional on dropZoneVisible)
    ├── [📂 Replace model] link (conditional on model loaded)
    └── Hidden <input type="file" ref={fileInputRef}>
```

### Complete New Refs Block

Add to the existing refs section in the component:

```javascript
// Stage 2 additions
const objectUrlRef     = useRef(null);
const fileInputRef     = useRef(null);
const groundPlaneRef   = useRef(null);
const groundMatRef     = useRef(null);
const rimTargetRef     = useRef(null);
const bloomComposerRef = useRef(null);
const blendPassRef     = useRef(null);
const rimOnlyMatRef    = useRef(null);
```

### Complete New State Block

```javascript
// Stage 2 additions
const [dragActive,       setDragActive]       = useState(false);
const [dropZoneVisible,  setDropZoneVisible]   = useState(!props.glbUrl);
const [exporting,        setExporting]         = useState(false);
```

### Full Drop Zone JSX

```jsx
{dropZoneVisible && (
  <div
    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
    onDragLeave={() => setDragActive(false)}
    onDrop={handleFileDrop}
    onClick={() => fileInputRef.current?.click()}
    style={{
      position:        'absolute',
      inset:           0,
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             12,
      background:      dragActive ? 'rgba(40,40,100,0.95)' : 'rgba(17,17,34,0.92)',
      border:          `2px dashed ${dragActive ? '#88aaff' : '#5566ff'}`,
      borderRadius:    12,
      cursor:          'pointer',
      transition:      'background 0.15s, border-color 0.15s',
      zIndex:          10,
      userSelect:      'none',
    }}
  >
    <span style={{ fontSize: 48 }}>⬇</span>
    <span style={{ fontSize: 18, color: '#eee' }}>Drop a .glb file here</span>
    <span style={{ fontSize: 13, color: '#aaa' }}>or click to browse</span>
  </div>
)}
```

### Function Insertion Map

The table below shows exactly where each new Stage 2 function slots into the existing Stage 1 source, to guide a precise patch:

| Function | Insertion Point |
|---|---|
| `clearModel()` | After `loadModel()` definition |
| `handleFileDrop(e)` | After `clearModel()` definition |
| `makeRimOnlyMaterial()` | After `makeAnimeMaterial()` definition |
| `setupBloomComposer()` | After `makeRimOnlyMaterial()` definition |
| `addBloomCompositePass()` | After `setupBloomComposer()` definition |
| `teardownBloom()` | After `addBloomCompositePass()` definition |
| `applyTemporaryMaterials(mat)` | After `teardownBloom()` definition |
| `restoreAnimeMaterials()` | After `applyTemporaryMaterials()` definition |
| `updateGroundPlane(mode)` | After `restoreAnimeMaterials()` definition |
| `handleExport()` | After `updateGroundPlane()` definition |
| `renderFrame()` | Replaces the `composer.render()` line in `animate()` |

### `applyShaderMode` Extended Splice

The Stage 1 function ends with the `OutlinePass` block. Append the following lines after that block:

```javascript
// Stage 2 additions — append to end of applyShaderMode(mode, model):

// Bloom: setup for anime, teardown for others (teardownBloom already called at top)
if (mode === 'anime') {
  // Create rim-only material once and reuse
  if (!rimOnlyMatRef.current) rimOnlyMatRef.current = makeRimOnlyMaterial();
  setupBloomComposer();
  addBloomCompositePass();
}

// Shadow ground plane
updateGroundPlane(mode);
```

### GLSL Constant Strings

All GLSL shader strings should be defined as JavaScript `const` template literals at module scope (outside the component function), grouped with the existing Stage 1 shader strings:

```javascript
// Stage 2 GLSL — add after Stage 1 shader strings

const RIM_ONLY_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir   = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const RIM_ONLY_FRAG = /* glsl */`
  uniform vec3  uRimColor;
  uniform float uRimStrength;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);
    float rimMask = rim * uRimStrength;
    gl_FragColor = vec4(uRimColor * rimMask, 1.0);
  }
`;

const ADDITIVE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ADDITIVE_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  varying vec2 vUv;
  void main() {
    vec4 base  = texture2D(tDiffuse, vUv);
    vec4 bloom = texture2D(tBloom,   vUv);
    gl_FragColor = vec4(base.rgb + bloom.rgb, base.a);
  }
`;
```

---

## Style Guide

Inherits all Stage 1 tokens. Additions:

| Token | Value |
|---|---|
| Drop zone border (idle) | `#5566ff` |
| Drop zone border (drag-over) | `#88aaff` |
| Drop zone background (idle) | `rgba(17,17,34,0.92)` |
| Drop zone background (drag-over) | `rgba(40,40,100,0.95)` |
| Export button (idle) | `background: #222244`, `border: #5566ff` |
| Export button (active flash) | `background: #5566ff` — held for `400ms` |
| Replace model link | `color: #aabbff`, `font-size: 11px`, `position: absolute top-left` |
| Shadow opacity (full day) | `0.35` |
| Shadow opacity (night / `fade=0`) | `0.0` (fades with sun) |

---

## Testing Scenarios

1. **Drop valid GLB** — drag `robot.glb` onto overlay → spinner → model loads → overlay hides → Toon mode → shadow visible beneath model.
2. **Drop invalid file** — drag `photo.jpg` → error message `"Only .glb files are supported."` → overlay stays open.
3. **Replace model** — click `[📂 Replace model]` → overlay reappears → drop a second GLB → first model disposed, second loads, no memory leak (object URL revoked).
4. **Bloom in Anime mode** — switch to Anime → rim light glows on edges facing camera → drag GI slider to 0 → rim still visible (independent of ambient).
5. **Bloom teardown** — switch Anime → Toon → no bloom artefacts; `OutlinePass` active; bloom composer null.
6. **Shadow in Toon** — Toon mode → shadow plane visible → drag Time of Day to 2h (night) → shadow opacity fades to `0`.
7. **Shadow hidden in Flat** — switch to Flat mode → ground plane removed from scene, no shadow visible.
8. **Export Toon** — click `[📷 Export]` → button flashes blue → PNG file downloads with timestamped name → image contains model with toon shading and visible shadow.
9. **Export Anime with bloom** — Anime mode → click Export → downloaded PNG shows rim glow correctly composited.
10. **Resize with bloom** — drag window to 50% width while in Anime mode → rim target and bloom composer resize; no stretching or null errors.

---

## Accessibility Requirements

- Drop zone has `role="button"` and `aria-label="Drop a GLB file or click to browse"`.
- Drop zone responds to `Enter` and `Space` keypresses (triggers file input click) in addition to mouse click.
- Export button has `title="Export current frame as PNG"` tooltip.
- Replace model link has `aria-label="Replace loaded model"`.
- All new interactive elements maintain visible focus rings.

---

## Performance Goals

- **Drop zone** — file object URL creation completes within 1 ms; all cost is in `loadModel()` which is unchanged.
- **Bloom rim pass** — second render of rim-only materials adds ≤ 3 ms GPU time on 1080p (materials are trivially cheap; only the shadow-casting geometry varies).
- **Shadow map** — 1024×1024 `PCFSoftShadowMap` adds ≤ 2 ms GPU per frame on mid-range hardware. Shadow map is only rendered when the ground plane is in the scene (Toon / Anime modes).
- **Export** — `toDataURL` with `preserveDrawingBuffer: true` blocks the main thread for ≤ 15 ms on a 1920×1080 canvas. Acceptable for a user-triggered, infrequent action.
- **Memory** — `clearModel()` fully disposes all geometries and materials before loading a new model, ensuring no unbounded accumulation across multiple drag-and-drop swaps.
