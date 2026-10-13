import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={19} strokeWidth={1.7} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  fullScreen = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  fullScreen?: boolean;
}) {
  const titleId = useId(),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const siblings = Array.from(
      container.current?.parentElement?.parentElement?.children ?? [],
    ).filter((el) => el !== container.current?.parentElement) as HTMLElement[];
    const inert = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });
    const visible = Array.from(
      container.current?.querySelectorAll<HTMLElement>(
        "input,textarea,select,button",
      ) ?? [],
    ).filter((el) => el.offsetParent !== null);
    const first =
      visible.find((el) => el.matches("input,textarea,select")) ?? visible[0];
    first?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      siblings.forEach((el, index) => {
        el.inert = inert[index];
      });
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""} ${fullScreen ? "full-screen" : ""}`}
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <h2 id={titleId} className={fullScreen ? "sr-only" : ""}>
            {title}
          </h2>
          <IconButton icon={X} label="关闭窗口" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function PopupMenu({
  children,
  onClose,
  className = "",
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (
          !document.querySelector(".modal-overlay") &&
          (!document.activeElement || document.activeElement === document.body)
        )
          trigger?.focus();
      });
    };
  }, []);
  return (
    <div
      ref={root}
      className={`popup-menu ${className}`}
      role="menu"
      onKeyDown={(e) => {
        const buttons = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          ),
          index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
          ]?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close.current();
        }
      }}
    >
      {children}
    </div>
  );
}
export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(onClose, 5000);
    return () => clearTimeout(timeout);
  }, [message, onClose]);
  return message ? (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  ) : null;
}
