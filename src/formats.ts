import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  Annotation,
  Layout,
  Sheet,
  Topic,
  TopicStyle,
  Workbook,
} from "./domain";
import { validateWorkbook } from "./model.ts";

export type ExportFormat =
  | "ymind"
  | "xmind"
  | "markdown"
  | "textbundle"
  | "opml"
  | "freemind"
  | "docx"
  | "xlsx"
  | "pptx"
  | "ics";
export const FORMAT_NOTES = {
  xmind:
    "支持现代 JSON 版 Xmind 多画布、标签、悬浮主题坐标、备注、链接、嵌入位图、标记和关系线。同一父主题下连续普通子主题可导出边界和概要。大括号/树表使用可读布局回退；自有布局、编号和富文本保存在 YMIND 扩展中，仅保证 YMIND 再导入保留，不保证其他软件呈现。加密与旧版 content.xml 不支持。",
  markdown:
    "保留多画布、主题层级、文本备注及链接；不保存布局、图片、关系线或任务信息。",
  textbundle:
    "将 Markdown 与实际嵌入位图打包为标准 .textpack ZIP，包含 info.json、text.md 和 assets/ 相对图片引用。不导出附件、布局、任务、关系线或富文本格式；解压后可作为 .textbundle 文件夹使用。",
  opml: "保留多画布、主题层级、文本备注及链接。",
  freemind: "多画布合并在一个文档根节点下，保留主题层级、备注及链接。",
  docx: "导出为有标题层级的文字大纲，不是可编辑的思维导图。",
  xlsx: "每个画布一个工作表，导出主题路径、备注、链接和任务字段。",
  pptx: "每个画布的一层分支一页，最多 50 页。每页正文最多 22 行，超出部分需先拆分分支。",
  ics: "只导出有有效开始日期的任务；没有日期的任务不生成日历事件。结束日期按包含当天解释。",
} as const;

const INPUT_LIMIT = 20 * 1024 * 1024;
const NATIVE_INPUT_LIMIT = 64 * 1024 * 1024;
const EXPANDED_LIMIT = 64 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const NODE_LIMIT = 10_000;
const DEPTH_LIMIT = 128;
const YMIND_EXTENSION_PROVIDER = "local.ymind.editor";
const uid = () => globalThis.crypto.randomUUID();
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("文件结构错误：需要对象。");
  return value as Record<string, unknown>;
};
const optionalRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const topic = (title: string): Topic => ({ id: uid(), title, children: [] });
const sheet = (title: string, root = topic(title)): Sheet => ({
  id: uid(),
  title,
  root,
  layout: "mindmap",
  theme: "classic",
  relations: [],
  annotations: [],
});
const workbook = (title: string, sheets: Sheet[]): Workbook => ({
  version: 1,
  id: uid(),
  title,
  sheets,
  activeSheetId: sheets[0].id,
  updatedAt: new Date().toISOString(),
});
const own = (o: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(o, key);
function bad(message: string): never {
  throw new Error(message);
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return bad(`${name} 不是有效 JSON，文件可能已损坏。`);
  }
}

/** Reuse the document owner for all owned YMIND semantics. */
export function parseYmind(value: unknown): Workbook {
  return validateWorkbook(value);
}

type FlatTopic = { topic: Topic; depth: number; path: string[] };
export function flatten(root: Topic): FlatTopic[] {
  const result: FlatTopic[] = [];
  const visit = (n: Topic, depth: number, path: string[]) => {
    if (result.length >= NODE_LIMIT || depth > DEPTH_LIMIT)
      bad("主题数量超过 10000 或层级超过 128。");
    const next = [...path, n.title];
    result.push({ topic: n, depth, path: next });
    n.children.forEach((c) => visit(c, depth + 1, next));
  };
  visit(root, 0, []);
  return result;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Validate advertised expansion before allocation. ZIP64, encryption and ambiguous filenames are unsupported. */
function boundedUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > INPUT_LIMIT) bad("输入文件不能超过 20 MB。");
  if (bytes.length < 22) bad("Xmind ZIP 文件不完整。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i--
  ) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) bad("ZIP 目录缺失，Xmind 文件可能已损坏。");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    bad("不支持分卷 ZIP 文件。");
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    entries === 65535 ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff
  )
    bad("不支持 ZIP64。");
  if (entries > 1024 || directoryOffset + directorySize !== end)
    bad("ZIP 目录无效或文件数量超过 1024。");
  const advertised = new Map<string, { size: number; crc: number }>();
  let total = 0;
  let offset = directoryOffset;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      bad("ZIP 文件目录损坏。");
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > end || local + 30 > directoryOffset) bad("ZIP 条目越界。");
    if (flags & 1)
      bad("不支持加密或受保护的 Xmind 文件。请从原应用正常导出非加密文件。");
    if (compression !== 0 && compression !== 8)
      bad("ZIP 使用了不支持的压缩算法。");
    if (view.getUint32(local, true) !== 0x04034b50) bad("ZIP 本地文件头损坏。");
    if (
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== compression
    )
      bad("ZIP 本地文件头与压缩标志不一致。");
    const name = strFromU8(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (
      !name ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.startsWith("/") ||
      name.includes(":") ||
      name.split("/").includes("..") ||
      advertised.has(name)
    )
      bad("ZIP 含无效或重复的资源路径。");
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const localName = strFromU8(
      bytes.subarray(local + 30, local + 30 + localNameLength),
    );
    if (
      name !== localName ||
      local + 30 + localNameLength + localExtraLength + compressed >
        directoryOffset
    )
      bad("ZIP 本地文件头与目录不一致。");
    total += size;
    if (total > EXPANDED_LIMIT || size > INPUT_LIMIT)
      bad("Xmind 解压内容超过安全上限（合计 64 MB，单文件 20 MB）。");
    advertised.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end) bad("ZIP 目录长度不一致。");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        ["content.json", "metadata.json", "manifest.json"].includes(f.name) ||
        f.name.startsWith("resources/"),
    });
  } catch {
    return bad("无法解压 Xmind 文件，内容可能已损坏。");
  }
  for (const [name, data] of Object.entries(files)) {
    const info = advertised.get(name);
    if (!info || data.length !== info.size || crc32(data) !== info.crc)
      bad(`ZIP 条目校验失败：${name}。`);
  }
  return files;
}

const structureMap: Record<Layout, string> = {
  mindmap: "org.xmind.ui.map.unbalanced",
  right: "org.xmind.ui.logic.right",
  left: "org.xmind.ui.logic.left",
  org: "org.xmind.ui.org-chart.down",
  tree: "org.xmind.ui.tree.right",
  timeline: "org.xmind.ui.timeline.horizontal",
  fishbone: "org.xmind.ui.fishbone.leftHeaded",
  radial: "org.xmind.ui.map.clockwise",
  // The public SDK has no dedicated brace/treetable class. Use verified readable structures,
  // retaining the caller's original choice in this application's extension below.
  brace: "org.xmind.ui.logic.right",
  treetable: "org.xmind.ui.spreadsheet.column",
  matrix: "org.xmind.ui.spreadsheet",
  "org-up": "org.xmind.ui.org-chart.up",
  "timeline-vertical": "org.xmind.ui.timeline.vertical",
};

function ownedXmindExtension(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const extension = array(source.extensions)
    .map(optionalRecord)
    .find((e) => e.provider === YMIND_EXTENSION_PROVIDER);
  if (!extension) return {};
  if (
    typeof extension.content !== "string" ||
    extension.content.length > 1_000_000
  )
    bad("YMIND 文件扩展内容无效或过大。");
  const content = record(parseJson(extension.content, "YMIND 文件扩展"));
  return content.version === 1 ? content : {};
}

function imageKind(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    strFromU8(bytes.subarray(1, 4)) === "PNG"
  )
    return "png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "jpeg";
  if (bytes.length >= 10 && strFromU8(bytes.subarray(0, 3)) === "GIF")
    return "gif";
  if (
    bytes.length >= 12 &&
    strFromU8(bytes.subarray(0, 4)) === "RIFF" &&
    strFromU8(bytes.subarray(8, 12)) === "WEBP"
  )
    return "webp";
  return undefined;
}
function toBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}
function decodeImage(
  value: string,
): { bytes: Uint8Array; kind: string } | undefined {
  const m =
    /^data:image\/(png|jpeg|jpg|gif|webp);base64,([\da-z+/=\s]+)$/i.exec(value);
  if (!m || m[2].length > IMAGE_LIMIT * 1.4) return undefined;
  try {
    const raw = atob(m[2]);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const kind = imageKind(bytes);
    return kind && bytes.length <= IMAGE_LIMIT ? { bytes, kind } : undefined;
  } catch {
    return undefined;
  }
}
function rangeIndices(value: unknown, children: Topic[]): Topic[] {
  const m = /^\((\d+),(\d+)\)$/.exec(text(value));
  if (!m) return [];
  const start = Number(m[1]),
    end = Number(m[2]);
  return start <= end && end < children.length
    ? children.slice(start, end + 1)
    : [];
}

export function parseXmind(bytes: Uint8Array, title = "导入 Xmind"): Workbook {
  const files = boundedUnzip(bytes);
  if (!files["content.json"])
    bad(
      "缺少 content.json。仅支持现代 JSON 版 Xmind；旧版 XML 格式请从原应用另存。",
    );
  if (files["manifest.json"])
    record(parseJson(strFromU8(files["manifest.json"]), "manifest.json"));
  if (files["metadata.json"])
    record(parseJson(strFromU8(files["metadata.json"]), "metadata.json"));
  const content = parseJson(strFromU8(files["content.json"]), "content.json");
  if (!Array.isArray(content) || !content.length || content.length > 100)
    bad("Xmind 画布数组无效或数量超过 100。");
  let count = 0;
  const sheets = content.map((raw) => {
    const s = record(raw);
    const ids = new Set<string>();
    const annotations: Annotation[] = [];
    function node(raw: unknown, depth = 0): Topic {
      if (++count > NODE_LIMIT || depth > DEPTH_LIMIT)
        bad("Xmind 主题数量超过 10000 或层级超过 128。");
      const n = record(raw);
      if (typeof n.title !== "string") bad("Xmind 主题标题缺失。");
      const id = text(n.id, uid());
      if (!id || ids.has(id)) bad("Xmind 含重复或空主题 id。");
      ids.add(id);
      const children = optionalRecord(n.children);
      const attached = array(children.attached).map((c) => node(c, depth + 1));
      if (depth > 0 && array(children.detached).length)
        bad("当前支持画布根主题下的悬浮主题；嵌套悬浮主题请先在原应用调整。");
      const detached = array(children.detached).map((c, index) => {
        const floating = node(c, depth + 1);
        const position = optionalRecord(record(c).position);
        floating.floating = {
          x: typeof position.x === "number" ? position.x : 480 + index * 240,
          y: typeof position.y === "number" ? position.y : 160 + index * 80,
        };
        return floating;
      });
      const result: Topic = {
        id,
        title: n.title,
        children: [...attached, ...detached],
      };
      const plain = optionalRecord(optionalRecord(n.notes).plain);
      if (typeof plain.content === "string") result.note = plain.content;
      if (typeof n.href === "string") result.url = n.href;
      if (n.branch === "folded") result.collapsed = true;
      if (n.labels !== undefined) {
        if (typeof n.labels === "string") result.labels = [n.labels];
        else if (Array.isArray(n.labels)) {
          result.labels = n.labels.map((label) =>
            typeof label === "string" ? label : bad("Xmind 标签必须是文字。"),
          );
        } else bad("Xmind 标签格式无效。");
      }
      const extension = ownedXmindExtension(n);
      if (extension.richText !== undefined)
        result.richText = extension.richText as Topic["richText"];
      result.markers = array(n.markers)
        .map((m) => text(optionalRecord(m).markerId))
        .filter(Boolean);
      const properties = optionalRecord(optionalRecord(n.style).properties);
      const style: TopicStyle = {};
      if (typeof properties["svg:fill"] === "string")
        style.color = properties["svg:fill"];
      if (typeof properties["fo:color"] === "string")
        style.textColor = properties["fo:color"];
      if (properties["fo:font-weight"] === "bold") style.bold = true;
      if (properties["fo:font-style"] === "italic") style.italic = true;
      const size = parseFloat(text(properties["fo:font-size"]));
      if (Number.isFinite(size) && size >= 8 && size <= 96)
        style.fontSize = size;
      if (Object.keys(style).length) result.style = style;
      const src = text(optionalRecord(n.image).src);
      if (src.startsWith("xap:resources/")) {
        const image = files[src.slice(4)];
        if (!image) bad(`Xmind 图片资源缺失：${src.slice(4)}。`);
        if (image.length > IMAGE_LIMIT) bad("单张图片不能超过 10 MB。");
        const kind = imageKind(image);
        if (kind) result.image = `data:image/${kind};base64,${toBase64(image)}`;
      }
      for (const raw of array(n.boundaries)) {
        const b = record(raw),
          selected = rangeIndices(b.range, attached);
        if (selected.length)
          annotations.push({
            id: text(b.id, uid()),
            kind: "boundary",
            topicIds: selected.map((t) => t.id),
            label: text(b.title),
          });
      }
      const summaryNodes = array(children.summary);
      for (const raw of array(n.summaries)) {
        const a = record(raw),
          selected = rangeIndices(a.range, attached);
        const summary = summaryNodes.find(
          (t) => text(optionalRecord(t).id) === text(a.topicId),
        );
        if (selected.length)
          annotations.push({
            id: text(a.id, uid()),
            kind: "summary",
            topicIds: selected.map((t) => t.id),
            label: text(optionalRecord(summary).title, "概要"),
          });
      }
      // Unknown children classes, author metadata, extensions and unreferenced resources are not retained.
      return result;
    }
    const root = node(s.rootTopic);
    const sheetIds = new Set(flatten(root).map((n) => n.topic.id));
    const rootRecord = record(s.rootTopic);
    const extension = ownedXmindExtension(rootRecord);
    const layout =
      (Object.keys(structureMap) as Layout[]).find(
        (k) => structureMap[k] === rootRecord.structureClass,
      ) || "mindmap";
    const result = sheet(text(s.title, root.title), root);
    result.id = text(s.id, uid());
    result.layout =
      typeof extension.layout === "string"
        ? (extension.layout as Layout)
        : layout;
    if (typeof extension.numbering === "string")
      result.numbering = extension.numbering as Sheet["numbering"];
    result.annotations = annotations;
    result.relations = array(s.relationships).flatMap((raw) => {
      const r = record(raw);
      const from = text(r.end1Id),
        to = text(r.end2Id);
      if (!sheetIds.has(from) || !sheetIds.has(to)) return [];
      return [
        {
          id: text(r.id, uid()),
          from,
          to,
          label: text(r.title),
          color: text(
            optionalRecord(optionalRecord(r.style).properties)["line-color"],
            "#6379bf",
          ),
        },
      ];
    });
    return result;
  });
  if (new Set(sheets.map((s) => s.id)).size !== sheets.length)
    bad("Xmind 含重复画布 id。");
  return validateWorkbook(workbook(title, sheets));
}

function xStyle(type: string, properties: Record<string, string>) {
  return { id: uid(), type, properties };
}
export function toXmind(input: Workbook): Uint8Array {
  const w = parseYmind(input);
  const files: Record<string, Uint8Array> = {};
  const manifest: Record<string, object> = {
    "content.json": {},
    "metadata.json": {},
  };
  let imageIndex = 0,
    totalImages = 0;
  const imagePaths = new Map<string, string>();
  const content = w.sheets.map((s) => {
    const nodes = new Map<string, Record<string, unknown>>();
    const parents = new Map<string, Topic>();
    function node(n: Topic): Record<string, unknown> {
      const result: Record<string, unknown> = {
        id: n.id,
        class: "topic",
        title: n.title,
      };
      nodes.set(n.id, result);
      if (n.children.length)
        result.children = {
          attached: n.children
            .filter((c) => !c.floating)
            .map((c) => {
              parents.set(c.id, n);
              return node(c);
            }),
          ...(n.children.some((c) => c.floating)
            ? {
                detached: n.children
                  .filter((c) => c.floating)
                  .map((c) => {
                    parents.set(c.id, n);
                    return { ...node(c), position: { ...c.floating } };
                  }),
              }
            : {}),
        };
      if (n.note) result.notes = { plain: { content: n.note } };
      if (n.url) result.href = n.url;
      if (n.collapsed) result.branch = "folded";
      if (n.labels?.length) result.labels = [...n.labels];
      if (n.richText?.length)
        result.extensions = [
          {
            provider: YMIND_EXTENSION_PROVIDER,
            content: JSON.stringify({ version: 1, richText: n.richText }),
          },
        ];
      if (n.markers?.length)
        result.markers = n.markers.map((markerId) => ({ markerId }));
      const p: Record<string, string> = {};
      if (n.style?.color) p["svg:fill"] = n.style.color;
      if (n.style?.textColor) p["fo:color"] = n.style.textColor;
      if (n.style?.bold) p["fo:font-weight"] = "bold";
      if (n.style?.italic) p["fo:font-style"] = "italic";
      if (n.style?.fontSize) p["fo:font-size"] = `${n.style.fontSize}pt`;
      if (Object.keys(p).length) result.style = xStyle("topic", p);
      let path = n.image ? imagePaths.get(n.image) : undefined;
      const image = n.image && !path ? decodeImage(n.image) : undefined;
      if (image) {
        totalImages += image.bytes.length;
        if (totalImages > INPUT_LIMIT)
          bad("Xmind 图片总量超过 20 MB，请减少图片后重试。");
        if (imageIndex >= 1021)
          bad("Xmind 独立图片资源超过 1021 个，请拆分文档。");
        path = `resources/ymind-${++imageIndex}.${image.kind === "jpeg" ? "jpg" : image.kind}`;
        files[path] = image.bytes;
        manifest[path] = {};
        imagePaths.set(n.image!, path);
      }
      if (path) {
        result.image = {
          src: `xap:${path}`,
          width: 240,
          height: 160,
          align: "center",
        };
      }
      return result;
    }
    const rootTopic = node(s.root);
    rootTopic.structureClass = structureMap[s.layout];
    rootTopic.extensions = [
      {
        provider: YMIND_EXTENSION_PROVIDER,
        content: JSON.stringify({
          version: 1,
          layout: s.layout,
          ...(s.numbering ? { numbering: s.numbering } : {}),
          ...(s.root.richText ? { richText: s.root.richText } : {}),
        }),
      },
    ];
    for (const a of s.annotations) {
      const parent = parents.get(a.topicIds[0]);
      if (!parent || a.topicIds.some((id) => parents.get(id)?.id !== parent.id))
        continue;
      const indices = a.topicIds
        .map((id) =>
          parent.children
            .filter((c) => !c.floating)
            .findIndex((c) => c.id === id),
        )
        .sort((a, b) => a - b);
      if (
        indices.some(
          (index, i) => index < 0 || (i > 0 && index !== indices[i - 1] + 1),
        )
      )
        continue;
      const p = nodes.get(parent.id)!;
      const range = `(${indices[0]},${indices.at(-1)})`;
      if (a.kind === "boundary") {
        const boundaries = (p.boundaries ||= []) as unknown[];
        boundaries.push({
          id: a.id,
          class: "boundary",
          range,
          title: a.label,
          style: xStyle("boundary", {
            "line-color": a.color || "#7891b9",
            "svg:fill": "#eef2f9",
          }),
        });
      } else {
        const id = uid();
        const summaries = (p.summaries ||= []) as unknown[];
        summaries.push({ id: a.id, class: "summary", range, topicId: id });
        const children = (p.children ||= {}) as Record<string, unknown>;
        const summary = (children.summary ||= []) as unknown[];
        summary.push({ id, class: "topic", title: a.label });
      }
    }
    return {
      id: s.id,
      class: "sheet",
      title: s.title,
      rootTopic,
      relationships: s.relations.map((r) => ({
        id: r.id,
        class: "relationship",
        title: r.label,
        end1Id: r.from,
        end2Id: r.to,
        style: xStyle("relationship", { "line-color": r.color || "#6379bf" }),
      })),
    };
  });
  files["content.json"] = strToU8(JSON.stringify(content));
  files["metadata.json"] = strToU8(
    JSON.stringify({ creator: { name: "YMIND", version: "1.0.0" } }),
  );
  files["manifest.json"] = strToU8(
    JSON.stringify({ "file-entries": manifest }),
  );
  if (Object.values(files).some((file) => file.length > INPUT_LIMIT))
    bad("Xmind 单条内容超过 20 MB，请拆分文档。");
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > EXPANDED_LIMIT)
    bad("导出内容超过 64 MB。");
  const result = zipSync(files, { level: 6 });
  if (result.length > INPUT_LIMIT)
    bad("导出 Xmind 超过 20 MB，请减少图片或附件。");
  return result;
}

const escapeMd = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]*_`<>])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
const decodeMd = (value: string) => value.replace(/\\([\\\[\]*_`<>])/g, "$1");
function mdTopic(n: Topic): string {
  return n.url
    ? `[${escapeMd(n.title)}](<${n.url.replace(/[<>\r\n]/g, (c) => encodeURIComponent(c))}>)`
    : escapeMd(n.title);
}
export function toMarkdown(input: Workbook): string {
  const w = parseYmind(input);
  return markdownContent(w);
}

function markdownContent(w: Workbook, images?: Map<Topic, string>): string {
  const lines: string[] = [];
  const imageRef = (n: Topic): string | undefined => {
    const asset = images?.get(n);
    return asset ? `![${escapeMd(n.title)}](${asset})` : undefined;
  };
  for (const s of w.sheets) {
    lines.push(
      `<!-- ymind-sheet: ${JSON.stringify(s.title).replace(/--/g, "\\u002d\\u002d")} -->`,
      `# ${mdTopic(s.root)}`,
      "",
    );
    if (s.root.note)
      lines.push(...s.root.note.split(/\r?\n/).map((line) => `> ${line}`), "");
    const rootImage = imageRef(s.root);
    if (rootImage) lines.push(rootImage, "");
    const visit = (n: Topic, depth: number) => {
      const pad = "  ".repeat(depth);
      lines.push(`${pad}- ${mdTopic(n)}`);
      if (n.note)
        lines.push(...n.note.split(/\r?\n/).map((line) => `${pad}  > ${line}`));
      const image = imageRef(n);
      if (image) lines.push(`${pad}  ${image}`);
      n.children.forEach((c) => visit(c, depth + 1));
    };
    s.root.children.forEach((n) => visit(n, 0));
    lines.push("");
  }
  return lines.join("\n");
}

/** Standard compressed TextBundle (.textpack): local embedded assets only, no fetching. */
export function toTextbundle(input: Workbook): Uint8Array {
  const w = parseYmind(input);
  const images = new Map<Topic, string>();
  const files: Record<string, Uint8Array> = {};
  const imagePaths = new Map<string, string>();
  let index = 0,
    imageBytes = 0;
  for (const s of w.sheets)
    for (const { topic: n } of flatten(s.root)) {
      if (!n.image) continue;
      const existing = imagePaths.get(n.image);
      if (existing) {
        images.set(n, existing);
        continue;
      }
      const image = decodeImage(n.image);
      if (!image)
        bad(
          `主题「${n.title}」图片无法打包，请使用不超过 10 MB 的嵌入 PNG/JPEG/GIF/WebP 位图。`,
        );
      imageBytes += image.bytes.length;
      if (imageBytes > INPUT_LIMIT)
        bad("TextBundle 图片总量超过 20 MB，请减少图片后重试。");
      const asset = `assets/image-${++index}.${image.kind === "jpeg" ? "jpg" : image.kind}`;
      files[asset] = image.bytes;
      imagePaths.set(n.image, asset);
      images.set(n, asset);
    }
  files["text.md"] = strToU8(markdownContent(w, images));
  files["info.json"] = strToU8(
    JSON.stringify({
      version: 2,
      type: "net.daringfireball.markdown",
      transient: false,
      creatorIdentifier: YMIND_EXTENSION_PROVIDER,
      [YMIND_EXTENSION_PROVIDER]: {
        version: 1,
        title: w.title,
        sheets: w.sheets.length,
      },
    }),
  );
  if (
    Object.values(files).reduce((size, file) => size + file.length, 0) >
    EXPANDED_LIMIT
  )
    bad("TextBundle 未压缩内容超过 64 MB，请拆分文档。");
  const bytes = zipSync(files, { level: 6 });
  if (bytes.length > INPUT_LIMIT)
    bad("TextBundle 压缩包超过 20 MB，请减少图片或拆分文档。");
  return bytes;
}

export function parseMarkdown(
  value: string,
  title = "导入 Markdown",
): Workbook {
  if (strToU8(value).length > INPUT_LIMIT) bad("Markdown 不能超过 20 MB。");
  const sheets: Sheet[] = [];
  let active: Sheet | undefined;
  let pendingTitle: string | undefined;
  let headings: { level: number; node: Topic }[] = [];
  let lists: { indent: number; node: Topic }[] = [];
  let last: Topic | undefined;
  let fence: string | undefined;
  let count = 0;
  const newTopic = (raw: string) => {
    if (++count > NODE_LIMIT) bad("Markdown 主题数量超过 10000。");
    const link = /^\[(.*)\]\((?:<([^>]*)>|([^)]*))\)$/.exec(raw.trim());
    const result = topic(decodeMd(link ? link[1] : raw.trim()));
    if (link) result.url = link[2] ?? link[3];
    return result;
  };
  const ensureSheet = () => {
    if (!active) {
      active = sheet(title);
      sheets.push(active);
      headings = [{ level: 1, node: active.root }];
      count++;
    }
    return active;
  };
  for (const line of value.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      fence = fence ? undefined : fenceMatch[1][0];
      continue;
    }
    if (fence) {
      if (last) last.note = (last.note ? last.note + "\n" : "") + line;
      continue;
    }
    const meta = /^<!-- ymind-sheet: (.*) -->$/.exec(line);
    if (meta) {
      const v = parseJson(meta[1], "Markdown 画布标题");
      pendingTitle = typeof v === "string" ? v : undefined;
      continue;
    }
    if (!line.trim() || /^\s*(?:---|\*\*\*)\s*$/.test(line)) continue;
    const h = /^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(line);
    if (h) {
      const level = h[1].length,
        n = newTopic(h[2]);
      if (level === 1) {
        if (sheets.length >= 100) bad("Markdown 画布数量超过 100。");
        active = sheet(pendingTitle || n.title, n);
        sheets.push(active);
        pendingTitle = undefined;
        headings = [{ level, node: n }];
      } else {
        ensureSheet();
        while (headings.length > 1 && headings.at(-1)!.level >= level)
          headings.pop();
        headings.at(-1)!.node.children.push(n);
        headings.push({ level, node: n });
      }
      lists = [];
      last = n;
      continue;
    }
    const list = /^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      ensureSheet();
      const indent = list[1].replace(/\t/g, "    ").length;
      const n = newTopic(list[2].replace(/^\[[ xX]\]\s*/, ""));
      while (lists.length && lists.at(-1)!.indent >= indent) lists.pop();
      if (lists.length > DEPTH_LIMIT) bad("Markdown 层级超过 128。");
      (lists.at(-1)?.node || headings.at(-1)!.node).children.push(n);
      lists.push({ indent, node: n });
      last = n;
      continue;
    }
    const quote = /^\s*> ?(.*)$/.exec(line);
    if (quote) {
      last ||= ensureSheet().root;
      last.note = (last.note === undefined ? "" : last.note + "\n") + quote[1];
    } else if (!line.trim().startsWith("<!--")) {
      last ||= ensureSheet().root;
      last.note = (last.note ? last.note + "\n" : "") + line.trim();
    }
  }
  if (!sheets.length) bad("Markdown 没有可导入内容。");
  const result = workbook(sheets[0].title || title, sheets);
  result.sheets.forEach((s) => flatten(s.root));
  return validateWorkbook(result);
}

const xmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
function readXml(value: string): Record<string, unknown> {
  if (strToU8(value).length > INPUT_LIMIT) bad("XML 文件不能超过 20 MB。");
  if (/<!DOCTYPE|<!ENTITY/i.test(value))
    bad("不支持带 DTD 或自定义实体的 XML 文件。");
  const valid = XMLValidator.validate(value);
  if (valid !== true) bad(`XML 文件损坏：${valid.err.msg}`);
  // Bound nested tags before fast-xml-parser converts them to recursive JS objects.
  let depth = 0,
    tags = 0;
  for (const match of value.matchAll(
    /<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|(?:[^"'<>]|"[^"]*"|'[^']*')*)>/g,
  )) {
    const tag = match[0];
    if (/^<[/!?]/.test(tag)) {
      if (tag.startsWith("</")) depth--;
      continue;
    }
    if (++tags > NODE_LIMIT * 4) bad("XML 节点数量超过安全上限。");
    if (!tag.endsWith("/>") && ++depth > DEPTH_LIMIT + 4)
      bad("XML 层级超过安全上限。");
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    htmlEntities: true,
    isArray: (name) => name === "outline" || name === "node",
  });
  return record(parser.parse(value));
}

export function parseOpml(value: string, title = "导入 OPML"): Workbook {
  const xml = readXml(value),
    opml = optionalRecord(xml.opml),
    body = optionalRecord(opml.body);
  if (!own(xml, "opml") || !own(opml, "body")) bad("不是有效 OPML 文件。");
  let count = 0;
  function node(raw: unknown, depth = 0): Topic {
    if (++count > NODE_LIMIT || depth > DEPTH_LIMIT)
      bad("OPML 主题数量或层级超过上限。");
    const o = record(raw);
    const result = topic(text(o["@_text"], text(o["@_title"])));
    result.children = array(o.outline).map((c) => node(c, depth + 1));
    if (typeof o["@__note"] === "string") result.note = o["@__note"];
    if (typeof o["@_url"] === "string") result.url = o["@_url"];
    return result;
  }
  const outlines = array(body.outline);
  if (!outlines.length || outlines.length > 100)
    bad("OPML 没有主题，或顶层画布超过 100。");
  const sheets = outlines.map((o) => {
    const root = node(o);
    return sheet(text(optionalRecord(o)["@_ymind-sheet"], root.title), root);
  });
  return validateWorkbook(
    workbook(text(optionalRecord(opml.head).title, title), sheets),
  );
}

export function toOpml(input: Workbook): string {
  const w = parseYmind(input);
  const node = (n: Topic, sheetTitle?: string): string =>
    `<outline text="${xmlEscape(n.title)}"${sheetTitle ? ` ymind-sheet="${xmlEscape(sheetTitle)}"` : ""}${n.note ? ` _note="${xmlEscape(n.note).replace(/\n/g, "&#10;")}"` : ""}${n.url ? ` url="${xmlEscape(n.url)}"` : ""}>${n.children.map((c) => node(c)).join("")}</outline>`;
  return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>${xmlEscape(w.title)}</title></head><body>${w.sheets.map((s) => node(s.root, s.title)).join("")}</body></opml>`;
}
export function parseFreemind(
  value: string,
  title = "导入 FreeMind",
): Workbook {
  const xml = readXml(value),
    map = optionalRecord(xml.map);
  if (!own(xml, "map") || array(map.node).length !== 1)
    bad("FreeMind 必须有且只有一个根主题。");
  let count = 0;
  function node(raw: unknown, depth = 0): Topic {
    if (++count > NODE_LIMIT || depth > DEPTH_LIMIT)
      bad("FreeMind 主题数量或层级超过上限。");
    const o = record(raw);
    const result = topic(text(o["@_TEXT"], "无标题主题"));
    result.children = array(o.node).map((c) => node(c, depth + 1));
    if (typeof o["@_LINK"] === "string") result.url = o["@_LINK"];
    if (o["@_FOLDED"] === "true") result.collapsed = true;
    const attrs = Array.isArray(o.attribute)
      ? o.attribute
      : o.attribute
        ? [o.attribute]
        : [];
    const note = attrs
      .map(optionalRecord)
      .find((a) => a["@_NAME"] === "YMIND_NOTE");
    if (note) result.note = text(note["@_VALUE"]);
    return result;
  }
  const root = node(array(map.node)[0]);
  if (record(array(map.node)[0])["@_YMIND_WORKBOOK"] === "true") {
    if (!root.children.length || root.children.length > 100)
      bad("FreeMind YMIND 画布结构无效。");
    return validateWorkbook(
      workbook(
        root.title,
        root.children.map((n) => sheet(n.title, n)),
      ),
    );
  }
  return validateWorkbook(workbook(title, [sheet(root.title, root)]));
}
export function toFreemind(input: Workbook): string {
  const w = parseYmind(input);
  const node = (n: Topic): string =>
    `<node ID="${xmlEscape(n.id)}" TEXT="${xmlEscape(n.title)}"${n.url ? ` LINK="${xmlEscape(n.url)}"` : ""}${n.collapsed ? ' FOLDED="true"' : ""}>${n.note ? `<attribute NAME="YMIND_NOTE" VALUE="${xmlEscape(n.note).replace(/\n/g, "&#10;")}"/>` : ""}${n.children.map(node).join("")}</node>`;
  const nodes = w.sheets.map((s) => node(s.root)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><map version="1.0.1">${w.sheets.length === 1 ? nodes : `<node TEXT="${xmlEscape(w.title)}" YMIND_WORKBOOK="true">${nodes}</node>`}</map>`;
}

export async function parseDocument(file: File): Promise<Workbook> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const limit =
    extension === "ymind" || extension === "json"
      ? NATIVE_INPUT_LIMIT
      : INPUT_LIMIT;
  if (file.size > limit) bad(`输入文件不能超过 ${limit / 1024 / 1024} MB。`);
  if (!file.size) bad("文件为空。");
  const title = file.name.replace(/\.[^.]+$/, "") || "导入文档";
  if (extension === "xmind")
    return parseXmind(new Uint8Array(await file.arrayBuffer()), title);
  const value = await file.text();
  if (extension === "ymind" || extension === "json")
    return parseYmind(parseJson(value, file.name));
  if (extension === "md" || extension === "markdown" || extension === "txt")
    return parseMarkdown(value, title);
  if (extension === "opml") return parseOpml(value, title);
  if (extension === "mm") return parseFreemind(value, title);
  bad("支持 .ymind、.json、现代 .xmind、.md、.opml 和 .mm 文件。");
}

const blob = (data: string | Uint8Array, type: string) =>
  new Blob([typeof data === "string" ? data : new Uint8Array(data).buffer], {
    type,
  });

async function toDocx(w: Workbook): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    ExternalHyperlink,
  } = await import("docx");
  const paragraphs = [
    new Paragraph({ text: w.title, heading: HeadingLevel.TITLE }),
  ];
  for (const [index, s] of w.sheets.entries()) {
    paragraphs.push(
      new Paragraph({
        text: s.title,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
      }),
    );
    for (const { topic: n, depth } of flatten(s.root)) {
      paragraphs.push(
        new Paragraph({
          children: n.richText?.length
            ? n.richText.map(
                (run) =>
                  new TextRun({
                    text: run.text,
                    bold: run.bold ?? depth < 2,
                    italics: run.italic,
                    underline: run.underline ? {} : undefined,
                  }),
              )
            : [new TextRun({ text: n.title, bold: depth < 2 })],
          heading:
            depth < 4
              ? [
                  HeadingLevel.HEADING_2,
                  HeadingLevel.HEADING_3,
                  HeadingLevel.HEADING_4,
                  HeadingLevel.HEADING_5,
                ][depth]
              : undefined,
          indent:
            depth >= 4 ? { left: Math.min(depth - 3, 12) * 180 } : undefined,
          spacing: { after: 100 },
          keepNext: !!n.note,
        }),
      );
      if (n.note)
        for (const line of n.note.split(/\r?\n/))
          paragraphs.push(
            new Paragraph({ text: line, spacing: { after: 80 } }),
          );
      if (n.url)
        paragraphs.push(
          new Paragraph({
            children: [
              new ExternalHyperlink({
                children: [new TextRun({ text: n.url, style: "Hyperlink" })],
                link: n.url,
              }),
            ],
          }),
        );
      if (n.task)
        paragraphs.push(
          new Paragraph({
            text: `任务 ${n.task.status}  ${n.task.start || ""}${n.task.end ? " 至 " + n.task.end : ""}${n.task.assignee ? " 负责人 " + n.task.assignee : ""}`,
            spacing: { after: 140 },
          }),
        );
    }
  }
  const document = new Document({
    creator: "YMIND",
    title: w.title,
    styles: {
      default: {
        document: {
          run: { font: "Microsoft YaHei", size: 22, color: "000000" },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBlob(document);
}

async function toXlsx(w: Workbook): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "YMIND";
  book.created = new Date();
  const names = new Set<string>();
  for (const [i, s] of w.sheets.entries()) {
    let name =
      s.title.replace(/[\\/:?*\[\]]/g, " ").slice(0, 31) || `画布${i + 1}`;
    let suffix = 1;
    const base = name;
    while (names.has(name.toLowerCase()))
      name = base.slice(0, 26) + ` (${++suffix})`;
    names.add(name.toLowerCase());
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const headers = [
      "层级",
      "主题",
      "路径",
      "备注",
      "链接",
      "任务状态",
      "开始日期",
      "结束日期",
      "负责人",
      "进度",
    ];
    const widths = [7, 30, 60, 60, 40, 12, 18, 18, 20, 10];
    ws.columns = headers.map((header, index) => ({
      header,
      width: widths[index],
    }));
    for (const { topic: n, depth, path } of flatten(s.root)) {
      // Strings are text cells, including user titles beginning '='. No formulas are created.
      ws.addRow([
        depth,
        n.title,
        path.join(" / "),
        n.note || "",
        n.url || "",
        n.task?.status || "",
        n.task?.start || "",
        n.task?.end || "",
        n.task?.assignee || "",
        n.task?.progress ?? "",
      ]);
    }
    ws.autoFilter = { from: "A1", to: "J1" };
    ws.getRow(1).font = {
      name: "Microsoft YaHei",
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    ws.getRow(1).height = 26;
    ws.eachRow((row, rowIndex) =>
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFD9D9D9" } },
          bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
          left: { style: "thin", color: { argb: "FFD9D9D9" } },
          right: { style: "thin", color: { argb: "FFD9D9D9" } },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb:
              rowIndex === 1
                ? "FF34465A"
                : rowIndex % 2 === 0
                  ? "FFF1F4F9"
                  : "FFFFFFFF",
          },
        };
      }),
    );
  }
  return blob(
    new Uint8Array(await book.xlsx.writeBuffer()),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

async function toPptx(w: Workbook): Promise<Blob> {
  const branches = w.sheets.flatMap((s) =>
    (s.root.children.length ? s.root.children : [s.root]).map((n) => ({
      sheet: s,
      node: n,
    })),
  );
  if (branches.length > 50)
    bad("PowerPoint 最多导出 50 页，请先减少一层分支或拆分文档。");
  for (const b of branches)
    if (flatten(b.node).length > 23)
      bad(`分支「${b.node.title}」正文超过 22 行，请拆分后再导出 PowerPoint。`);
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "YMIND";
  deck.subject = w.title;
  deck.title = w.title;
  deck.company = "YMIND";
  deck.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };
  for (const [i, b] of branches.entries()) {
    const slide = deck.addSlide();
    slide.background = { color: "F7F8FC" };
    slide.addText(`${b.sheet.title}  /  ${i + 1}`, {
      x: 0.65,
      y: 0.3,
      w: 12,
      h: 0.4,
      fontSize: 12,
      color: "59657A",
      margin: 0,
    });
    slide.addText(b.node.title, {
      x: 0.65,
      y: 0.9,
      w: 12,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: "24374A",
      breakLine: false,
      fit: "shrink",
      margin: 0,
    });
    const descendants = flatten(b.node).slice(1);
    const body = descendants.length
      ? descendants
          .map(
            ({ topic: n, depth }) =>
              `${"    ".repeat(Math.min(depth - 1, 5))}${depth > 1 ? "◦" : "•"} ${n.title.replace(/[\r\n]/g, " ")}`,
          )
          .join("\n")
      : b.node.note || " ";
    slide.addText(body, {
      x: 0.8,
      y: 2.0,
      w: 11.8,
      h: 4.7,
      fontSize: descendants.length > 14 ? 14 : 18,
      color: "34465A",
      valign: "top",
      breakLine: false,
      fit: "shrink",
      margin: 0.08,
      paraSpaceAfter: 8,
    });
    slide.addNotes(
      [
        b.node.note || "",
        ...descendants
          .filter((d) => d.topic.note)
          .map((d) => d.topic.title + "\n" + d.topic.note),
      ].join("\n\n"),
    );
  }
  const data = await deck.write({ outputType: "arraybuffer" });
  return blob(
    new Uint8Array(data as ArrayBuffer),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
}

function validDate(
  value: string | undefined,
): { value: string; dateOnly: boolean; date: Date } | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + "T00:00:00Z");
    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? { value: value.replace(/-/g, ""), dateOnly: true, date }
      : undefined;
  }
  // Timed values require an explicit offset, so export never depends on the computer timezone.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return undefined;
  if (!validDate(value.slice(0, 10))) return undefined;
  const date = new Date(value);
  return !Number.isNaN(date.getTime())
    ? {
        value: date
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, ""),
        dateOnly: false,
        date,
      }
    : undefined;
}
const icsEscape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/[,;]/g, "\\$&");
function foldIcs(value: string): string {
  const result: string[] = [];
  let current = "",
    bytes = 0;
  for (const char of value) {
    const size = strToU8(char).length;
    if (bytes + size > 75) {
      result.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  result.push(current);
  return result.join("\r\n");
}
export function toIcs(input: Workbook): string {
  const w = parseYmind(input);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//YMIND//Local Mind Map//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  let events = 0;
  for (const s of w.sheets)
    for (const { topic: n } of flatten(s.root)) {
      if (!n.task) continue;
      const start = validDate(n.task.start),
        end = validDate(n.task.end);
      if (!start) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${encodeURIComponent(w.id)}-${encodeURIComponent(s.id)}-${encodeURIComponent(n.id)}@ymind.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART${start.dateOnly ? ";VALUE=DATE" : ""}:${start.value}`,
      );
      if (
        end &&
        end.dateOnly === start.dateOnly &&
        end.date.getTime() >= start.date.getTime()
      ) {
        const endValue = end.dateOnly
          ? new Date(end.date.getTime() + 86_400_000)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, "")
          : end.value;
        if (end.dateOnly || end.date > start.date)
          lines.push(`DTEND${end.dateOnly ? ";VALUE=DATE" : ""}:${endValue}`);
      }
      lines.push(
        `SUMMARY:${icsEscape(n.title)}`,
        `DESCRIPTION:${icsEscape([n.note, `画布：${s.title}`, `任务状态：${n.task.status}`, n.task.assignee && `负责人：${n.task.assignee}`].filter(Boolean).join("\n"))}`,
      );
      if (n.url && /^https?:\/\//i.test(n.url))
        lines.push(`URL:${n.url.replace(/[\r\n]/g, "")}`);
      lines.push("END:VEVENT");
      events++;
    }
  if (!events)
    bad(
      "没有可导出的日历任务。请先设置有效开始日期（YYYY-MM-DD 或含时区的 ISO 时间）。",
    );
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}

export async function exportDocument(
  input: Workbook,
  format: ExportFormat,
): Promise<{ blob: Blob; extension: string }> {
  const w = parseYmind(input);
  switch (format) {
    case "ymind": {
      const data = JSON.stringify(w, null, 2);
      if (strToU8(data).length > NATIVE_INPUT_LIMIT)
        bad("YMIND 文件序列化后超过 64 MB，请移除部分附件或拆分文档。");
      return {
        blob: blob(data, "application/json"),
        extension: "ymind",
      };
    }
    case "xmind":
      return { blob: blob(toXmind(w), "application/zip"), extension: "xmind" };
    case "markdown":
      return {
        blob: blob(toMarkdown(w), "text/markdown;charset=utf-8"),
        extension: "md",
      };
    case "textbundle":
      return {
        blob: blob(toTextbundle(w), "application/zip"),
        extension: "textpack",
      };
    case "opml":
      return {
        blob: blob(toOpml(w), "text/x-opml;charset=utf-8"),
        extension: "opml",
      };
    case "freemind":
      return {
        blob: blob(toFreemind(w), "application/xml;charset=utf-8"),
        extension: "mm",
      };
    case "docx":
      return { blob: await toDocx(w), extension: "docx" };
    case "xlsx":
      return { blob: await toXlsx(w), extension: "xlsx" };
    case "pptx":
      return { blob: await toPptx(w), extension: "pptx" };
    case "ics":
      return {
        blob: blob(toIcs(w), "text/calendar;charset=utf-8"),
        extension: "ics",
      };
    default:
      return bad("不支持的导出格式。");
  }
}
