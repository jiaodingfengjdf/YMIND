import { useCallback, useEffect, useRef, useState } from "react";
import type { Workbook } from "./domain";
import { createWorkbook, validateWorkbook } from "./model";
import { loadSession, saveCurrent, saveRevision } from "./storage";
export function useWorkbook() {
  const [workbook, setWorkbook] = useState(createWorkbook);
  const current = useRef(workbook);
  const lastPersisted = useRef<Workbook | null>(null);
  const past = useRef<Workbook[]>([]);
  const future = useRef<Workbook[]>([]);
  const ready = useRef(false),
    writable = useRef(false);
  const weights = useRef(new WeakMap<Workbook, number>());
  const savedToken = useRef<string | null>(null),
    writes = useRef<Promise<void>>(Promise.resolve());
  const writeCurrent = useCallback((snapshot: Workbook) => {
    const task = writes.current
      .catch(() => {})
      .then(async () => {
        savedToken.current = await saveCurrent(snapshot, savedToken.current);
        lastPersisted.current = snapshot;
      });
    writes.current = task;
    return task;
  }, []);
  function weight(w: Workbook) {
    let n = weights.current.get(w);
    if (n === undefined) {
      n = JSON.stringify(w).length * 2;
      weights.current.set(w, n);
    }
    return n;
  }
  function retainPast(w: Workbook) {
    past.current.push(w);
    while (
      past.current.length > 80 ||
      (past.current.length > 1 &&
        past.current.reduce((sum, v) => sum + weight(v), 0) > 64 * 1024 * 1024)
    )
      past.current.shift();
  }
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("正在读取本地文档");
  const [historyEpoch, setEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadSession()
      .then(({ workbook: saved, token }) => {
        if (cancelled) return;
        savedToken.current = token;
        if (saved) {
          const next = validateWorkbook(saved);
          current.current = next;
          lastPersisted.current = next;
          setWorkbook(next);
        }
        setLoaded(true);
        ready.current = true;
        writable.current = true;
        setStatus("已保存");
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          ready.current = true;
          writable.current = false;
          setStatus("本地记录读取失败，编辑仅存内存，请导出备份");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !writable.current || workbook === lastPersisted.current)
      return;
    setStatus("正在保存");
    let cancelled = false;
    const timer = setTimeout(() => {
      writeCurrent(workbook)
        .then(() => {
          if (!cancelled) setStatus("已保存");
        })
        .catch((e) => {
          if (!cancelled)
            setStatus(
              e instanceof Error
                ? `保存失败：${e.message}`
                : "保存失败，请导出备份",
            );
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workbook, loaded, writeCurrent]);
  const commit = useCallback((change: (draft: Workbook) => void) => {
    if (!ready.current) return false;
    const before = current.current,
      next = structuredClone(before);
    change(next);
    if (JSON.stringify(next) === JSON.stringify(before)) return true;
    try {
      validateWorkbook(next);
      if (
        new TextEncoder().encode(JSON.stringify(next, null, 2)).byteLength >
        64 * 1024 * 1024
      )
        throw new Error("YMIND 完整备份上限为 64MB，请拆分文档或减少附件。");
    } catch (e) {
      setStatus(`修改失败：${e instanceof Error ? e.message : "文档超出容量"}`);
      return false;
    }
    next.updatedAt = new Date().toISOString();
    retainPast(before);
    future.current = [];
    current.current = next;
    setWorkbook(next);
    setEpoch((e) => e + 1);
    return true;
  }, []);
  const replace = useCallback((next: Workbook) => {
    if (!ready.current) return;
    const validated = validateWorkbook(next);
    retainPast(current.current);
    future.current = [];
    current.current = validated;
    setWorkbook(validated);
    setEpoch((e) => e + 1);
  }, []);
  const undo = useCallback(() => {
    const before = past.current.pop();
    if (!before) return;
    future.current.push(current.current);
    current.current = before;
    setWorkbook(before);
    setEpoch((e) => e + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    retainPast(current.current);
    current.current = next;
    setWorkbook(next);
    setEpoch((e) => e + 1);
  }, []);
  const save = useCallback(async () => {
    if (!ready.current || !writable.current)
      throw new Error(
        "本地记录未能正常读取。为保留原记录，已暂停写入，请导出 YMIND 备份。",
      );
    const snapshot = current.current;
    await writeCurrent(snapshot);
    await saveRevision(snapshot);
    setStatus(current.current === snapshot ? "已保存" : "正在保存");
  }, []);
  return {
    workbook,
    commit,
    replace,
    undo,
    redo,
    save,
    loaded,
    status,
    canUndo: historyEpoch >= 0 && past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
