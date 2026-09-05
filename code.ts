figma.showUI(__html__, {
  width: 260,
  height: 328,
  themeColors: true,
  title: "Isometric",
});

type Direction = "top-left" | "top-right" | "left" | "right";
type LinearMatrix = [[number, number], [number, number]];

interface TransformMessage {
  type: "transform";
  angle: number;
  direction: Direction;
}

interface ResetMessage {
  type: "reset";
}

interface ReadyMessage {
  type: "ready";
}

type PluginMessage = TransformMessage | ResetMessage | ReadyMessage;

type TransformableNode = SceneNode & LayoutMixin;

function isTransformable(node: SceneNode): node is TransformableNode {
  return "relativeTransform" in node && "x" in node && "y" in node;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function multiplyLinear(a: LinearMatrix, b: LinearMatrix): LinearMatrix {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
    ],
  ];
}

function scaleMatrix(sx: number, sy: number): LinearMatrix {
  return [
    [sx, 0],
    [0, sy],
  ];
}

function skewMatrix(kx: number, ky: number): LinearMatrix {
  return [
    [1, kx],
    [ky, 1],
  ];
}

function rotateMatrix(radians: number): LinearMatrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

function composeSSR(
  sx: number,
  sy: number,
  kx: number,
  ky: number,
  rotation: number,
): LinearMatrix {
  return multiplyLinear(
    rotateMatrix(rotation),
    multiplyLinear(skewMatrix(kx, ky), scaleMatrix(sx, sy)),
  );
}

function safeCot(theta: number): number {
  const sin = Math.sin(theta);
  if (Math.abs(sin) < 1e-8) {
    return 0;
  }
  return Math.cos(theta) / sin;
}

function safeTan(theta: number): number {
  const cos = Math.cos(theta);
  if (Math.abs(cos) < 1e-8) {
    return 0;
  }
  return Math.sin(theta) / cos;
}

function buildDirectionalMatrix(
  direction: Direction,
  angle: number,
): LinearMatrix {
  const theta = toRadians(angle);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tan = safeTan(theta);
  const cot = safeCot(theta);

  switch (direction) {
    case "top-left":
      // Scale(cos, sin) × Skew(−cot, +tan) → [[cos, −cos], [sin, sin]]
      return composeSSR(cos, sin, -cot, tan, 0);
    case "top-right":
      // Scale(cos, sin) × Skew(+cot, −tan) → [[cos, cos], [−sin, sin]]
      return composeSSR(cos, sin, cot, -tan, 0);
    case "left":
      // Scale(cos, 1) × Skew(0, +tan) keeps height and shears horizontally.
      return composeSSR(cos, 1, 0, tan, 0);
    case "right":
      // Scale(cos, 1) × Skew(0, −tan) reverses the horizontal projection.
      return composeSSR(cos, 1, 0, -tan, 0);
    default: {
      const _exhaustive: never = direction;
      return _exhaustive;
    }
  }
}

function getVisualCenter(
  node: TransformableNode,
): { x: number; y: number } | null {
  const box = node.absoluteBoundingBox;
  if (!box) {
    return null;
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function applyWorldDelta(
  node: TransformableNode,
  worldDx: number,
  worldDy: number,
): void {
  const parent = node.parent;
  if (
    !parent ||
    parent.type === "PAGE" ||
    parent.type === "DOCUMENT" ||
    !("absoluteTransform" in parent)
  ) {
    node.x += worldDx;
    node.y += worldDy;
    return;
  }

  const parentTransform = parent.absoluteTransform;
  const det =
    parentTransform[0][0] * parentTransform[1][1] -
    parentTransform[0][1] * parentTransform[1][0];
  if (Math.abs(det) < 1e-10) {
    node.x += worldDx;
    node.y += worldDy;
    return;
  }

  node.x +=
    (parentTransform[1][1] * worldDx - parentTransform[0][1] * worldDy) / det;
  node.y +=
    (-parentTransform[1][0] * worldDx + parentTransform[0][0] * worldDy) / det;
}

function preserveVisualCenter(
  node: TransformableNode,
  before: { x: number; y: number } | null,
): void {
  if (!before) {
    return;
  }
  const after = getVisualCenter(node);
  if (!after) {
    return;
  }
  applyWorldDelta(node, before.x - after.x, before.y - after.y);
}

function applyLinearTransform(
  node: TransformableNode,
  linear: LinearMatrix,
): void {
  const before = getVisualCenter(node);
  const current = node.relativeTransform;
  node.relativeTransform = [
    [linear[0][0], linear[0][1], current[0][2]],
    [linear[1][0], linear[1][1], current[1][2]],
  ];
  preserveVisualCenter(node, before);
}

function flattenNode(node: TransformableNode): void {
  const before = getVisualCenter(node);
  const originalX = node.x;
  const originalY = node.y;
  node.relativeTransform = [
    [1, 0, originalX],
    [0, 1, originalY],
  ];
  preserveVisualCenter(node, before);
}

function selectedTransformableNodes(): TransformableNode[] {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify("Please select a layer to transform.");
    return [];
  }

  const nodes: TransformableNode[] = [];
  for (const node of selection) {
    if (isTransformable(node) && !node.locked) {
      nodes.push(node);
    }
  }

  if (nodes.length === 0) {
    figma.notify("Please select a layer to transform.");
  }

  return nodes;
}

let previewToken = 0;

async function pushSelectionPreview(): Promise<void> {
  const token = ++previewToken;
  const selection = figma.currentPage.selection;
  let node: SceneNode | null = null;
  for (const candidate of selection) {
    if (isTransformable(candidate)) {
      node = candidate;
      break;
    }
  }

  if (!node) {
    figma.ui.postMessage({ type: "selection-preview", bytes: null });
    return;
  }

  try {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: 240 },
    });
    if (token !== previewToken) {
      return;
    }
    figma.ui.postMessage({ type: "selection-preview", bytes });
  } catch {
    if (token !== previewToken) {
      return;
    }
    figma.ui.postMessage({ type: "selection-preview", bytes: null });
  }
}

figma.on("selectionchange", () => {
  void pushSelectionPreview();
});

figma.ui.onmessage = (msg: PluginMessage) => {
  if (msg.type === "ready") {
    void pushSelectionPreview();
    return;
  }

  const nodes = selectedTransformableNodes();
  if (nodes.length === 0) {
    return;
  }

  if (msg.type === "reset") {
    for (const node of nodes) {
      try {
        flattenNode(node);
      } catch {
        // Skip nodes that reject transform writes (for example, locked instance children).
      }
    }
    return;
  }

  if (msg.type === "transform") {
    const angle = Number.isFinite(msg.angle) ? msg.angle : 30;
    const linear = buildDirectionalMatrix(msg.direction, angle);
    for (const node of nodes) {
      try {
        applyLinearTransform(node, linear);
      } catch {
        // Skip nodes that reject transform writes (for example, locked instance children).
      }
    }
  }
};
