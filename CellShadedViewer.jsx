import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'https://esm.sh/three@0.128.0';
import { GLTFLoader } from 'https://esm.sh/three@0.128.0/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls';
import { EffectComposer } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/ShaderPass';
import { OutlinePass } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/OutlinePass';
import { UnrealBloomPass } from 'https://esm.sh/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass';

// ─── GLSL Shaders ────────────────────────────────────────────────────────────

const FLAT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLAT_FRAG = `
uniform sampler2D uMap;
uniform vec3 uBaseColor;
uniform bool uHasMap;
varying vec2 vUv;
void main() {
  vec3 col = uHasMap ? texture2D(uMap, vUv).rgb : uBaseColor;
  gl_FragColor = vec4(col, 1.0);
}
`;

const TOON_VERT = `
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vNormal   = normalize(normalMatrix * normal);
  vUv       = uv;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TOON_FRAG = `
uniform sampler2D uMap;
uniform vec3 uBaseColor;
uniform bool uHasMap;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uAmbient;
varying vec3 vNormal;
varying vec2 vUv;

float toonRamp(float d) {
  if (d > 0.6)  return 1.0;
  if (d > 0.1)  return 0.6;
  return 0.15;
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
`;

const ANIME_VERT = `
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
`;

const ANIME_FRAG = `
uniform sampler2D uMap;
uniform vec3  uBaseColor;
uniform bool  uHasMap;
uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform float uAmbient;
uniform float uShininess;
uniform vec3  uRimColor;
uniform float uRimStrength;
uniform bool  uIsOutlinePass;
uniform vec3  uOutlineColor;
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

  float spec = pow(max(0.0, dot(H, N)), uShininess);
  float specQ = spec > 0.5 ? 1.0 : 0.0;

  float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);

  vec3 albedo  = uHasMap ? texture2D(uMap, vUv).rgb : uBaseColor;
  vec3 diffuse = albedo * uLightColor * uLightIntensity * ramp;
  vec3 ambient = albedo * uAmbient;
  vec3 specCol = uLightColor * specQ * 0.8;
  vec3 rimCol  = uRimColor * rim * uRimStrength;

  gl_FragColor = vec4(diffuse + ambient + specCol + rimCol, 1.0);
}
`;

// ─── Stage 2 GLSL — Rim-only & Additive Blend ───────────────────────────────

const RIM_ONLY_VERT = `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal  = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir   = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const RIM_ONLY_FRAG = `
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

const ADDITIVE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ADDITIVE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
varying vec2 vUv;
void main() {
  vec4 base  = texture2D(tDiffuse, vUv);
  vec4 bloom = texture2D(tBloom,   vUv);
  gl_FragColor = vec4(base.rgb + bloom.rgb, base.a);
}
`;

// ─── Material Factories ──────────────────────────────────────────────────────

function makeFlatMaterial(src) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap:       { value: src.map ?? null },
      uBaseColor: { value: src.color ? src.color.clone() : new THREE.Color(0.8, 0.8, 0.8) },
      uHasMap:    { value: !!src.map },
    },
    vertexShader: FLAT_VERT,
    fragmentShader: FLAT_FRAG,
    skinning: !!src.skinning,
  });
}

function makeToonMaterial(src) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap:            { value: src.map ?? null },
      uBaseColor:      { value: src.color ? src.color.clone() : new THREE.Color(0.8, 0.8, 0.8) },
      uHasMap:         { value: !!src.map },
      uLightDir:       { value: new THREE.Vector3(1, 1, 1).normalize() },
      uLightColor:     { value: new THREE.Color(1, 0.957, 0.878) },
      uLightIntensity: { value: 1.5 },
      uAmbient:        { value: 0.4 },
    },
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    skinning: !!src.skinning,
  });
}

function makeAnimeMaterial(src, isOutline) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap:            { value: src.map ?? null },
      uBaseColor:      { value: src.color ? src.color.clone() : new THREE.Color(0.8, 0.8, 0.8) },
      uHasMap:         { value: !!src.map },
      uLightDir:       { value: new THREE.Vector3(1, 1, 1).normalize() },
      uLightColor:     { value: new THREE.Color(1, 0.957, 0.878) },
      uLightIntensity: { value: 1.5 },
      uAmbient:        { value: 0.4 },
      uShininess:      { value: 64.0 },
      uRimColor:       { value: new THREE.Color(0.4, 0.6, 1.0) },
      uRimStrength:    { value: 0.6 },
      uOutlineWidth:   { value: 0.02 },
      uIsOutlinePass:  { value: isOutline },
      uOutlineColor:   { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: ANIME_VERT,
    fragmentShader: ANIME_FRAG,
    skinning: !!src.skinning,
    side: isOutline ? THREE.BackSide : THREE.FrontSide,
  });
}

function makeRimOnlyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRimColor:    { value: new THREE.Color(0.4, 0.6, 1.0) },
      uRimStrength: { value: 0.6 },
    },
    vertexShader: RIM_ONLY_VERT,
    fragmentShader: RIM_ONLY_FRAG,
  });
}

const AdditiveBlendShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom:   { value: null },
  },
  vertexShader: ADDITIVE_VERT,
  fragmentShader: ADDITIVE_FRAG,
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 10,
    }}>
      <div style={{
        width: 40, height: 40, border: '4px solid #333',
        borderTop: '4px solid #5566ff', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorOverlay({ message, onRetry }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: 16,
    }}>
      <span style={{ color: '#ff4455', fontSize: 16 }}>
        Failed to load GLB: {message}
      </span>
      <button onClick={onRetry} style={{
        padding: '6px 16px', background: '#222244', border: '1px solid #ff4455',
        borderRadius: 4, color: '#eee', cursor: 'pointer',
      }}>
        Retry
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CellShadedViewer({ glbUrl }) {
  // React state (drives UI re-renders)
  const [shaderMode, setShaderMode] = useState('toon');
  const [timeOfDay, setTimeOfDay] = useState(12);
  const [giStrength, setGiStrength] = useState(0.4);
  const [animations, setAnimations] = useState([]);
  const [currentClip, setCurrentClip] = useState('');
  const [playing, setPlaying] = useState(true);
  const [animSpeed, setAnimSpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Stage 2 state
  const [dragActive, setDragActive] = useState(false);
  const [dropZoneVisible, setDropZoneVisible] = useState(!glbUrl);
  const [exporting, setExporting] = useState(false);
  const [hasModel, setHasModel] = useState(false);

  // Refs (mutable values read inside the rAF loop)
  const container = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const composerRef = useRef(null);
  const dirLightRef = useRef(null);
  const ambLightRef = useRef(null);
  const modelRef = useRef(null);
  const mixerRef = useRef(null);
  const rafRef = useRef(null);
  const wasdRef = useRef(null);
  const shaderModeRef = useRef('toon');
  const timeOfDayRef = useRef(12);
  const clipsRef = useRef([]);
  const activeActionRef = useRef(null);

  // Stage 2 refs
  const objectUrlRef = useRef(null);
  const fileInputRef = useRef(null);
  const groundPlaneRef = useRef(null);
  const groundMatRef = useRef(null);
  const rimTargetRef = useRef(null);
  const bloomComposerRef = useRef(null);
  const blendPassRef = useRef(null);
  const rimOnlyMatRef = useRef(null);

  // ── Sync state → refs ──────────────────────────────────────────────────────

  useEffect(() => { shaderModeRef.current = shaderMode; }, [shaderMode]);
  useEffect(() => { timeOfDayRef.current = timeOfDay; }, [timeOfDay]);
  useEffect(() => {
    if (ambLightRef.current) ambLightRef.current.intensity = giStrength;
  }, [giStrength]);
  useEffect(() => {
    if (mixerRef.current) mixerRef.current.timeScale = animSpeed;
  }, [animSpeed]);

  // ── Light calculation ──────────────────────────────────────────────────────

  const updateLightFromTimeOfDay = useCallback(() => {
    const t = timeOfDayRef.current;
    const elevation = ((t / 24) * 360 - 90) * (Math.PI / 180);
    const azimuth = 45 * (Math.PI / 180);
    const x = Math.cos(elevation) * Math.sin(azimuth);
    const y = Math.sin(elevation);
    const z = Math.cos(elevation) * Math.cos(azimuth);
    dirLightRef.current.position.set(x * 10, y * 10, z * 10);

    const elevDeg = elevation * (180 / Math.PI);
    const fade = Math.max(0, Math.min(1, (elevDeg + 10) / 10));
    dirLightRef.current.intensity = 1.5 * fade;

    // Stage 2: update shadow camera and fade ground shadow
    dirLightRef.current.shadow.camera.updateProjectionMatrix();
    if (groundMatRef.current) {
      groundMatRef.current.opacity = 0.35 * fade;
    }
  }, []);

  // ── Shader uniform update ─────────────────────────────────────────────────

  const updateShaderUniforms = useCallback(() => {
    if (!modelRef.current) return;
    const L = dirLightRef.current.position.clone().normalize();
    const intensity = dirLightRef.current.intensity;
    const ambient = ambLightRef.current.intensity;
    modelRef.current.traverse((child) => {
      if (!child.isMesh) return;
      const mat = child.material;
      if (mat?.uniforms?.uLightDir) {
        mat.uniforms.uLightDir.value.copy(L);
        mat.uniforms.uLightIntensity.value = intensity;
        mat.uniforms.uAmbient.value = ambient;
      }
    });
  }, []);

  // ── Bloom helpers ──────────────────────────────────────────────────────────

  const setupBloomComposer = useCallback(() => {
    const renderer = rendererRef.current;
    const W = renderer.domElement.width;
    const H = renderer.domElement.height;

    const rimTarget = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    rimTargetRef.current = rimTarget;

    const bloomComposer = new EffectComposer(renderer, rimTarget);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(sceneRef.current, cameraRef.current));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(W, H),
      1.2,  // strength
      0.4,  // radius
      0.9   // threshold
    );
    bloomComposer.addPass(bloomPass);
    bloomComposerRef.current = bloomComposer;
  }, []);

  const addBloomCompositePass = useCallback(() => {
    const blendPass = new ShaderPass(AdditiveBlendShader);
    blendPass.uniforms['tBloom'].value = bloomComposerRef.current.renderTarget2.texture;
    blendPass.renderToScreen = true;
    composerRef.current.addPass(blendPass);
    blendPassRef.current = blendPass;
  }, []);

  const teardownBloom = useCallback(() => {
    rimTargetRef.current?.dispose();
    rimTargetRef.current = null;
    bloomComposerRef.current = null;
    if (blendPassRef.current) {
      const passes = composerRef.current.passes;
      const idx = passes.indexOf(blendPassRef.current);
      if (idx !== -1) passes.splice(idx, 1);
      blendPassRef.current = null;
    }
  }, []);

  const applyTemporaryMaterials = useCallback((mat) => {
    modelRef.current?.traverse((child) => {
      if (child.isMesh && !child.userData.isOutlineMesh) {
        child.userData._savedMat = child.material;
        child.material = mat;
      }
    });
  }, []);

  const restoreAnimeMaterials = useCallback(() => {
    modelRef.current?.traverse((child) => {
      if (child.isMesh && child.userData._savedMat) {
        child.material = child.userData._savedMat;
        delete child.userData._savedMat;
      }
    });
  }, []);

  // ── Ground plane helper ────────────────────────────────────────────────────

  const updateGroundPlane = useCallback((mode) => {
    const plane = groundPlaneRef.current;
    const scene = sceneRef.current;
    if (!plane || !scene) return;

    const shouldShow = mode === 'toon' || mode === 'anime';
    const inScene = scene.getObjectByName('shadowGroundPlane') !== undefined;

    if (shouldShow && !inScene) scene.add(plane);
    if (!shouldShow && inScene) scene.remove(plane);

    if (dirLightRef.current) dirLightRef.current.castShadow = shouldShow;
  }, []);

  // ── Shader mode application ────────────────────────────────────────────────

  const applyShaderMode = useCallback((mode, model) => {
    // Stage 2: tear down bloom before rebuilding passes
    teardownBloom();

    model.traverse((child) => {
      if (!child.isMesh) return;
      const src = child.userData.originalMaterial ?? child.material;
      child.userData.originalMaterial = src;

      // Remove any previous anime outline twin
      if (child.userData.outlineMesh) {
        child.userData.outlineMesh.parent?.remove(child.userData.outlineMesh);
        child.userData.outlineMesh.geometry = undefined;
        child.userData.outlineMesh = null;
      }

      if (mode === 'flat') {
        child.material = makeFlatMaterial(src);
      } else if (mode === 'toon') {
        child.material = makeToonMaterial(src);
      } else if (mode === 'anime') {
        child.material = makeAnimeMaterial(src, false);

        // Outline twin — shares geometry, no extra GPU memory
        const outlineMat = makeAnimeMaterial(src, true);
        const outlineMesh = new THREE.Mesh(child.geometry, outlineMat);
        outlineMesh.renderOrder = -1;
        outlineMesh.userData.isOutlineMesh = true;
        child.add(outlineMesh);
        child.userData.outlineMesh = outlineMesh;
      }
    });

    // OutlinePass (Toon only — anime uses geometry twin)
    const composer = composerRef.current;
    if (composer.passes.length > 1) {
      composer.passes.splice(1, composer.passes.length - 1);
    }
    if (mode === 'toon') {
      const outlinePass = new OutlinePass(
        new THREE.Vector2(
          rendererRef.current.domElement.width,
          rendererRef.current.domElement.height
        ),
        sceneRef.current,
        cameraRef.current
      );
      outlinePass.edgeStrength = 4.0;
      outlinePass.edgeThickness = 1.0;
      outlinePass.visibleEdgeColor.set('#000000');
      const selected = [];
      model.traverse((c) => { if (c.isMesh) selected.push(c); });
      outlinePass.selectedObjects = selected;
      composer.addPass(outlinePass);
    }

    // Stage 2: bloom for anime mode
    if (mode === 'anime') {
      if (!rimOnlyMatRef.current) rimOnlyMatRef.current = makeRimOnlyMaterial();
      setupBloomComposer();
      addBloomCompositePass();
    }

    // Stage 2: shadow ground plane
    updateGroundPlane(mode);
  }, [teardownBloom, setupBloomComposer, addBloomCompositePass, updateGroundPlane]);

  // ── Render frame (mode-aware) ──────────────────────────────────────────────

  const renderFrame = useCallback(() => {
    if (shaderModeRef.current === 'anime' && bloomComposerRef.current) {
      // Swap every mesh to rim-only material
      applyTemporaryMaterials(rimOnlyMatRef.current);
      // Render rim-only scene into rimTarget
      bloomComposerRef.current.render();
      // Restore anime materials
      restoreAnimeMaterials();
      // Render full scene + additive bloom composite
      composerRef.current.render();
    } else {
      composerRef.current.render();
    }
  }, [applyTemporaryMaterials, restoreAnimeMaterials]);

  // ── Animation helpers ──────────────────────────────────────────────────────

  const playClip = useCallback((clip, mixer) => {
    if (activeActionRef.current) {
      activeActionRef.current.fadeOut(0.2);
    }
    const action = mixer.clipAction(clip);
    action.reset().fadeIn(0.2).play();
    activeActionRef.current = action;
    setCurrentClip(clip.name);
    setPlaying(true);
  }, []);

  const switchClip = useCallback((name) => {
    const clip = clipsRef.current.find((c) => c.name === name);
    if (clip && mixerRef.current) {
      playClip(clip, mixerRef.current);
    }
  }, [playClip]);

  const togglePlay = useCallback(() => {
    if (!activeActionRef.current) return;
    if (playing) {
      activeActionRef.current.paused = true;
      setPlaying(false);
    } else {
      activeActionRef.current.paused = false;
      setPlaying(true);
    }
  }, [playing]);

  // ── Clear model (Stage 2) ─────────────────────────────────────────────────

  const clearModel = useCallback(() => {
    if (!modelRef.current) return;
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }
    modelRef.current.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
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
    activeActionRef.current = null;
    setAnimations([]);
    setCurrentClip('');
    setHasModel(false);
  }, []);

  // ── Model loading ──────────────────────────────────────────────────────────

  const loadModel = useCallback((url) => {
    setLoading(true);
    setLoadError(null);
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        // Remove previous model if any
        if (modelRef.current) {
          clearModel();
        }

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

        // Stage 2: enable shadow casting on model meshes
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
          }
        });

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
          clipsRef.current = gltf.animations;
          setAnimations(gltf.animations.map((a) => a.name));
          playClip(gltf.animations[0], mixer);
        } else {
          setAnimations([]);
          mixerRef.current = null;
          clipsRef.current = [];
        }

        setLoading(false);
        setHasModel(true);
      },
      undefined,
      (err) => {
        setLoadError(err.message || String(err));
        setLoading(false);
      }
    );
  }, [applyShaderMode, playClip, clearModel]);

  // ── Drag-and-drop handler (Stage 2) ────────────────────────────────────────

  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0] ?? e.target?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.glb')) {
      setLoadError('Only .glb files are supported.');
      return;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    clearModel();
    loadModel(url);
    setDropZoneVisible(false);
  }, [clearModel, loadModel]);

  // ── Export handler (Stage 2) ───────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    setExporting(true);
    setTimeout(() => setExporting(false), 400);

    // Force one render to ensure the buffer is current
    renderFrame();

    const dataUrl = renderer.domElement.toDataURL('image/png');

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      + `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `cellshade-export-${ts}.png`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [renderFrame]);

  // ── Scene bootstrap (runs once) ────────────────────────────────────────────

  useEffect(() => {
    const el = container.current;
    const W = el.clientWidth;
    const H = el.clientHeight;

    // Renderer — Stage 2: preserveDrawingBuffer for export, shadowMap enabled
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    el.appendChild(renderer.domElement);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.01, 1000);
    camera.position.set(0, 1, 3);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Lights — Stage 2: shadow camera on directional light
    const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.5);
    dirLight.position.set(5, 5, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -3;
    dirLight.shadow.camera.right = 3;
    dirLight.shadow.camera.top = 3;
    dirLight.shadow.camera.bottom = -3;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    const ambLight = new THREE.AmbientLight(0x8888cc, 0.4);
    scene.add(ambLight);

    // Stage 2: shadow ground plane (created once, added/removed per shader mode)
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35, transparent: true });
    const groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = 0;
    groundPlane.receiveShadow = true;
    groundPlane.name = 'shadowGroundPlane';
    groundPlaneRef.current = groundPlane;
    groundMatRef.current = groundMat;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);

    // Post-process composer
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // Store refs
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    composerRef.current = composer;
    dirLightRef.current = dirLight;
    ambLightRef.current = ambLight;

    // Load model if glbUrl provided
    if (glbUrl) {
      loadModel(glbUrl);
    }

    // WASD keys
    const keys = {};
    const onDown = (e) => { keys[e.code] = true; };
    const onUp = (e) => { keys[e.code] = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);

    wasdRef.current = () => {
      const speed = 0.05;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DefaultUp).normalize();

      if (keys['KeyW']) { controls.target.addScaledVector(fwd, speed); camera.position.addScaledVector(fwd, speed); }
      if (keys['KeyS']) { controls.target.addScaledVector(fwd, -speed); camera.position.addScaledVector(fwd, -speed); }
      if (keys['KeyA']) { controls.target.addScaledVector(right, -speed); camera.position.addScaledVector(right, -speed); }
      if (keys['KeyD']) { controls.target.addScaledVector(right, speed); camera.position.addScaledVector(right, speed); }
    };

    // Resize observer — Stage 2: also resize bloom targets
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        renderer.setSize(width, height);
        composer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (rimTargetRef.current) {
          rimTargetRef.current.setSize(width, height);
        }
        if (bloomComposerRef.current) {
          bloomComposerRef.current.setSize(width, height);
        }
      }
    });
    ro.observe(el);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      wasdRef.current?.();
      controls.update();
      if (mixerRef.current) mixerRef.current.update(delta);
      updateLightFromTimeOfDay();
      updateShaderUniforms();

      // Stage 2: mode-aware rendering (bloom composite for anime)
      if (shaderModeRef.current === 'anime' && bloomComposerRef.current && modelRef.current) {
        applyTemporaryMaterials(rimOnlyMatRef.current);
        bloomComposerRef.current.render();
        restoreAnimeMaterials();
        composerRef.current.render();
      } else {
        composerRef.current.render();
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0d0d1a', color: '#eee', fontFamily: 'sans-serif',
    }}>
      {/* Top bar — Stage 2: added Export button */}
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', padding: '0 16px',
        background: '#111122', borderBottom: '1px solid #333', flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#aabbff', letterSpacing: '0.05em' }}>
          GLB Viewer — Cell Shaded
        </span>
        <button
          onClick={handleExport}
          title="Export current frame as PNG"
          style={{
            marginLeft: 'auto',
            background: exporting ? '#5566ff' : '#222244',
            border: '1px solid #5566ff',
            borderRadius: 6,
            color: '#eee',
            padding: '5px 14px',
            cursor: 'pointer',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.15s',
          }}
        >
          {'\uD83D\uDCF7'} Export
        </button>
      </div>

      {/* Canvas container */}
      <div ref={container} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading && <Spinner />}
        {loadError && <ErrorOverlay message={loadError} onRetry={() => {
          setLoadError(null);
          if (objectUrlRef.current) loadModel(objectUrlRef.current);
          else if (glbUrl) loadModel(glbUrl);
        }} />}

        {/* Stage 2: Drop zone overlay */}
        {dropZoneVisible && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop a GLB file or click to browse"
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: dragActive ? 'rgba(40,40,100,0.95)' : 'rgba(17,17,34,0.92)',
              border: `2px dashed ${dragActive ? '#88aaff' : '#5566ff'}`,
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
              zIndex: 10,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 48 }}>{'\u2B07'}</span>
            <span style={{ fontSize: 18, color: '#eee' }}>Drop a .glb file here</span>
            <span style={{ fontSize: 13, color: '#aaa' }}>or click to browse</span>
          </div>
        )}

        {/* Stage 2: Replace model link (visible when model loaded and drop zone hidden) */}
        {hasModel && !dropZoneVisible && (
          <button
            onClick={() => { setDropZoneVisible(true); }}
            aria-label="Replace loaded model"
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5,
              background: 'rgba(17,17,34,0.7)', border: '1px solid #5566ff',
              borderRadius: 4, color: '#aabbff', cursor: 'pointer',
              padding: '3px 10px', fontSize: 11,
            }}
          >
            {'\uD83D\uDCC2'} Replace model
          </button>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb"
          style={{ display: 'none' }}
          onChange={handleFileDrop}
        />
      </div>

      {/* Controls panel */}
      <div style={{
        height: 120, display: 'flex', alignItems: 'center', padding: '0 24px',
        gap: 32, background: '#111122', borderTop: '1px solid #333', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* Time of Day */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Time of Day: {timeOfDay.toFixed(1)}h</span>
          <input type="range" min={0} max={24} step={0.1}
            value={timeOfDay} onChange={(e) => setTimeOfDay(+e.target.value)}
            style={{ width: 160, accentColor: '#5566ff' }} />
        </label>

        {/* Global Illumination */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Global Illum: {giStrength.toFixed(2)}</span>
          <input type="range" min={0} max={3} step={0.01}
            value={giStrength} onChange={(e) => setGiStrength(+e.target.value)}
            style={{ width: 160, accentColor: '#5566ff' }} />
        </label>

        {/* Shader Mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Shader Mode</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {['flat', 'toon', 'anime'].map((m) => (
              <button key={m} onClick={() => {
                setShaderMode(m);
                if (modelRef.current) applyShaderMode(m, modelRef.current);
              }}
                style={{
                  padding: '4px 12px',
                  background: shaderMode === m ? '#5566ff' : '#222244',
                  border: '1px solid #5566ff', borderRadius: 4,
                  color: '#eee', cursor: 'pointer', textTransform: 'capitalize',
                  fontSize: 13,
                }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Animation controls */}
        {animations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Animation</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={currentClip} onChange={(e) => switchClip(e.target.value)}
                style={{
                  background: '#222244', color: '#eee', border: '1px solid #5566ff',
                  borderRadius: 4, padding: '2px 8px', fontSize: 13,
                }}>
                {animations.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button onClick={togglePlay}
                style={{
                  background: '#222244', border: '1px solid #5566ff', borderRadius: 4,
                  color: '#eee', cursor: 'pointer', padding: '4px 10px', fontSize: 14,
                }}>
                {playing ? '\u23F8' : '\u25B6'}
              </button>
              <input type="range" min={0.1} max={3} step={0.05}
                value={animSpeed} onChange={(e) => setAnimSpeed(+e.target.value)}
                style={{ width: 80, accentColor: '#5566ff' }} />
              <span style={{ fontSize: 12 }}>{animSpeed.toFixed(2)}x</span>
            </div>
          </div>
        )}

        {animations.length === 0 && !loading && !loadError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Animation</span>
            <span style={{ fontSize: 12, color: '#666' }}>(none)</span>
          </div>
        )}
      </div>
    </div>
  );
}
