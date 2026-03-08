# Cell-Shaded GLB Viewer — JSX Component

<!-- TINS Specification v1.0 -->
<!-- ZS:COMPLEXITY:HIGH -->
<!-- ZS:PRIORITY:HIGH -->
<!-- ZS:PLATFORM:WEB -->
<!-- ZS:LANGUAGE:JAVASCRIPT -->

---

## Description

A self-contained React JSX component that loads a GLB (binary glTF) 3D model file, plays its embedded animations, and renders it through a suite of real-time stylised shader modes — flat-2D, cartoon outline, and anime/cel-shaded — driven by the actual 3D mesh in a WebGL scene.

The target audience is developers and artists who need to preview character assets with non-photorealistic (NPR) rendering styles directly in the browser, without a dedicated DCC application. The differentiator is that all shading is implemented as custom GLSL post-process and material shaders wired into Three.js, giving frame-accurate NPR results that respond to scene lighting, camera angle, and animation state in real time.

The component is entirely self-contained in a single `.jsx` file. It imports Three.js, its GLTFLoader and OrbitControls extensions, and dat.GUI (or equivalent React sliders) inline via CDN-compatible ESM imports. No build pipeline is required beyond standard JSX transpilation. The consumer drops in their `.glb` file URL and mounts the component.

---

## Functionality

### Layout

```
+--------------------------------------------------------------+
|  [Top Bar]  GLB Viewer — Cell Shaded                        |
+--------------------------------------------------------------+
|                                                              |
|                                                              |
|               [ 3D Canvas — fills remaining height ]         |
|                  character centred, WASD + mouse orbit       |
|                                                              |
|                                                              |
+--------------------+------------------+---------------------+
| Time of Day        | Global Illum.    | Shader Mode         |
| [====O=========]   | [====O=========] | [Flat][Toon][Anime] |
| 0h ---- 24h        | 0% ---- 100%     |                     |
+--------------------+------------------+---------------------+
|  Animation: [Idle v]  Play ▶  Pause ⏸  Speed [=O=]         |
+--------------------------------------------------------------+
```

All controls sit in a fixed panel below the canvas. The canvas takes `100vw × (100vh - 120px)`.

### Core Features

1. **GLB loader** — accepts a `glbUrl` prop. Loads via `THREE.GLTFLoader`. Centres and normalises the model to fit a unit bounding box scaled to height 2.0 world units. Skeleton and morph targets are preserved.

2. **Embedded animation playback** — detects all `AnimationClip` entries in the loaded GLTF. Populates a dropdown; selecting a clip calls `mixer.clipAction(clip).play()`. Play / Pause button and a 0.1×–3× speed slider control `mixer.timeScale`.

3. **WASD + mouse camera** — `THREE.OrbitControls` handles mouse-drag orbit and scroll zoom. Additionally, keyboard `W/A/S/D` translate the orbit target (pan) at a fixed world-space speed of `0.05` units per frame so the user can reposition the pivot around the character.

4. **Time-of-day directional light** — a single `THREE.DirectionalLight` (`color: 0xfff4e0`, initial intensity `1.5`) acts as the sun. Its azimuth is fixed at 45°. Its elevation angle maps linearly from the slider:
   - `0h → 24h` maps to elevation `-90° → +270°` (full day cycle).
   - At elevation < 0° or > 180° the light intensity is multiplied by `0` (night) with a smooth 10° twilight fade.
   - A `THREE.AmbientLight` (`color: 0x8888cc`) provides the base fill.

5. **Global illumination strength slider** — controls `ambientLight.intensity` from `0.0` to `3.0`. Default `0.4`.

6. **Shader mode selector** — three mutually exclusive buttons that swap the active NPR pass:
   - **Flat** — removes shading entirely; each face shows its albedo/diffuse texture colour with no lighting.
   - **Toon** — three-band cel shading (shadow / mid / highlight) using a dot-product ramp; adds a silhouette outline via back-face inflation in a second render pass.
   - **Anime** — full anime/cel look: five-band ramp, specular hotspot, coloured rim light, thick ink outline with line-weight variation based on depth discontinuity.

7. **Real-time shader response** — shader uniforms (`uLightDir`, `uLightIntensity`, `uAmbient`) are updated every frame from the scene's actual directional light, so shading responds correctly to the time-of-day slider.

### User Flows

**Load and preview:**
1. Component mounts with `glbUrl` prop.
2. Loading spinner shown centred in canvas.
3. GLB loads → model centred → `Idle` clip (or first clip) auto-plays.
4. Default shader mode is **Toon**.
5. User orbits with mouse, pans with WASD.

**Change shader mode:**
1. User clicks **Anime** button.
2. All mesh materials swap to the anime shader. Outline pass activates.
3. Scene re-renders immediately; no reload.

**Adjust lighting:**
1. User drags the Time of Day slider to ~18h (sunset).
2. `DirectionalLight` elevation drops to ~10°; warm low-angle light rakes the model.
3. Shader shadow bands visibly shift.

**Play animation:**
1. User opens animation dropdown, selects `Walk`.
2. `AnimationMixer` transitions to `Walk` clip over 0.2 s cross-fade.
3. User sets speed to `0.5×`; animation slows in real time.

### Edge Cases

- **No animations in GLB** — dropdown shows `(none)` disabled; play/pause/speed controls are hidden.
- **GLB load failure** — canvas shows red error text: `"Failed to load GLB: [url]"`. Retry button calls loader again.
- **Very large model** — bounding-box normalisation always fits the model; camera far-plane is set to `model_diagonal × 100`.
- **No textures / vertex colours** — Flat and Toon shaders fall back to `uBaseColor = vec3(0.8)`. Anime shader adds a pastel rim tint `vec3(0.6, 0.7, 1.0)`.
- **Resize** — `ResizeObserver` on the container div updates `renderer.setSize` and `camera.aspect` each frame the size changes.

---

## Technical Implementation

### Architecture

```
CellShadedViewer (React component)
├── useEffect → bootstraps Three.js scene (runs once on mount)
│   ├── WebGLRenderer  (antialias: false — MSAA conflicts with outline pass)
│   ├── PerspectiveCamera  fov=50, near=0.01, far=dynamic
│   ├── Scene
│   │   ├── DirectionalLight  (sun)
│   │   ├── AmbientLight      (sky fill)
│   │   └── modelGroup        (loaded GLB root)
│   ├── OrbitControls
│   ├── AnimationMixer
│   ├── EffectComposer  (post-process outline pass)
│   │   ├── RenderPass
│   │   └── OutlinePass  (active for Toon and Anime modes)
│   └── requestAnimationFrame loop
├── React state
│   ├── shaderMode: "flat" | "toon" | "anime"
│   ├── timeOfDay: number  0–24
│   ├── giStrength: number  0–3
│   ├── animations: AnimationClip[]
│   ├── currentClip: string
│   ├── playing: boolean
│   └── animSpeed: number
└── JSX controls panel  (sliders, buttons, dropdown)
```

### Dependencies (ESM / CDN imports)

```javascript
import * as THREE from 'three';
// r128 is available on cdnjs — use addons from the same build:
import { GLTFLoader }    from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }    from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }    from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutlinePass }   from 'three/examples/jsm/postprocessing/OutlinePass.js';
```

> **Important:** In the JSX artifact environment Three.js r128 is loaded from
> `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`.
> The JSM addon modules must be fetched from the same tagged release on
> `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/`.
> Use a dynamic `import()` inside `useEffect` to load the addons after the
> Three.js global is available, **or** use the full module bundle approach
> described below.

### Recommended Module Strategy (single-bundle)

Because JSX artifacts cannot guarantee side-by-side CDN + ESM resolution,
the cleanest approach is to use the **importmap** trick in an HTML wrapper,
or to import directly from `https://esm.sh/three@0.128.0` which serves
pre-built ESM for browser consumption including all addons:

```javascript
import * as THREE from 'https://esm.sh/three@0.128.0';
import { GLTFLoader }    from 'https://esm.sh/three@0.128.0/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls';
import { EffectComposer } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/EffectComposer';
import { RenderPass }    from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/RenderPass';
import { ShaderPass }    from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/ShaderPass';
import { OutlinePass }   from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/OutlinePass';
```

Place these at the very top of the `.jsx` file.

### Scene Setup (useEffect, runs once)

```javascript
useEffect(() => {
  const W = container.current.clientWidth;
  const H = container.current.clientHeight;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = false;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.current.appendChild(renderer.domElement);

  // Camera
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.01, 1000);
  camera.position.set(0, 1, 3);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Lights (stored in refs for uniform updates)
  const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.5);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  const ambLight = new THREE.AmbientLight(0x8888cc, 0.4);
  scene.add(ambLight);

  // OrbitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1, 0);

  // Post-process composer
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // OutlinePass added/removed based on shader mode (see below)

  // Store refs
  rendererRef.current = renderer;
  sceneRef.current = scene;
  cameraRef.current = camera;
  controlsRef.current = controls;
  composerRef.current = composer;
  dirLightRef.current = dirLight;
  ambLightRef.current = ambLight;

  loadModel(props.glbUrl); // async, see below

  // Animation loop
  const clock = new THREE.Clock();
  const animate = () => {
    rafRef.current = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    controls.update();
    if (mixerRef.current) mixerRef.current.update(delta);
    updateLightFromTimeOfDay();   // reads timeOfDayRef
    updateShaderUniforms();       // reads shaderModeRef
    composer.render();
  };
  animate();

  return () => {
    cancelAnimationFrame(rafRef.current);
    renderer.dispose();
    container.current?.removeChild(renderer.domElement);
  };
}, []); // eslint-disable-line
```

### Model Loading

```javascript
const loadModel = (url) => {
  setLoading(true);
  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      const model = gltf.scene;

      // Centre and normalise
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2.0 / maxDim;
      model.scale.setScalar(scale);
      model.position.sub(centre.multiplyScalar(scale));
      // Adjust vertical so feet sit on y=0
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      sceneRef.current.add(model);
      modelRef.current = model;

      // Update camera far plane
      const diagonal = size.length() * scale * 100;
      cameraRef.current.far = diagonal;
      cameraRef.current.updateProjectionMatrix();

      // Apply initial shader
      applyShaderMode(shaderModeRef.current, model);

      // Animations
      if (gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        mixerRef.current = mixer;
        setAnimations(gltf.animations.map(a => a.name));
        playClip(gltf.animations[0], mixer);
      }

      setLoading(false);
    },
    undefined,
    (err) => { setLoadError(err.message); setLoading(false); }
  );
};
```

### Time-of-Day Light Calculation

```javascript
// Called every frame from animate()
const updateLightFromTimeOfDay = () => {
  const t = timeOfDayRef.current; // 0–24
  const elevation = ((t / 24) * 360 - 90) * (Math.PI / 180); // -90° at 0h, +270° at 24h
  const azimuth = 45 * (Math.PI / 180);
  const x = Math.cos(elevation) * Math.sin(azimuth);
  const y = Math.sin(elevation);
  const z = Math.cos(elevation) * Math.cos(azimuth);
  dirLightRef.current.position.set(x * 10, y * 10, z * 10);

  // Twilight fade
  const elevDeg = elevation * (180 / Math.PI);
  const fade = Math.max(0, Math.min(1, (elevDeg + 10) / 10));  // 0 below -10°, 1 above 0°
  dirLightRef.current.intensity = 1.5 * fade;
};
```

### Shader Mode System

Each mode replaces mesh materials. Three material factories are defined. When a mode is selected, `model.traverse` replaces every `THREE.MeshStandardMaterial` with the appropriate custom material, storing the original in `mesh.userData.originalMaterial` for easy restore.

#### Flat Shader

No lighting. Outputs albedo/diffuse texture directly.

```glsl
// VERTEX
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// FRAGMENT
uniform sampler2D uMap;
uniform vec3 uBaseColor;
uniform bool uHasMap;
varying vec2 vUv;
void main() {
  vec3 col = uHasMap ? texture2D(uMap, vUv).rgb : uBaseColor;
  gl_FragColor = vec4(col, 1.0);
}
```

```javascript
const makeFlatMaterial = (src) => new THREE.ShaderMaterial({
  uniforms: {
    uMap:       { value: src.map ?? null },
    uBaseColor: { value: src.color ?? new THREE.Color(0.8, 0.8, 0.8) },
    uHasMap:    { value: !!src.map },
  },
  vertexShader:   FLAT_VERT,
  fragmentShader: FLAT_FRAG,
});
```

#### Toon Shader (3-band cel + silhouette outline)

Uses a dot(normal, lightDir) ramp quantised into shadow / mid / highlight bands.
Outline is applied via `OutlinePass` in the post-process composer (thickness 3px, colour black).

```glsl
// VERTEX
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vNormal   = normalize(normalMatrix * normal);
  vUv       = uv;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// FRAGMENT
uniform sampler2D uMap;
uniform vec3 uBaseColor;
uniform bool uHasMap;
uniform vec3 uLightDir;       // normalised world-space sun direction
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uAmbient;
varying vec3 vNormal;
varying vec2 vUv;

float toonRamp(float d) {
  if (d > 0.6)  return 1.0;   // highlight
  if (d > 0.1)  return 0.6;   // mid
  return 0.15;                 // shadow
}

void main() {
  vec3 N   = normalize(vNormal);
  vec3 L   = normalize(uLightDir);
  float NdL = dot(N, L);
  float ramp = toonRamp(NdL);

  vec3 albedo = uHasMap ? texture2D(uMap, vUv).rgb : uBaseColor;
  vec3 diffuse = albedo * uLightColor * uLightIntensity * ramp;
  vec3 ambient = albedo * uAmbient;
  gl_FragColor = vec4(diffuse + ambient, 1.0);
}
```

```javascript
// Per-frame uniform update
const updateShaderUniforms = () => {
  if (!modelRef.current) return;
  const L = dirLightRef.current.position.clone().normalize();
  modelRef.current.traverse((child) => {
    if (!child.isMesh) return;
    const mat = child.material;
    if (mat?.uniforms?.uLightDir) {
      mat.uniforms.uLightDir.value.copy(L);
      mat.uniforms.uLightIntensity.value = dirLightRef.current.intensity;
      mat.uniforms.uAmbient.value = ambLightRef.current.intensity;
    }
  });
};
```

#### Anime / Cel Shader (5-band + specular + rim + ink outline)

Extends the Toon shader with:
- 5 quantised ramp steps: `[0.0, 0.15, 0.35, 0.6, 0.85, 1.0]`
- Specular hotspot: Blinn-Phong `pow(max(0,dot(H,N)), uShininess)` quantised to on/off
- Rim light: `1.0 - dot(N, viewDir)` raised to power 3, coloured `vec3(0.4, 0.6, 1.0)`
- Ink outline: a second `THREE.MeshBasicMaterial` pass on a duplicated mesh with `side: THREE.BackSide`, vertex shader inflating along normals by `uOutlineWidth = 0.02`

```glsl
// ANIME VERTEX (shared with outline inflation trick)
uniform float uOutlineWidth;
uniform bool  uIsOutlinePass;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewDir;

void main() {
  vec3 pos = position;
  if (uIsOutlinePass) {
    pos += normal * uOutlineWidth;
  }
  vNormal  = normalize(normalMatrix * normal);
  vUv      = uv;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vViewDir   = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}

// ANIME FRAGMENT
uniform sampler2D uMap;
uniform vec3  uBaseColor;
uniform bool  uHasMap;
uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform float uAmbient;
uniform float uShininess;       // default 64.0
uniform vec3  uRimColor;        // default vec3(0.4, 0.6, 1.0)
uniform float uRimStrength;     // default 0.6
uniform bool  uIsOutlinePass;
uniform vec3  uOutlineColor;    // default vec3(0.0)
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vViewDir;

float animeRamp(float d) {
  if (d > 0.85) return 1.00;
  if (d > 0.60) return 0.80;
  if (d > 0.35) return 0.55;
  if (d > 0.10) return 0.30;
  return 0.05;
}

void main() {
  if (uIsOutlinePass) {
    gl_FragColor = vec4(uOutlineColor, 1.0);
    return;
  }

  vec3 N   = normalize(vNormal);
  vec3 L   = normalize(uLightDir);
  vec3 V   = normalize(vViewDir);
  vec3 H   = normalize(L + V);

  float NdL  = dot(N, L);
  float ramp = animeRamp(NdL);

  // Specular (quantised)
  float spec = pow(max(0.0, dot(H, N)), uShininess);
  float specQ = spec > 0.5 ? 1.0 : 0.0;

  // Rim
  float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);

  vec3 albedo  = uHasMap ? texture2D(uMap, vUv).rgb : uBaseColor;
  vec3 diffuse = albedo * uLightColor * uLightIntensity * ramp;
  vec3 ambient = albedo * uAmbient;
  vec3 specCol = uLightColor * specQ * 0.8;
  vec3 rimCol  = uRimColor * rim * uRimStrength;

  gl_FragColor = vec4(diffuse + ambient + specCol + rimCol, 1.0);
}
```

Outline for Anime mode is achieved by adding a second render of each mesh with `uIsOutlinePass = true` and `side = THREE.BackSide`, stacked behind via `renderOrder = -1` on the outline mesh. This avoids the Z-fight artefacts of `OutlinePass` at high pixel ratios.

### Shader Mode Application Function

```javascript
const applyShaderMode = (mode, model) => {
  model.traverse((child) => {
    if (!child.isMesh) return;
    const src = child.userData.originalMaterial ?? child.material;
    child.userData.originalMaterial = src;

    // Remove any previous anime outline twin
    if (child.userData.outlineMesh) {
      child.userData.outlineMesh.parent?.remove(child.userData.outlineMesh);
      child.userData.outlineMesh = null;
    }

    if (mode === 'flat') {
      child.material = makeFlatMaterial(src);
    } else if (mode === 'toon') {
      child.material = makeToonMaterial(src);
    } else if (mode === 'anime') {
      child.material = makeAnimeMaterial(src, false);

      // Outline twin
      const outlineMat = makeAnimeMaterial(src, true); // uIsOutlinePass=true
      outlineMat.side = THREE.BackSide;
      const outlineMesh = new THREE.Mesh(child.geometry, outlineMat);
      outlineMesh.renderOrder = -1;
      child.add(outlineMesh);
      child.userData.outlineMesh = outlineMesh;
    }
  });

  // OutlinePass (Toon only — anime uses geometry twin)
  const composer = composerRef.current;
  if (composer.passes.length > 1) composer.passes.splice(1, composer.passes.length - 1);
  if (mode === 'toon') {
    const outlinePass = new OutlinePass(
      new THREE.Vector2(rendererRef.current.domElement.width, rendererRef.current.domElement.height),
      sceneRef.current, cameraRef.current
    );
    outlinePass.edgeStrength = 4.0;
    outlinePass.edgeThickness = 1.0;
    outlinePass.visibleEdgeColor.set('#000000');
    const selected = [];
    model.traverse(c => { if (c.isMesh) selected.push(c); });
    outlinePass.selectedObjects = selected;
    composer.addPass(outlinePass);
  }
};
```

### WASD Camera Pan

```javascript
useEffect(() => {
  const keys = {};
  const onDown = (e) => { keys[e.code] = true; };
  const onUp   = (e) => { keys[e.code] = false; };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup',   onUp);

  // Integrated into the animate() loop via a ref-stable callback:
  wasdRef.current = () => {
    if (!controlsRef.current) return;
    const speed = 0.05;
    const ctrl  = controlsRef.current;
    const fwd   = new THREE.Vector3();
    cameraRef.current.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DefaultUp).normalize();

    if (keys['KeyW']) { ctrl.target.addScaledVector(fwd,   speed); cameraRef.current.position.addScaledVector(fwd,   speed); }
    if (keys['KeyS']) { ctrl.target.addScaledVector(fwd,  -speed); cameraRef.current.position.addScaledVector(fwd,  -speed); }
    if (keys['KeyA']) { ctrl.target.addScaledVector(right,-speed); cameraRef.current.position.addScaledVector(right,-speed); }
    if (keys['KeyD']) { ctrl.target.addScaledVector(right, speed); cameraRef.current.position.addScaledVector(right, speed); }
  };

  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup',   onUp);
  };
}, []);
```

Call `wasdRef.current?.()` at the top of the `animate()` loop before `controls.update()`.

### React State & Refs

```javascript
// State (triggers re-renders for UI only)
const [shaderMode,   setShaderMode]   = useState('toon');   // "flat"|"toon"|"anime"
const [timeOfDay,    setTimeOfDay]    = useState(12);        // 0–24
const [giStrength,   setGiStrength]   = useState(0.4);       // 0–3
const [animations,   setAnimations]   = useState([]);        // clip name strings
const [currentClip,  setCurrentClip]  = useState('');
const [playing,      setPlaying]      = useState(true);
const [animSpeed,    setAnimSpeed]    = useState(1.0);
const [loading,      setLoading]      = useState(false);
const [loadError,    setLoadError]    = useState(null);

// Refs (mutable values read inside the rAF loop without stale closures)
const container     = useRef(null);
const rendererRef   = useRef(null);
const sceneRef      = useRef(null);
const cameraRef     = useRef(null);
const controlsRef   = useRef(null);
const composerRef   = useRef(null);
const dirLightRef   = useRef(null);
const ambLightRef   = useRef(null);
const modelRef      = useRef(null);
const mixerRef      = useRef(null);
const rafRef        = useRef(null);
const wasdRef       = useRef(null);
const shaderModeRef = useRef('toon');
const timeOfDayRef  = useRef(12);
```

Whenever React state changes, sync to the corresponding ref:

```javascript
useEffect(() => { shaderModeRef.current = shaderMode; }, [shaderMode]);
useEffect(() => { timeOfDayRef.current  = timeOfDay;  }, [timeOfDay]);
useEffect(() => {
  if (ambLightRef.current) ambLightRef.current.intensity = giStrength;
}, [giStrength]);
useEffect(() => {
  if (mixerRef.current) mixerRef.current.timeScale = animSpeed;
}, [animSpeed]);
```

### JSX Structure

```jsx
export default function CellShadedViewer({ glbUrl }) {
  // ... state, refs, effects above ...

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
                  background: '#0d0d1a', color: '#eee', fontFamily: 'sans-serif' }}>
      {/* Canvas container */}
      <div ref={container} style={{ flex: 1, position: 'relative' }}>
        {loading && <Spinner />}
        {loadError && <ErrorOverlay message={loadError} onRetry={() => loadModel(glbUrl)} />}
      </div>

      {/* Controls panel */}
      <div style={{ height: 120, display: 'flex', alignItems: 'center',
                    padding: '0 24px', gap: 32, background: '#111122',
                    borderTop: '1px solid #333' }}>

        {/* Time of Day */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Time of Day: {timeOfDay.toFixed(1)}h</span>
          <input type="range" min={0} max={24} step={0.1}
            value={timeOfDay} onChange={e => setTimeOfDay(+e.target.value)} style={{ width: 160 }} />
        </label>

        {/* Global Illumination */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Global Illum: {giStrength.toFixed(2)}</span>
          <input type="range" min={0} max={3} step={0.01}
            value={giStrength} onChange={e => setGiStrength(+e.target.value)} style={{ width: 160 }} />
        </label>

        {/* Shader Mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Shader Mode</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {['flat','toon','anime'].map(m => (
              <button key={m} onClick={() => {
                setShaderMode(m);
                if (modelRef.current) applyShaderMode(m, modelRef.current);
              }}
                style={{ padding: '4px 12px', background: shaderMode === m ? '#5566ff' : '#222244',
                         border: '1px solid #5566ff', borderRadius: 4, color: '#eee', cursor: 'pointer',
                         textTransform: 'capitalize' }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Animation controls */}
        {animations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Animation</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={currentClip} onChange={e => switchClip(e.target.value)}
                style={{ background: '#222244', color: '#eee', border: '1px solid #5566ff',
                         borderRadius: 4, padding: '2px 8px' }}>
                {animations.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button onClick={togglePlay}
                style={{ background: '#222244', border: '1px solid #5566ff', borderRadius: 4,
                         color: '#eee', cursor: 'pointer', padding: '4px 10px' }}>
                {playing ? '⏸' : '▶'}
              </button>
              <input type="range" min={0.1} max={3} step={0.05}
                value={animSpeed} onChange={e => setAnimSpeed(+e.target.value)} style={{ width: 80 }} />
              <span style={{ fontSize: 12 }}>{animSpeed.toFixed(2)}×</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
```

### Default Prop

```javascript
CellShadedViewer.defaultProps = {
  glbUrl: 'https://threejs.org/examples/models/gltf/Soldier.glb'
};
```

This uses the canonical Three.js demo soldier model so the component renders something useful without any prop.

---

## Style Guide

| Token | Value |
|---|---|
| Background | `#0d0d1a` dark navy |
| Panel background | `#111122` |
| Accent (active button / slider thumb) | `#5566ff` cornflower blue |
| Text | `#eeeeee` |
| Error | `#ff4455` |
| Loading spinner | CSS-only, 40px ring, `border-top: 4px solid #5566ff`, `animation: spin 0.8s linear infinite` |
| Canvas sky colour | `#1a1a2e` (matches page background for seamless look) |

---

## Testing Scenarios

1. **Default load** — mount with no props → Soldier.glb loads → Toon mode → Walk animation plays.
2. **Shader switching** — click Flat → Anime → Toon in rapid succession → no materials leak, no outline artefacts.
3. **Full day cycle** — drag Time of Day slider from 0→24 → light sweeps, night sections darken to ambient only.
4. **GI at zero** — drag GI slider to 0 → shadow bands fully black in Toon/Anime mode; Flat unaffected.
5. **No animation GLB** — load a static prop GLB → animation row hidden.
6. **Window resize** — drag browser window smaller → canvas fills new size, aspect ratio corrects.
7. **WASD pan** — press W while orbiting → camera + target move forward together; model stays centred relative to new position.

---

## Accessibility Requirements

- All sliders have associated `<label>` elements with visible text and live numeric readout.
- Shader mode buttons have descriptive text (not icon-only).
- Error overlay text meets WCAG AA contrast on the dark background.
- Keyboard focus rings are preserved (no `outline: none` without replacement).

---

## Performance Goals

- Maintain ≥ 60 fps on a mid-range GPU (e.g. Intel Iris Xe / Apple M1) for models up to 50k triangles.
- Shader uniform updates complete within 0.1 ms per frame (simple loop over mesh children).
- `OutlinePass` (Toon mode only) adds ≤ 2 ms GPU time on 1080p; disabled in Flat and Anime modes.
- Anime outline twin meshes share geometry (no copy) — zero extra GPU memory for vertices.

---

## Extended / Optional Features

- **Drag-and-drop GLB upload** — `<input type="file">` hidden behind a drop zone; on drop, call `URL.createObjectURL(file)` and pass to `loadModel`.
- **Bloom on rim light** — add `UnrealBloomPass` to the composer for the Anime mode rim channel only, using a luminance threshold of 0.9.
- **Shadow ground plane** — a `THREE.ShadowMaterial` plane at `y = 0` with a `THREE.DirectionalLight` shadow camera (only when using Toon or Anime mode; disabled for Flat).
- **Export frame** — a button that calls `renderer.domElement.toDataURL('image/png')` and triggers a download.
- **Morph target sliders** — if the model has morph targets, auto-generate a slider per target in an expandable panel below the animation controls.
