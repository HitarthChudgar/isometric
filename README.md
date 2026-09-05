# Isometric

A Figma plugin that projects selected 2D layers into 2.5D isometric views. Set a custom angle, pick a direction, preview the result, then apply. Reset flattens the layer back to 2D in place.

## Features

- Custom angle (default 30°)
- Four projections: Top left, Top right, Left, Right
- Live preview of the current selection before apply
- Multi-selection support
- Visual-center correction so layers transform in place
- Reset transform back to a flat identity matrix

## Install in Figma

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. In the Figma desktop app: **Plugins → Development → Import plugin from manifest…**
3. Select `manifest.json` in this folder.
4. Select one or more layers, then run **Isometric 2.5D**.

Local / Development plugins always show Figma’s default `</>` icon. A custom mark is uploaded as `icon-128.png` when you publish.

## Usage

1. Select a layer (or several).
2. Set **Angle**.
3. Hover or focus a direction to preview the projection.
4. Click a direction to apply it to the selection.
5. **Reset transform** flattens the layer back to 2D.

If nothing is selected, the plugin notifies: `Please select a layer to transform.`

## Develop

```bash
npm install
npm run watch    # rebuild code.js on save
npm run lint
```

Figma runs `code.js`. Reload the plugin after UI or build changes.

| File                        | Role                                                |
| --------------------------- | --------------------------------------------------- |
| `manifest.json`             | Plugin metadata                                     |
| `code.ts`                   | Main thread: selection, SSR matrices, apply / reset |
| `ui.html`                   | Panel UI, preview, and message passing              |
| `icon.svg` / `icon-128.png` | Publish assets (not used by the local manifest)     |

## How the math works

The angle is converted to radians. Each direction is a Scale–Skew–Rotate matrix written to `node.relativeTransform`. The visual bounding-box center is measured before and after, then `x` / `y` are adjusted so the layer does not jump.
