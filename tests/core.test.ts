import assert from "node:assert/strict";
import test from "node:test";
import type { Layout, LayoutResult, Sheet, Topic } from "../src/domain.ts";
import {
  MAX_WORKBOOK_BYTES,
  addChild,
  addSibling,
  countTopics,
  createTopic,
  createWorkbook,
  findTopic,
  flattenTopics,
  moveTopic,
  removeTopic,
  themeColors,
  uid,
  updateTopic,
  validateWorkbook,
} from "../src/model.ts";
import { computeLayout, measureTopic, wrapText } from "../src/layout.ts";

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

function assertLayout(result: LayoutResult): void {
  assert.ok(result.nodes.length >= 1);
  assert.equal(
    new Set(result.nodes.map((node) => node.id)).size,
    result.nodes.length,
  );
  assert.equal(
    result.edges.length,
    result.nodes.filter((node) => node.parentId !== undefined).length,
  );
  for (const node of result.nodes) {
    for (const value of [node.x, node.y, node.width, node.height, node.depth])
      assert.ok(Number.isFinite(value), `${node.topic.title}: finite geometry`);
    assert.ok(node.width > 0 && node.height > 0);
    assert.ok(node.width <= 220);
    assert.ok(
      node.x >= result.bounds.x - 0.0001 && node.y >= result.bounds.y - 0.0001,
    );
    assert.ok(
      node.x + node.width <= result.bounds.x + result.bounds.width + 0.0001,
    );
    assert.ok(
      node.y + node.height <= result.bounds.y + result.bounds.height + 0.0001,
    );
  }
  assert.equal(
    result.bounds.x,
    Math.min(...result.nodes.map((node) => node.x)),
  );
  assert.equal(
    result.bounds.y,
    Math.min(...result.nodes.map((node) => node.y)),
  );
  assert.equal(
    result.bounds.width,
    Math.max(...result.nodes.map((node) => node.x + node.width)) -
      result.bounds.x,
  );
  assert.equal(
    result.bounds.height,
    Math.max(...result.nodes.map((node) => node.y + node.height)) -
      result.bounds.y,
  );
  for (let i = 0; i < result.nodes.length; i++) {
    for (let j = i + 1; j < result.nodes.length; j++) {
      const a = result.nodes[i];
      const b = result.nodes[j];
      const overlapX = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01;
      const overlapY =
        a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
      assert.ok(
        !(overlapX && overlapY),
        `overlapping topics: ${a.topic.title} / ${b.topic.title}`,
      );
    }
  }
  const ids = new Set(result.nodes.map((node) => node.id));
  for (const edge of result.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to));
    assert.match(edge.path, /^M /);
    assert.match(edge.path, / C /);
    assert.doesNotMatch(edge.path, /NaN|Infinity|undefined/);
  }
}

test("initial workbook matches the planning concept and contains an independent task sheet", () => {
  const workbook = createWorkbook();
  assert.equal(workbook.sheets.length, 2);
  assert.equal(workbook.activeSheetId, workbook.sheets[0].id);
  assert.equal(workbook.sheets[0].root.title, "产品规划");
  assert.deepEqual(
    workbook.sheets[0].root.children.map((topic) => [
      topic.title,
      topic.children.map((child) => child.title),
    ]),
    [
      ["产品愿景", ["思维导图", "自由表达"]],
      ["目标用户", ["个人创作者", "项目团队"]],
      ["核心功能", ["快捷编辑", "本地保存", "多格式导出"]],
      ["用户体验", ["简洁界面", "键盘操作"]],
      ["开发计划", ["原型设计", "开发测试"]],
      ["验收标准", ["导入导出", "编辑体验"]],
    ],
  );
  assert.equal(workbook.sheets[1].title, "实施计划");
  assert.ok(flattenTopics(workbook.sheets[1].root).some((topic) => topic.task));
  assert.equal(countTopics(workbook.sheets[0].root), 20);
  assert.equal(new Set(Array.from({ length: 1_000 }, uid)).size, 1_000);
});

test("editing operations preserve identity and refuse invalid tree ownership", () => {
  const root = createTopic("根");
  const first = addChild(root, root.id, "第一分支")!;
  const second = addSibling(root, first.id, "第二分支")!;
  const leaf = addChild(root, first.id, "子主题")!;
  assert.deepEqual(
    root.children.map((topic) => topic.id),
    [first.id, second.id],
  );
  assert.equal(
    updateTopic(root, leaf.id, (topic) => {
      topic.title = "已修改";
      topic.note = "说明";
    }),
    true,
  );
  assert.equal(findTopic(root, leaf.id)?.title, "已修改");
  assert.equal(moveTopic(root, root.id, second.id), false);
  assert.equal(moveTopic(root, first.id, leaf.id), false);
  assert.equal(moveTopic(root, first.id, first.id), false);
  assert.equal(moveTopic(root, leaf.id, "missing"), false);
  assert.equal(countTopics(root), 4);
  assert.equal(moveTopic(root, leaf.id, second.id), true);
  assert.equal(second.children[0], leaf);
  assert.equal(first.children.length, 0);
  assert.equal(removeTopic(root, root.id), false);
  assert.equal(addSibling(root, root.id), undefined);
  assert.equal(
    updateTopic(root, "missing", () => assert.fail("should not update")),
    false,
  );
  assert.equal(addChild(root, "missing"), undefined);
  assert.equal(removeTopic(root, first.id), true);
  assert.equal(removeTopic(root, first.id), false);
  second.collapsed = true;
  assert.equal(findTopic(root, leaf.id), leaf);
  assert.equal(countTopics(root), 3);
  addChild(root, second.id);
  assert.equal(second.collapsed, false);
});

test("workbook validation preserves supported details in independent objects", () => {
  const workbook = createWorkbook();
  const sheet = workbook.sheets[0];
  const child = sheet.root.children[0];
  child.note = "工作说明";
  child.url = "https://example.com/path?q=hello";
  child.image = "data:image/png;base64,AAAA";
  child.attachment = {
    name: "note.txt",
    data: "data:text/plain;base64,SGk=",
    type: "text/plain",
  };
  child.task = {
    status: "doing",
    progress: 25,
    start: "2026-10-13",
    end: "2026-10-20",
    assignee: "作者",
  };
  child.markers = ["⭐", "1"];
  child.equation = "x^2";
  child.style = {
    color: "#123456",
    textColor: "#445566",
    bold: true,
    italic: true,
    fontSize: 20,
    shape: "round",
  };
  sheet.relations.push({
    id: uid(),
    from: child.id,
    to: sheet.root.children[1].id,
    label: "依赖",
    color: "#999",
  });
  sheet.annotations.push({
    id: uid(),
    kind: "summary",
    topicIds: [child.id],
    label: "阶段总结",
  });
  const validated = validateWorkbook(workbook);
  assert.deepEqual(validated, workbook);
  assert.notEqual(validated, workbook);
  assert.notEqual(validated.sheets[0].root.children[0].style, child.style);
  validated.sheets[0].root.title = "另一个文档";
  assert.equal(workbook.sheets[0].root.title, "产品规划");
});

test("bad or resource-exhausting imports are rejected before they replace the document", () => {
  for (const bad of [null, [], "text", {}, { version: 2 }])
    assert.throws(() => validateWorkbook(bad), /文档格式错误/);
  const cases: Array<(workbook: ReturnType<typeof createWorkbook>) => void> = [
    (value) => {
      value.activeSheetId = "missing";
    },
    (value) => {
      value.sheets = [];
    },
    (value) => {
      value.sheets[0].root.children[0].id = value.sheets[0].root.id;
    },
    (value) => {
      value.sheets[0].root.children.push(value.sheets[0].root);
    },
    (value) => {
      value.sheets[0].root.style = { fontSize: NaN };
    },
    (value) => {
      value.sheets[0].root.task = { status: "doing", progress: 101 };
    },
    (value) => {
      value.sheets[0].relations.push({
        id: uid(),
        from: "missing",
        to: value.sheets[0].root.id,
        label: "",
      });
    },
    (value) => {
      value.sheets[0].annotations.push({
        id: uid(),
        kind: "boundary",
        topicIds: [],
        label: "",
      });
    },
    (value) => {
      value.updatedAt = "not a date";
    },
    (value) => {
      value.sheets[0].root.title = "字".repeat(20_001);
    },
    (value) => {
      let node = value.sheets[0].root;
      for (let i = 0; i < 129; i++) {
        const child = createTopic();
        node.children = [child];
        node = child;
      }
    },
  ];
  for (const mutate of cases) {
    const workbook = createWorkbook();
    mutate(workbook);
    assert.throws(() => validateWorkbook(workbook), /文档格式错误/);
  }
});

for (const layout of layouts) {
  test(`${layout}: finite paths, exact bounds, no overlap, collapsed descendants excluded`, () => {
    const sheet = createWorkbook().sheets[0];
    sheet.layout = layout;
    sheet.root.children[0].collapsed = true;
    const hiddenIds = sheet.root.children[0].children.map((topic) => topic.id);
    sheet.root.children[1].title =
      "用于测试换行与节点尺寸的较长主题标题".repeat(4);
    sheet.root.children[2].children[0].image = "data:image/png;base64,AAAA";
    const result = computeLayout(sheet);
    assertLayout(result);
    assert.equal(
      result.nodes.length,
      countTopics(sheet.root) - hiddenIds.length,
    );
    assert.ok(
      hiddenIds.every((id) => result.nodes.every((node) => node.id !== id)),
    );
    assert.ok(
      result.nodes.find((node) => node.id === sheet.root.children[1].id)!
        .height > 46,
    );
    assert.equal(
      result.nodes.find(
        (node) => node.id === sheet.root.children[2].children[0].id,
      )!.height,
      measureTopic(sheet.root.children[2].children[0], 2).height,
    );
    assert.equal(result.nodes[0].x + result.nodes[0].width / 2, 0);
    assert.equal(result.nodes[0].y + result.nodes[0].height / 2, 0);
    if (layout === "mindmap")
      assert.equal(
        result.nodes.filter((node) => node.depth === 1 && node.side === "left")
          .length,
        3,
      );
  });
}

test("all thirteen layout selections produce different coordinates on the same document", () => {
  const sheet = createWorkbook().sheets[0];
  const geometries = layouts.map((layout) =>
    computeLayout({ ...sheet, layout })
      .nodes.map((node) => `${node.x},${node.y}`)
      .join("|"),
  );
  assert.equal(new Set(geometries).size, layouts.length);
});

test("shared measurement budgets every title, media, marker and wrapped task row before layout", () => {
  const topic = createTopic("带图片的完整任务");
  topic.image = "data:image/png;base64,AAAA";
  topic.equation = "x^2";
  topic.markers = ["⭐ 优先事项", "任务开始", "跨部门协作"];
  topic.task = {
    status: "doing",
    progress: 20,
    start: "2026-10-13",
    end: "2026-11-15",
    assignee: "设计团队与开发团队",
  };
  const measured = measureTopic(topic, 2);
  assert.ok(measured.markerLines.length > 1);
  assert.ok(measured.taskLines.length > 1);
  assert.equal(
    measured.height,
    Math.ceil(
      24 +
        measured.titleLines.length * measured.fontSize * 1.35 +
        100 +
        60 +
        measured.markerLines.length * 20 +
        30 +
        measured.taskLines.length * 14,
    ),
  );
  const attachmentOnly = {
    ...topic,
    attachment: {
      name: "说明",
      data: "data:text/plain;base64,AAAA",
      type: "text/plain",
    },
  };
  assert.equal(
    measureTopic(attachmentOnly, 2).height,
    measured.height,
    "attachments render as indicators rather than rows",
  );
  assert.equal(
    measureTopic({ ...topic, style: { fontSize: 72 } }, 2).fontSize,
    48,
  );
  assert.deepEqual(wrapText("👩‍💻👩‍💻", 16, 16), ["👩‍💻", "👩‍💻"]);
  assert.deepEqual(wrapText("甲\r\n乙\r丙", 100, 16), ["甲", "乙", "丙"]);
  for (const layout of layouts) {
    const sheet = createWorkbook().sheets[0];
    sheet.layout = layout;
    sheet.root.children[0].children.push(
      topic,
      structuredClone({ ...topic, id: uid(), title: "另一个带媒体任务" }),
    );
    const result = computeLayout(sheet);
    assertLayout(result);
    assert.equal(
      result.nodes.find((node) => node.id === topic.id)!.height,
      measured.height,
    );
  }
});

test("uneven deeper trees remain non-overlapping in every layout", () => {
  const root = createTopic("不平衡导图");
  function populate(parent: Topic, depth: number, branchIndex: number): void {
    if (!depth) return;
    const count = (branchIndex % 3) + 1;
    for (let index = 0; index < count; index++) {
      const child = addChild(
        root,
        parent.id,
        index % 2 ? "较长主题".repeat(depth * 4) : `主题 ${depth}/${index}`,
      )!;
      if (index === 1 && depth === 2)
        child.image = "data:image/png;base64,AAAA";
      populate(child, depth - 1, branchIndex + index + 1);
    }
  }
  populate(root, 4, 5);
  const sheet: Sheet = {
    id: uid(),
    title: "布局验证",
    root,
    layout: "mindmap",
    theme: "classic",
    annotations: [],
    relations: [],
  };
  for (const layout of layouts)
    assertLayout(computeLayout({ ...sheet, layout }));
});

test("branch palettes and explicit overrides stay stable through collapse and do not mutate document", () => {
  const sheet = createWorkbook().sheets[0];
  const colors = themeColors("classic");
  colors[0] = "mutated";
  assert.notEqual(themeColors("classic")[0], "mutated");
  const branch = sheet.root.children[0];
  branch.style = { color: "#abcdef" };
  branch.children[0].style = { color: "#654321" };
  const before = structuredClone(sheet);
  const layout = computeLayout(sheet);
  assert.deepEqual(sheet, before);
  assert.equal(
    layout.nodes.find((node) => node.id === branch.id)!.color,
    "#abcdef",
  );
  assert.equal(
    layout.nodes.find((node) => node.id === branch.children[0].id)!.color,
    "#654321",
  );
  assert.equal(
    layout.nodes.find((node) => node.id === branch.children[1].id)!.color,
    "#abcdef",
  );
  const otherColors = new Map(
    layout.nodes
      .filter((node) => node.depth === 1)
      .map((node) => [node.id, node.color]),
  );
  branch.collapsed = true;
  for (const node of computeLayout(sheet).nodes.filter(
    (node) => node.depth === 1,
  ))
    assert.equal(node.color, otherColors.get(node.id));
});

test("new layout modes and supported rich metadata survive validation without changing source fields", () => {
  const workbook = createWorkbook();
  const topic = workbook.sheets[0].root.children[0];
  topic.labels = ["产品", "重点"];
  topic.richText = [
    { text: "产品", bold: true },
    { text: "愿景", italic: true, underline: true },
  ];
  topic.floating = { x: -3200.5, y: 1400.25 };
  workbook.sheets[0].numbering = "hierarchical";
  for (const layout of layouts) {
    workbook.sheets[0].layout = layout;
    assert.deepEqual(validateWorkbook(workbook), workbook);
  }
  const copied = structuredClone(topic);
  flattenTopics(copied).forEach((node) => {
    node.id = uid();
  });
  copied.floating = { x: 3200, y: -1400 };
  workbook.sheets[0].root.children.push(copied);
  const validated = validateWorkbook(workbook);
  assert.deepEqual(
    validated.sheets[0].root.children.at(-1)?.richText,
    topic.richText,
  );
  assert.notEqual(
    validated.sheets[0].root.children.at(-1)?.richText,
    topic.richText,
  );
});

test("metadata validation rejects invalid applicability, coordinates, labels, rich runs and numbering", () => {
  const cases: Array<(workbook: ReturnType<typeof createWorkbook>) => void> = [
    (value) => {
      value.sheets[0].root.floating = { x: 10, y: 10 };
    },
    (value) => {
      value.sheets[0].root.children[0].children[0].floating = { x: 10, y: 10 };
    },
    (value) => {
      value.sheets[0].root.children[0].floating = { x: NaN, y: 10 };
    },
    (value) => {
      value.sheets[0].root.children[0].floating = { x: 10, y: Infinity };
    },
    (value) => {
      value.sheets[0].root.labels = Array.from({ length: 33 }, () => "标签");
    },
    (value) => {
      value.sheets[0].root.labels = ["字".repeat(257)];
    },
    (value) => {
      value.sheets[0].root.richText = [{ text: "不等于标题" }];
    },
    (value) => {
      value.sheets[0].root.richText = [
        { text: value.sheets[0].root.title, underline: "yes" as never },
      ];
    },
    (value) => {
      value.sheets[0].root.richText = Array.from({ length: 257 }, () => ({
        text: "",
      }));
    },
    (value) => {
      value.sheets[0].numbering = "unsupported" as never;
    },
  ];
  for (const mutate of cases) {
    const workbook = createWorkbook();
    mutate(workbook);
    assert.throws(() => validateWorkbook(workbook), /文档格式错误/);
  }
});

test("floating trees use requested centers without root edges in every layout and remain visible under root collapse", () => {
  const workbook = createWorkbook();
  const sheet = workbook.sheets[0];
  const floating = sheet.root.children[0];
  floating.floating = { x: 10_000.5, y: -2000.25 };
  for (const layout of layouts) {
    sheet.layout = layout;
    const result = computeLayout(sheet);
    assertLayout(result);
    assert.equal(result.nodes.length, 20);
    assert.equal(result.edges.length, 18);
    const detachedRoot = result.nodes.find((node) => node.id === floating.id)!;
    assert.equal(detachedRoot.topic, floating);
    assert.equal(detachedRoot.parentId, undefined);
    assert.equal(detachedRoot.x + detachedRoot.width / 2, floating.floating.x);
    assert.equal(detachedRoot.y + detachedRoot.height / 2, floating.floating.y);
    assert.ok(result.edges.every((edge) => edge.to !== floating.id));
    const original = computeLayout({ ...sheet, root: floating });
    for (const originalNode of original.nodes) {
      const shifted = result.nodes.find((node) => node.id === originalNode.id)!;
      assert.equal(shifted.topic, originalNode.topic);
      assert.equal(shifted.x, originalNode.x + floating.floating.x);
      assert.equal(shifted.y, originalNode.y + floating.floating.y);
    }
    assert.ok(
      result.edges
        .filter((edge) => edge.from === floating.id)
        .every((edge) => !/NaN|Infinity/.test(edge.path)),
    );
    for (const originalEdge of original.edges) {
      const shifted = result.edges.find(
        (edge) =>
          edge.from === originalEdge.from && edge.to === originalEdge.to,
      )!;
      const originalCoordinates = originalEdge.path
        .match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)!
        .map(Number);
      const shiftedCoordinates = shifted.path
        .match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)!
        .map(Number);
      assert.equal(originalCoordinates.length, shiftedCoordinates.length);
      originalCoordinates.forEach((value, index) =>
        assert.ok(
          Math.abs(
            shiftedCoordinates[index] -
              value -
              (index % 2 === 0 ? floating.floating!.x : floating.floating!.y),
          ) < 0.02,
        ),
      );
    }
  }
  sheet.root.collapsed = true;
  const collapsed = computeLayout(sheet);
  assertLayout(collapsed);
  assert.equal(collapsed.nodes.length, 4);
  assert.equal(collapsed.edges.length, 2);
  floating.collapsed = true;
  assert.equal(computeLayout(sheet).nodes.length, 2);
});

test("attaching floating trees clears position, preserves identity and prevents stale rich text after title edits", () => {
  const workbook = createWorkbook();
  const root = workbook.sheets[0].root;
  const floating = root.children[0];
  floating.floating = { x: 1000, y: 1000 };
  floating.richText = [{ text: floating.title, bold: true }];
  assert.equal(moveTopic(root, floating.id, root.id), true);
  assert.equal(floating.floating, undefined);
  assert.equal(moveTopic(root, floating.id, root.id), false);
  floating.floating = { x: 1000, y: 1000 };
  const parent = root.children[1];
  assert.equal(moveTopic(root, floating.id, parent.id), true);
  assert.equal(floating.floating, undefined);
  assert.equal(parent.children.at(-1), floating);
  updateTopic(root, floating.id, (topic) => {
    topic.title = "纯文本改名";
  });
  assert.equal(floating.richText, undefined);
  updateTopic(root, floating.id, (topic) => {
    topic.title = "富文本改名";
    topic.richText = [{ text: "富文本", bold: true }, { text: "改名" }];
  });
  assert.equal(floating.richText?.[0].bold, true);
  assert.doesNotThrow(() => validateWorkbook(workbook));
  assert.equal(removeTopic(root, floating.id), true);
  assert.equal(findTopic(root, floating.id), undefined);
});

test("numbering is presentation-only, stable through collapse and measured with its full display prefix", () => {
  const sheet = createWorkbook().sheets[0];
  const first = sheet.root.children[0];
  const grandchild = first.children[0];
  for (const mode of ["none", "decimal", "hierarchical", "roman"] as const) {
    sheet.numbering = mode;
    const result = computeLayout(sheet);
    assertLayout(result);
    assert.equal(result.nodes[0].title, sheet.root.title);
    const primary = result.nodes.find((node) => node.id === first.id)!;
    const nested = result.nodes.find((node) => node.id === grandchild.id)!;
    assert.equal(
      primary.title,
      `${mode === "none" ? "" : mode === "roman" ? "I. " : "1. "}${first.title}`,
    );
    assert.equal(
      nested.title,
      `${mode === "none" ? "" : mode === "roman" ? "I. " : mode === "hierarchical" ? "1.1. " : "1. "}${grandchild.title}`,
    );
    assert.equal(nested.topic, grandchild);
    assert.equal(nested.width, measureTopic(grandchild, 2, nested.title).width);
    assert.equal(grandchild.title, "思维导图");
    const beforeSecond = result.nodes.find(
      (node) => node.id === sheet.root.children[1].id,
    )!.title;
    first.collapsed = true;
    assert.equal(
      computeLayout(sheet).nodes.find(
        (node) => node.id === sheet.root.children[1].id,
      )!.title,
      beforeSecond,
    );
    first.collapsed = false;
  }
  sheet.numbering = "roman";
  assert.equal(
    computeLayout(sheet).nodes.find(
      (node) => node.id === sheet.root.children[3].id,
    )!.title,
    "IV. 用户体验",
  );
});

test("label lines add their complete height budget and remain non-overlapping with rich media", () => {
  const sheet = createWorkbook().sheets[0];
  const topic = sheet.root.children[0].children[0];
  const original = measureTopic(topic, 2);
  topic.labels = ["高优先级标签", "等待开发团队确认", "需要审核"];
  const measured = measureTopic(topic, 2);
  assert.ok(measured.labelLines.length > 1);
  assert.equal(
    measured.height,
    Math.ceil(
      24 +
        measured.titleLines.length * measured.fontSize * 1.35 +
        measured.labelLines.length * 20,
    ),
  );
  assert.ok(measured.height > original.height);
  topic.image = "data:image/png;base64,AAAA";
  topic.task = { status: "doing", progress: 20, assignee: "负责人" };
  for (const layout of layouts)
    assertLayout(
      computeLayout({ ...sheet, layout, numbering: "hierarchical" }),
    );
});

test("64 MiB object content budget counts UTF-8 bytes rather than UTF-16 character length", () => {
  assert.equal(MAX_WORKBOOK_BYTES, 64 * 1024 * 1024);
  const workbook = createWorkbook();
  const root = workbook.sheets[0].root;
  const note = "字".repeat(1_000_000);
  for (let index = 0; index < 21; index++) {
    const topic = addChild(root, root.id)!;
    topic.note = note;
  }
  assert.doesNotThrow(() => validateWorkbook(workbook));
  for (let index = 0; index < 2; index++) addChild(root, root.id)!.note = note;
  assert.throws(() => validateWorkbook(workbook), /64 MiB/);
});
