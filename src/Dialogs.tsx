import { useEffect, useState, useId, useRef } from "react";
import type { Sheet, Topic, TopicTask, Workbook } from "./domain";
import { flattenTopics } from "./model";
import { FORMAT_NOTES, type ExportFormat } from "./formats";
import { loadRevisions, type Revision } from "./storage";
import { Equation } from "./Canvas";
import { safeImage } from "./assets";
import { Field, Modal } from "./ui";

export type MapFormat = ExportFormat | "svg" | "png" | "jpeg" | "pdf";
const formats: [MapFormat, string, string][] = [
  ["ymind", "YMIND", "完整文档备份"],
  ["xmind", "Xmind", "现代 JSON 格式"],
  ["png", "PNG", "高清无损图片"],
  ["jpeg", "JPEG", "高质量图片"],
  ["svg", "SVG", "矢量图"],
  ["pdf", "PDF", "单页完整图"],
  ["markdown", "Markdown", "文字大纲"],
  ["textbundle", "TextBundle", "带图片的文字压缩包"],
  ["opml", "OPML", "通用大纲"],
  ["freemind", "FreeMind", "思维导图格式"],
  ["docx", "Word", "层级文字文档"],
  ["xlsx", "Excel", "主题与任务表"],
  ["pptx", "PowerPoint", "分支演示文稿"],
  ["ics", "日历", "有日期的任务"],
];
export function ExportDialog({
  onClose,
  onExport,
  busy,
}: {
  onClose: () => void;
  onExport: (format: MapFormat) => void;
  busy: boolean;
}) {
  const [format, setFormat] = useState<MapFormat>("ymind");
  const notes =
    format in FORMAT_NOTES
      ? FORMAT_NOTES[format as keyof typeof FORMAT_NOTES]
      : format === "ymind"
        ? "保留所有画布、样式、任务、附件、公式、备注、关联和范围标注，是完整备份的推荐格式。"
        : "导出当前画布。隐藏的折叠子主题按当前显示状态导出；如需全部主题，请先展开。大图导出会检查像素上限。";
  return (
    <Modal title="导出文档" onClose={onClose} wide>
      <p className="muted">选择适合分享或备份的格式。文件直接保存到本机。</p>
      <div className="export-grid">
        {formats.map(([id, label, desc]) => (
          <button
            key={id}
            className={format === id ? "chosen" : ""}
            onClick={() => setFormat(id)}
            disabled={busy}
          >
            <strong>{label}</strong>
            <small>{desc}</small>
          </button>
        ))}
      </div>
      <div className="format-note">{notes}</div>
      <div className="modal-actions">
        <button onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          className="primary"
          onClick={() => onExport(format)}
          disabled={busy}
        >
          {busy ? "正在生成文件…" : "导出文件"}
        </button>
      </div>
    </Modal>
  );
}
export function ContentDialog({
  kind,
  topic,
  onClose,
  onApply,
}: {
  kind: string;
  topic: Topic;
  onClose: () => void;
  onApply: (value: Partial<Topic>) => boolean | void;
}) {
  const [value, setValue] = useState(
    kind === "note"
      ? topic.note || ""
      : kind === "link"
        ? topic.url || ""
        : kind === "equation"
          ? topic.equation || ""
          : kind === "labels"
            ? topic.labels?.join(", ") || ""
            : topic.markers?.join(" ") || "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false),
    errorId = useId(),
    field = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const title =
    {
      note: "主题备注",
      link: "超链接",
      equation: "数学公式",
      markers: "主题标记",
      labels: "主题标签",
    }[kind] || "主题内容";
  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      if (kind === "link" && value.trim()) {
        const url = new URL(value);
        if (!["http:", "https:", "mailto:"].includes(url.protocol))
          throw new Error("请输入 http、https 或 mailto 链接");
      }
      if (kind === "equation" && value.trim())
        await (await import("./render")).equationSvg(value);
      if (!alive.current) return;
      const applied = onApply({
        [kind === "link" ? "url" : kind === "markers" ? "markers" : kind]:
          kind === "labels"
            ? [
                ...new Set(
                  value
                    .split(/[,，\n]/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                ),
              ]
            : kind === "markers"
              ? value.trim().split(/\s+/).filter(Boolean)
              : value.trim() || undefined,
      });
      if (applied === false)
        throw new Error(
          "本次修改未保存，请检查内容长度或减少文档中的图片、附件。",
        );
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "内容无效");
        field.current?.focus();
      }
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{topic.title}</p>
      {kind === "note" ? (
        <Field label="备注内容">
          <textarea
            className="resize-none"
            style={{ resize: "none" }}
            rows={9}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(430, Math.max(200, e.currentTarget.scrollHeight))}px`;
            }}
            placeholder="补充说明、想法或行动步骤…"
          />
        </Field>
      ) : (
        <Field
          label={
            kind === "link"
              ? "链接地址"
              : kind === "equation"
                ? "LaTeX 表达式"
                : kind === "labels"
                  ? "标签（用逗号分隔）"
                  : "标记（用空格分隔）"
          }
        >
          <input
            ref={field}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              kind === "link"
                ? "https://example.com"
                : kind === "equation"
                  ? "E = mc^2"
                  : kind === "labels"
                    ? "设计, 优先级, 待讨论"
                    : "⭐ ✅ 🔥"
            }
          />
        </Field>
      )}
      {kind === "labels" && (
        <p className="muted">
          使用逗号分隔标签，每个主题最多 32 个标签，每个标签最多 256 字符。
        </p>
      )}
      {kind === "equation" && value && (
        <div className="formula-preview">
          <Equation value={value} />
        </div>
      )}
      {kind === "markers" && (
        <div className="marker-picker">
          {[
            "⭐",
            "✅",
            "❗",
            "🔥",
            "💡",
            "🚩",
            "1️⃣",
            "2️⃣",
            "3️⃣",
            "👍",
            "🎯",
            "🔴",
            "🟡",
            "🟢",
          ].map((mark) => (
            <button
              key={mark}
              aria-label={`添加标记${mark}`}
              onClick={() => setValue((v) => `${v} ${mark}`.trim())}
            >
              {mark}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert" id={errorId}>
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          disabled={saving}
          onClick={() => {
            setValue("");
            onApply({
              [kind === "link" ? "url" : kind === "markers" ? "markers" : kind]:
                undefined,
            });
          }}
        >
          清除
        </button>
        <button className="primary" onClick={submit} disabled={saving}>
          {saving ? "处理中…" : "保存"}
        </button>
      </div>
    </Modal>
  );
}
export function TaskDialog({
  topic,
  onClose,
  onApply,
}: {
  topic: Topic;
  onClose: () => void;
  onApply: (value?: TopicTask) => void;
}) {
  const [task, setTask] = useState<TopicTask>(
      topic.task || { status: "todo", progress: 0 },
    ),
    [error, setError] = useState("");
  function submit() {
    if (task.start && task.end && task.end < task.start) {
      setError("结束日期不能早于开始日期");
      return;
    }
    onApply({
      ...task,
      progress: task.status === "done" ? 100 : task.progress,
    });
  }
  return (
    <Modal title="任务信息" onClose={onClose}>
      <p className="muted">{topic.title}</p>
      <Field label="状态">
        <select
          value={task.status}
          onChange={(e) =>
            setTask({ ...task, status: e.target.value as TopicTask["status"] })
          }
        >
          <option value="todo">待办</option>
          <option value="doing">进行中</option>
          <option value="done">已完成</option>
        </select>
      </Field>
      <div className="two-fields">
        <Field label="开始日期">
          <input
            type="date"
            value={task.start || ""}
            onInput={(e) => {
              const start = e.currentTarget.value || undefined;
              setTask((current) => ({ ...current, start }));
            }}
            onChange={(e) =>
              setTask({ ...task, start: e.target.value || undefined })
            }
          />
        </Field>
        <Field label="结束日期">
          <input
            type="date"
            value={task.end || ""}
            onInput={(e) => {
              const end = e.currentTarget.value || undefined;
              setTask((current) => ({ ...current, end }));
            }}
            onChange={(e) =>
              setTask({ ...task, end: e.target.value || undefined })
            }
          />
        </Field>
      </div>
      <Field label="负责人">
        <input
          value={task.assignee || ""}
          onChange={(e) => setTask({ ...task, assignee: e.target.value })}
        />
      </Field>
      <Field label={`完成进度 ${task.progress || 0}%`}>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={task.progress || 0}
          onChange={(e) =>
            setTask({ ...task, progress: Number(e.target.value) })
          }
        />
      </Field>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button onClick={() => onApply(undefined)}>移除任务</button>
        <button className="primary" onClick={submit}>
          保存任务
        </button>
      </div>
    </Modal>
  );
}
export function TextDialog({
  title,
  label,
  initial = "",
  onClose,
  onApply,
}: {
  title: string;
  label: string;
  initial?: string;
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onApply(value.trim());
        }}
      >
        <Field label={label}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={10000}
          />
        </Field>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!value.trim()}>
            确定
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function HistoryDialog({
  onClose,
  restore,
}: {
  onClose: () => void;
  restore: (workbook: Workbook) => void;
}) {
  const [items, setItems] = useState<Revision[]>([]),
    [status, setStatus] = useState("正在读取…");
  useEffect(() => {
    let live = true;
    loadRevisions()
      .then((r) => {
        if (live) {
          setItems(r);
          setStatus("");
        }
      })
      .catch(() => {
        if (live) setStatus("无法读取本机历史");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal title="本机历史版本" onClose={onClose}>
      <p className="muted">
        手动保存（Ctrl+S）生成快照，保留最近 30 个版本。恢复可通过撤销回退。
      </p>
      {status ? (
        <p>{status}</p>
      ) : items.length ? (
        <div className="history-list">
          {items.map((item) => (
            <button key={item.id} onClick={() => restore(item.workbook)}>
              <span>{item.title}</span>
              <small>{new Date(item.date).toLocaleString("zh-CN")}</small>
              <strong>恢复</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          还没有快照。先按 Ctrl+S 保存一个版本。
        </div>
      )}
    </Modal>
  );
}
export function GanttDialog({
  sheet,
  onClose,
  select,
}: {
  sheet: Sheet;
  onClose: () => void;
  select: (id: string) => void;
}) {
  const tasks = flattenTopics(sheet.root).filter((t) => t.task);
  const dated = tasks.filter((t) => t.task?.start),
    day = 86400000;
  const start = dated.length
    ? Math.min(...dated.map((t) => Date.parse(t.task!.start!)))
    : Date.now();
  const end = dated.length
    ? Math.max(
        ...dated.map((t) => Date.parse(t.task!.end || t.task!.start!) + day),
      )
    : start + day;
  const days = Math.max(1, Math.round((end - start) / day));
  return (
    <Modal title="任务与甘特视图" onClose={onClose} wide>
      <p className="muted">
        {sheet.title} · {tasks.length}{" "}
        项任务。给任务设置日期后即可显示时间进度。
      </p>
      {tasks.length ? (
        <>
          <div className="gantt-scale">
            <span>{new Date(start).toLocaleDateString("zh-CN")}</span>
            <span>{days} 天</span>
            <span>{new Date(end - day).toLocaleDateString("zh-CN")}</span>
          </div>
          <div className="gantt-list">
            {tasks.map((t) => (
              <button
                className="gantt-row"
                key={t.id}
                onClick={() => select(t.id)}
              >
                <span>
                  {t.title}
                  <small>{t.task?.assignee || "未指定负责人"}</small>
                </span>
                <div className="gantt-track">
                  {t.task?.start ? (
                    <span
                      className={`gantt-bar ${t.task.status}`}
                      style={{
                        left: `${Math.max(0, ((Date.parse(t.task.start) - start) / (end - start)) * 100)}%`,
                        width: `${Math.max(2, ((Date.parse(t.task.end || t.task.start) + day - Date.parse(t.task.start)) / (end - start)) * 100)}%`,
                      }}
                    >
                      <i
                        style={{
                          width: `${t.task.progress || (t.task.status === "done" ? 100 : 0)}%`,
                        }}
                      />
                    </span>
                  ) : (
                    <small>未设置日期</small>
                  )}
                </div>
                <strong>
                  {t.task?.status === "done"
                    ? "已完成"
                    : t.task?.status === "doing"
                      ? "进行中"
                      : "待办"}
                </strong>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">
          选中主题后，在「工具 → 任务信息」中建立第一项任务。
        </div>
      )}
    </Modal>
  );
}
export function Presentation({
  sheet,
  onClose,
}: {
  sheet: Sheet;
  onClose: () => void;
}) {
  const slides = sheet.root.children.length
      ? sheet.root.children
      : [sheet.root],
    [index, setIndex] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(slides.length - 1, i + 1));
      }
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, slides.length]);
  const slide = slides[index];
  function list(topic: Topic) {
    return (
      <li key={topic.id}>
        <span>{topic.title}</span>
        {topic.note && <p>{topic.note}</p>}
        {topic.children.length ? <ul>{topic.children.map(list)}</ul> : null}
      </li>
    );
  }
  return (
    <Modal title="分支演示" onClose={onClose} fullScreen>
      <div className="presentation">
        <div className="presentation-top">
          <span>YMIND / {sheet.title}</span>
          <button onClick={onClose}>退出演示 Esc</button>
        </div>
        <article>
          <span className="eyebrow">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(slides.length).padStart(2, "0")}
          </span>
          <h1>{slide.title}</h1>
          {safeImage(slide.image) && <img src={slide.image} alt="主题图片" />}
          {slide.note && <p>{slide.note}</p>}
          <ul>{slide.children.map(list)}</ul>
        </article>
        <div className="presentation-controls">
          <button disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            ← 上一页
          </button>
          <span>
            {index + 1} / {slides.length}
          </span>
          <button
            disabled={index === slides.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            下一页 →
          </button>
        </div>
      </div>
    </Modal>
  );
}
