import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Link,
  Paperclip,
  Check,
} from "lucide-react";
import type { Sheet, Topic } from "./domain";
import { computeLayout, measureTopic } from "./layout";
import { safeImage } from "./assets";
import { flattenTopics } from "./model";
import { richTextLines } from "./richText";

export function Equation({ value }: { value: string }) {
  const [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    import("./render")
      .then((m) => m.equationSvg(value))
      .then((result) => {
        if (live) {
          setSvg(result);
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setSvg("");
          setError(String(e.message));
        }
      });
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <span
      className="equation"
      aria-label={`数学公式 ${value}`}
      title={error || value}
    >
      {svg ? (
        <span dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        error || "正在排版公式…"
      )}
    </span>
  );
}

interface Props {
  sheet: Sheet;
  selected: string[];
  zoom: number;
  setZoom: (n: number) => void;
  fitEpoch: number;
  editId: string | null;
  relationFrom: string | null;
  select: (id: string, multiple?: boolean) => void;
  startEdit: (id: string) => void;
  endEdit: (id: string, title?: string) => void;
  collapse: (id: string) => void;
  move: (id: string, parent: string) => void;
  moveFloating: (id: string, position: { x: number; y: number }) => void;
  addFloating: (position: { x: number; y: number }) => void;
  focusId: string | null;
  focusEpoch: number;
}
export function Canvas({
  sheet,
  selected,
  zoom,
  setZoom,
  fitEpoch,
  editId,
  relationFrom,
  select,
  startEdit,
  endEdit,
  collapse,
  move,
  moveFloating,
  addFloating,
  focusId,
  focusEpoch,
}: Props) {
  const layout = useMemo(() => computeLayout(sheet), [sheet]);
  const host = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 900, height: 650 });
  const [pan, setPan] = useState({ x: 0, y: 0 }),
    [space, setSpace] = useState(false),
    [dragging, setDragging] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const gesture = useRef<{
    x: number;
    y: number;
    pan: typeof pan;
    node?: string;
    moved?: boolean;
    floating?: { x: number; y: number };
    zoom?: number;
  } | null>(null);
  const edit = useRef<HTMLTextAreaElement>(null),
    [title, setTitle] = useState("");
  const editing = useRef<string | null>(null);
  editing.current = editId;
  function settle(id: string, value?: string, restoreFocus = false) {
    if (editing.current !== id) return;
    editing.current = null;
    endEdit(id, value);
    if (restoreFocus)
      requestAnimationFrame(() =>
        host.current
          ?.querySelector<HTMLButtonElement>(
            `[data-topic-id="${CSS.escape(id)}"] .topic`,
          )
          ?.focus(),
      );
  }
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  // A fit is explicit, or follows a sheet / layout change. Editing does not reset the viewport.
  useEffect(() => {
    const { bounds } = layout;
    const next = Math.max(
      0.15,
      Math.min(
        1,
        (size.width - 96) / bounds.width,
        (size.height - 100) / bounds.height,
      ),
    );
    setZoom(next);
    setPan({
      x: -(bounds.x + bounds.width / 2) * next,
      y: -(bounds.y + bounds.height / 2) * next - 24,
    });
  }, [fitEpoch, sheet.id, sheet.layout, size.width, size.height]);
  useEffect(() => {
    if (!focusId) return;
    const node = layout.nodes.find((n) => n.id === focusId);
    if (node)
      setPan({
        x: -(node.x + node.width / 2) * zoom,
        y: -(node.y + node.height / 2) * zoom,
      });
  }, [focusId, focusEpoch]);
  useEffect(() => {
    if (!editId) return;
    setTitle(layout.nodes.find((n) => n.id === editId)?.topic.title ?? "");
    requestAnimationFrame(() => {
      edit.current?.focus();
      edit.current?.select();
    });
  }, [editId]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        (event.target as HTMLElement)?.closest(".canvas") &&
        !(event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      ) {
        event.preventDefault();
        setSpace(true);
      }
    };
    const up = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, []);
  function begin(event: PointerEvent, node?: string) {
    if (event.button === 2 || editId) return;
    if (node && !space && event.button === 0) {
      select(node, event.ctrlKey || event.metaKey);
      gesture.current = {
        x: event.clientX,
        y: event.clientY,
        pan,
        node,
        floating: layout.nodes.find((n) => n.id === node)?.topic.floating,
        zoom,
      };
      setDragDelta({ x: 0, y: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      gesture.current = { x: event.clientX, y: event.clientY, pan };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function during(event: PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    if (Math.hypot(dx, dy) > 8) {
      g.moved = true;
      if (g.node) {
        setDragging(g.node);
        if (g.floating) setDragDelta({ x: dx / g.zoom!, y: dy / g.zoom! });
      } else setPan({ x: g.pan.x + dx, y: g.pan.y + dy });
    }
  }
  function finish(event: PointerEvent) {
    const g = gesture.current;
    if (g?.node && g.moved) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-topic-id]")?.dataset.topicId;
      if (g.floating && !(event.shiftKey && target && target !== g.node))
        moveFloating(g.node, {
          x: g.floating.x + (event.clientX - g.x) / g.zoom!,
          y: g.floating.y + (event.clientY - g.y) / g.zoom!,
        });
      else if (target && target !== g.node) move(g.node, target);
    }
    gesture.current = null;
    setDragging(null);
    setDragDelta({ x: 0, y: 0 });
  }
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        setZoom(
          Math.min(2, Math.max(0.15, zoom * (event.deltaY > 0 ? 0.9 : 1.1))),
        );
      else setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom, setZoom]);
  const floatingTree =
    dragging && gesture.current?.floating
      ? new Set(
          flattenTopics(layout.nodes.find((n) => n.id === dragging)!.topic).map(
            (t) => t.id,
          ),
        )
      : new Set<string>();
  const nodes = layout.nodes.map((n) =>
    floatingTree.has(n.id)
      ? { ...n, x: n.x + dragDelta.x, y: n.y + dragDelta.y }
      : n,
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div
      ref={host}
      className={`canvas ${sheet.theme === "dark" ? "dark-map" : ""} ${space ? "panning" : ""}`}
      tabIndex={0}
      aria-label="思维导图画布"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) begin(event);
      }}
      onPointerMove={during}
      onPointerUp={finish}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-topic-id]")) return;
        const box = host.current!.getBoundingClientRect();
        addFloating({
          x: (event.clientX - box.left - size.width / 2 - pan.x) / zoom,
          y: (event.clientY - box.top - size.height / 2 - pan.y) / zoom,
        });
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setDragging(null);
        setDragDelta({ x: 0, y: 0 });
      }}
    >
      <div
        className="map-world"
        style={{
          transform: `translate(${size.width / 2 + pan.x}px,${size.height / 2 + pan.y}px) scale(${zoom})`,
        }}
      >
        <svg className="map-lines" aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0,0 L7,3.5 L0,7" fill="#8a78bf" />
            </marker>
          </defs>
          {sheet.annotations.map((a) => {
            const nodes = a.topicIds
              .map((id) => byId.get(id))
              .filter((n) => !!n);
            if (!nodes.length) return null;
            const x = Math.min(...nodes.map((n) => n.x)) - 14,
              y = Math.min(...nodes.map((n) => n.y)) - 18,
              right = Math.max(...nodes.map((n) => n.x + n.width)) + 14,
              bottom = Math.max(...nodes.map((n) => n.y + n.height)) + 18;
            return (
              <g key={a.id} className="annotation">
                {a.kind === "boundary" ? (
                  <rect
                    x={x}
                    y={y}
                    width={right - x}
                    height={bottom - y}
                    rx="14"
                    fill={
                      a.kind === "boundary"
                        ? `${a.color || "#7d89b5"}12`
                        : "none"
                    }
                    stroke={a.color || "#7d89b5"}
                    strokeDasharray={a.kind === "boundary" ? "5 4" : undefined}
                  />
                ) : (
                  <path
                    d={`M ${right + 6} ${y + 18} h 8 v ${(bottom - y - 36) / 2 - 8} q 0 8 8 8 q -8 0 -8 8 v ${(bottom - y - 36) / 2 - 8} h -8`}
                    fill="none"
                    stroke={a.color || "#7d89b5"}
                  />
                )}
                <text
                  x={a.kind === "summary" ? right + 32 : x + 8}
                  y={a.kind === "summary" ? (y + bottom) / 2 + 4 : y - 6}
                  fill={a.color || "#7d89b5"}
                  fontSize="12"
                >
                  {a.kind === "summary" ? "概要 · " : ""}
                  {a.label}
                </text>
              </g>
            );
          })}
          {layout.edges.map((e) => (
            <path
              key={`${e.from}-${e.to}`}
              d={e.path}
              transform={
                floatingTree.has(e.from)
                  ? `translate(${dragDelta.x} ${dragDelta.y})`
                  : undefined
              }
              stroke={e.color}
              strokeWidth={byId.get(e.to)?.depth === 1 ? 4 : 2.5}
              fill="none"
            />
          ))}
          {sheet.relations.map((r) => {
            const a = byId.get(r.from),
              b = byId.get(r.to);
            if (!a || !b) return null;
            const ax = a.x + a.width / 2,
              ay = a.y,
              bx = b.x + b.width / 2,
              by = b.y;
            const lift = Math.min(110, Math.abs(ax - bx) * 0.25 + 45);
            return (
              <g key={r.id}>
                <path
                  d={`M${ax},${ay} C${ax},${ay - lift} ${bx},${by - lift} ${bx},${by}`}
                  stroke={r.color || "#8a78bf"}
                  strokeWidth="1.7"
                  fill="none"
                  strokeDasharray="5 4"
                  markerEnd="url(#arrow)"
                />
                <text
                  x={(ax + bx) / 2}
                  y={Math.min(ay, by) - lift * 0.7 - 6}
                  fontSize="12"
                  textAnchor="middle"
                  fill={r.color || "#8a78bf"}
                >
                  {r.label}
                </text>
              </g>
            );
          })}
        </svg>
        {nodes.map((n) => {
          const t = n.topic,
            shape = t.style?.shape ?? (n.depth <= 1 ? "round" : "underline");
          const metrics = measureTopic(t, n.depth, n.title);
          const richLines = richTextLines(
            t.title,
            t.richText,
            n.title,
            metrics.titleLines,
          );
          const style = {
            left: n.x,
            top: n.y,
            width: n.width,
            minHeight: n.height,
            height: n.height,
            "--branch": n.color,
            fontSize: metrics.fontSize,
            pointerEvents: floatingTree.has(n.id) ? "none" : undefined,
            fontWeight:
              t.style?.bold === false
                ? 400
                : t.style?.bold
                  ? 700
                  : n.depth <= 1
                    ? 600
                    : 400,
            fontStyle: t.style?.italic ? "italic" : "normal",
            color: t.style?.textColor,
          } as CSSProperties;
          return (
            <div
              key={n.id}
              data-topic-id={n.id}
              className={`topic-wrap depth-${n.depth} ${selected.includes(n.id) ? "selected" : ""} ${dragging === n.id ? "dragging" : ""} ${relationFrom === n.id ? "relation-source" : ""}`}
              style={style}
            >
              {editId === n.id ? (
                <textarea
                  ref={edit}
                  className="topic-editor resize-none"
                  style={{ resize: "none" }}
                  aria-label="编辑主题文字"
                  maxLength={10000}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => settle(n.id, title.trim() || t.title)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      settle(n.id, title.trim() || t.title, true);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      settle(n.id, undefined, true);
                    }
                  }}
                />
              ) : (
                <button
                  className={`topic shape-${shape}`}
                  aria-label={`主题：${t.title}`}
                  aria-pressed={selected.includes(n.id)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    begin(e, n.id);
                  }}
                  onDoubleClick={() => startEdit(n.id)}
                  onClick={(e) => {
                    if (e.detail === 0) select(n.id, e.ctrlKey || e.metaKey);
                  }}
                >
                  <span className="topic-title">
                    {richLines.map((line, index) => (
                      <span className="rich-line" key={index}>
                        {line.length
                          ? line.map((run, i) => (
                              <span
                                key={i}
                                style={{
                                  fontWeight: run.bold ? 700 : undefined,
                                  fontStyle: run.italic ? "italic" : undefined,
                                  textDecoration: run.underline
                                    ? "underline"
                                    : undefined,
                                }}
                              >
                                {run.text}
                              </span>
                            ))
                          : "\u00a0"}
                      </span>
                    ))}
                  </span>
                  {safeImage(t.image) && (
                    <img
                      className="topic-image"
                      src={t.image}
                      alt="主题图片"
                      draggable={false}
                    />
                  )}
                  {t.image && !safeImage(t.image) && (
                    <span className="image-unavailable">
                      图片未内嵌，请重新插入本机位图
                    </span>
                  )}
                  {t.equation && <Equation value={t.equation} />}
                  {t.markers?.length ? (
                    <span className="topic-markers">
                      {metrics.markerLines.join("\n")}
                    </span>
                  ) : null}
                  {metrics.labelLines.length > 0 && (
                    <span className="topic-labels">
                      {metrics.labelLines.join("\n")}
                    </span>
                  )}
                  {t.task && (
                    <span className="topic-task">
                      <span>
                        {t.task.status === "done" ? (
                          <Check size={13} />
                        ) : (
                          <span className="task-dot" />
                        )}{" "}
                        {t.task.status === "done"
                          ? "已完成"
                          : t.task.status === "doing"
                            ? "进行中"
                            : "待办"}{" "}
                        ·{" "}
                        {t.task.progress ??
                          (t.task.status === "done" ? 100 : 0)}
                        %
                      </span>
                      <span className="topic-progress">
                        <i
                          style={{
                            width: `${t.task.progress ?? (t.task.status === "done" ? 100 : 0)}%`,
                          }}
                        />
                      </span>
                      {(t.task.start || t.task.end || t.task.assignee) && (
                        <small>{metrics.taskLines.join("\n")}</small>
                      )}
                    </span>
                  )}
                  {(t.note || t.url || t.attachment) && (
                    <span className="topic-badges">
                      {t.note && <FileText size={12} />}{" "}
                      {t.url && <Link size={12} />}{" "}
                      {t.attachment && <Paperclip size={12} />}
                    </span>
                  )}
                </button>
              )}
              {!!t.children.length && (
                <button
                  className="collapse-button"
                  aria-label={`${t.collapsed ? "展开" : "折叠"}${t.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => collapse(n.id)}
                >
                  {t.collapsed ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {relationFrom && (
        <div className="canvas-message">点击目标主题建立关联线 · Esc 取消</div>
      )}
    </div>
  );
}
