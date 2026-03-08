# Cell-Shaded GLB Viewer

A browser-based 3D model viewer that renders `.glb` files in real-time stylised shader modes — flat, toon, and anime/cel-shaded. Load any GLB character or prop, play its animations, adjust lighting, and switch between non-photorealistic rendering styles instantly.

**Live Web:** [https://scuffedepoch.com/cell-shaded-glb/](https://scuffedepoch.com/cell-shaded-glb/)

## Shader Modes

**Flat** — Removes all lighting. Every surface displays its raw texture colour, producing a clean, illustration-like look.

**Toon** — Classic cel shading with three light bands (shadow, mid, highlight) and a black silhouette outline. Gives models a Saturday-morning-cartoon feel.

**Anime** — Full anime/cel rendering with five-band shading, a sharp specular hotspot, coloured rim lighting, and thick ink outlines with depth-aware line weight. The most stylised option.

All three modes respond to the scene lighting in real time — moving the time-of-day slider visibly shifts shadows and highlights across the model.

## Controls

### Camera

| Input | Action |
|---|---|
| Left-click drag | Orbit around the model |
| Scroll wheel | Zoom in / out |
| W / A / S / D | Pan the camera forward, left, back, right |

### Bottom Panel

| Control | What it does |
|---|---|
| **Time of Day** slider | Sweeps the directional light through a full day cycle (0h–24h). The light fades naturally at dawn/dusk and disappears at night. |
| **Global Illum** slider | Sets ambient light intensity from 0 (pitch black shadows) to 3 (fully lit from all directions). Default is 0.4. |
| **Shader Mode** buttons | Switches between Flat, Toon, and Anime rendering. The change is instant — no reload needed. |
| **Animation** dropdown | Lists all animation clips embedded in the GLB file. Selecting a clip cross-fades to it over 0.2 seconds. |
| **Play / Pause** button | Pauses or resumes the current animation. |
| **Speed** slider | Adjusts animation playback speed from 0.1x to 3x. |

If the loaded model has no animations, the animation controls are hidden automatically.

## Usage

Mount the component and pass a URL to any `.glb` file:

```jsx
<CellShadedViewer glbUrl="https://example.com/my-character.glb" />
```

If no URL is provided, it loads the [Three.js Soldier](https://threejs.org/examples/models/gltf/Soldier.glb) demo model by default.

The component fills the entire viewport. The 3D canvas takes up all available space above the fixed control panel at the bottom.

## Supported Models

- Any standard `.glb` (binary glTF 2.0) file
- Models with or without textures — untextured meshes render with a neutral grey
- Skinned meshes with skeleton animation
- Morph targets are preserved
- Models of any size are automatically scaled and centred to fit the viewport

## Error Handling

If a GLB file fails to load, an error message appears over the canvas with a **Retry** button. Check that the URL is accessible and points to a valid `.glb` file.

## License

MIT

## 📚 Citation

### Academic Citation

If you use this codebase in your research or project, please cite:

```bibtex
@software{cell_shaded_glb,
  title = {Cell-Shaded GLB Viewer: Real-time stylised shader modes for GLB 3D models},
  author = {Drift Johnson},
  year = {2025},
  url = {https://github.com/MushroomFleet/cell-shaded-glb},
  version = {1.0.0}
}
```

### Donate:

[![Ko-Fi](https://cdn.ko-fi.com/cdn/kofi3.png?v=3)](https://ko-fi.com/driftjohnson)
