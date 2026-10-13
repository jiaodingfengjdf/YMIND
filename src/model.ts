import type {
  Annotation,
  Layout,
  Relation,
  RichTextRun,
  Sheet,
  Theme,
  Topic,
  TopicStyle,
  TopicTask,
  Workbook,
} from "./domain.ts";

export const MAX_WORKBOOK_BYTES = 64 * 1024 * 1024;

let sequence = 0;
export function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `ym-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function createTopic(title = "新主题"): Topic {
  return { id: uid(), title, children: [] };
}

function branch(title: string, children: string[]): Topic {
  return { ...createTopic(title), children: children.map(createTopic) };
}

export function createWorkbook(): Workbook {
  const first: Sheet = {
    id: uid(),
    title: "产品规划",
    layout: "mindmap",
    theme: "classic",
    relations: [],
    annotations: [],
    root: {
      ...createTopic("产品规划"),
      children: [
        branch("产品愿景", ["思维导图", "自由表达"]),
        branch("目标用户", ["个人创作者", "项目团队"]),
        branch("核心功能", ["快捷编辑", "本地保存", "多格式导出"]),
        branch("用户体验", ["简洁界面", "键盘操作"]),
        branch("开发计划", ["原型设计", "开发测试"]),
        branch("验收标准", ["导入导出", "编辑体验"]),
      ],
    },
  };
  const second: Sheet = {
    id: uid(),
    title: "实施计划",
    layout: "right",
    theme: "ocean",
    relations: [],
    annotations: [],
    root: {
      ...createTopic("实施计划"),
      children: [
        {
          ...branch("设计阶段", ["确定需求", "绘制原型"]),
          task: { status: "done", progress: 100 },
        },
        {
          ...branch("开发阶段", ["实现编辑器", "完成导入导出"]),
          task: { status: "doing", progress: 50 },
        },
        {
          ...branch("验收阶段", ["功能测试", "打包发布"]),
          task: { status: "todo", progress: 0 },
        },
      ],
    },
  };
  return {
    version: 1,
    id: uid(),
    title: "产品规划",
    sheets: [first, second],
    activeSheetId: first.id,
    updatedAt: new Date().toISOString(),
  };
}

/** Includes collapsed descendants: collapsing changes visibility, not document ownership. */
export function flattenTopics(root: Topic): Topic[] {
  const result: Topic[] = [];
  const stack = [root];
  while (stack.length) {
    const topic = stack.pop()!;
    result.push(topic);
    for (let i = topic.children.length - 1; i >= 0; i--)
      stack.push(topic.children[i]);
  }
  return result;
}

export function findTopic(root: Topic, id: string): Topic | undefined {
  const stack = [root];
  while (stack.length) {
    const topic = stack.pop()!;
    if (topic.id === id) return topic;
    for (let i = topic.children.length - 1; i >= 0; i--)
      stack.push(topic.children[i]);
  }
  return undefined;
}

function parentOf(root: Topic, id: string): Topic | undefined {
  const stack = [root];
  while (stack.length) {
    const topic = stack.pop()!;
    if (topic.children.some((child) => child.id === id)) return topic;
    stack.push(...topic.children);
  }
  return undefined;
}

/** Mutates an already cloned tree, allowing one application transaction per edit. */
export function updateTopic(
  root: Topic,
  id: string,
  updater: (topic: Topic) => void,
): boolean {
  const topic = findTopic(root, id);
  if (!topic) return false;
  updater(topic);
  if (
    topic.richText &&
    topic.richText.map((run) => run.text).join("") !== topic.title
  )
    delete topic.richText;
  return true;
}

export function addChild(
  root: Topic,
  parentId: string,
  title?: string,
): Topic | undefined {
  const parent = findTopic(root, parentId);
  if (!parent) return undefined;
  const child = createTopic(title);
  parent.children.push(child);
  parent.collapsed = false;
  return child;
}

export function addSibling(
  root: Topic,
  id: string,
  title?: string,
): Topic | undefined {
  if (id === root.id) return undefined;
  const parent = parentOf(root, id);
  if (!parent) return undefined;
  const sibling = createTopic(title);
  parent.children.splice(
    parent.children.findIndex((child) => child.id === id) + 1,
    0,
    sibling,
  );
  parent.collapsed = false;
  return sibling;
}

export function removeTopic(root: Topic, id: string): boolean {
  if (id === root.id) return false;
  const parent = parentOf(root, id);
  if (!parent) return false;
  parent.children.splice(
    parent.children.findIndex((child) => child.id === id),
    1,
  );
  return true;
}

export function moveTopic(
  root: Topic,
  id: string,
  newParentId: string,
): boolean {
  if (id === root.id || id === newParentId) return false;
  const source = findTopic(root, id);
  const oldParent = parentOf(root, id);
  const newParent = findTopic(root, newParentId);
  if (!source || !oldParent || !newParent || findTopic(source, newParentId))
    return false;
  if (oldParent === newParent) {
    if (!source.floating || newParent !== root) return false;
    delete source.floating;
    newParent.collapsed = false;
    return true;
  }
  oldParent.children.splice(
    oldParent.children.findIndex((child) => child.id === id),
    1,
  );
  newParent.children.push(source);
  delete source.floating;
  newParent.collapsed = false;
  return true;
}

export function countTopics(root: Topic): number {
  return flattenTopics(root).length;
}

const palettes: Record<Theme, string[]> = {
  classic: ["#4586ff", "#9870ff", "#ffa526", "#2cc5b6", "#ff6b69", "#98c523"],
  ocean: ["#087fa5", "#2099b4", "#327de0", "#3764b7", "#46a1b3", "#287ba2"],
  forest: ["#28845b", "#65a540", "#32956d", "#9b9e2c", "#5a9562", "#47817a"],
  sunset: ["#d46a42", "#de8d35", "#c85268", "#bd6a91", "#bd862c", "#d68170"],
  violet: ["#8361c8", "#a66ccb", "#6666c3", "#aa5b9b", "#785ac0", "#976eb6"],
  mono: ["#46566b", "#69788b", "#526477", "#748396", "#55687e", "#8793a2"],
  dark: ["#77b0ff", "#e8bf61", "#bd99ed", "#70d1aa", "#eca56a", "#e390b2"],
};

export function themeColors(theme: Theme): string[] {
  return [...palettes[theme]];
}

const layouts: Layout[] = [
  "mindmap",
  "right",
  "left",
  "org",
  "tree",
  "timeline",
  "fishbone",
  "radial",
  "brace",
  "treetable",
  "matrix",
  "org-up",
  "timeline-vertical",
];
const themes: Theme[] = [
  "classic",
  "ocean",
  "forest",
  "sunset",
  "violet",
  "mono",
  "dark",
];
const shapes = ["round", "rect", "ellipse", "underline", "diamond"] as const;

function fail(path: string, expected: string): never {
  throw new Error(`文档格式错误：${path} ${expected}`);
}

function object(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail(path, "必须是对象");
  return input as Record<string, unknown>;
}

function string(
  input: unknown,
  path: string,
  maximum = 20_000,
  nonempty = false,
): string {
  if (
    typeof input !== "string" ||
    input.length > maximum ||
    (nonempty && !input.length)
  )
    fail(path, "必须是有效字符串");
  return input;
}

function array(input: unknown, path: string, maximum = 10_000): unknown[] {
  if (!Array.isArray(input) || input.length > maximum)
    fail(path, "必须是有效数组");
  return input;
}

function choice<T extends string>(
  input: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof input !== "string" || !values.includes(input as T))
    fail(path, "包含不支持的值");
  return input as T;
}

function finite(
  input: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < minimum ||
    input > maximum
  )
    fail(path, "数值超出范围");
  return input;
}

function style(input: unknown, path: string): TopicStyle {
  const value = object(input, path);
  const result: TopicStyle = {};
  for (const key of ["color", "textColor"] as const)
    if (value[key] !== undefined)
      result[key] = string(value[key], `${path}.${key}`, 256);
  if (value.fontSize !== undefined)
    result.fontSize = finite(value.fontSize, `${path}.fontSize`, 8, 72);
  for (const key of ["bold", "italic"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") fail(`${path}.${key}`, "必须是布尔值");
    result[key] = value[key];
  }
  if (value.shape !== undefined)
    result.shape = choice(value.shape, shapes, `${path}.shape`);
  return result;
}

function task(input: unknown, path: string): TopicTask {
  const value = object(input, path);
  const result: TopicTask = {
    status: choice(value.status, ["todo", "doing", "done"], `${path}.status`),
  };
  for (const key of ["start", "end", "assignee"] as const)
    if (value[key] !== undefined)
      result[key] = string(value[key], `${path}.${key}`, 1_000);
  if (value.progress !== undefined)
    result.progress = finite(value.progress, `${path}.progress`, 0, 100);
  return result;
}

interface ValidationContext {
  nodes: number;
  bytes: number;
  objects: WeakSet<object>;
  ids: Set<string>;
}

function utf8Size(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

function budgetStrings(
  value: unknown,
  context: ValidationContext,
  path: string,
): void {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") context.bytes += utf8Size(current);
    else if (current && typeof current === "object")
      pending.push(...Object.values(current));
    if (context.bytes > MAX_WORKBOOK_BYTES)
      fail(path, "文档文本内容超过 64 MiB 的导入上限");
  }
}

function richText(input: unknown, path: string, title: string): RichTextRun[] {
  const runs = array(input, path, 256).map((item, index): RichTextRun => {
    const runPath = `${path}[${index}]`;
    const value = object(item, runPath);
    const result: RichTextRun = { text: string(value.text, `${runPath}.text`) };
    for (const key of ["bold", "italic", "underline"] as const) {
      if (value[key] === undefined) continue;
      if (typeof value[key] !== "boolean")
        fail(`${runPath}.${key}`, "必须是布尔值");
      result[key] = value[key];
    }
    return result;
  });
  if (runs.map((run) => run.text).join("") !== title)
    fail(path, "富文本段落合并后必须与主题标题相等");
  return runs;
}

function topic(
  input: unknown,
  path: string,
  context: ValidationContext,
  depth = 0,
): Topic {
  // These bounds keep recursive validation and browser editing within a predictable budget.
  if (++context.nodes > 10_000 || depth > 128)
    fail(path, "超过 10,000 节点或 128 层的导入上限");
  const value = object(input, path);
  if (context.objects.has(value)) fail(path, "不能有循环引用或重复的节点对象");
  context.objects.add(value);
  const id = string(value.id, `${path}.id`, 256, true);
  if (context.ids.has(id)) fail(`${path}.id`, "节点标识不能重复");
  context.ids.add(id);
  const result: Topic = {
    id,
    title: string(value.title, `${path}.title`),
    children: [],
  };
  if (value.collapsed !== undefined) {
    if (typeof value.collapsed !== "boolean")
      fail(`${path}.collapsed`, "必须是布尔值");
    result.collapsed = value.collapsed;
  }
  for (const key of ["note", "url", "image", "equation"] as const) {
    if (value[key] === undefined) continue;
    result[key] = string(
      value[key],
      `${path}.${key}`,
      key === "image" ? 25_000_000 : 1_000_000,
    );
  }
  if (value.markers !== undefined)
    result.markers = array(value.markers, `${path}.markers`, 64).map(
      (item, index) => string(item, `${path}.markers[${index}]`, 256),
    );
  if (value.labels !== undefined)
    result.labels = array(value.labels, `${path}.labels`, 32).map(
      (item, index) => string(item, `${path}.labels[${index}]`, 256),
    );
  if (value.richText !== undefined)
    result.richText = richText(
      value.richText,
      `${path}.richText`,
      result.title,
    );
  if (value.floating !== undefined) {
    if (depth !== 1)
      fail(`${path}.floating`, "悬浮主题必须是根主题的直接子主题");
    const position = object(value.floating, `${path}.floating`);
    const limit = Number.MAX_SAFE_INTEGER / 4;
    result.floating = {
      x: finite(position.x, `${path}.floating.x`, -limit, limit),
      y: finite(position.y, `${path}.floating.y`, -limit, limit),
    };
  }
  if (value.task !== undefined) result.task = task(value.task, `${path}.task`);
  if (value.style !== undefined)
    result.style = style(value.style, `${path}.style`);
  if (value.attachment !== undefined) {
    const attachment = object(value.attachment, `${path}.attachment`);
    result.attachment = {
      name: string(attachment.name, `${path}.attachment.name`, 1_000),
      type: string(attachment.type, `${path}.attachment.type`, 1_000),
      data: string(attachment.data, `${path}.attachment.data`, 25_000_000),
    };
  }
  budgetStrings(result, context, path);
  result.children = array(value.children, `${path}.children`).map(
    (child, index) =>
      topic(child, `${path}.children[${index}]`, context, depth + 1),
  );
  return result;
}

function relation(
  input: unknown,
  path: string,
  topicIds: Set<string>,
  ids: Set<string>,
): Relation {
  const value = object(input, path);
  const result: Relation = {
    id: string(value.id, `${path}.id`, 256, true),
    from: string(value.from, `${path}.from`, 256, true),
    to: string(value.to, `${path}.to`, 256, true),
    label: string(value.label, `${path}.label`),
  };
  if (ids.has(result.id)) fail(`${path}.id`, "关系线标识不能重复");
  ids.add(result.id);
  if (!topicIds.has(result.from) || !topicIds.has(result.to))
    fail(path, "关系线引用了不存在的节点");
  if (value.color !== undefined)
    result.color = string(value.color, `${path}.color`, 256);
  return result;
}

function annotation(
  input: unknown,
  path: string,
  topicIds: Set<string>,
  ids: Set<string>,
): Annotation {
  const value = object(input, path);
  const result: Annotation = {
    id: string(value.id, `${path}.id`, 256, true),
    kind: choice(value.kind, ["boundary", "summary"], `${path}.kind`),
    topicIds: array(value.topicIds, `${path}.topicIds`).map((item, index) =>
      string(item, `${path}.topicIds[${index}]`, 256, true),
    ),
    label: string(value.label, `${path}.label`),
  };
  if (ids.has(result.id)) fail(`${path}.id`, "注释标识不能重复");
  ids.add(result.id);
  if (
    !result.topicIds.length ||
    result.topicIds.some((id) => !topicIds.has(id))
  )
    fail(path, "边界或概要必须引用存在的节点");
  if (value.color !== undefined)
    result.color = string(value.color, `${path}.color`, 256);
  return result;
}

/** Rebuilds known fields so imported data never becomes the application's mutable object by reference. */
export function validateWorkbook(input: unknown): Workbook {
  const value = object(input, "workbook");
  if (value.version !== 1) fail("version", "仅支持 YMIND 文档版本 1");
  const context: ValidationContext = {
    nodes: 0,
    bytes: 0,
    objects: new WeakSet(),
    ids: new Set(),
  };
  const sheetIds = new Set<string>();
  const sheets = array(value.sheets, "sheets", 100).map(
    (item, index): Sheet => {
      const path = `sheets[${index}]`;
      const entry = object(item, path);
      const id = string(entry.id, `${path}.id`, 256, true);
      if (sheetIds.has(id)) fail(`${path}.id`, "画布标识不能重复");
      sheetIds.add(id);
      // Topic references are sheet-local; the global node budget still covers the entire workbook.
      context.ids = new Set();
      const root = topic(entry.root, `${path}.root`, context);
      const relationIds = new Set<string>();
      const annotationIds = new Set<string>();
      const result: Sheet = {
        id,
        title: string(entry.title, `${path}.title`),
        root,
        layout: choice(entry.layout, layouts, `${path}.layout`),
        theme: choice(entry.theme, themes, `${path}.theme`),
        relations: array(entry.relations, `${path}.relations`).map((value, i) =>
          relation(value, `${path}.relations[${i}]`, context.ids, relationIds),
        ),
        annotations: array(entry.annotations, `${path}.annotations`).map(
          (value, i) =>
            annotation(
              value,
              `${path}.annotations[${i}]`,
              context.ids,
              annotationIds,
            ),
        ),
      };
      if (entry.numbering !== undefined)
        result.numbering = choice(
          entry.numbering,
          ["none", "decimal", "hierarchical", "roman"] as const,
          `${path}.numbering`,
        );
      // Topics were counted as they were parsed; now account for sheet-local metadata.
      budgetStrings(
        {
          id: result.id,
          title: result.title,
          relations: result.relations,
          annotations: result.annotations,
        },
        context,
        path,
      );
      return result;
    },
  );
  if (!sheets.length) fail("sheets", "文档必须至少包含一个画布");
  const activeSheetId = string(value.activeSheetId, "activeSheetId", 256, true);
  if (!sheetIds.has(activeSheetId)) fail("activeSheetId", "当前画布不存在");
  const updatedAt = string(value.updatedAt, "updatedAt", 64, true);
  if (!Number.isFinite(Date.parse(updatedAt)))
    fail("updatedAt", "必须是有效日期");
  const result: Workbook = {
    version: 1,
    id: string(value.id, "id", 256, true),
    title: string(value.title, "title"),
    sheets,
    activeSheetId,
    updatedAt,
  };
  budgetStrings(
    { id: result.id, title: result.title, activeSheetId, updatedAt },
    context,
    "workbook",
  );
  return result;
}
