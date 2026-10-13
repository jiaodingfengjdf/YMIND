import type { RichTextRun } from "./domain.ts";

export type { RichTextRun } from "./domain.ts";
export const MAX_RICH_TEXT_LENGTH = 20_000;
export const MAX_RICH_TEXT_RUNS = 256;
export const MAX_RICH_TEXT_INPUT = 50_000;
export type RichTextFormat = "bold" | "italic" | "underline";
type Flags = Pick<RichTextRun, "bold" | "italic" | "underline">;

function same(a: Flags, b: Flags): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline
  );
}

function append(runs: RichTextRun[], text: string, flags: Flags): void {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous && same(previous, flags)) previous.text += text;
  else
    runs.push({
      text,
      ...(flags.bold ? { bold: true } : {}),
      ...(flags.italic ? { italic: true } : {}),
      ...(flags.underline ? { underline: true } : {}),
    });
  if (runs.length > MAX_RICH_TEXT_RUNS)
    throw new Error("格式分段超过 256 段，请减少格式切换");
}

/** The deliberately small grammar handles paired **bold**, *italic*, __underline__ and escapes. */
export function parseRichText(input: string): {
  title: string;
  runs: RichTextRun[];
} {
  if (typeof input !== "string") throw new Error("富文本输入必须是文字");
  if (input.length > MAX_RICH_TEXT_INPUT)
    throw new Error("富文本输入超过 50000 字符，请缩短内容");
  function segment(
    start: number,
    closing: string | undefined,
    flags: Flags,
    depth: number,
  ): { runs: RichTextRun[]; end: number; matched: boolean } {
    if (depth > 32) throw new Error("格式嵌套过深，请减少嵌套");
    const runs: RichTextRun[] = [];
    let cursor = start,
      plain = "";
    const flush = () => {
      append(runs, plain, flags);
      plain = "";
    };
    while (cursor < input.length) {
      if (input[cursor] === "\\" && /[\\*_]/.test(input[cursor + 1] ?? "")) {
        plain += input[cursor + 1];
        cursor += 2;
        continue;
      }
      // A ** opener may occur inside italics; *** can close the inner italic then outer bold.
      if (
        closing &&
        input.startsWith(closing, cursor) &&
        !(
          closing === "*" &&
          input.startsWith("**", cursor) &&
          !input.startsWith("***", cursor)
        )
      ) {
        flush();
        return { runs, end: cursor + closing.length, matched: true };
      }
      const delimiter = input.startsWith("**", cursor)
        ? "**"
        : input.startsWith("__", cursor)
          ? "__"
          : input[cursor] === "*"
            ? "*"
            : undefined;
      if (delimiter) {
        const format: RichTextFormat =
          delimiter === "**"
            ? "bold"
            : delimiter === "__"
              ? "underline"
              : "italic";
        const child = segment(
          cursor + delimiter.length,
          delimiter,
          { ...flags, [format]: true },
          depth + 1,
        );
        if (child.matched) {
          flush();
          for (const run of child.runs) append(runs, run.text, run);
          cursor = child.end;
          continue;
        }
        plain += delimiter;
        cursor += delimiter.length;
        continue;
      }
      plain += input[cursor++];
    }
    flush();
    return { runs, end: cursor, matched: !closing };
  }
  const runs = segment(0, undefined, {}, 0).runs;
  const title = runs.map((run) => run.text).join("");
  if (title.length > MAX_RICH_TEXT_LENGTH)
    throw new Error("主题文字超过 20000 字符，请缩短内容");
  return { title, runs };
}

/** Canonical nesting shares common styles between runs; all literal delimiters are escaped. */
export function formatRichText(runs: readonly RichTextRun[]): string {
  if (runs.length > MAX_RICH_TEXT_RUNS) throw new Error("格式分段超过 256 段");
  if (
    runs.reduce((count, run) => count + run.text.length, 0) >
    MAX_RICH_TEXT_LENGTH
  )
    throw new Error("主题文字超过 20000 字符");
  const tokens: Array<[RichTextFormat, string]> = [
    ["bold", "**"],
    ["underline", "__"],
    ["italic", "*"],
  ];
  let opened: Array<[RichTextFormat, string]> = [],
    output = "";
  for (const run of runs) {
    if (!run.text) continue;
    const desired = tokens.filter(([flag]) => run[flag]);
    let shared = 0;
    while (
      shared < Math.min(opened.length, desired.length) &&
      opened[shared]![0] === desired[shared]![0]
    )
      shared++;
    output += opened
      .slice(shared)
      .reverse()
      .map(([, token]) => token)
      .join("");
    output += desired
      .slice(shared)
      .map(([, token]) => token)
      .join("");
    output += run.text.replace(/[\\*_]/g, (character) => "\\" + character);
    opened = desired;
  }
  return (
    output +
    opened
      .reverse()
      .map(([, token]) => token)
      .join("")
  );
}

function boundary(title: string, offset: number, end: boolean): number {
  let index = Math.max(0, Math.min(title.length, Math.trunc(offset)));
  const before = title.charCodeAt(index - 1),
    after = title.charCodeAt(index);
  if (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
    index += end ? 1 : -1;
  return index;
}

/** Selection offsets are textarea/DOM UTF-16 offsets, expanded to keep surrogate pairs intact. */
export function splitRichText(
  runs: readonly RichTextRun[],
  start: number,
  end: number,
): { before: RichTextRun[]; selected: RichTextRun[]; after: RichTextRun[] } {
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("选区位置无效");
  const title = runs.map((run) => run.text).join("");
  const from = boundary(title, Math.min(start, end), false),
    to = boundary(title, Math.max(start, end), true);
  const before: RichTextRun[] = [],
    selected: RichTextRun[] = [],
    after: RichTextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const next = cursor + run.text.length;
    append(
      before,
      run.text.slice(0, Math.max(0, Math.min(run.text.length, from - cursor))),
      run,
    );
    append(
      selected,
      run.text.slice(
        Math.max(0, from - cursor),
        Math.max(0, Math.min(run.text.length, to - cursor)),
      ),
      run,
    );
    append(after, run.text.slice(Math.max(0, to - cursor)), run);
    cursor = next;
  }
  return { before, selected, after };
}

/** Preserve formatting while consuming the exact line strings from the canonical layout wrapper. */
export function splitRichTextLines(
  runs: readonly RichTextRun[],
  lines: readonly string[],
  prefix = "",
): RichTextRun[][] {
  const source: RichTextRun[] = prefix
    ? [{ text: prefix }, ...runs]
    : [...runs];
  const title = source.map((run) => run.text).join("");
  let cursor = 0;
  return lines.map((line, index) => {
    if (index && title[cursor] === "\r" && title[cursor + 1] === "\n")
      cursor += 2;
    else if (index && (title[cursor] === "\r" || title[cursor] === "\n"))
      cursor++;
    if (title.slice(cursor, cursor + line.length) !== line)
      throw new Error("富文本分行与显示文字不一致");
    const result = splitRichText(source, cursor, cursor + line.length).selected;
    cursor += line.length;
    return result;
  });
}

export function richTextLines(
  topicTitle: string,
  runs: readonly RichTextRun[] | undefined,
  displayTitle: string,
  lines: readonly string[],
): RichTextRun[][] {
  const source = runs ?? [{ text: topicTitle }];
  if (source.map((run) => run.text).join("") !== topicTitle)
    throw new Error("富文本分段与主题文字不一致");
  if (!displayTitle.endsWith(topicTitle))
    throw new Error("显示标题与主题文字不一致");
  return splitRichTextLines(
    source,
    lines,
    displayTitle.slice(0, displayTitle.length - topicTitle.length),
  );
}

export function wrapRichSelection(
  input: string,
  start: number,
  end: number,
  format: RichTextFormat,
): { input: string; start: number; end: number } {
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("选区位置无效");
  if (start === end) throw new Error("请先选中需要设置格式的文字");
  const from = Math.max(0, Math.min(input.length, Math.min(start, end))),
    to = Math.max(0, Math.min(input.length, Math.max(start, end)));
  const delimiter = format === "bold" ? "**" : format === "italic" ? "*" : "__";
  const selected = input.slice(from, to),
    before = input.slice(0, from),
    after = input.slice(to);
  const italicOutside =
    format !== "italic" ||
    ((/\*+$/.exec(before)?.[0].length ?? 0) % 2 === 1 &&
      (/^\*+/.exec(after)?.[0].length ?? 0) % 2 === 1);
  const italicInside =
    format !== "italic" ||
    ((/^\*+/.exec(selected)?.[0].length ?? 0) % 2 === 1 &&
      (/\*+$/.exec(selected)?.[0].length ?? 0) % 2 === 1);
  if (
    before.endsWith(delimiter) &&
    after.startsWith(delimiter) &&
    italicOutside &&
    !before.endsWith("\\" + delimiter)
  ) {
    return {
      input:
        before.slice(0, -delimiter.length) +
        selected +
        after.slice(delimiter.length),
      start: from - delimiter.length,
      end: to - delimiter.length,
    };
  }
  if (
    selected.startsWith(delimiter) &&
    selected.endsWith(delimiter) &&
    italicInside &&
    selected.length > delimiter.length * 2
  ) {
    return {
      input:
        before + selected.slice(delimiter.length, -delimiter.length) + after,
      start: from,
      end: to - delimiter.length * 2,
    };
  }
  const result = before + delimiter + selected + delimiter + after;
  if (result.length > MAX_RICH_TEXT_INPUT)
    throw new Error("富文本输入过长，请缩短内容");
  return {
    input: result,
    start: from + delimiter.length,
    end: to + delimiter.length,
  };
}
