import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  exportDocument,
  parseDocument,
  parseFreemind,
  parseMarkdown,
  parseOpml,
  parseXmind,
  parseYmind,
  toFreemind,
  toIcs,
  toMarkdown,
  toOpml,
  toTextbundle,
  toXmind,
} from "../src/formats.ts";
import type { Workbook } from "../src/domain.ts";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFo0AAAAASUVORK5CYII=";
function fixture(): Workbook {
  return {
    version: 1,
    id: "book",
    title: "研发规划",
    activeSheetId: "sheet-two",
    updatedAt: "2026-10-13T04:00:00Z",
    sheets: [
      {
        id: "sheet-one",
        title: "A & B / 产品",
        layout: "right",
        theme: "ocean",
        root: {
          id: "root",
          title: "产品计划",
          note: "第一行\n第二行",
          children: [
            {
              id: "a",
              title: "调查 [需求] <反馈>",
              note: "正文 <不执行> & 中文\n多行",
              url: "https://example.com/?a=1&b=2",
              image,
              style: { bold: true, color: "#abcdef", fontSize: 18 },
              markers: ["priority-1"],
              task: {
                status: "doing",
                start: "2026-10-13",
                end: "2026-10-14",
                assignee: "甲",
                progress: 50,
              },
              children: [{ id: "a1", title: "=SUM(A1:A3)", children: [] }],
            },
            { id: "b", title: "交付", children: [] },
          ],
        },
        relations: [
          { id: "r", from: "a", to: "b", label: "依赖", color: "#abcdef" },
        ],
        annotations: [
          {
            id: "bound",
            kind: "boundary",
            topicIds: ["a", "b"],
            label: "开发阶段",
          },
          {
            id: "summary",
            kind: "summary",
            topicIds: ["a", "b"],
            label: "完成迭代",
          },
        ],
      },
      {
        id: "sheet-two",
        title: "A & B / 产品",
        layout: "mindmap",
        theme: "classic",
        root: {
          id: "root2",
          title: "学习路线",
          children: [{ id: "c", title: "实践", children: [] }],
        },
        relations: [],
        annotations: [],
      },
    ],
  };
}
const titles = (w: Workbook) =>
  w.sheets.map((s) => ({
    title: s.title,
    root: s.root.title,
    children: s.root.children.map((n) => ({
      title: n.title,
      children: n.children.map((c) => c.title),
      note: n.note,
      url: n.url,
    })),
  }));

test("YMIND validates known fields, preserves full owned document and discards unknown metadata", () => {
  const input = { ...fixture(), authorPrivateData: "excluded" };
  assert.deepEqual(parseYmind(input), fixture());
  assert.equal("authorPrivateData" in parseYmind(input), false);
  const bad = fixture();
  bad.sheets[0].root.children[0].id = "root";
  assert.throws(() => parseYmind(bad), /不能重复/);
  const separateSheets = fixture();
  separateSheets.sheets[1].root.id = "root";
  assert.equal(parseYmind(separateSheets).sheets[1].root.id, "root");
  assert.equal(parseXmind(toXmind(separateSheets)).sheets[1].root.id, "root");
  const badRelation = fixture();
  badRelation.sheets[0].relations[0].to = "missing";
  assert.throws(() => parseYmind(badRelation), /关系线/);
});

test("modern Xmind roundtrip preserves all sheets, hierarchy, notes, links, images, markers, relations and representable annotations", () => {
  const original = fixture(),
    bytes = toXmind(original),
    parsed = parseXmind(bytes, original.title);
  assert.deepEqual(titles(parsed), titles(original));
  assert.equal(parsed.sheets[0].layout, "right");
  assert.deepEqual(parsed.sheets[0].root.children[0].image, image);
  assert.deepEqual(parsed.sheets[0].root.children[0].markers, ["priority-1"]);
  assert.deepEqual(parsed.sheets[0].relations, original.sheets[0].relations);
  assert.deepEqual(
    parsed.sheets[0].annotations,
    original.sheets[0].annotations,
  );
  const files = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.ok(files["content.json"]);
  assert.ok(files["metadata.json"]);
  assert.ok(manifest["file-entries"]["resources/ymind-1.png"]);
  assert.equal(
    JSON.parse(strFromU8(files["metadata.json"])).creator.name,
    "YMIND",
  );
});

test("Xmind rejects malformed JSON, missing content and duplicate topics", () => {
  assert.throws(
    () => parseXmind(zipSync({ "content.json": strToU8("{bad") })),
    /JSON/,
  );
  assert.throws(
    () => parseXmind(zipSync({ "content.xml": strToU8("<xmap/>") })),
    /content.json/,
  );
  assert.throws(() => parseXmind(new Uint8Array([1, 2, 3])), /不完整/);
  const files = unzipSync(toXmind(fixture())),
    content = JSON.parse(strFromU8(files["content.json"]));
  content[0].rootTopic.children.attached[0].id = content[0].rootTopic.id;
  files["content.json"] = strToU8(JSON.stringify(content));
  assert.throws(() => parseXmind(zipSync(files)), /重复/);
});

test("Xmind verifies CRC and rejects oversized advertised expansion before allocation", () => {
  const bytes = toXmind(fixture());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22,
    directory = view.getUint32(end + 16, true);
  const invalidCrc = bytes.slice(),
    invalidCrcView = new DataView(invalidCrc.buffer);
  invalidCrcView.setUint32(directory + 16, 0, true);
  assert.throws(() => parseXmind(invalidCrc), /校验失败/);
  const huge = bytes.slice(),
    hugeView = new DataView(huge.buffer);
  hugeView.setUint32(directory + 24, 100 * 1024 * 1024, true);
  assert.throws(() => parseXmind(huge), /安全上限/);
});

test("Xmind rejects encrypted archives, ambiguous paths and missing image resource", () => {
  const bytes = toXmind(fixture()),
    encrypted = bytes.slice();
  const view = new DataView(encrypted.buffer),
    directory = view.getUint32(bytes.length - 6, true);
  view.setUint16(directory + 8, 1, true);
  assert.throws(() => parseXmind(encrypted), /加密/);
  assert.throws(
    () => parseXmind(zipSync({ "../content.json": strToU8("[]") })),
    /路径/,
  );
  const files = unzipSync(bytes);
  delete files["resources/ymind-1.png"];
  assert.throws(() => parseXmind(zipSync(files)), /资源缺失/);
});

test("Markdown roundtrip preserves multi-sheet titles, escaped labels, hierarchy, links and notes", () => {
  assert.deepEqual(
    titles(parseMarkdown(toMarkdown(fixture()))),
    titles(fixture()),
  );
  const parsed = parseMarkdown(
    "# 目标\n## 阶段\n- 项目甲\n  - 子任务\n- 项目乙\n> 备注",
  );
  assert.equal(parsed.sheets[0].root.children[0].title, "阶段");
  assert.equal(
    parsed.sheets[0].root.children[0].children[0].children[0].title,
    "子任务",
  );
  assert.equal(parsed.sheets[0].root.children[0].children[1].note, "备注");
  assert.throws(() => parseMarkdown(""), /没有/);
});

test("OPML roundtrip keeps text entities, all sheets, links and multiline notes", () => {
  const input = fixture();
  assert.deepEqual(titles(parseOpml(toOpml(input))), titles(input));
  assert.throws(() => parseOpml("<opml><body><outline></body></opml>"), /XML/);
  assert.throws(
    () =>
      parseOpml(
        '<!DOCTYPE opml [<!ENTITY x "data">]><opml><body><outline text="&x;"/></body></opml>',
      ),
    /DTD/,
  );
});

test("FreeMind standard input and own multi-sheet roundtrip remain valid XML", () => {
  const parsed = parseFreemind(
    '<map version="1.0.1"><node TEXT="根"><node TEXT="子" LINK="https://example.com"/></node></map>',
  );
  assert.equal(parsed.sheets[0].root.children[0].url, "https://example.com");
  const input = fixture();
  const roundtrip = parseFreemind(toFreemind(input));
  assert.deepEqual(
    roundtrip.sheets.map((s) =>
      s.root.children.map((n) => ({
        title: n.title,
        note: n.note,
        url: n.url,
      })),
    ),
    input.sheets.map((s) =>
      s.root.children.map((n) => ({
        title: n.title,
        note: n.note,
        url: n.url,
      })),
    ),
  );
  assert.throws(
    () => parseFreemind('<map><node TEXT="A"/><node TEXT="B"/></map>'),
    /根主题/,
  );
});

test("ICS uses actual task dates, inclusive all-day end, skips undated tasks and folds UTF-8 lines", () => {
  const input = fixture();
  input.sheets[0].root.children[1].task = { status: "todo" };
  input.sheets[0].root.children[0].title = "长标题".repeat(100);
  const ics = toIcs(input);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20261013/);
  assert.match(ics, /DTEND;VALUE=DATE:20261015/);
  assert.ok(ics.split("\r\n").every((line) => strToU8(line).length <= 75));
  const noDates = fixture();
  noDates.sheets[0].root.children[0].task!.start = "2026-02-30";
  assert.throws(() => toIcs(noDates), /没有可导出/);
});

test("ICS serializes explicit timezone to UTC and ignores date-only/datetime end mismatches", () => {
  const input = fixture();
  input.sheets[0].root.children[0].task = {
    status: "todo",
    start: "2026-10-13T10:00:00+08:00",
    end: "2026-10-13T11:30:00+08:00",
  };
  assert.match(toIcs(input), /DTSTART:20261013T020000Z/);
  assert.match(toIcs(input), /DTEND:20261013T033000Z/);
});

test("File API accepts YMIND and reports bad JSON and unsupported extension clearly", async () => {
  const input = fixture();
  assert.deepEqual(
    await parseDocument(new File([JSON.stringify(input)], "test.ymind")),
    input,
  );
  await assert.rejects(parseDocument(new File(["{"], "broken.json")), /JSON/);
  await assert.rejects(
    parseDocument(new File(["data"], "invalid.pdf")),
    /支持/,
  );
  await assert.rejects(parseDocument(new File([], "empty.md")), /为空/);
  const result = await exportDocument(input, "xmind");
  assert.equal(result.extension, "xmind");
  assert.deepEqual(
    titles(await parseDocument(new File([result.blob], "roundtrip.xmind"))),
    titles(input),
  );
});

test("Office exports are genuine OOXML packages with real contents and no formula injection", async () => {
  const input = fixture();
  for (const format of ["docx", "xlsx", "pptx"] as const) {
    const result = await exportDocument(input, format);
    assert.equal(result.extension, format);
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    assert.ok(
      files["[Content_Types].xml"],
      `${format} has OOXML content types`,
    );
    const target =
      format === "docx"
        ? "word/document.xml"
        : format === "xlsx"
          ? "xl/workbook.xml"
          : "ppt/presentation.xml";
    assert.ok(files[target], `${format} has actual document part`);
    if (format === "docx") assert.match(strFromU8(files[target]), /产品计划/);
    if (format === "pptx")
      assert.equal(
        Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
          .length,
        3,
      );
    if (format === "xlsx") {
      assert.equal(
        Object.keys(files).filter((k) =>
          /^xl\/worksheets\/sheet\d+\.xml$/.test(k),
        ).length,
        2,
      );
      assert.match(strFromU8(files["xl/sharedStrings.xml"]), /=SUM\(A1:A3\)/);
      assert.doesNotMatch(
        strFromU8(files["xl/worksheets/sheet1.xml"]),
        /<f[ >]/,
      );
    }
  }
});

test("PPT refuses documents beyond its page capacity rather than silently truncating", async () => {
  const input = fixture();
  input.sheets[0].root.children = Array.from({ length: 51 }, (_, i) => ({
    id: `topic-${i}`,
    title: `分支 ${i}`,
    children: [],
  }));
  input.sheets[0].relations = [];
  input.sheets[0].annotations = [];
  await assert.rejects(exportDocument(input, "pptx"), /50 页/);
});

test("native extended metadata and Xmind labels/detached coordinates/owned styles roundtrip", async () => {
  const input = fixture();
  input.sheets[0].layout = "brace";
  input.sheets[0].numbering = "hierarchical";
  const n = input.sheets[0].root.children[0];
  n.labels = ["团队", "研发"];
  n.richText = [
    { text: "调查 ", bold: true },
    { text: "[需求]", italic: true },
    { text: " <反馈>", underline: true },
  ];
  input.sheets[0].root.children.push({
    id: "floating",
    title: "独立想法",
    children: [{ id: "floating-child", title: "独立分支", children: [] }],
    floating: { x: -200, y: 450 },
    labels: ["灵感"],
  });
  const originalJson = await exportDocument(input, "ymind");
  assert.deepEqual(
    await parseDocument(new File([originalJson.blob], "extended.ymind")),
    input,
  );
  const result = parseXmind(toXmind(input));
  assert.equal(result.sheets[0].layout, "brace");
  assert.equal(result.sheets[0].numbering, "hierarchical");
  assert.deepEqual(result.sheets[0].root.children[0].labels, n.labels);
  assert.deepEqual(result.sheets[0].root.children[0].richText, n.richText);
  assert.deepEqual(result.sheets[0].root.children[2].floating, {
    x: -200,
    y: 450,
  });
  assert.equal(result.sheets[0].root.children[2].children[0].title, "独立分支");
  const xmindContent = JSON.parse(
    strFromU8(unzipSync(toXmind(input))["content.json"]),
  );
  assert.deepEqual(xmindContent[0].rootTopic.children.detached[0].position, {
    x: -200,
    y: 450,
  });
  assert.equal(xmindContent[0].rootTopic.children.attached.length, 2);
  const word = await exportDocument(input, "docx");
  const document = strFromU8(
    unzipSync(new Uint8Array(await word.blob.arrayBuffer()))[
      "word/document.xml"
    ],
  );
  assert.match(document, /<w:u/);
});

test("all thirteen caller-selected layouts survive own Xmind extension roundtrips", () => {
  for (const layout of [
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
  ] as const) {
    const input = fixture();
    input.sheets[0].layout = layout;
    assert.equal(parseXmind(toXmind(input)).sheets[0].layout, layout);
  }
});

test("standard Xmind labels and positioned detached topics import without own metadata", () => {
  const content = [
    {
      id: "s",
      title: "外部文档",
      rootTopic: {
        id: "r",
        title: "中心",
        children: {
          detached: [
            {
              id: "f",
              title: "独立",
              position: { x: 250, y: -40 },
              labels: ["标签"],
            },
          ],
        },
      },
    },
  ];
  const parsed = parseXmind(
    zipSync({ "content.json": strToU8(JSON.stringify(content)) }),
  );
  assert.deepEqual(parsed.sheets[0].root.children[0].floating, {
    x: 250,
    y: -40,
  });
  assert.deepEqual(parsed.sheets[0].root.children[0].labels, ["标签"]);
  const files = unzipSync(toXmind(fixture()));
  const raw = JSON.parse(strFromU8(files["content.json"]));
  raw[0].rootTopic.extensions = [
    { provider: "local.ymind.editor", content: "{broken" },
  ];
  files["content.json"] = strToU8(JSON.stringify(raw));
  assert.throws(() => parseXmind(zipSync(files)), /JSON/);
});

test("TextBundle exports a standard textpack ZIP with actual assets and matching Markdown references", async () => {
  const files = unzipSync(toTextbundle(fixture()));
  assert.deepEqual(Object.keys(files).sort(), [
    "assets/image-1.png",
    "info.json",
    "text.md",
  ]);
  const info = JSON.parse(strFromU8(files["info.json"]));
  assert.equal(info.version, 2);
  assert.equal(info.type, "net.daringfireball.markdown");
  assert.equal(info.creatorIdentifier, "local.ymind.editor");
  assert.equal(info.sourceURL, undefined);
  const md = strFromU8(files["text.md"]);
  assert.match(md, /\]\(assets\/image-1\.png\)/);
  assert.equal(
    btoa(String.fromCharCode(...files["assets/image-1.png"])),
    image.split(",")[1],
  );
  assert.match(md, /学习路线/);
  const result = await exportDocument(fixture(), "textbundle");
  assert.equal(result.extension, "textpack");
  assert.equal(result.blob.type, "application/zip");
});

test("TextBundle refuses external/unsupported images rather than fetching or silently dropping them", () => {
  const input = fixture();
  input.sheets[0].root.children[0].image = "https://example.com/private.png";
  assert.throws(() => toTextbundle(input), /图片无法打包/);
});

test("repeated embedded images share one resource and keep Xmind export re-importable", () => {
  const input = fixture();
  input.sheets[0].root.children = Array.from({ length: 1100 }, (_, i) => ({
    id: `image-topic-${i}`,
    title: `图片 ${i}`,
    image,
    children: [],
  }));
  input.sheets[0].relations = [];
  input.sheets[0].annotations = [];
  const bytes = toXmind(input);
  const files = unzipSync(bytes);
  assert.equal(
    Object.keys(files).filter((name) => name.startsWith("resources/")).length,
    1,
  );
  assert.equal(parseXmind(bytes).sheets[0].root.children.length, 1100);
  const pack = unzipSync(toTextbundle(input));
  assert.equal(
    Object.keys(pack).filter((name) => name.startsWith("assets/")).length,
    1,
  );
});

test("native YMIND inputs may exceed 20 MB while other inputs retain the 20 MB boundary", async () => {
  const input = fixture();
  const payload = "x".repeat(8_000_000);
  for (const n of [
    input.sheets[0].root,
    input.sheets[0].root.children[0],
    input.sheets[1].root,
  ]) {
    n.attachment = { name: "local.txt", type: "text/plain", data: payload };
  }
  const value = JSON.stringify(input);
  const file = new File([value], "large.ymind");
  assert.ok(file.size > 20 * 1024 * 1024);
  const parsed = await parseDocument(file);
  assert.equal(parsed.sheets[0].root.attachment?.data.length, payload.length);
  await assert.rejects(
    parseDocument(new File([value], "large.xmind")),
    /20 MB/,
  );
});
