import type { Workbook } from "./domain";
export interface Revision {
  id: string;
  title: string;
  date: string;
  workbook: Workbook;
}
const DB = "ymind-local-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("history", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地存储"));
  });
}
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const loadCurrent = () =>
  transact<Workbook | undefined>("state", "readonly", (s) => s.get("current"));
export async function loadSession(): Promise<{
  workbook?: Workbook;
  token: string | null;
}> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readonly"),
        store = tx.objectStore("state");
      const document = store.get("current"),
        revision = store.get("revision");
      tx.oncomplete = () =>
        resolve({ workbook: document.result, token: revision.result ?? null });
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function saveCurrent(
  workbook: Workbook,
  expected?: string | null,
) {
  const db = await open();
  const nextToken = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      const read = store.get("revision");
      let conflict = false;
      read.onsuccess = () => {
        const token = read.result ?? null;
        if (expected !== undefined && token !== expected) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(workbook, "current");
        store.put(nextToken, "revision");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          conflict
            ? new Error(
                "其他窗口已更新文档，已暂停覆盖；请导出备份并重新打开。",
              )
            : tx.error,
        );
    });
    return nextToken;
  } finally {
    db.close();
  }
}
export async function saveRevision(workbook: Workbook) {
  const revision = {
    id: crypto.randomUUID(),
    title: workbook.title,
    date: new Date().toISOString(),
    workbook,
  };
  await transact("history", "readwrite", (s) => s.put(revision));
  const entries = await loadRevisions();
  for (const old of entries.slice(30))
    await transact("history", "readwrite", (s) => s.delete(old.id));
}
export async function loadRevisions(): Promise<Revision[]> {
  const entries = await transact<Revision[]>("history", "readonly", (s) =>
    s.getAll(),
  );
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
