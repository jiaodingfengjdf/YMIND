import { useMemo, useRef, useState, type FormEvent } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import type { RichTextRun, Topic } from "./domain.ts";
import { Field, Modal } from "./ui.tsx";
import {
  formatRichText,
  MAX_RICH_TEXT_INPUT,
  parseRichText,
  wrapRichSelection,
  type RichTextFormat,
} from "./richText.ts";

export interface RichEditorProps {
  topic: Topic;
  onClose: () => void;
  onApply: (value: {
    title: string;
    richText: RichTextRun[];
  }) => boolean | void;
}

export function RichEditor({ topic, onClose, onApply }: RichEditorProps) {
  const [input, setInput] = useState(() =>
    formatRichText(topic.richText ?? [{ text: topic.title }]),
  );
  const [applyError, setApplyError] = useState("");
  const [selected, setSelected] = useState(false);
  const [composing, setComposing] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => {
    try {
      return { value: parseRichText(input), error: "" };
    } catch (error) {
      return {
        value: undefined,
        error: error instanceof Error ? error.message : "无法读取文字格式",
      };
    }
  }, [input]);
  const error = preview.error || applyError;
  function format(style: RichTextFormat): void {
    if (composing) return;
    const element = editor.current;
    if (!element) return;
    try {
      const result = wrapRichSelection(
        input,
        element.selectionStart,
        element.selectionEnd,
        style,
      );
      setInput(result.input);
      setApplyError("");
      requestAnimationFrame(() => {
        if (editor.current !== element) return;
        element.focus();
        element.setSelectionRange(result.start, result.end);
        setSelected(result.start !== result.end);
      });
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : "请重新选择文字");
    }
  }
  function apply(event?: FormEvent): void {
    event?.preventDefault();
    if (composing) return;
    if (!preview.value) {
      editor.current?.focus();
      return;
    }
    try {
      const result = onApply({
        title: preview.value.title,
        richText: preview.value.runs,
      });
      if (result === false) {
        setApplyError("文字没有保存，请检查主题后重试");
        return;
      }
      onClose();
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : "无法保存文字");
    }
  }
  return (
    <Modal title="编辑主题富文本" onClose={onClose} wide>
      <form noValidate onSubmit={apply}>
        <p className="muted" id="rich-help">
          选中下方文字，再点击粗体、斜体或下划线。预览会保留混合格式；Ctrl +
          Enter 应用修改。
        </p>
        <div
          role="group"
          aria-label="文字格式"
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {(
            [
              { style: "bold", label: "粗体", Icon: Bold },
              { style: "italic", label: "斜体", Icon: Italic },
              { style: "underline", label: "下划线", Icon: Underline },
            ] as const
          ).map(({ style, label, Icon }) => (
            <button
              key={style}
              type="button"
              disabled={!selected || composing}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(style)}
              aria-label={`设置${label}`}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <Field label="主题文字">
          <textarea
            className="resize-none"
            ref={editor}
            value={input}
            rows={7}
            maxLength={MAX_RICH_TEXT_INPUT}
            aria-invalid={!!error}
            aria-describedby={`rich-help${error ? " rich-error" : ""}`}
            style={{ resize: "none", minHeight: 160 }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setInput(event.currentTarget.value);
            }}
            onChange={(event) => {
              setInput(event.target.value);
              setApplyError("");
            }}
            onSelect={(event) => {
              const element = event.currentTarget;
              setSelected(element.selectionStart !== element.selectionEnd);
            }}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === "Enter" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </Field>
        <div
          aria-label="格式预览"
          style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 16,
            minHeight: 72,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            fontSize: 16,
            lineHeight: 1.5,
          }}
        >
          {preview.value?.runs.length ? (
            preview.value.runs.map((run, index) => (
              <span
                key={index}
                style={{
                  fontWeight: run.bold ? 700 : 400,
                  fontStyle: run.italic ? "italic" : "normal",
                  textDecoration: run.underline ? "underline" : "none",
                }}
              >
                {run.text}
              </span>
            ))
          ) : (
            <span className="muted">
              {preview.error ? "请修正文字格式后查看预览" : "空标题"}
            </span>
          )}
        </div>
        <p className="muted">
          {preview.value
            ? `${preview.value.title.length} / 20000 字符 · ${preview.value.runs.length} / 256 个格式分段`
            : "文字内容将在应用后保存到当前主题"}
        </p>
        {error && (
          <p className="form-error" id="rich-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!preview.value || composing}
          >
            应用修改
          </button>
        </div>
      </form>
    </Modal>
  );
}
