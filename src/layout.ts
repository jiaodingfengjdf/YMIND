import type {
  LayoutEdge,
  LayoutNode,
  LayoutResult,
  Sheet,
  Topic,
} from "./domain.ts";
import { themeColors } from "./model.ts";

interface Frame {
  topic: Topic;
  node: LayoutNode;
  parent?: Frame;
  children: Frame[];
  spanX: number;
  spanY: number;
  leaves: number;
  angle: number;
}

const GAP_X = 64;
const GAP_Y = 28;

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

function characters(text: string): string[] {
  return segmenter
    ? Array.from(segmenter.segment(text), (item) => item.segment)
    : Array.from(text);
}

function widthOf(character: string, size: number): number {
  if (/\s/.test(character)) return size * 0.34;
  if (/^[ilI.,:;!|'`]$/.test(character)) return size * 0.3;
  if (/^[MW@#%]$/.test(character)) return size * 0.85;
  return character.codePointAt(0)! > 0x2ff ? size : size * 0.57;
}

/** Shared by live and exported renderers; preserves lines and complete Unicode graphemes. */
export function wrapText(
  text: string,
  maximumWidth: number,
  fontSize: number,
): string[] {
  const lines: string[] = [];
  const available = Math.max(fontSize, maximumWidth);
  for (const explicit of text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")) {
    let line = "";
    let currentWidth = 0;
    for (const character of characters(explicit)) {
      const width = widthOf(character, fontSize);
      if (line && currentWidth + width > available) {
        lines.push(line);
        line = "";
        currentWidth = 0;
      }
      line += character;
      currentWidth += width;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export interface TopicMeasurement {
  width: number;
  height: number;
  fontSize: number;
  titleLines: string[];
  markerLines: string[];
  taskLines: string[];
  labelLines: string[];
}

/** Single geometry owner for layout, live UI, and SVG export. All media rows include their gaps. */
export function measureTopic(
  topic: Topic,
  depth: number,
  titleOverride = topic.title,
): TopicMeasurement {
  const requested = topic.style?.fontSize ?? (depth === 0 ? 24 : 16);
  const fontSize = Number.isFinite(requested)
    ? Math.min(48, Math.max(10, requested))
    : 16;
  const explicitLines = titleOverride
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const lineWidths = explicitLines.map((line) =>
    characters(line).reduce(
      (width, character) => width + widthOf(character, fontSize),
      0,
    ),
  );
  const width = Math.ceil(
    Math.min(
      220,
      Math.max(
        depth === 0 ? 164 : depth === 1 ? 126 : 82,
        ...lineWidths.map((lineWidth) => lineWidth + 24),
      ),
    ),
  );
  const available = Math.max(20, width - 24);
  const titleLines = wrapText(titleOverride, available, fontSize);
  const markerLines = topic.markers?.length
    ? wrapText(topic.markers.join(" "), available, 14)
    : [];
  const details = topic.task
    ? [
        topic.task.start,
        topic.task.end ? `→ ${topic.task.end}` : undefined,
        topic.task.assignee,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const taskLines = details ? wrapText(details, available, 10) : [];
  const labelLines = topic.labels?.length
    ? wrapText(
        topic.labels.map((label) => `#${label}`).join(" "),
        available,
        11,
      )
    : [];
  // Image: 8 + 84 + 8. Equation: 8 + up to 48 + 4. Task: label/checkbox + meter + gap.
  const contentHeight =
    24 +
    titleLines.length * fontSize * 1.35 +
    (topic.image ? 100 : 0) +
    (topic.equation?.trim() ? 60 : 0) +
    markerLines.length * 20 +
    labelLines.length * 20 +
    (topic.task ? 30 + taskLines.length * 14 : 0);
  const height = Math.ceil(
    Math.max(depth === 0 ? 68 : depth === 1 ? 54 : 36, contentHeight),
  );
  return {
    width,
    height,
    fontSize,
    titleLines,
    markerLines,
    taskLines,
    labelLines,
  };
}

function center(frame: Frame): { x: number; y: number } {
  const node = frame.node;
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function position(
  frame: Frame,
  centerX: number,
  centerY: number,
  side: LayoutNode["side"],
): void {
  frame.node.x = centerX - frame.node.width / 2;
  frame.node.y = centerY - frame.node.height / 2;
  frame.node.side = side;
}

function sum(values: number[], gap: number): number {
  return (
    values.reduce((total, value) => total + value, 0) +
    Math.max(0, values.length - 1) * gap
  );
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function cubic(
  ax: number,
  ay: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  bx: number,
  by: number,
): string {
  return `M ${round(ax)} ${round(ay)} C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(bx)} ${round(by)}`;
}

function horizontalEdge(parent: Frame, child: Frame): string {
  const a = center(parent);
  const b = center(child);
  const sign = child.node.side === "left" ? -1 : 1;
  const ax = a.x + (sign * parent.node.width) / 2;
  const bx = b.x - (sign * child.node.width) / 2;
  const mid = (ax + bx) / 2;
  return cubic(ax, a.y, mid, a.y, mid, b.y, bx, b.y);
}

function verticalEdge(parent: Frame, child: Frame): string {
  const a = center(parent);
  const b = center(child);
  const sign = b.y < a.y ? -1 : 1;
  const ay = a.y + (sign * parent.node.height) / 2;
  const by = b.y - (sign * child.node.height) / 2;
  const mid = (ay + by) / 2;
  return cubic(a.x, ay, a.x, mid, b.x, mid, b.x, by);
}

/** Intersects the ray towards another node with this node's rectangle. */
function rayAnchor(
  frame: Frame,
  towards: { x: number; y: number },
): { x: number; y: number } {
  const point = center(frame);
  const dx = towards.x - point.x;
  const dy = towards.y - point.y;
  const divisor = Math.max(
    Math.abs(dx) / (frame.node.width / 2),
    Math.abs(dy) / (frame.node.height / 2),
  );
  return divisor
    ? { x: point.x + dx / divisor, y: point.y + dy / divisor }
    : point;
}

function radialEdge(parent: Frame, child: Frame): string {
  const a = rayAnchor(parent, center(child));
  const b = rayAnchor(child, center(parent));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return cubic(
    a.x,
    a.y,
    a.x + dx * 0.45,
    a.y + dy * 0.15,
    b.x - dx * 0.45,
    b.y - dy * 0.15,
    b.x,
    b.y,
  );
}

/** Node x/y are rectangle top-left coordinates; the root center is the world origin. */
export function computeLayout(sheet: Sheet): LayoutResult {
  const palette = themeColors(sheet.theme);
  const frames: Frame[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  function build(
    topic: Topic,
    depth: number,
    color: string,
    parent?: Frame,
    numberPath: number[] = [],
  ): Frame {
    const prefix = numberingPrefix(sheet.numbering, numberPath);
    const title = prefix + topic.title;
    const measured = measureTopic(topic, depth, title);
    const size = { width: measured.width, height: measured.height };
    const node: LayoutNode = {
      id: topic.id,
      title,
      topic,
      parentId: parent?.topic.id,
      x: -size.width / 2,
      y: -size.height / 2,
      ...size,
      depth,
      color: topic.style?.color || color,
      side: "center",
    };
    const frame: Frame = {
      topic,
      node,
      parent,
      children: [],
      spanX: size.width,
      spanY: size.height,
      leaves: 1,
      angle: 0,
    };
    frames.push(frame);
    widths[depth] = Math.max(widths[depth] ?? 0, size.width);
    heights[depth] = Math.max(heights[depth] ?? 0, size.height);
    if (!topic.collapsed)
      frame.children = topic.children
        .map((child, index) => ({ child, index }))
        .filter((entry) => depth > 0 || !entry.child.floating)
        .map(({ child, index }, ordinal) =>
          build(
            child,
            depth + 1,
            depth === 0 ? palette[index % palette.length] : node.color,
            frame,
            [...numberPath, ordinal + 1],
          ),
        );
    if (frame.children.length) {
      frame.spanX = Math.max(
        size.width,
        sum(
          frame.children.map((child) => child.spanX),
          GAP_Y,
        ),
      );
      frame.spanY = Math.max(
        size.height,
        sum(
          frame.children.map((child) => child.spanY),
          GAP_Y,
        ),
      );
      frame.leaves = frame.children.reduce(
        (total, child) => total + child.leaves,
        0,
      );
    }
    return frame;
  }
  const root = build(
    sheet.root,
    0,
    sheet.theme === "classic" ? "#1677ff" : palette[0],
  );

  function horizontal(
    branches: Frame[],
    side: "left" | "right",
    columnGap = GAP_X,
  ): void {
    const offsets: number[] = [];
    let offset = root.node.width / 2 + columnGap;
    for (let depth = 1; depth < widths.length; depth++) {
      offsets[depth] = offset;
      offset += widths[depth] + columnGap;
    }
    function place(frame: Frame, middleY: number): void {
      const node = frame.node;
      const middleX =
        (offsets[node.depth] + node.width / 2) * (side === "left" ? -1 : 1);
      position(frame, middleX, middleY, side);
      let cursor =
        middleY -
        sum(
          frame.children.map((child) => child.spanY),
          GAP_Y,
        ) /
          2;
      for (const child of frame.children) {
        place(child, cursor + child.spanY / 2);
        cursor += child.spanY + GAP_Y;
      }
    }
    let cursor =
      -sum(
        branches.map((frame) => frame.spanY),
        GAP_Y,
      ) / 2;
    for (const frame of branches) {
      place(frame, cursor + frame.spanY / 2);
      cursor += frame.spanY + GAP_Y;
    }
  }

  function localHeights(frame: Frame): number[] {
    const result: number[] = [];
    const stack: Array<{ frame: Frame; depth: number }> = [{ frame, depth: 0 }];
    while (stack.length) {
      const current = stack.pop()!;
      result[current.depth] = Math.max(
        result[current.depth] ?? 0,
        current.frame.node.height,
      );
      for (const child of current.frame.children)
        stack.push({ frame: child, depth: current.depth + 1 });
    }
    return result;
  }

  function vertical(
    branch: Frame,
    middleX: number,
    middleY: number,
    direction: 1 | -1,
    rowHeights: number[],
  ): void {
    const offsets = [0];
    for (let level = 1; level < rowHeights.length; level++)
      offsets[level] =
        offsets[level - 1] +
        rowHeights[level - 1] / 2 +
        GAP_X +
        rowHeights[level] / 2;
    function place(frame: Frame, x: number, level: number): void {
      position(
        frame,
        x,
        middleY + direction * offsets[level],
        x < -1 ? "left" : x > 1 ? "right" : "center",
      );
      let cursor =
        x -
        sum(
          frame.children.map((child) => child.spanX),
          GAP_Y,
        ) /
          2;
      for (const child of frame.children) {
        place(child, cursor + child.spanX / 2, level + 1);
        cursor += child.spanX + GAP_Y;
      }
    }
    place(branch, middleX, 0);
  }

  switch (sheet.layout) {
    case "mindmap": {
      const split = Math.ceil(root.children.length / 2);
      horizontal(root.children.slice(0, split), "left");
      horizontal(root.children.slice(split), "right");
      break;
    }
    case "right":
      horizontal(root.children, "right");
      break;
    case "left":
      horizontal(root.children, "left");
      break;
    case "brace": {
      // Bracket groups read top-to-bottom, with each heading preceding its nested rows.
      const spans = new Map<Frame, number>();
      function span(frame: Frame): number {
        const height =
          frame.node.height +
          frame.children.reduce((total, child) => total + span(child) + 16, 0);
        spans.set(frame, height);
        return height;
      }
      root.children.forEach(span);
      const columns: number[] = [];
      let x = root.node.width / 2 + 40;
      for (let depth = 1; depth < widths.length; depth++) {
        columns[depth] = x;
        x += widths[depth] + 40;
      }
      function place(frame: Frame, y: number): void {
        frame.node.x = columns[frame.node.depth];
        frame.node.y = y;
        frame.node.side = "right";
        let cursor = y + frame.node.height + 16;
        for (const child of frame.children) {
          place(child, cursor);
          cursor += spans.get(child)! + 16;
        }
      }
      let cursor =
        -sum(
          root.children.map((frame) => spans.get(frame)!),
          GAP_Y,
        ) / 2;
      for (const branch of root.children) {
        place(branch, cursor);
        cursor += spans.get(branch)! + GAP_Y;
      }
      break;
    }
    case "org":
      vertical(root, 0, 0, 1, heights);
      break;
    case "org-up":
      vertical(root, 0, 0, -1, heights);
      break;
    case "treetable": {
      const columns = [root.node.x];
      for (let depth = 1; depth < widths.length; depth++)
        columns[depth] = columns[depth - 1] + widths[depth - 1] + 24;
      let cursor = root.node.height / 2 + 16;
      for (const frame of frames.slice(1)) {
        frame.node.x = columns[frame.node.depth];
        frame.node.y = cursor;
        frame.node.side = "right";
        cursor += frame.node.height + 16;
      }
      break;
    }
    case "matrix": {
      const columns = Math.max(1, Math.ceil(Math.sqrt(root.children.length)));
      const blocks = root.children.map((branch) => {
        const entries: Array<{ frame: Frame; level: number }> = [];
        function visit(frame: Frame, level: number): void {
          entries.push({ frame, level });
          frame.children.forEach((child) => visit(child, level + 1));
        }
        visit(branch, 0);
        return {
          entries,
          width: Math.max(
            ...entries.map(
              (entry) => entry.frame.node.width + entry.level * 24,
            ),
          ),
          height: sum(
            entries.map((entry) => entry.frame.node.height),
            16,
          ),
        };
      });
      let y = root.node.height / 2 + GAP_X;
      for (let start = 0; start < blocks.length; start += columns) {
        const row = blocks.slice(start, start + columns);
        let x =
          -sum(
            row.map((block) => block.width),
            GAP_X,
          ) / 2;
        for (const block of row) {
          let cursor = y;
          for (const { frame, level } of block.entries) {
            frame.node.x = x + level * 24;
            frame.node.y = cursor;
            frame.node.side = x < 0 ? "left" : "right";
            cursor += frame.node.height + 16;
          }
          x += block.width + GAP_X;
        }
        y += Math.max(...row.map((block) => block.height)) + GAP_X;
      }
      break;
    }
    case "timeline-vertical": {
      let cursor = root.node.height / 2 + GAP_X;
      root.children.forEach((branch, index) => {
        horizontal([branch], index % 2 === 0 ? "left" : "right");
        const shift = cursor + branch.spanY / 2;
        const stack = [branch];
        while (stack.length) {
          const frame = stack.pop()!;
          frame.node.y += shift;
          stack.push(...frame.children);
        }
        cursor += branch.spanY + GAP_X;
      });
      break;
    }
    case "tree": {
      let cursor = root.node.height / 2 + GAP_Y;
      for (const frame of frames.slice(1)) {
        frame.node.x = root.node.x + frame.node.depth * 42;
        frame.node.y = cursor;
        frame.node.side = "right";
        cursor += frame.node.height + GAP_Y;
      }
      break;
    }
    case "timeline": {
      let cursor = root.node.width / 2 + GAP_X;
      root.children.forEach((branch, index) => {
        const direction = index % 2 === 0 ? -1 : 1;
        const branchY =
          direction * (root.node.height / 2 + GAP_X + branch.node.height / 2);
        vertical(
          branch,
          cursor + branch.spanX / 2,
          branchY,
          direction,
          localHeights(branch),
        );
        cursor += branch.spanX + GAP_X;
      });
      break;
    }
    case "fishbone": {
      let cursor = root.node.width / 2 + GAP_X;
      root.children.forEach((branch, index) => {
        const direction = index % 2 === 0 ? -1 : 1;
        const entries: Array<{ frame: Frame; level: number }> = [];
        function visit(frame: Frame, level: number): void {
          entries.push({ frame, level });
          frame.children.forEach((child) => visit(child, level + 1));
        }
        visit(branch, 0);
        const blockWidth = Math.max(
          ...entries.map((entry) => entry.level * 42 + entry.frame.node.width),
        );
        let distance = root.node.height / 2 + GAP_X;
        for (const entry of entries) {
          const node = entry.frame.node;
          position(
            entry.frame,
            cursor + entry.level * 42 + node.width / 2,
            direction * (distance + node.height / 2),
            "right",
          );
          distance += node.height + GAP_Y;
        }
        cursor += blockWidth + GAP_X;
      });
      break;
    }
    case "radial": {
      const tau = Math.PI * 2;
      function allocate(frame: Frame, start: number, end: number): void {
        frame.angle = (start + end) / 2;
        let cursor = start;
        for (const child of frame.children) {
          const span = ((end - start) * child.leaves) / frame.leaves;
          allocate(child, cursor, cursor + span);
          cursor += span;
        }
      }
      allocate(root, -Math.PI / 2, Math.PI * 1.5);
      const levels: Frame[][] = [];
      for (const frame of frames) (levels[frame.node.depth] ??= []).push(frame);
      let previousRadius = 0;
      let previousDiagonal = Math.hypot(root.node.width, root.node.height);
      for (let depth = 1; depth < levels.length; depth++) {
        const level = levels[depth];
        const diagonal = Math.max(
          ...level.map((frame) =>
            Math.hypot(frame.node.width, frame.node.height),
          ),
        );
        const angles = level.map((frame) => frame.angle).sort((a, b) => a - b);
        let minimumAngle = tau;
        if (angles.length > 1) {
          for (let index = 0; index < angles.length; index++) {
            const next =
              index === angles.length - 1 ? angles[0] + tau : angles[index + 1];
            minimumAngle = Math.min(minimumAngle, next - angles[index]);
          }
        }
        const circumferenceRadius =
          angles.length > 1
            ? (diagonal + GAP_Y) / (2 * Math.sin(minimumAngle / 2))
            : 0;
        // Circumference spacing prevents same-ring overlap; radial spacing prevents cross-ring overlap.
        const radius = Math.max(
          circumferenceRadius,
          previousRadius + (previousDiagonal + diagonal) / 2 + GAP_X,
        );
        for (const frame of level) {
          const x = Math.cos(frame.angle) * radius;
          const y = Math.sin(frame.angle) * radius;
          position(frame, x, y, x < -1 ? "left" : x > 1 ? "right" : "center");
        }
        previousRadius = radius;
        previousDiagonal = diagonal;
      }
      break;
    }
  }

  const edges: LayoutEdge[] = [];
  for (const frame of frames) {
    const parent = frame.parent;
    if (!parent) continue;
    let path: string;
    if (sheet.layout === "radial") path = radialEdge(parent, frame);
    else if (
      sheet.layout === "org" ||
      sheet.layout === "org-up" ||
      sheet.layout === "matrix"
    )
      path = verticalEdge(parent, frame);
    else if (sheet.layout === "timeline-vertical" && parent === root) {
      const point = center(frame);
      const side = frame.node.side === "left" ? -1 : 1;
      const bx = point.x - (side * frame.node.width) / 2;
      path = `M 0 ${round(root.node.height / 2)} L 0 ${round(point.y)} C ${round(bx * 0.35)} ${round(point.y)} ${round(bx * 0.65)} ${round(point.y)} ${round(bx)} ${round(point.y)}`;
    } else if (sheet.layout === "brace") {
      const a = center(parent),
        b = center(frame),
        ax = parent.node.x + parent.node.width,
        bx = frame.node.x;
      const mid = (ax + bx) / 2;
      path = `M ${round(ax)} ${round(a.y)} L ${round(mid - 8)} ${round(a.y)} C ${round(mid + 8)} ${round(a.y)} ${round(mid - 8)} ${round(b.y)} ${round(bx)} ${round(b.y)}`;
    } else if (sheet.layout === "tree") {
      const child = center(frame);
      const ax = parent.node.x + 16;
      const ay = parent.node.y + parent.node.height;
      path = `M ${round(ax)} ${round(ay)} L ${round(ax)} ${round(child.y - 8)} C ${round(ax)} ${round(child.y)} ${round(frame.node.x - 8)} ${round(child.y)} ${round(frame.node.x)} ${round(child.y)}`;
    } else if (sheet.layout === "timeline" || sheet.layout === "fishbone") {
      if (parent !== root) path = verticalEdge(parent, frame);
      else {
        const child = center(frame);
        const ax = root.node.x + root.node.width;
        const by = child.y + ((child.y < 0 ? 1 : -1) * frame.node.height) / 2;
        const joint = sheet.layout === "fishbone" ? child.x + 42 : child.x;
        path = `M ${round(ax)} 0 L ${round(joint)} 0 C ${round(joint)} ${round(by * 0.35)} ${round(child.x)} ${round(by * 0.65)} ${round(child.x)} ${round(by)}`;
      }
    } else path = horizontalEdge(parent, frame);
    edges.push({
      from: parent.topic.id,
      to: frame.topic.id,
      color: frame.node.color,
      path,
    });
  }

  const nodes = frames.map((frame) => frame.node);
  // Detached trees retain their exact caller-specified centers, independent from the main root.
  for (const detached of sheet.root.children.filter(
    (topic) => topic.floating,
  )) {
    const position = detached.floating!;
    const own = computeLayout({
      ...sheet,
      root: detached,
      relations: [],
      annotations: [],
    });
    nodes.push(
      ...own.nodes.map((node) => ({
        ...node,
        x: node.x + position.x,
        y: node.y + position.y,
      })),
    );
    edges.push(
      ...own.edges.map((edge) => ({
        ...edge,
        path: translatePath(edge.path, position.x, position.y),
      })),
    );
  }
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  for (const node of nodes) {
    minimumX = Math.min(minimumX, node.x);
    minimumY = Math.min(minimumY, node.y);
    maximumX = Math.max(maximumX, node.x + node.width);
    maximumY = Math.max(maximumY, node.y + node.height);
  }
  return {
    nodes,
    edges,
    bounds: {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX,
      height: maximumY - minimumY,
    },
  };
}

function numberingPrefix(mode: Sheet["numbering"], path: number[]): string {
  if (!path.length || !mode || mode === "none") return "";
  if (mode === "hierarchical") return `${path.join(".")}. `;
  const index = path[path.length - 1];
  if (mode === "decimal") return `${index}. `;
  let remainder = index;
  let roman = "";
  for (const [value, symbol] of [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ] as const) {
    while (remainder >= value) {
      roman += symbol;
      remainder -= value;
    }
  }
  return `${roman}. `;
}

/** Only absolute M/L/C are emitted by this module; translate the owned coordinate pairs. */
function translatePath(path: string, x: number, y: number): string {
  let axis = 0;
  return path.replace(
    /[MLC]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi,
    (token) => {
      if (/^[MLC]$/i.test(token)) {
        axis = 0;
        return token;
      }
      return round(Number(token) + (axis++ % 2 === 0 ? x : y));
    },
  );
}
