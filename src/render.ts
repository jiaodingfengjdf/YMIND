import type { LayoutNode, Sheet } from "./domain.ts";
import { computeLayout, measureTopic, wrapText } from "./layout.ts";
import { safeImage, safeLink } from "./assets.ts";
import { richTextLines } from "./richText.ts";

const FONT = "Segoe UI, Microsoft YaHei, sans-serif";
const MAX_RASTER_SIDE = 16384;
const MAX_RASTER_PIXELS = 48_000_000;
const MAX_EQUATION_SVG = 2_000_000;
const MAX_EQUATION_CACHE = 4_000_000;

/** XML text and attribute encoding also removes characters forbidden by XML 1.0. */
function xml(value: unknown): string {
  return Array.from(String(value))
    .map((character) => {
      const code = character.codePointAt(0)!;
      if (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      )
        return "\ufffd";
      return (
        (
          {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          } as Record<string, string>
        )[character] ?? character
      );
    })
    .join("");
}

function color(value: string | undefined, fallback: string): string {
  return value &&
    (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
      /^(?:black|white|red|green|blue|orange|purple|gray|grey|teal|navy|transparent)$/i.test(
        value,
      ))
    ? value
    : fallback;
}

function textLines(
  lines: string[],
  x: number,
  baseline: number,
  size: number,
  fill: string,
  attributes = "",
): string {
  return (
    `<text x="${x}" y="${baseline}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${attributes}>` +
    lines
      .map(
        (line, index) =>
          `<tspan x="${x}" ${index ? `dy="${size * 1.35}"` : ""}>${xml(line) || "&#160;"}</tspan>`,
      )
      .join("") +
    "</text>"
  );
}

type MathRenderer = (tex: string) => string;
let mathRenderer: Promise<MathRenderer> | undefined;
const equationCache = new Map<string, string>();
let equationCacheSize = 0;

async function loadMathRenderer(): Promise<MathRenderer> {
  mathRenderer ??= (async () => {
    const [
      { mathjax },
      { TeX },
      { SVG },
      { liteAdaptor },
      { RegisterHTMLHandler },
    ] = await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
      import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const input = new TeX({
      packages: ["base", "ams"],
      maxBuffer: 5000,
      maxMacros: 1000,
      formatError: (_jax: unknown, error: { message: string }) => {
        throw new Error(error.message);
      },
    });
    const document = mathjax.document("", {
      InputJax: input,
      OutputJax: new SVG({ fontCache: "none" }),
    });
    return (tex) => {
      const container = document.convert(tex, { display: true });
      const element = adaptor.tags(container, "svg")[0];
      if (!element) throw new Error("公式没有生成 SVG 图像");
      const result = adaptor.outerHTML(element);
      if (
        !result.startsWith("<svg") ||
        /<(?:script|foreignObject|image|a)(?:\s|>)/i.test(result) ||
        /\son\w+=/i.test(result) ||
        /(?:href|xlink:href)=["'](?!#)/i.test(result)
      ) {
        throw new Error("公式含有不支持的资源或链接");
      }
      return result;
    };
  })();
  try {
    return await mathRenderer;
  } catch (error) {
    mathRenderer = undefined;
    throw error;
  }
}

/** TeX is rendered as standalone SVG paths, never inserted as HTML or fetched remotely. */
export async function equationSvg(tex: string): Promise<string> {
  const expression = tex.trim();
  if (!expression) throw new Error("公式不能为空");
  if (expression.length > 5000) throw new Error("公式超过 5000 字符的渲染上限");
  if (
    /\\(?:href|url|html\w*|class|style|cssId|includegraphics|require|def|gdef|edef|xdef|newcommand|renewcommand|let)\b/i.test(
      expression,
    )
  ) {
    throw new Error("公式仅支持数学表达式，不支持外部链接、资源或自定义命令");
  }
  const cached = equationCache.get(expression);
  if (cached) {
    equationCache.delete(expression);
    equationCache.set(expression, cached);
    return cached;
  }
  const result = (await loadMathRenderer())(expression);
  if (result.length > MAX_EQUATION_SVG)
    throw new Error("公式渲染结果超过 2 MB 的资源上限，请拆分为较小公式");
  equationCache.set(expression, result);
  equationCacheSize += result.length;
  while (equationCache.size > 64 || equationCacheSize > MAX_EQUATION_CACHE) {
    const oldest = equationCache.keys().next().value!;
    equationCacheSize -= equationCache.get(oldest)!.length;
    equationCache.delete(oldest);
  }
  return result;
}

interface PreparedNode {
  node: LayoutNode;
  lines: string[];
  markerLines: string[];
  labelLines: string[];
  taskLines: string[];
  size: number;
  equation?: string;
  equationWidth?: number;
  equationHeight?: number;
}

async function prepareNode(original: LayoutNode): Promise<PreparedNode> {
  const node = original;
  const metrics = measureTopic(node.topic, node.depth, node.title);
  const {
    fontSize: size,
    titleLines: lines,
    markerLines,
    labelLines,
    taskLines,
  } = metrics;
  const available = Math.max(20, node.width - 24);
  let equation: string | undefined,
    equationWidth = 0,
    equationHeight = 0;
  if (node.topic.equation?.trim()) {
    try {
      equation = await equationSvg(node.topic.equation);
    } catch (error) {
      throw new Error(
        `主题「${node.topic.title}」的公式无法渲染：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const dimensions = /viewBox="([^"]+)"/
      .exec(equation)?.[1]
      .split(/\s+/)
      .map(Number);
    if (
      !dimensions ||
      dimensions.length !== 4 ||
      dimensions.some((v) => !Number.isFinite(v)) ||
      dimensions[2]! <= 0 ||
      dimensions[3]! <= 0
    ) {
      throw new Error("公式 SVG 尺寸无效");
    }
    const ratio = dimensions[2]! / dimensions[3]!;
    equationHeight = Math.min(48, available / ratio);
    equationWidth = equationHeight * ratio;
  }
  return {
    node,
    lines,
    markerLines,
    labelLines,
    taskLines,
    size,
    equation,
    equationWidth,
    equationHeight,
  };
}

function topicShape(node: LayoutNode, stroke: string): string {
  const { x, y, width: w, height: h } = node;
  const shape =
    node.topic.style?.shape ?? (node.depth >= 2 ? "underline" : "round");
  const fill = node.depth === 0 ? stroke : stroke;
  const opacity = node.depth === 0 ? 1 : 0.09;
  const attrs = `fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${node.depth === 0 ? 0 : 1.5}"`;
  if (shape === "underline")
    return `<path d="M ${x + 3} ${y + h - 3} H ${x + w - 3}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`;
  if (shape === "ellipse")
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
  if (shape === "diamond")
    return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${attrs}/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${shape === "rect" ? 2 : 12}" ${attrs}/>`;
}

function drawNode(prepared: PreparedNode, dark: boolean): string {
  const {
    node,
    lines,
    markerLines,
    labelLines,
    taskLines,
    size,
    equation,
    equationWidth,
    equationHeight,
  } = prepared;
  const topic = node.topic,
    stroke = color(topic.style?.color, color(node.color, "#1677ff"));
  const foreground = color(
    topic.style?.textColor,
    node.depth === 0
      ? dark
        ? "#101828"
        : "#ffffff"
      : dark
        ? "#e4edff"
        : "#152238",
  );
  const muted = node.depth === 0 ? "#edf4ff" : dark ? "#afbdd5" : "#6f7f96";
  const center = node.x + node.width / 2;
  let cursor = node.y + 12;
  let result = `<g data-topic-id="${xml(topic.id)}"><title>${xml(topic.title)}${topic.note ? "\n" + xml(topic.note) : ""}</title>${topicShape(node, stroke)}`;
  const richLines = richTextLines(
    topic.title,
    topic.richText,
    node.title,
    lines,
  );
  result +=
    `<text x="${center}" y="${cursor + size}" xml:space="preserve" font-family="${FONT}" font-size="${size}" fill="${foreground}" text-anchor="middle" font-weight="${topic.style?.bold === false ? 400 : topic.style?.bold ? 700 : node.depth <= 1 ? 600 : 400}" font-style="${topic.style?.italic ? "italic" : "normal"}">` +
    richLines
      .map(
        (line, index) =>
          `<tspan x="${center}" ${index ? `dy="${size * 1.35}"` : ""}>${line.length ? line.map((run) => `<tspan${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}${run.underline ? ' text-decoration="underline"' : ""}>${xml(run.text)}</tspan>`).join("") : "&#160;"}</tspan>`,
      )
      .join("") +
    "</text>";
  cursor += lines.length * size * 1.35;
  if (topic.image) {
    const image = safeImage(topic.image);
    if (image)
      result += `<image x="${node.x + 12}" y="${cursor + 8}" width="${node.width - 24}" height="84" preserveAspectRatio="xMidYMid meet" href="${xml(image)}"/>`;
    else
      result +=
        `<rect x="${node.x + 12}" y="${cursor + 8}" width="${node.width - 24}" height="84" fill="none" stroke="${muted}" stroke-dasharray="4 3"/>` +
        textLines(
          ["图片不可用"],
          center,
          cursor + 53,
          12,
          muted,
          'text-anchor="middle"',
        );
    cursor += 100;
  }
  if (equation) {
    result += equation.replace(/^<svg\b[^>]*>/, (opening) =>
      opening
        .replace(/\s(?:width|height|style)="[^"]*"/g, "")
        .replace(
          ">",
          ` x="${center - equationWidth! / 2}" y="${cursor + 8}" width="${equationWidth}" height="${equationHeight}" color="${foreground}" fill="${foreground}">`,
        ),
    );
    cursor += 60;
  }
  if (markerLines.length) {
    result += textLines(markerLines, node.x + 12, cursor + 15, 14, foreground);
    cursor += markerLines.length * 20;
  }
  if (labelLines.length) {
    result += textLines(labelLines, node.x + 12, cursor + 14, 11, foreground);
    cursor += labelLines.length * 20;
  }
  if (topic.task) {
    const task = topic.task;
    const status =
      task.status === "done"
        ? "已完成"
        : task.status === "doing"
          ? "进行中"
          : "待办";
    const progress =
      task.status === "done"
        ? 100
        : Math.max(
            0,
            Math.min(100, Number.isFinite(task.progress) ? task.progress! : 0),
          );
    result += `<g data-task="${xml(task.status)}"><rect x="${node.x + 12}" y="${cursor + 7}" width="13" height="13" rx="3" fill="${task.status === "done" ? stroke : "none"}" stroke="${foreground}"/>`;
    if (task.status === "done")
      result += `<path d="M ${node.x + 15} ${cursor + 13} l 3 3 l 5 -6" fill="none" stroke="${foreground}" stroke-width="1.5"/>`;
    result += textLines(
      [`${status} · ${Math.round(progress)}%`],
      node.x + 32,
      cursor + 18,
      12,
      foreground,
    );
    const meter = Math.max(12, node.width - 24);
    result += `<rect x="${node.x + 12}" y="${cursor + 25}" width="${meter}" height="3" rx="1.5" fill="${muted}" fill-opacity=".3"/><rect x="${node.x + 12}" y="${cursor + 25}" width="${(meter * progress) / 100}" height="3" rx="1.5" fill="${node.depth === 0 ? foreground : stroke}"/></g>`;
    cursor += 30;
    if (taskLines.length)
      result += textLines(taskLines, node.x + 12, cursor + 12, 10, muted);
  }
  let indicatorX = node.x + node.width - 8;
  for (const [shown, label, meaning] of [
    [topic.note, "注", "备注"],
    [topic.attachment, "附", "附件"],
    [topic.url, "↗", "链接"],
  ] as const) {
    if (!shown) continue;
    indicatorX -= 17;
    const badge = `<g data-indicator="${meaning}"><title>${meaning}${meaning === "附件" ? "：" + xml(topic.attachment?.name ?? "") : ""}</title><circle cx="${indicatorX + 7}" cy="${node.y + 5}" r="8" fill="${dark ? "#18253a" : "#ffffff"}" stroke="${stroke}"/><text x="${indicatorX + 7}" y="${node.y + 9}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${stroke}">${label}</text></g>`;
    const link = meaning === "链接" ? safeLink(topic.url) : undefined;
    result += link
      ? `<a href="${xml(link)}" target="_blank">${badge}</a>`
      : badge;
  }
  if (topic.collapsed && topic.children.length)
    result += textLines(
      [`+${topic.children.length}`],
      node.x + node.width + 5,
      node.y + node.height / 2 + 4,
      11,
      stroke,
    );
  return result + "</g>";
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

interface SvgDocument {
  svg: string;
  width: number;
  height: number;
}

async function svgDocument(sheet: Sheet): Promise<SvgDocument> {
  const layout = computeLayout(sheet);
  const nodes = await Promise.all(layout.nodes.map(prepareNode));
  const byId = new Map(nodes.map((item) => [item.node.id, item.node]));
  if (!nodes.length) throw new Error("导图中没有可导出的主题");
  const dark = sheet.theme === "dark";
  const foreground = dark ? "#e4edff" : "#152238";
  let bounds: Box = { ...layout.bounds };
  for (const { node } of nodes)
    bounds = union(bounds, {
      x: node.x - 4,
      y: node.y - 6,
      width: node.width + 40,
      height: node.height + 10,
    });
  const behind: string[] = [],
    above: string[] = [];
  for (const annotation of sheet.annotations) {
    const selection = annotation.topicIds
      .map((id) => byId.get(id))
      .filter((node): node is LayoutNode => !!node);
    if (!selection.length) continue;
    const group = selection
      .map((node) => ({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      }))
      .reduce(union);
    const stroke = color(annotation.color, "#8b72cb");
    const labels = wrapText(
      annotation.label,
      annotation.kind === "summary" ? 180 : Math.max(80, group.width),
      13,
    );
    const labelHeight = labels.length * 17.55;
    if (annotation.kind === "boundary") {
      const x = group.x - 14,
        y = group.y - labelHeight - 22,
        width = Math.max(group.width + 28, 100),
        height = group.height + labelHeight + 36;
      behind.push(
        `<g data-annotation="boundary"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${stroke}" fill-opacity=".035" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="5 4"/>${textLines(labels, x + 12, y + 18, 13, stroke)}</g>`,
      );
      bounds = union(bounds, { x, y, width, height });
    } else {
      const x = group.x + group.width + 20,
        y = group.y,
        h = group.height;
      above.push(
        `<g data-annotation="summary"><path d="M ${x} ${y} h 8 v ${h / 2 - 8} q 0 8 8 8 q -8 0 -8 8 v ${h / 2 - 8} h -8" fill="none" stroke="${stroke}" stroke-width="1.6"/>${textLines(labels, x + 26, y + h / 2 - labelHeight / 2 + 13, 13, stroke)}</g>`,
      );
      bounds = union(bounds, {
        x,
        y: Math.min(y, y + h / 2 - labelHeight / 2),
        width: 210,
        height: Math.max(h, labelHeight),
      });
    }
  }
  const branches: string[] = [];
  for (const edge of layout.edges) {
    const from = byId.get(edge.from),
      to = byId.get(edge.to);
    if (!from || !to) continue;
    branches.push(
      `<path data-branch="${xml(edge.to)}" d="${xml(edge.path)}" fill="none" stroke="${color(edge.color, "#1677ff")}" stroke-width="${to.depth === 1 ? 4 : 2.5}" stroke-linecap="round"/>`,
    );
  }
  for (const relation of sheet.relations) {
    const from = byId.get(relation.from),
      to = byId.get(relation.to);
    if (!from || !to) continue;
    const forward = to.x + to.width / 2 >= from.x + from.width / 2;
    const x1 = from.x + (forward ? from.width : 0),
      y1 = from.y + from.height / 2;
    const x2 = to.x + (forward ? 0 : to.width),
      y2 = to.y + to.height / 2;
    const bend = Math.min(130, Math.max(40, Math.abs(x2 - x1) * 0.2));
    const stroke = color(relation.color, "#8794ad");
    const cx = (x1 + x2) / 2,
      cy = (y1 + y2) / 2 - bend * 0.75;
    const labelLines = wrapText(relation.label, 190, 12);
    above.push(
      `<g data-relation="${xml(relation.id)}"><path d="M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 - bend}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-dasharray="6 4"/>` +
        `<circle cx="${x2}" cy="${y2}" r="3" fill="${stroke}"/>${textLines(labelLines, cx, cy - 7, 12, foreground, 'text-anchor="middle"')}</g>`,
    );
    bounds = union(bounds, {
      x: Math.min(x1, x2, cx - 100),
      y: Math.min(y1 - bend, y2 - bend, cy - 22),
      width: Math.max(x1, x2, cx + 100) - Math.min(x1, x2, cx - 100),
      height:
        Math.max(y1, y2, cy + labelLines.length * 16) -
        Math.min(y1 - bend, y2 - bend, cy - 22),
    });
  }
  const padding = 32,
    width = Math.ceil(bounds.width + padding * 2),
    height = Math.ceil(bounds.height + padding * 2);
  const x = Math.floor(bounds.x - padding),
    y = Math.floor(bounds.y - padding);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" role="img" aria-label="${xml(sheet.title)}">` +
    `<title>${xml(sheet.title)}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${dark ? "#101828" : "#ffffff"}"/>` +
    behind.join("") +
    branches.join("") +
    nodes.map((node) => drawNode(node, dark)).join("") +
    above.join("") +
    "</svg>";
  return { svg, width, height };
}

export async function buildSvg(sheet: Sheet): Promise<string> {
  return (await svgDocument(sheet)).svg;
}

async function raster(
  document: SvgDocument,
  scale: number,
): Promise<HTMLCanvasElement> {
  if (
    typeof window === "undefined" ||
    typeof globalThis.document === "undefined"
  )
    throw new Error("PNG/PDF 导出需要在 YMIND 窗口中运行");
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4)
    throw new Error("导出倍率必须大于 0 且不超过 4");
  const width = Math.ceil(document.width * scale),
    height = Math.ceil(document.height * scale);
  if (
    width > MAX_RASTER_SIDE ||
    height > MAX_RASTER_SIDE ||
    width * height > MAX_RASTER_PIXELS
  ) {
    throw new Error(
      `导图在 ${scale} 倍率下为 ${width} × ${height} 像素，超过图像导出上限。请降低倍率或导出 SVG；内容没有被截断。`,
    );
  }
  await globalThis.document.fonts?.ready;
  const url = URL.createObjectURL(
    new Blob([document.svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("导图图像无法渲染，请检查图片资源"));
      image.src = url;
    });
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图像画布");
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportMap(
  sheet: Sheet,
  format: "svg" | "png" | "jpeg" | "pdf",
  scale = 1,
): Promise<{ blob: Blob; extension: string }> {
  const document = await svgDocument(sheet);
  if (format === "svg")
    return {
      blob: new Blob([document.svg], { type: "image/svg+xml;charset=utf-8" }),
      extension: "svg",
    };
  const canvas = await raster(document, scale);
  try {
    if (format === "png" || format === "jpeg") {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("图片编码失败")),
          format === "jpeg" ? "image/jpeg" : "image/png",
          0.94,
        ),
      );
      return { blob, extension: format === "jpeg" ? "jpg" : "png" };
    }
    if (format !== "pdf") throw new Error("不支持的导出格式");
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: document.width >= document.height ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    const pageWidth = pdf.internal.pageSize.getWidth(),
      pageHeight = pdf.internal.pageSize.getHeight(),
      margin = 12;
    const fit = Math.min(
      (pageWidth - margin * 2) / document.width,
      (pageHeight - margin * 2) / document.height,
    );
    const drawWidth = document.width * fit,
      drawHeight = document.height * fit;
    pdf.addImage(
      canvas,
      "PNG",
      (pageWidth - drawWidth) / 2,
      (pageHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    return { blob: pdf.output("blob"), extension: "pdf" };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
