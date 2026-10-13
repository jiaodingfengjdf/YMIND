import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Field, Modal } from "./ui.tsx";

const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
type Phase =
  "idle" | "requesting" | "recording" | "stopping" | "ready" | "saving";
export interface RecorderProps {
  onClose: () => void;
  onApply: (value: {
    name: string;
    data: string;
    type: string;
  }) => boolean | void;
}

function defaultName(): string {
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replace(/[\s:]/g, "-");
  return `语音备注-${time}`;
}
function message(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "麦克风权限未允许。请在浏览器或系统设置中开启麦克风权限后重试。";
    if (error.name === "NotFoundError")
      return "没有可用的麦克风，请连接麦克风后重试。";
    if (error.name === "NotReadableError")
      return "暂时无法读取麦克风，请检查设备是否被其他应用占用后重试。";
    return "暂时无法完成录音，请检查麦克风设备后重试。";
  }
  return error instanceof Error ? error.message : "录音失败，请重试。";
}
function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取录音数据"));
    reader.onerror = () => reject(new Error("录音编码失败，请重试保存"));
    reader.onabort = () => reject(new Error("录音保存已取消"));
    reader.readAsDataURL(blob);
  });
}

export function Recorder({ onClose, onApply }: RecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle"),
    [error, setError] = useState("");
  const [name, setName] = useState(defaultName),
    [audio, setAudio] = useState<Blob | null>(null),
    [preview, setPreview] = useState("");
  const [elapsed, setElapsed] = useState(0),
    [bytes, setBytes] = useState(0);
  const alive = useRef(true),
    generation = useRef(0),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    started = useRef(0);
  const releaseTracks = useCallback(() => {
    const owned = stream.current;
    stream.current = null;
    owned?.getTracks().forEach((track) => track.stop());
  }, []);
  const cleanup = useCallback(() => {
    generation.current++;
    const owned = recorder.current;
    recorder.current = null;
    if (owned) {
      owned.ondataavailable = null;
      owned.onstop = null;
      owned.onerror = null;
      if (owned.state !== "inactive") {
        try {
          owned.stop();
        } catch {
          /* already stopped by the browser */
        }
      }
    }
    releaseTracks();
  }, [releaseTracks]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cleanup();
    };
  }, [cleanup]);
  useEffect(() => {
    if (!audio) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(audio);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(
      () =>
        setElapsed(Math.floor((performance.now() - started.current) / 1000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [phase]);
  const close = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  async function start(): Promise<void> {
    if (
      phase === "requesting" ||
      phase === "recording" ||
      phase === "stopping" ||
      phase === "saving"
    )
      return;
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("当前环境不支持本机录音，请在本机浏览器或桌面应用中打开。");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mime) {
      setError(
        "当前浏览器不支持 WebM 录音，请使用支持 WebM 的 Chrome、Edge 或 YMIND 桌面版。",
      );
      return;
    }
    const request = ++generation.current;
    setPhase("requesting");
    let acquired: MediaStream | undefined;
    try {
      // This request is made only in response to the user's Start button.
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || generation.current !== request) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const active = new MediaRecorder(acquired, { mimeType: mime });
      recorder.current = active;
      const chunks: Blob[] = [];
      let total = 0,
        overflow = false;
      active.ondataavailable = (event) => {
        if (!alive.current || generation.current !== request) return;
        total += event.data.size;
        if (total > MAX_RECORDING_BYTES) {
          overflow = true;
          setError("录音超过 12 MB 上限。请缩短录音后重新录制。");
          setPhase("stopping");
          if (active.state !== "inactive") active.stop();
          releaseTracks();
          return;
        }
        if (event.data.size) chunks.push(event.data);
        setBytes(total);
      };
      active.onerror = (event) => {
        if (!alive.current || generation.current !== request) return;
        setError(
          message(
            (event as Event & { error?: DOMException }).error ??
              new Error("麦克风录音失败，请重试。"),
          ),
        );
        cleanup();
        setPhase(audio ? "ready" : "idle");
      };
      active.onstop = () => {
        if (stream.current === acquired) releaseTracks();
        if (recorder.current === active) recorder.current = null;
        if (!alive.current || generation.current !== request) return;
        setElapsed(Math.floor((performance.now() - started.current) / 1000));
        if (overflow) {
          setPhase(audio ? "ready" : "idle");
          return;
        }
        const result = new Blob(chunks, { type: "audio/webm" });
        if (!result.size) {
          setError("没有录到声音数据，请检查麦克风后重试。");
          setPhase(audio ? "ready" : "idle");
          return;
        }
        setAudio(result);
        setBytes(result.size);
        setPhase("ready");
      };
      started.current = performance.now();
      setElapsed(0);
      setBytes(0);
      active.start(1000);
      setPhase("recording");
    } catch (cause) {
      acquired?.getTracks().forEach((track) => track.stop());
      if (!alive.current || generation.current !== request) return;
      cleanup();
      setError(message(cause));
      setPhase(audio ? "ready" : "idle");
    }
  }
  function stop(): void {
    const active = recorder.current;
    if (!active || active.state === "inactive") return;
    setPhase("stopping");
    try {
      active.stop();
      releaseTracks();
    } catch (cause) {
      cleanup();
      setError(message(cause));
      setPhase(audio ? "ready" : "idle");
    }
  }
  async function save(): Promise<void> {
    if (!audio || phase !== "ready") return;
    const filename = name.trim();
    if (!filename) {
      setError("请填写录音名称。");
      return;
    }
    if (filename.length > 120) {
      setError("录音名称不能超过 120 字符。");
      return;
    }
    setPhase("saving");
    setError("");
    try {
      const data = await asDataURL(audio);
      if (!alive.current) return;
      const result = onApply({
        name: /\.webm$/i.test(filename) ? filename : filename + ".webm",
        data,
        type: "audio/webm",
      });
      if (result === false) {
        setError("录音没有保存，请检查主题后重试。");
        setPhase("ready");
        return;
      }
      close();
    } catch (cause) {
      if (alive.current) {
        setError(message(cause));
        setPhase("ready");
      }
    }
  }
  const busy = ["requesting", "recording", "stopping", "saving"].includes(
    phase,
  );
  const status =
    phase === "requesting"
      ? "等待麦克风权限"
      : phase === "recording"
        ? "正在录音"
        : phase === "stopping"
          ? "正在处理录音"
          : phase === "saving"
            ? "正在保存录音"
            : audio
              ? "录音已准备好，可预览后保存"
              : "尚未录音";
  const time = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  return (
    <Modal title="添加语音备注" onClose={close}>
      <p className="muted">
        点击开始后申请麦克风权限。录音只保存到本机主题附件，单次录音上限 12 MB。
      </p>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 18,
          textAlign: "center",
          minHeight: 110,
        }}
      >
        <p
          role="status"
          aria-live="polite"
          style={{
            color: phase === "recording" ? "var(--danger)" : "var(--text)",
            margin: 0,
          }}
        >
          {status}
        </p>
        <div
          role="timer"
          aria-live="off"
          aria-label={`录音时长 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}
          style={{
            fontSize: 32,
            fontVariantNumeric: "tabular-nums",
            margin: "8px 0",
          }}
        >
          {time}
        </div>
        <span className="muted">
          {(bytes / 1024 / 1024).toFixed(2)} / 12 MB
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          margin: "14px 0",
        }}
      >
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          style={{ minWidth: 124 }}
        >
          <Mic size={16} aria-hidden="true" />
          {phase === "requesting"
            ? "等待权限…"
            : audio
              ? "重新录制"
              : "开始录音"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={phase !== "recording"}
          style={{ minWidth: 124 }}
        >
          <Square size={14} aria-hidden="true" />
          停止录音
        </button>
      </div>
      {preview && (
        <Field label="录音预览">
          <audio
            aria-label="录音预览"
            src={preview}
            controls
            preload="metadata"
            style={{ width: "100%" }}
          />
        </Field>
      )}
      <Field label="录音名称">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          disabled={phase === "saving"}
          maxLength={120}
          aria-invalid={!!error}
          aria-describedby={error ? "recording-error" : undefined}
        />
      </Field>
      {error && (
        <p id="recording-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={close}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={!audio || phase !== "ready"}
          onClick={() => void save()}
          style={{ minWidth: 110 }}
        >
          {phase === "saving" ? "正在保存…" : "保存到主题"}
        </button>
      </div>
    </Modal>
  );
}
