import assert from "node:assert/strict";
import test from "node:test";
import type { RichTextRun } from "../src/domain.ts";
import {
  formatRichText,
  parseRichText,
  richTextLines,
  splitRichText,
  wrapRichSelection,
} from "../src/richText.ts";

const text = (runs: readonly RichTextRun[]) =>
  runs.map((run) => run.text).join("");
const flags = (run: RichTextRun) => ({
  bold: !!run.bold,
  italic: !!run.italic,
  underline: !!run.underline,
});

test("mixed CJK, emoji, combining characters and explicit lines retain their text and formatting", () => {
  const result = parseRichText(
    "中文 **粗体👩‍💻** / *e\u0301斜体*\n__下划线__ 原文",
  );
  assert.equal(result.title, "中文 粗体👩‍💻 / e\u0301斜体\n下划线 原文");
  assert.equal(result.runs.find((run) => run.text === "粗体👩‍💻")?.bold, true);
  assert.equal(
    result.runs.find((run) => run.text === "e\u0301斜体")?.italic,
    true,
  );
  assert.equal(
    result.runs.find((run) => run.text === "下划线")?.underline,
    true,
  );
});

test("nested and adjacent formatting is truly mixed rather than whole-title style", () => {
  const result = parseRichText("普通 **粗体 *粗斜* __粗下划__** 收尾");
  assert.equal(result.title, "普通 粗体 粗斜 粗下划 收尾");
  assert.deepEqual(flags(result.runs.find((run) => run.text === "粗斜")!), {
    bold: true,
    italic: true,
    underline: false,
  });
  assert.deepEqual(flags(result.runs.find((run) => run.text === "粗下划")!), {
    bold: true,
    italic: false,
    underline: true,
  });
  assert.equal(result.runs[0]!.bold, undefined);
  assert.equal(text(parseRichText("**A****B**").runs), "AB");
});

test("escaped delimiters and unmatched syntax remain literal; HTML and script-looking text is only data", () => {
  const literal = String.raw`\*字面星号\* \_下划\_ \\ 路径`;
  assert.equal(parseRichText(literal).title, "*字面星号* _下划_ \\ 路径");
  assert.equal(parseRichText("未闭合 **粗体").title, "未闭合 **粗体");
  const attack =
    '<img src=x onerror="alert(1)"><script>fetch("https://example.org")</script>';
  const result = parseRichText(attack);
  assert.equal(result.title, attack);
  assert.deepEqual(result.runs, [{ text: attack }]);
  assert.equal(
    parseRichText("[链接](javascript:alert(1))").title,
    "[链接](javascript:alert(1))",
  );
});

test("canonical serialization roundtrips every pair of style combinations with literal syntax", () => {
  const styles = Array.from({ length: 8 }, (_, mask) => ({
    ...(mask & 1 ? { bold: true } : {}),
    ...(mask & 2 ? { italic: true } : {}),
    ...(mask & 4 ? { underline: true } : {}),
  }));
  for (const first of styles)
    for (const second of styles) {
      const source: RichTextRun[] = [
        { text: "甲*__\\", ...first },
        { text: "乙👩‍💻\n<内容>", ...second },
      ];
      const result = parseRichText(formatRichText(source));
      assert.equal(result.title, text(source));
      const sections = splitRichText(result.runs, 0, source[0]!.text.length);
      for (const run of sections.selected)
        assert.deepEqual(flags(run), flags(source[0]!));
      for (const run of sections.after)
        assert.deepEqual(flags(run), flags(source[1]!));
    }
});

test("empty text, exact limits and over-limit data have clear outcomes", () => {
  assert.deepEqual(parseRichText(""), { title: "", runs: [] });
  assert.equal(parseRichText("a".repeat(20_000)).title.length, 20_000);
  assert.throws(() => parseRichText("a".repeat(20_001)), /20000/);
  assert.throws(() => parseRichText("*".repeat(50_001)), /50000/);
  assert.throws(() => parseRichText("**粗**普通".repeat(129)), /256/);
  assert.throws(
    () => formatRichText(Array.from({ length: 257 }, () => ({ text: "x" }))),
    /256/,
  );
});

test("selection splits preserve run formats and do not tear emoji surrogate pairs", () => {
  const source: RichTextRun[] = [
    { text: "A😀", bold: true },
    { text: "BC", italic: true },
  ];
  const result = splitRichText(source, 2, 4);
  assert.equal(text(result.before), "A");
  assert.equal(text(result.selected), "😀B");
  assert.equal(text(result.after), "C");
  assert.equal(result.selected[0]!.bold, true);
  assert.equal(result.selected[1]!.italic, true);
  assert.deepEqual(splitRichText(source, 0, 0).selected, []);
});

test("canonical layout lines preserve mixed styles with numbering, wrapping and empty lines", () => {
  const title = "\n第一行\r\n\n粗斜文字";
  const source: RichTextRun[] = [
    { text: "\n第一行\r\n\n" },
    { text: "粗斜文字", bold: true, italic: true },
  ];
  const lines = richTextLines(title, source, "1. " + title, [
    "1. ",
    "第一行",
    "",
    "粗斜",
    "文字",
  ]);
  assert.deepEqual(lines.map(text), ["1. ", "第一行", "", "粗斜", "文字"]);
  assert.deepEqual(flags(lines[0]![0]!), {
    bold: false,
    italic: false,
    underline: false,
  });
  assert.equal(lines[3]![0]!.bold, true);
  assert.equal(lines[4]![0]!.italic, true);
  assert.deepEqual(
    richTextLines("普通文字", undefined, "2. 普通文字", [
      "2. 普通",
      "文字",
    ]).map(text),
    ["2. 普通", "文字"],
  );
  assert.throws(
    () => richTextLines("原文", [{ text: "不同" }], "原文", ["原文"]),
    /不一致/,
  );
});

test("format actions wrap the real selection and can remove its existing wrapper", () => {
  const bold = wrapRichSelection("前文字后", 1, 3, "bold");
  assert.equal(bold.input, "前**文字**后");
  assert.equal(
    parseRichText(bold.input).runs.find((run) => run.text === "文字")?.bold,
    true,
  );
  const plain = wrapRichSelection(bold.input, bold.start, bold.end, "bold");
  assert.equal(plain.input, "前文字后");
  const mixed = wrapRichSelection(bold.input, bold.start, bold.end, "italic");
  assert.deepEqual(
    flags(parseRichText(mixed.input).runs.find((run) => run.text === "文字")!),
    { bold: true, italic: true, underline: false },
  );
  const onlyBold = wrapRichSelection(
    mixed.input,
    mixed.start,
    mixed.end,
    "italic",
  );
  assert.equal(onlyBold.input, bold.input);
  const wholeWrapper = wrapRichSelection("**粗体**", 0, 6, "italic");
  assert.deepEqual(flags(parseRichText(wholeWrapper.input).runs[0]!), {
    bold: true,
    italic: true,
    underline: false,
  });
  assert.throws(() => wrapRichSelection("文本", 1, 1, "bold"), /选中/);
});
