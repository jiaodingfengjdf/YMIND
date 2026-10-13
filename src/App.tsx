import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  Plus,
  Minus,
  Maximize,
  Search,
  X,
  Undo2,
  Redo2,
  Download,
  ChevronDown,
  ChevronRight,
  ListTree,
  Network,
  SquareDashed,
  Braces,
  Flag,
  FileText,
  Image,
  Presentation as PresentationIcon,
  Focus,
  PanelRight,
  Trash2,
  MoreHorizontal,
  CircleCheck,
  PanelLeft,
  Sigma,
  ListTodo,
  Paperclip,
  Link,
  Upload,
} from "lucide-react";
import type { Sheet, Topic, TopicStyle } from "./domain";
import {
  addChild,
  addSibling,
  countTopics,
  createTopic,
  createWorkbook,
  findTopic,
  flattenTopics,
  moveTopic,
  removeTopic,
  uid,
  updateTopic,
} from "./model";
import { parseDocument, exportDocument } from "./formats";
import { useWorkbook } from "./useWorkbook";
import { saveRevision } from "./storage";
import { safeFile } from "./assets";
import { Canvas } from "./Canvas";
import { computeLayout } from "./layout";
import { RichEditor } from "./RichEditor";
import { Recorder } from "./Recorder";
import { Inspector } from "./Inspector";
import {
  ContentDialog,
  ExportDialog,
  GanttDialog,
  HistoryDialog,
  Presentation,
  TaskDialog,
  TextDialog,
  type MapFormat,
} from "./Dialogs";
import { IconButton, Modal, Toast, PopupMenu } from "./ui";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
type MenuItem = [string, string, string?];
const menus: Record<string, MenuItem[]> = {
  文件: [
    ["新建文档", "new", "Ctrl+N"],
    ["打开文件…", "open", "Ctrl+O"],
    ["保存历史快照", "save", "Ctrl+S"],
    ["导出…", "export", "Ctrl+E"],
    ["历史版本", "history"],
  ],
  编辑: [
    ["撤销", "undo", "Ctrl+Z"],
    ["重做", "redo", "Ctrl+Shift+Z"],
    ["添加子主题", "child", "Tab"],
    ["添加同级主题", "sibling", "Enter"],
    ["添加悬浮主题", "floating"],
    ["编辑文字", "edit", "F2"],
    ["编辑富文本", "rich"],
    ["复制分支", "copy"],
    ["粘贴分支", "paste"],
    ["删除主题", "delete", "Delete"],
  ],
  视图: [
    ["适合画布", "fit"],
    ["展开全部", "expand"],
    ["折叠全部", "collapse"],
    ["专注模式", "focus"],
    ["分支演示", "present"],
    ["显示 / 隐藏大纲", "sidebar"],
    ["显示 / 隐藏属性", "inspector"],
  ],
  工具: [
    ["主题标记", "markers"],
    ["主题标签", "labels"],
    ["主题备注", "note"],
    ["超链接", "link"],
    ["插入图片", "image"],
    ["文件 / 音频附件", "attachment"],
    ["录制音频", "record"],
    ["数学公式", "equation"],
    ["任务信息", "task"],
    ["任务与甘特图", "gantt"],
  ],
  帮助: [
    ["使用说明与快捷键", "help"],
    ["关于 YMIND", "about"],
  ],
};

export default function App() {
  const {
    workbook,
    commit,
    replace,
    undo,
    redo,
    save,
    status,
    loaded,
    canUndo,
    canRedo,
  } = useWorkbook();
  const sheet =
    workbook.sheets.find((s) => s.id === workbook.activeSheetId) ||
    workbook.sheets[0];
  const [selection, setSelection] = useState<string[]>([]),
    [editId, setEditId] = useState<string | null>(null);
  const selected = selection.filter((id) => findTopic(sheet.root, id)),
    topic = findTopic(sheet.root, selected.at(-1) || "") || sheet.root;
  const [menu, setMenu] = useState<string | null>(null),
    [modal, setModal] = useState<string | null>(null),
    [toast, setToast] = useState("");
  const [zoom, setZoom] = useState(1),
    [fitEpoch, setFitEpoch] = useState(0),
    [focusId, setFocusId] = useState<string | null>(null);
  const [focusEpoch, setFocusEpoch] = useState(0);
  const [relationFrom, setRelationFrom] = useState<string | null>(null),
    [focusMode, setFocusMode] = useState(false),
    [inspector, setInspector] = useState(() => window.innerWidth >= 760),
    [sidebar, setSidebar] = useState(() => window.innerWidth >= 1100);
  const [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [documentTitle, setDocumentTitle] = useState(workbook.title);
  const [searchQuery, setSearchQuery] = useState("");
  const composing = useRef(false);
  const [sheetMenu, setSheetMenu] = useState<string | null>(null),
    [sheetTarget, setSheetTarget] = useState<string | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<{
    id: string;
    kind: "relation" | "annotation";
  } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    attachmentInput = useRef<HTMLInputElement>(null),
    copied = useRef<Topic | null>(null);
  const closeModal = useCallback(() => setModal(null), []),
    closeToast = useCallback(() => setToast(""), []);
  useEffect(() => setDocumentTitle(workbook.title), [workbook.title]);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1099px)"),
      phone = window.matchMedia("(max-width: 759px)");
    const closeSidebar = () => {
        if (narrow.matches) setSidebar(false);
      },
      closeInspector = () => {
        if (phone.matches) setInspector(false);
      };
    narrow.addEventListener("change", closeSidebar);
    phone.addEventListener("change", closeInspector);
    return () => {
      narrow.removeEventListener("change", closeSidebar);
      phone.removeEventListener("change", closeInspector);
    };
  }, []);
  useEffect(() => {
    const visible = new Set<string>();
    function scan(t: Topic) {
      visible.add(t.id);
      t.children.filter((c) => !t.collapsed || c.floating).forEach(scan);
    }
    scan(sheet.root);
    if (selection.some((id) => !visible.has(id))) {
      const keep = selection.filter((id) => visible.has(id));
      if (!keep.length) {
        const id = selection.at(-1);
        function path(t: Topic): Topic[] | undefined {
          if (t.id === id) return [t];
          for (const c of t.children) {
            const p = path(c);
            if (p) return [t, ...p];
          }
        }
        keep.push(
          path(sheet.root)
            ?.filter((t) => visible.has(t.id))
            .at(-1)?.id || sheet.root.id,
        );
      }
      setSelection(keep);
    }
    if (editId && !visible.has(editId)) setEditId(null);
  }, [sheet.root, selection, editId]);
  function focusTopic(id: string) {
    setFocusId(id);
    setFocusEpoch((n) => n + 1);
  }
  useEffect(() => {
    setSelection([sheet.root.children[2]?.id || sheet.root.id]);
    setEditId(null);
    setRelationFrom(null);
    setFocusId(null);
  }, [sheet.id]);
  useEffect(() => {
    if (!menu && !sheetMenu) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".menu-area,.sheet-menu-area")) {
        setMenu(null);
        setSheetMenu(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setSheetMenu(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu, sheetMenu]);
  const mutate = useCallback(
    (change: (s: Sheet) => void) =>
      commit((w) => {
        const s = w.sheets.find((v) => v.id === w.activeSheetId)!;
        change(s);
      }),
    [commit],
  );
  function changeTopic(value: Partial<Topic>) {
    return mutate((s) =>
      updateTopic(s.root, topic.id, (t) => Object.assign(t, value)),
    );
  }
  function style(value: Partial<TopicStyle>) {
    mutate((s) => {
      for (const id of selected.length ? selected : [topic.id])
        updateTopic(s.root, id, (t) => {
          t.style = { ...t.style, ...value };
        });
    });
  }
  function select(id: string, multiple = false) {
    if (relationFrom) {
      if (!findTopic(sheet.root, relationFrom)) {
        setRelationFrom(null);
        setSelection([id]);
        return;
      }
      if (id !== relationFrom) {
        mutate((s) =>
          s.relations.push({
            id: uid(),
            from: relationFrom,
            to: id,
            label: "关联",
          }),
        );
        setToast("关联线已添加，可在结构面板移除");
      }
      setRelationFrom(null);
      return;
    }
    setSelection((previous) =>
      multiple
        ? previous.includes(id)
          ? previous.filter((v) => v !== id)
          : [...previous, id]
        : [id],
    );
  }
  function reveal(id: string) {
    mutate((s) => {
      function open(t: Topic): boolean {
        if (t.id === id) return true;
        if (t.children.some(open)) {
          t.collapsed = false;
          return true;
        }
        return false;
      }
      open(s.root);
    });
    setSelection([id]);
    focusTopic(id);
    setQuery("");
    setSearchQuery("");
  }
  function add(sibling = false) {
    let id = "";
    const applied = mutate((s) => {
      const node = sibling
        ? addSibling(s.root, topic.id)
        : addChild(s.root, topic.id);
      id = node?.id || "";
    });
    if (!applied) return;
    if (id) {
      setSelection([id]);
      setEditId(id);
    } else setToast("根主题没有同级主题，请添加子主题");
  }
  function move(id: string, parent: string) {
    let moved = false;
    const applied = mutate((s) => {
      moved = moveTopic(s.root, id, parent);
    });
    if (applied && moved) focusTopic(id);
    setToast(
      applied && moved ? "主题已移动" : "不能移动到自身、子主题或当前父主题",
    );
  }
  function addFloating(position?: { x: number; y: number }) {
    const bounds = computeLayout(sheet).bounds;
    const node = createTopic("悬浮主题");
    node.floating = position || {
      x: bounds.x + bounds.width + 160,
      y: bounds.y + bounds.height / 2,
    };
    if (!mutate((s) => s.root.children.push(node))) return;
    setSelection([node.id]);
    focusTopic(node.id);
    setEditId(node.id);
  }
  function moveFloating(id: string, position: { x: number; y: number }) {
    mutate((s) =>
      updateTopic(s.root, id, (t) => {
        if (t.floating) t.floating = position;
      }),
    );
  }
  function detach() {
    if (topic.id === sheet.root.id) return;
    if (topic.floating) {
      move(topic.id, sheet.root.id);
      return;
    }
    const node = computeLayout(sheet).nodes.find((n) => n.id === topic.id);
    if (!node) return;
    mutate((s) => {
      const t = findTopic(s.root, topic.id);
      if (!t) return;
      removeTopic(s.root, t.id);
      t.floating = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
      s.root.children.push(t);
    });
    setToast("已转为悬浮主题，可自由拖动");
  }
  function remove() {
    if (topic.id === sheet.root.id && selected.length <= 1) {
      setToast("根主题不能删除");
      return;
    }
    mutate((s) => {
      for (const id of selected.length ? selected : [topic.id])
        removeTopic(s.root, id);
      const ids = new Set(flattenTopics(s.root).map((t) => t.id));
      s.relations = s.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
      s.annotations = s.annotations
        .map((a) => ({
          ...a,
          topicIds: a.topicIds.filter((id) => ids.has(id)),
        }))
        .filter((a) => a.topicIds.length);
    });
    setSelection([sheet.root.id]);
  }
  async function saveNow() {
    try {
      await save();
      setToast("已保存，并创建本机历史快照");
    } catch (e) {
      setToast(errorText(e));
    }
  }
  function action(id: string) {
    if (!loaded) return;
    setMenu(null);
    setSheetMenu(null);
    if (id === "new") {
      const next = createWorkbook();
      next.title = "未命名文档";
      next.sheets = [
        {
          id: uid(),
          title: "画布 1",
          root: createTopic("中心主题"),
          layout: "mindmap",
          theme: "classic",
          relations: [],
          annotations: [],
        },
      ];
      next.activeSheetId = next.sheets[0].id;
      saveRevision(workbook).catch(() => {});
      replace(next);
      setToast("已新建文档，可通过撤销返回");
    } else if (id === "open") input.current?.click();
    else if (id === "save") void saveNow();
    else if (id === "undo") undo();
    else if (id === "redo") redo();
    else if (id === "child") add();
    else if (id === "sibling") add(true);
    else if (id === "floating") addFloating();
    else if (id === "detach") detach();
    else if (id === "edit") setEditId(topic.id);
    else if (id === "delete") remove();
    else if (id === "fit") setFitEpoch((n) => n + 1);
    else if (id === "focus") setFocusMode((v) => !v);
    else if (id === "sidebar") setSidebar((v) => !v);
    else if (id === "inspector") setInspector((v) => !v);
    else if (id === "expand" || id === "collapse")
      mutate((s) =>
        flattenTopics(s.root).forEach((t) => {
          t.collapsed = id === "collapse" && t.id !== s.root.id;
        }),
      );
    else if (id === "image") imageInput.current?.click();
    else if (id === "attachment") setModal("attachment");
    else if (id === "remove-image") changeTopic({ image: undefined });
    else if (id === "relation") {
      setRelationFrom(topic.id);
      setToast("点击另一个主题作为关联目标");
    } else if (id === "boundary" || id === "summary") {
      if (!selected.length) setSelection([topic.id]);
      setModal(id);
    } else if (id === "copy") {
      copied.current = structuredClone(topic);
      setToast("已复制分支，可粘贴到任意主题");
    } else if (id === "paste") {
      if (!copied.current) {
        setToast("请先复制一个分支");
        return;
      }
      const node = structuredClone(copied.current);
      flattenTopics(node).forEach((t) => {
        t.id = uid();
        delete t.floating;
      });
      mutate((s) =>
        updateTopic(s.root, topic.id, (t) => {
          t.children.push(node);
          t.collapsed = false;
        }),
      );
      setSelection([node.id]);
    } else setModal(id);
  }
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        !loaded ||
        e.isComposing ||
        modal ||
        editId ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && ["s", "o", "e", "n", "z", "y"].includes(key)) {
        e.preventDefault();
        action(
          key === "s"
            ? "save"
            : key === "o"
              ? "open"
              : key === "e"
                ? "export"
                : key === "n"
                  ? "new"
                  : key === "y" || e.shiftKey
                    ? "redo"
                    : "undo",
        );
      } else if (
        e.key === "Tab" &&
        (e.target as HTMLElement).closest(".canvas") &&
        !(e.target as HTMLElement).closest("button:not(.topic),a")
      ) {
        e.preventDefault();
        add();
      } else if (
        e.key === "Enter" &&
        (e.target as HTMLElement).closest(".canvas")
      ) {
        e.preventDefault();
        add(true);
      } else if (e.key === "F2") {
        e.preventDefault();
        setEditId(topic.id);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        setRelationFrom(null);
        setFocusMode(false);
      } else if (
        e.key.startsWith("Arrow") &&
        (e.target as HTMLElement).closest(".canvas")
      ) {
        e.preventDefault();
        const all = flattenTopics(sheet.root),
          parent = all.find((t) => t.children.some((c) => c.id === topic.id));
        if (e.key === "ArrowLeft" && parent) setSelection([parent.id]);
        else if (e.key === "ArrowRight" && topic.children[0]) {
          if (topic.collapsed)
            mutate((s) =>
              updateTopic(s.root, topic.id, (t) => {
                t.collapsed = false;
              }),
            );
          setSelection([topic.children[0].id]);
        } else if (parent) {
          const index = parent.children.findIndex((t) => t.id === topic.id),
            delta = e.key === "ArrowUp" ? -1 : 1;
          setSelection([
            parent.children[
              Math.max(0, Math.min(parent.children.length - 1, index + delta))
            ].id,
          ]);
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });
  async function imported(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const next = await parseDocument(file);
      await saveRevision(workbook).catch(() => {});
      replace(next);
      setToast(
        file.name.endsWith(".xmind")
          ? "已导入现代 Xmind 文档，兼容范围请查看导出说明"
          : `已导入 ${file.name}`,
      );
    } catch (e) {
      setToast(`导入失败：${errorText(e)}。当前文档已保留。`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function addFile(file: File | undefined, image: boolean) {
    if (!file) return;
    if (file.size > (image ? 10 : 12) * 1024 * 1024) {
      setToast("文件过大，请选择不超过图片 10MB / 附件 12MB 的文件");
      return;
    }
    if (image && !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setToast("支持 PNG、JPEG、GIF 和 WEBP 图片");
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const applied = changeTopic(
        image
          ? { image: data }
          : {
              attachment: {
                name: file.name,
                type: file.type || "application/octet-stream",
                data,
              },
            },
      );
      if (!applied) {
        setToast("未插入文件：文档超出容量上限，当前内容已保留。");
        return;
      }
      setToast("文件已嵌入文档，导出 YMIND 可完整备份");
      if (!image) closeModal();
    } catch (e) {
      setToast(errorText(e));
    } finally {
      if (imageInput.current) imageInput.current.value = "";
      if (attachmentInput.current) attachmentInput.current.value = "";
    }
  }
  async function exported(format: MapFormat) {
    setBusy(true);
    try {
      const result = ["png", "jpeg", "svg", "pdf"].includes(format)
        ? await (
            await import("./render")
          ).exportMap(sheet, format as "png" | "jpeg" | "svg" | "pdf", 2)
        : await exportDocument(
            workbook,
            format as Parameters<typeof exportDocument>[1],
          );
      download(
        result.blob,
        `${workbook.title.replace(/[<>:"/\\|?*]/g, "_") || "YMIND"}.${result.extension}`,
      );
      setToast("文件已生成并开始下载");
      closeModal();
    } catch (e) {
      setToast(`导出失败：${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }
  function addSheet() {
    const s: Sheet = {
      id: uid(),
      title: `画布 ${workbook.sheets.length + 1}`,
      root: createTopic("中心主题"),
      layout: "mindmap",
      theme: "classic",
      relations: [],
      annotations: [],
    };
    commit((w) => {
      w.sheets.push(s);
      w.activeSheetId = s.id;
    });
  }
  function outline(t: Topic, depth = 0): React.ReactNode {
    return (
      <div key={t.id}>
        <div
          className={`outline-row ${topic.id === t.id ? "active" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <button
            className="outline-toggle"
            aria-label={`${t.collapsed ? "展开" : "折叠"}大纲${t.title}`}
            disabled={!t.children.length}
            onClick={() =>
              mutate((s) =>
                updateTopic(s.root, t.id, (n) => {
                  n.collapsed = !n.collapsed;
                }),
              )
            }
          >
            {t.children.length ? (
              t.collapsed ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )
            ) : (
              <span />
            )}
          </button>
          <button
            onClick={() => {
              select(t.id);
              focusTopic(t.id);
            }}
            title={t.title}
          >
            {t.title}
          </button>
        </div>
        {!t.collapsed && t.children.map((c) => outline(c, depth + 1))}
      </div>
    );
  }
  const results = useMemo(
    () =>
      searchQuery.trim()
        ? flattenTopics(sheet.root)
            .filter((t) =>
              `${t.title} ${t.note || ""}`
                .toLowerCase()
                .includes(searchQuery.trim().toLowerCase()),
            )
            .slice(0, 100)
        : [],
    [sheet.root, searchQuery],
  );
  const toolbar = [
    [GitBranch, "sibling", "主题"],
    [Plus, "child", "子主题"],
    [Network, "relation", "关联线"],
    [Braces, "summary", "概要"],
    [SquareDashed, "boundary", "边界"],
    [Flag, "markers", "标记"],
    [FileText, "note", "备注"],
    [Image, "image", "图片"],
  ] as const;
  return (
    <div
      className={`app ${focusMode ? "focus-mode" : ""} ${!inspector ? "no-inspector" : ""} ${!sidebar ? "no-sidebar" : ""}`}
    >
      <header className="app-header" inert={!loaded}>
        <div className="brand">
          <span className="brand-icon">
            <GitBranch size={19} />
          </span>
          <strong>YMIND</strong>
        </div>
        <nav className="main-menu" aria-label="主菜单">
          {Object.keys(menus).map((label) => (
            <div className="menu-area" key={label}>
              <button
                aria-haspopup="menu"
                aria-expanded={menu === label}
                onClick={() => setMenu(menu === label ? null : label)}
              >
                {label}
              </button>
              {menu === label && (
                <PopupMenu onClose={() => setMenu(null)}>
                  {menus[label].map(([text, id, key]) => (
                    <button
                      role="menuitem"
                      key={id}
                      onClick={() => action(id)}
                      disabled={
                        (id === "undo" && !canUndo) ||
                        (id === "redo" && !canRedo)
                      }
                    >
                      <span>{text}</span>
                      {key && <small>{key}</small>}
                    </button>
                  ))}
                </PopupMenu>
              )}
            </div>
          ))}
        </nav>
        <div className="menu-area mobile-more">
          <button
            aria-label="更多菜单"
            aria-haspopup="menu"
            aria-expanded={menu === "更多"}
            onClick={() => setMenu(menu === "更多" ? null : "更多")}
          >
            <MoreHorizontal size={18} />
          </button>
          {menu === "更多" && (
            <PopupMenu onClose={() => setMenu(null)}>
              {Object.entries(menus)
                .filter(([name]) => !["文件", "编辑"].includes(name))
                .map(([name, items]) => (
                  <div key={name}>
                    <h4>{name}</h4>
                    {items.map(([label, id]) => (
                      <button
                        role="menuitem"
                        key={id}
                        onClick={() => action(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ))}
            </PopupMenu>
          )}
        </div>
        <input
          className="document-title"
          aria-label="文档名称"
          maxLength={10000}
          value={documentTitle}
          onChange={(e) => setDocumentTitle(e.target.value)}
          onBlur={() => {
            if (documentTitle.trim() && documentTitle !== workbook.title)
              commit((w) => {
                w.title = documentTitle.trim();
              });
            else setDocumentTitle(workbook.title);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing)
              e.currentTarget.blur();
          }}
        />
        <span
          className={`save-status ${status.includes("失败") ? "error" : ""}`}
        >
          <CircleCheck size={13} />
          {status}
        </span>
        <button
          className="primary export-top"
          onClick={() => action("export")}
          disabled={busy || !loaded}
        >
          <Download size={15} />
          导出
        </button>
      </header>
      <div className="toolbar" role="toolbar" aria-label="编辑工具">
        <div className="history-tools">
          <IconButton
            icon={Undo2}
            label="撤销"
            onClick={undo}
            disabled={!canUndo}
          />
          <IconButton
            icon={Redo2}
            label="重做"
            onClick={redo}
            disabled={!canRedo}
          />
        </div>
        <div className="creation-tools">
          {toolbar.map(([Icon, id, label]) => (
            <button
              className={`tool ${id === "relation" && relationFrom ? "active" : ""}`}
              key={id}
              onClick={() => action(id)}
            >
              <Icon size={23} strokeWidth={1.5} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="view-tools">
          <button className="tool" onClick={() => action("present")}>
            <PresentationIcon size={23} strokeWidth={1.5} />
            <span>演示</span>
          </button>
          <button className="tool" onClick={() => action("focus")}>
            <Focus size={23} strokeWidth={1.5} />
            <span>专注</span>
          </button>
          <IconButton
            icon={PanelRight}
            label="显示 / 隐藏属性"
            onClick={() => action("inspector")}
          />
        </div>
      </div>
      <div className="workspace" inert={!loaded}>
        {sidebar && (
          <aside className="sidebar" aria-label="画布和大纲">
            <div className="panel-heading">
              <span>工作簿</span>
              <IconButton icon={Plus} label="添加画布" onClick={addSheet} />
            </div>
            <div className="sheet-list">
              {workbook.sheets.map((s) => (
                <div
                  className={`sheet-row ${s.id === sheet.id ? "active" : ""}`}
                  key={s.id}
                >
                  <button
                    className="sheet-select"
                    onClick={() =>
                      commit((w) => {
                        w.activeSheetId = s.id;
                      })
                    }
                  >
                    <ListTree size={16} />
                    <span>{s.title}</span>
                  </button>
                  <div className="sheet-menu-area">
                    <button
                      className="sheet-more"
                      aria-label={`管理画布 ${s.title}`}
                      onClick={() =>
                        setSheetMenu(sheetMenu === s.id ? null : s.id)
                      }
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {sheetMenu === s.id && (
                      <PopupMenu
                        className="sheet-popup"
                        onClose={() => setSheetMenu(null)}
                      >
                        <button
                          onClick={() => {
                            setSheetTarget(s.id);
                            setSheetMenu(null);
                            setModal("rename-sheet");
                          }}
                        >
                          重命名
                        </button>
                        <button
                          onClick={() => {
                            setSheetTarget(s.id);
                            setSheetMenu(null);
                            setModal("delete-sheet");
                          }}
                          disabled={workbook.sheets.length === 1}
                        >
                          删除画布
                        </button>
                      </PopupMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="outline-heading">
              <span>大纲</span>
              <span>{countTopics(sheet.root)}</span>
            </div>
            <div className="search-field">
              <Search size={14} />
              <input
                aria-label="搜索主题"
                placeholder="搜索主题…"
                value={query}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  setSearchQuery(e.currentTarget.value);
                }}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!composing.current) setSearchQuery(e.target.value);
                }}
              />
              {query && (
                <button
                  aria-label="清除搜索"
                  onClick={() => {
                    setQuery("");
                    setSearchQuery("");
                    document
                      .querySelector<HTMLInputElement>(
                        '[aria-label="搜索主题"]',
                      )
                      ?.focus();
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="outline-scroll">
              {query ? (
                <>
                  <p className="search-count">
                    {results.length
                      ? `${results.length} 个匹配主题`
                      : "没有匹配主题"}
                  </p>
                  {results.map((t) => (
                    <button
                      className="search-result"
                      key={t.id}
                      onClick={() => reveal(t.id)}
                    >
                      {t.title}
                    </button>
                  ))}
                </>
              ) : (
                outline(sheet.root)
              )}
            </div>
            <div className="sidebar-footer">
              <span className="local-dot" />
              本机文档 · 无需登录
            </div>
          </aside>
        )}
        <main className="map-area">
          <Canvas
            sheet={sheet}
            selected={selected.length ? selected : [topic.id]}
            zoom={zoom}
            setZoom={setZoom}
            fitEpoch={fitEpoch}
            editId={editId}
            relationFrom={relationFrom}
            select={select}
            startEdit={setEditId}
            endEdit={(id, title) => {
              setEditId(null);
              if (
                title !== undefined &&
                title !== findTopic(sheet.root, id)?.title
              )
                mutate((s) =>
                  updateTopic(s.root, id, (t) => {
                    t.title = title;
                    delete t.richText;
                  }),
                );
            }}
            collapse={(id) =>
              mutate((s) =>
                updateTopic(s.root, id, (t) => {
                  t.collapsed = !t.collapsed;
                }),
              )
            }
            move={move}
            moveFloating={moveFloating}
            addFloating={addFloating}
            focusId={focusId}
            focusEpoch={focusEpoch}
          />
          {focusMode && (
            <button className="focus-exit" onClick={() => setFocusMode(false)}>
              <Focus size={15} />
              退出专注 Esc
            </button>
          )}
        </main>
        {inspector && (
          <Inspector
            sheet={sheet}
            topic={topic}
            changeStyle={style}
            changeSheet={(value) => mutate((s) => Object.assign(s, value))}
            action={action}
            move={(parent) => move(topic.id, parent)}
            editConnection={(id, kind) => {
              setConnectionTarget({ id, kind });
              setModal("connection-label");
            }}
          />
        )}
      </div>
      <footer className="status-bar">
        <div>
          <IconButton
            icon={PanelLeft}
            label="显示 / 隐藏大纲"
            onClick={() => action("sidebar")}
          />
          <span>{countTopics(sheet.root)} 个主题</span>
          <span className="status-divider" />
          <span>{status === "已保存" ? "自动保存已启用" : status}</span>
        </div>
        <span className="canvas-help">双击编辑 · 空格拖动画布 · Ctrl 多选</span>
        <div className="zoom-controls">
          <IconButton
            icon={Minus}
            label="缩小画布"
            onClick={() => setZoom((z) => Math.max(0.15, z - 0.1))}
          />
          <span>{Math.round(zoom * 100)}%</span>
          <IconButton
            icon={Plus}
            label="放大画布"
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          />
          <span className="status-divider" />
          <IconButton
            icon={Maximize}
            label="适合画布"
            onClick={() => action("fit")}
          />
        </div>
      </footer>
      <input
        hidden
        ref={input}
        aria-label="导入文件"
        type="file"
        accept=".ymind,.json,.xmind,.md,.markdown,.opml,.mm"
        onChange={(e) => void imported(e.target.files?.[0])}
      />
      <input
        hidden
        ref={imageInput}
        aria-label="图片文件"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => void addFile(e.target.files?.[0], true)}
      />
      <input
        hidden
        ref={attachmentInput}
        aria-label="附件文件"
        type="file"
        onChange={(e) => void addFile(e.target.files?.[0], false)}
      />
      {status.includes("失败") && (
        <div className="storage-warning" role="alert">
          <span>{status}</span>
          <button onClick={() => action("export")}>导出备份</button>
        </div>
      )}
      {!loaded && (
        <div className="loading-shield" role="status">
          正在读取本机文档…
        </div>
      )}
      {busy && !modal && (
        <div className="busy-indicator" role="status">
          正在读取文件…
        </div>
      )}
      {modal === "export" && (
        <ExportDialog onClose={closeModal} onExport={exported} busy={busy} />
      )}
      {["note", "link", "markers", "labels", "equation"].includes(
        modal || "",
      ) && (
        <ContentDialog
          kind={modal!}
          topic={topic}
          onClose={closeModal}
          onApply={(value) => {
            const applied = changeTopic(value);
            if (applied) closeModal();
            return applied;
          }}
        />
      )}{" "}
      {modal === "rich" && (
        <RichEditor
          topic={topic}
          onClose={closeModal}
          onApply={(value) => {
            const applied = changeTopic(value);
            if (applied) closeModal();
            return applied;
          }}
        />
      )}
      {modal === "record" && (
        <Recorder
          onClose={closeModal}
          onApply={(value) => {
            const applied = changeTopic({ attachment: value });
            if (applied) {
              closeModal();
              setToast("录音已嵌入当前主题，可在附件中播放");
            }
            return applied;
          }}
        />
      )}
      {modal === "task" && (
        <TaskDialog
          topic={topic}
          onClose={closeModal}
          onApply={(value) => {
            const applied = changeTopic({ task: value });
            if (applied) closeModal();
            return applied;
          }}
        />
      )}{" "}
      {modal === "history" && (
        <HistoryDialog
          onClose={closeModal}
          restore={(w) => {
            replace(w);
            closeModal();
            setToast("已恢复历史版本，可通过撤销回退");
          }}
        />
      )}{" "}
      {modal === "gantt" && (
        <GanttDialog
          sheet={sheet}
          onClose={closeModal}
          select={(id) => {
            closeModal();
            reveal(id);
            setModal("task");
          }}
        />
      )}{" "}
      {modal === "present" && (
        <Presentation sheet={sheet} onClose={closeModal} />
      )}
      {(modal === "boundary" || modal === "summary") && (
        <TextDialog
          title={modal === "boundary" ? "添加边界" : "添加概要"}
          label="标注名称"
          initial={modal === "boundary" ? "重点内容" : "分支概要"}
          onClose={closeModal}
          onApply={(label) => {
            mutate((s) =>
              s.annotations.push({
                id: uid(),
                kind: modal,
                topicIds: selected.length ? selected : [topic.id],
                label,
              }),
            );
            closeModal();
          }}
        />
      )}{" "}
      {modal === "connection-label" && connectionTarget && (
        <TextDialog
          title="编辑标注文字"
          label="说明文字"
          initial={
            (connectionTarget.kind === "relation"
              ? sheet.relations
              : sheet.annotations
            ).find((v) => v.id === connectionTarget.id)?.label
          }
          onClose={closeModal}
          onApply={(label) => {
            if (
              mutate((s) => {
                const item = (
                  connectionTarget.kind === "relation"
                    ? s.relations
                    : s.annotations
                ).find((v) => v.id === connectionTarget.id);
                if (item) item.label = label;
              })
            )
              closeModal();
          }}
        />
      )}
      {modal === "rename-sheet" && (
        <TextDialog
          title="重命名画布"
          label="画布名称"
          initial={workbook.sheets.find((s) => s.id === sheetTarget)?.title}
          onClose={closeModal}
          onApply={(title) => {
            commit((w) => {
              const s = w.sheets.find((v) => v.id === sheetTarget);
              if (s) s.title = title;
            });
            closeModal();
          }}
        />
      )}{" "}
      {modal === "delete-sheet" && (
        <Modal title="删除画布" onClose={closeModal}>
          <p>
            删除「{workbook.sheets.find((s) => s.id === sheetTarget)?.title}
            」及其中的主题？此操作可以撤销。
          </p>
          <div className="modal-actions">
            <button onClick={closeModal}>取消</button>
            <button
              className="danger"
              onClick={() => {
                commit((w) => {
                  if (w.sheets.length <= 1) return;
                  w.sheets = w.sheets.filter((s) => s.id !== sheetTarget);
                  if (w.activeSheetId === sheetTarget)
                    w.activeSheetId = w.sheets[0].id;
                });
                closeModal();
              }}
            >
              删除画布
            </button>
          </div>
        </Modal>
      )}
      {modal === "attachment" && (
        <Modal title="文件与音频附件" onClose={closeModal}>
          <p className="muted">
            文件嵌入当前主题及 YMIND 备份，大小上限 12MB。
          </p>
          {topic.attachment && (
            <div className="attachment-detail">
              <strong>{topic.attachment.name}</strong>
              {topic.attachment.type.startsWith("audio/") &&
                safeFile(topic.attachment.data) && (
                  <audio controls src={topic.attachment.data} />
                )}
              <button
                onClick={() => {
                  if (topic.attachment) {
                    if (!safeFile(topic.attachment.data)) {
                      setToast("附件不是有效的本机嵌入文件，请重新添加。");
                      return;
                    }
                    const link = document.createElement("a");
                    link.download = topic.attachment.name;
                    link.href = topic.attachment.data;
                    link.click();
                  }
                }}
              >
                保存附件到本机
              </button>
              <button
                onClick={() => {
                  changeTopic({ attachment: undefined });
                  closeModal();
                }}
              >
                移除附件
              </button>
            </div>
          )}
          <div className="modal-actions">
            <button onClick={closeModal}>取消</button>
            <button
              className="primary"
              onClick={() => attachmentInput.current?.click()}
            >
              <Upload size={15} />
              选择文件
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="YMIND 使用说明" onClose={closeModal} wide>
          <div className="help-content">
            <p>
              双击主题编辑文字；选中主题后使用工具栏或右侧面板添加内容。文件自动保存在本机，建议定期导出
              YMIND 完整备份。
            </p>
            <div className="shortcut-grid">
              {[
                ["Tab", "添加子主题"],
                ["Enter", "添加同级主题"],
                ["F2", "编辑主题文字"],
                ["Delete", "删除选中分支"],
                ["Ctrl+Z / Ctrl+Shift+Z", "撤销 / 重做"],
                ["Ctrl+S", "保存并创建快照"],
                ["Ctrl+O / Ctrl+E", "打开 / 导出文件"],
                ["空格 + 拖动", "平移画布"],
                ["Ctrl + 点击", "多选主题"],
                ["Ctrl + 滚轮", "缩放画布"],
              ].map(([key, label]) => (
                <div key={key}>
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p>
              关联线：选择起始主题，再点击目标主题。边界 / 概要：Ctrl
              多选后点击工具栏。拖动主题到其他主题可改变父级，也可以在结构面板选择父主题。
            </p>
            <p>
              任务可设置负责人、日期和进度；甘特图位于工具菜单。演示按一层分支分页，左右箭头切换。备注、超链接、公式、附件位于工具菜单。
            </p>
            <p>
              编辑菜单可添加悬浮主题，也可双击画布空白处创建。悬浮主题自由拖动；按住
              Shift 拖到主题上可连接。结构面板提供 13
              种布局和自动编号；工具菜单提供标签、富文本与本机录音。录音需你主动点击开始并允许麦克风权限。
            </p>
            <p>
              浏览器版和桌面版各自保存本机数据。转移文档请导出后导入
              YMIND；清除浏览器数据或卸载可能删除本机记录。AI 和云协作待配置。
            </p>
          </div>
        </Modal>
      )}
      {modal === "about" && (
        <Modal title="关于 YMIND" onClose={closeModal}>
          <div className="about-brand">
            <GitBranch size={32} />
            <strong>YMIND 1.0</strong>
          </div>
          <p>
            独立实现的本机思维导图编辑器。无需账号，所有已实现的本地功能均可使用。
          </p>
          <p className="muted">
            支持对应的编辑与导出能力；尚未完成 Xmind
            全量功能的逐项一致性验证。未修改 Xmind 安装或授权。
          </p>
          <p>AI 和云协作按你的选择暂缓配置。</p>
        </Modal>
      )}
      <Toast message={toast} onClose={closeToast} />
    </div>
  );
}
