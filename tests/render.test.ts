import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Sheet, Topic } from "../src/domain.ts";
import { computeLayout } from "../src/layout.ts";
import { buildSvg, equationSvg, exportMap } from "../src/render.ts";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0O0AAAAASUVORK5CYII=";
const topic = (id: string, title: string, children: Topic[] = []): Topic => ({
  id,
  title,
  children,
});
function sheet(): Sheet {
  return {
    id: "sheet",
    title: "测试导图",
    layout: "mindmap",
    theme: "classic",
    relations: [],
    annotations: [],
    root: topic("root", "中心", [
      topic("alpha", "规划", [topic("leaf", "细节")]),
      topic("beta", "交付"),
    ]),
  };
}

function validate(svg: string): void {
  assert.equal(
    XMLValidator.validate(svg),
    true,
    "export must be well-formed XML",
  );
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(svg);
  assert.ok(parsed.svg);
}

test("SVG escapes document text, IDs, attribute injection and invalid XML characters", async () => {
  const document = sheet();
  document.title = '<script>alert("x")</script> & "标题"';
  document.root.id = 'root" onload="alert(1)';
  document.root.title = 'A < B & "Q"\n第二行\u0000';
  const svg = await buildSvg(document);
  validate(svg);
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("A &lt; B &amp; &quot;Q&quot;"));
  assert.ok(svg.includes("第二行\ufffd"));
  assert.ok(svg.includes("root&quot; onload=&quot;alert(1)"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes(' onload="'));
  assert.ok(!svg.includes("<foreignObject"));
});

test("SVG contains curved branches, relations, boundary and summary labels", async () => {
  const document = sheet();
  document.relations = [
    {
      id: "relationship",
      from: "leaf",
      to: "beta",
      label: "依赖 <准备>",
      color: "#aa22cc",
    },
  ];
  document.annotations = [
    {
      id: "boundary",
      kind: "boundary",
      topicIds: ["alpha", "leaf"],
      label: "工作范围",
      color: "#2255aa",
    },
    {
      id: "summary",
      kind: "summary",
      topicIds: ["alpha", "beta"],
      label: "阶段总结",
    },
  ];
  const svg = await buildSvg(document);
  validate(svg);
  assert.equal((svg.match(/data-topic-id=/g) ?? []).length, 4);
  assert.equal((svg.match(/data-branch=/g) ?? []).length, 3);
  assert.match(svg, /data-relation="relationship"/);
  assert.match(svg, /data-annotation="boundary"/);
  assert.match(svg, /data-annotation="summary"/);
  assert.match(svg, /依赖 &lt;准备&gt;/);
  assert.match(svg, /stroke="#aa22cc"/);
  assert.match(svg, /阶段总结/);
  assert.match(svg, / C /);
});

test("SVG preserves explicit lines, all long text and a viewport containing negative coordinates", async () => {
  const document = sheet();
  document.root.children[0]!.title =
    "ABCDEFGHIJKLMNO\n中文题目文字足够长需要进行自动换行";
  document.layout = "left";
  const layout = computeLayout(document),
    svg = await buildSvg(document);
  validate(svg);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);
  assert.ok(viewBox[0]! < 0);
  assert.ok(viewBox[1]! < 0);
  assert.ok(viewBox[0]! <= layout.bounds.x);
  assert.ok(viewBox[0]! + viewBox[2]! >= layout.bounds.x + layout.bounds.width);
  const text = new XMLParser({ ignoreAttributes: false }).parse(svg);
  const serialized = JSON.stringify(text);
  assert.match(serialized, /ABCDEFGHIJKLMNO/);
  assert.ok((svg.match(/<tspan/g) ?? []).length > layout.nodes.length);
  assert.match(svg, /<\/tspan><tspan/);
});

test("SVG renders independent styles, embedded images, task details and content indicators", async () => {
  const document = sheet();
  const node = document.root.children[0]!;
  node.style = {
    color: "#123456",
    textColor: "#654321",
    fontSize: 20,
    bold: true,
    italic: true,
    shape: "ellipse",
  };
  node.image = pixel;
  node.markers = ["★", "优先级 1"];
  node.task = {
    status: "doing",
    progress: 45,
    start: "2026-10-13",
    end: "2026-10-20",
    assignee: "张三",
  };
  node.note = "需要整理资料";
  node.url = "https://example.org/?a=1&b=2";
  node.attachment = {
    name: "资料.txt",
    type: "text/plain",
    data: "data:text/plain;base64,dGVzdA==",
  };
  const svg = await buildSvg(document);
  validate(svg);
  assert.match(svg, /<ellipse/);
  assert.match(svg, /fill="#123456"/);
  assert.match(svg, /fill="#654321"/);
  assert.match(svg, /font-style="italic"/);
  assert.match(svg, /font-weight="700"/);
  assert.ok(svg.includes(`href="${pixel}"`));
  assert.match(svg, /优先级 1/);
  assert.match(svg, /进行中 · 45%/);
  assert.match(svg, /2026-10-13/);
  assert.match(svg, /张三/);
  for (const indicator of ["备注", "附件", "链接"])
    assert.ok(svg.includes(`data-indicator="${indicator}"`));
  assert.ok(svg.includes('href="https://example.org/?a=1&amp;b=2"'));
});

test("SVG never loads external images or executes unsafe URLs and colors", async () => {
  const document = sheet();
  document.root.url = "javascript:alert(1)";
  document.root.image = "https://example.org/remote.png";
  document.root.style = {
    color: '\" onload=\"alert(1)',
    textColor: "url(https://example.org/paint)",
  };
  const svg = await buildSvg(document);
  validate(svg);
  assert.ok(!svg.includes("javascript:"));
  assert.ok(!svg.includes("https://example.org"));
  assert.ok(!svg.includes("<image"));
  assert.match(svg, /图片不可用/);
  assert.ok(!svg.includes('onload="'));
  assert.ok(!svg.includes("url("));
});

test("collapsed topic does not export hidden children or broken references", async () => {
  const document = sheet();
  document.root.children[0]!.collapsed = true;
  document.relations = [
    { id: "hidden-edge", from: "leaf", to: "beta", label: "隐藏" },
  ];
  const svg = await buildSvg(document);
  assert.equal((svg.match(/data-topic-id=/g) ?? []).length, 3);
  assert.ok(!svg.includes('data-topic-id="leaf"'));
  assert.ok(!svg.includes('data-relation="hidden-edge"'));
  assert.match(svg, /\+1/);
});

test("MathJax renders fractions, superscripts and matrix as standalone SVG paths", async () => {
  for (const expression of [
    "\\frac{a^2+b^2}{c}",
    "\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}",
  ]) {
    const svg = await equationSvg(expression);
    validate(svg);
    assert.match(svg, /^<svg/);
    assert.match(svg, /<path /);
    assert.match(svg, /viewBox=/);
    assert.ok(!svg.includes("foreignObject"));
    assert.ok(!svg.includes('href="http'));
    assert.ok(!svg.includes("\\frac"));
  }
  const document = sheet();
  document.root.equation = "\\sum_{i=1}^{n} i^2";
  const svg = await buildSvg(document);
  validate(svg);
  assert.match(svg, /data-mml-node="munderover"/);
  assert.ok(!svg.includes("\\sum"));
});

test("equations reject resource/link commands and fail explicitly for malformed expressions", async () => {
  for (const expression of [
    "\\href{javascript:alert(1)}{x}",
    "\\url{https://example.org}",
    "\\includegraphics{x}",
    "\\require{html}",
    "\\htmlData{x=y}{x}",
    "\\def\\evil{x}\\evil",
  ]) {
    await assert.rejects(equationSvg(expression), /数学表达式/);
  }
  await assert.rejects(equationSvg(""), /不能为空/);
  await assert.rejects(equationSvg("x".repeat(5001)), /5000/);
  await assert.rejects(equationSvg("\\unknownYMIND{x}"));
  const document = sheet();
  document.root.equation = "\\unknownYMIND{x}";
  await assert.rejects(buildSvg(document), /公式无法渲染/);
});

test("SVG export returns an actual UTF-8 SVG blob and preserves complete document", async () => {
  const result = await exportMap(sheet(), "svg");
  assert.equal(result.extension, "svg");
  assert.match(result.blob.type, /^image\/svg\+xml/);
  const svg = await result.blob.text();
  validate(svg);
  assert.match(svg, /测试导图/);
  assert.equal((svg.match(/data-topic-id=/g) ?? []).length, 4);
});

test("SVG preserves visible numbering, label rows, styled title runs and detached branches", async () => {
  const document = sheet();
  document.numbering = "hierarchical";
  const branch = document.root.children[0]!;
  branch.title = "粗体斜体";
  branch.richText = [
    { text: "粗体", bold: true },
    { text: "斜体", italic: true, underline: true },
  ];
  branch.labels = ["优先级", "本机"];
  const floating = document.root.children[1]!;
  floating.floating = { x: 800, y: -250 };
  const svg = await buildSvg(document);
  validate(svg);
  assert.match(svg, />1\. <\/tspan>/);
  assert.match(svg, /font-weight="700">粗体/);
  assert.match(svg, /font-style="italic" text-decoration="underline">斜体/);
  assert.match(svg, /#优先级 #本机/);
  assert.ok(!svg.includes(`data-branch="${floating.id}"`));
  assert.ok(svg.includes(`data-topic-id="${floating.id}"`));
});
