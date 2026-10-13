import { useState, useMemo } from "react";
import {
  Bold,
  Italic,
  GitBranch,
  Network,
  AlignLeft,
  CalendarDays,
  CircleDot,
  Fish,
  ArrowLeft,
  ListTree,
  FileText,
  Link,
  ListTodo,
  Sigma,
  Paperclip,
  Braces,
  Table2,
  Grid3X3,
  ArrowUp,
  ArrowDown,
  Tags,
  Type,
  Mic,
} from "lucide-react";
import type { Layout, Sheet, Shape, Theme, Topic, TopicStyle } from "./domain";
import { flattenTopics, themeColors } from "./model";
import { computeLayout } from "./layout";
import { safeLink } from "./assets";
import { Field, IconButton } from "./ui";
export const layoutNames: Record<Layout, string> = {
  mindmap: "思维导图",
  right: "逻辑图（右）",
  left: "逻辑图（左）",
  org: "组织结构",
  tree: "树状图",
  timeline: "时间轴",
  fishbone: "鱼骨图",
  radial: "放射图",
  brace: "括号图",
  treetable: "树形表格",
  matrix: "矩阵图",
  "org-up": "组织结构（向上）",
  "timeline-vertical": "时间轴（纵向）",
};
const layoutIcons = {
  mindmap: GitBranch,
  right: AlignLeft,
  left: ArrowLeft,
  org: Network,
  tree: ListTree,
  timeline: CalendarDays,
  fishbone: Fish,
  radial: CircleDot,
  brace: Braces,
  treetable: Table2,
  matrix: Grid3X3,
  "org-up": ArrowUp,
  "timeline-vertical": ArrowDown,
};
export const themeNames: Record<Theme, string> = {
  classic: "经典",
  ocean: "海洋",
  forest: "森林",
  sunset: "日落",
  violet: "紫藤",
  mono: "墨色",
  dark: "深色",
};
export function Inspector({
  sheet,
  topic,
  changeStyle,
  changeSheet,
  action,
  move,
  editConnection,
}: {
  sheet: Sheet;
  topic: Topic;
  changeStyle: (value: Partial<TopicStyle>) => void;
  changeSheet: (value: Partial<Sheet>) => void;
  action: (value: string) => void;
  move: (parent: string) => void;
  editConnection: (id: string, kind: "relation" | "annotation") => void;
}) {
  const [tab, setTab] = useState("style");
  const nodes = useMemo(() => computeLayout(sheet).nodes, [sheet]);
  const currentNode = nodes.find((n) => n.id === topic.id),
    effectiveColor = currentNode?.color || "#1677ff";
  const primary = (currentNode?.depth ?? 0) <= 1,
    effectiveBold = topic.style?.bold ?? primary;
  const effectiveShape =
    topic.style?.shape ?? (primary ? "round" : "underline");
  const shapes: Record<Shape, string> = {
    round: "圆角",
    rect: "矩形",
    ellipse: "椭圆",
    underline: "下划线",
    diamond: "菱形",
  };
  function shapeButtons(items: Shape[]) {
    return (
      <div className="shape-grid">
        {items.map((shape) => (
          <button
            key={shape}
            className={effectiveShape === shape ? "chosen" : ""}
            onClick={() => changeStyle({ shape })}
          >
            <span className={`shape-preview shape-${shape}`} />
            <small>{shapes[shape]}</small>
          </button>
        ))}
      </div>
    );
  }
  function layoutButtons(items: Layout[]) {
    return (
      <div className="layout-grid">
        {items.map((id) => {
          const I = layoutIcons[id];
          return (
            <button
              key={id}
              className={sheet.layout === id ? "chosen" : ""}
              onClick={() => changeSheet({ layout: id })}
            >
              <I size={30} strokeWidth={1.2} />
              <span>{layoutNames[id]}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <aside className="inspector" aria-label="主题属性">
      <div className="panel-tabs" role="tablist" aria-label="属性类别">
        <button
          role="tab"
          aria-selected={tab === "style"}
          onClick={() => setTab("style")}
        >
          样式
        </button>
        <button
          role="tab"
          aria-selected={tab === "structure"}
          onClick={() => setTab("structure")}
        >
          结构
        </button>
      </div>
      {tab === "style" ? (
        <div className="inspector-body">
          <h3>主题颜色</h3>
          <div className="swatches">
            {[...themeColors(sheet.theme), "#9aa7ba"].map((color) => (
              <button
                key={color}
                title={color}
                aria-label={`主题颜色 ${color}`}
                className={effectiveColor === color ? "chosen" : ""}
                style={{ background: color }}
                onClick={() => changeStyle({ color })}
              />
            ))}
          </div>
          <div className="color-custom">
            <label>
              自选颜色{" "}
              <input
                aria-label="自选主题颜色"
                type="color"
                value={effectiveColor}
                onChange={(e) => changeStyle({ color: e.target.value })}
              />
            </label>
            <button
              className="text-button"
              onClick={() => changeStyle({ color: undefined })}
            >
              跟随分支
            </button>
          </div>
          <h3>文字</h3>
          <div className="text-style-row">
            <Field label="字号">
              <select
                aria-label="字号"
                value={
                  topic.style?.fontSize ?? (currentNode?.depth === 0 ? 24 : 16)
                }
                onChange={(e) =>
                  changeStyle({ fontSize: Number(e.target.value) })
                }
              >
                {[12, 14, 16, 18, 20, 22, 24, 28, 32, 40, 48].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <IconButton
              icon={Bold}
              label="粗体"
              active={effectiveBold}
              onClick={() => changeStyle({ bold: !effectiveBold })}
            />
            <IconButton
              icon={Italic}
              label="斜体"
              active={topic.style?.italic}
              onClick={() => changeStyle({ italic: !topic.style?.italic })}
            />
          </div>
          <h3>形状</h3>
          {shapeButtons(["round", "rect", "ellipse"])}
          <h3>布局</h3>
          {layoutButtons(["mindmap", "right", "org", "timeline"])}
          <button
            className="text-button all-layouts"
            onClick={() => setTab("structure")}
          >
            查看全部 13 种布局 →
          </button>
          <details className="advanced-style">
            <summary>更多样式</summary>
            <Field label="文字颜色">
              <input
                type="color"
                value={topic.style?.textColor || "#152238"}
                onChange={(e) => changeStyle({ textColor: e.target.value })}
              />
            </Field>
            {shapeButtons(["underline", "diamond"])}
          </details>
          <h3>画布主题</h3>
          <Field label="配色">
            <select
              aria-label="配色"
              value={sheet.theme}
              onChange={(e) => changeSheet({ theme: e.target.value as Theme })}
            >
              {Object.entries(themeNames).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <h3>主题内容</h3>
          <div className="property-actions">
            {[
              [FileText, "note", "备注"],
              [Link, "link", "超链接"],
              [ListTodo, "task", "任务"],
              [Sigma, "equation", "公式"],
              [Paperclip, "attachment", "附件"],
              [Tags, "labels", "标签"],
              [Type, "rich", "富文本"],
              [Mic, "record", "录音"],
            ].map(([Icon, id, label]) => {
              const I = Icon as typeof FileText;
              return (
                <button key={String(id)} onClick={() => action(String(id))}>
                  <I size={16} />
                  {String(label)}
                </button>
              );
            })}
          </div>
          {topic.note && <p className="note-preview">{topic.note}</p>}
          {safeLink(topic.url) && (
            <a
              className="safe-link"
              href={safeLink(topic.url)}
              target="_blank"
              rel="noreferrer"
            >
              打开超链接 ↗
            </a>
          )}
          {topic.image && (
            <button
              className="text-button"
              onClick={() => action("remove-image")}
            >
              移除主题图片
            </button>
          )}
        </div>
      ) : (
        <div className="inspector-body">
          <h3>布局</h3>
          {layoutButtons(Object.keys(layoutNames) as Layout[])}
          <h3>自动编号</h3>
          <Field label="编号方式">
            <select
              aria-label="编号方式"
              value={sheet.numbering || "none"}
              onChange={(e) =>
                changeSheet({ numbering: e.target.value as Sheet["numbering"] })
              }
            >
              <option value="none">无编号</option>
              <option value="decimal">数字 · 1, 2, 3</option>
              <option value="hierarchical">层级 · 1.1, 1.2</option>
              <option value="roman">罗马数字 · I, II, III</option>
            </select>
          </Field>
          <h3>移动主题</h3>
          <Field label="移动到父主题">
            <select
              aria-label="移动到父主题"
              value=""
              disabled={topic.id === sheet.root.id}
              onChange={(e) => {
                if (e.target.value) move(e.target.value);
              }}
            >
              <option value="">选择目标主题…</option>
              {flattenTopics(sheet.root)
                .filter((t) => t.id !== topic.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </Field>
          <p className="muted">
            拖到另一个主题可移动分支。悬浮主题可自由拖动；按住 Shift
            拖到主题上可连接。根主题不能移动。
          </p>
          {topic.id !== sheet.root.id && (
            <button className="text-button" onClick={() => action("detach")}>
              {topic.floating ? "连接到中心主题" : "转为悬浮主题"}
            </button>
          )}
          <h3>画布连接</h3>
          {sheet.relations.length || sheet.annotations.length ? (
            <div className="connection-list">
              {sheet.relations.map((r) => (
                <div key={r.id}>
                  <span>关联 · {r.label || "未命名"}</span>
                  <button
                    aria-label={`编辑关联 ${r.label}`}
                    onClick={() => editConnection(r.id, "relation")}
                  >
                    编辑
                  </button>
                  <button
                    aria-label={`删除关联 ${r.label}`}
                    onClick={() =>
                      changeSheet({
                        relations: sheet.relations.filter((v) => v.id !== r.id),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              {sheet.annotations.map((a) => (
                <div key={a.id}>
                  <span>
                    {a.kind === "boundary" ? "边界" : "概要"} · {a.label}
                  </span>
                  <button
                    aria-label={`编辑${a.kind === "boundary" ? "边界" : "概要"} ${a.label}`}
                    onClick={() => editConnection(a.id, "annotation")}
                  >
                    编辑
                  </button>
                  <button
                    aria-label={`删除${a.label}`}
                    onClick={() =>
                      changeSheet({
                        annotations: sheet.annotations.filter(
                          (v) => v.id !== a.id,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              选中主题后添加关联线；Ctrl 多选主题后添加边界或概要。
            </p>
          )}
        </div>
      )}
      <div className="inspector-tip">
        <span className="keycap">Tab</span>
        <span>快速添加子主题</span>
      </div>
    </aside>
  );
}
