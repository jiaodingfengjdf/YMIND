// Electron is outside the CUA native-app surface on this host. These automated
// regression checks use an isolated application profile and never user documents.
import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  qa = path.join(root, ".qa");
await fs.mkdir(qa, { recursive: true });
const profile = await fs.mkdtemp(path.join(qa, "desktop-profile-"));
const downloads = await fs.mkdtemp(path.join(qa, "desktop-exports-"));
const executable = path.join(root, "release", "win-unpacked", "YMIND.exe");
const packedAvailable = await fs
  .access(executable)
  .then(() => true)
  .catch(() => false);
const packed = process.argv.includes("--packaged") && packedAvailable;
const env = {
  ...process.env,
  YMIND_TEST_MODE: "1",
  YMIND_TEST_DATA_DIR: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: packed
    ? executable
    : path.join(root, "node_modules", "electron", "dist", "electron.exe"),
  args: packed ? [] : [root],
  env,
  timeout: 30000,
});
const checks = [],
  errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, session }, dir) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1536, 1024);
    session.defaultSession.on("will-download", (_event, item) =>
      item.setSavePath(`${dir}/${item.getFilename()}`),
    );
  }, downloads);
  await page
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .waitFor();
  await page.getByText("已保存", { exact: true }).waitFor();
  checks.push("production file:// boot");
  // Hidden Electron windows may not supply CDP screenshots; the shared UI is
  // captured separately in IAB, while this suite checks the actual desktop runtime.
  await page.getByRole("button", { name: "子主题", exact: true }).click();
  await page.getByRole("textbox", { name: "编辑主题文字" }).fill("桌面验收");
  await page.getByRole("textbox", { name: "编辑主题文字" }).press("Enter");
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .waitFor();
  checks.push("create and edit");
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .press("Delete");
  assert.equal(
    await page
      .getByRole("button", { name: "主题：桌面验收", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .waitFor();
  checks.push("delete and undo");
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .click();
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "备注", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "备注内容" })
    .fill("桌面版持久化验收");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .press("Control+s");
  await page
    .getByRole("status")
    .filter({ hasText: "已保存，并创建本机历史快照" })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .waitFor();
  checks.push("save, snapshot and reopen");
  const bad = path.join(qa, "bad.ymind");
  await fs.writeFile(bad, "{broken");
  await page.locator('input[aria-label="导入文件"]').setInputFiles(bad);
  await page
    .getByRole("status")
    .filter({ hasText: "当前文档已保留" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "主题：桌面验收", exact: true })
      .count(),
    1,
  );
  checks.push("invalid import retains document");
  // Browser/desktop renderer must load its lazy formula and export chunks offline.
  await page
    .getByRole("button", { name: "主题：桌面验收", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "主题属性" })
    .getByRole("button", { name: "公式", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "LaTeX 表达式" })
    .fill("\\frac{1}{2}+x^2");
  await page.locator(".formula-preview svg path").first().waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  checks.push("offline formula SVG");
  await page.getByRole("button", { name: "标签", exact: true }).click();
  await page
    .getByRole("textbox", { name: "标签（用逗号分隔）" })
    .fill("本机, 优先级");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "富文本", exact: true }).click();
  await page
    .getByRole("textbox", { name: "主题文字", exact: true })
    .fill("**桌面** *验收*");
  await page.getByRole("button", { name: "应用修改", exact: true }).click();
  const richNode = page.getByRole("button", {
    name: "主题：桌面 验收",
    exact: true,
  });
  assert.match(
    (await richNode.innerText()).replaceAll("\n", ""),
    /#本机 #优先级/,
  );
  assert.equal(
    await richNode
      .locator(".rich-line span")
      .first()
      .evaluate((e) => getComputedStyle(e).fontWeight),
    "700",
  );
  await page.getByRole("tab", { name: "结构", exact: true }).click();
  await page
    .getByRole("combobox", { name: "编号方式" })
    .selectOption("hierarchical");
  assert.match(await richNode.innerText(), /^3\.4\. /);
  for (const label of [
    "括号图",
    "树形表格",
    "矩阵图",
    "组织结构（向上）",
    "时间轴（纵向）",
    "思维导图",
  ]) {
    await page
      .getByRole("complementary", { name: "主题属性" })
      .getByRole("button", { name: label, exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("main")
        .getByRole("button", { name: /^主题：/ })
        .count(),
      21,
    );
  }
  checks.push("rich title, labels, numbering and five added layouts");
  await page
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .click();
  await page.getByRole("button", { name: "关联线", exact: true }).click();
  await page
    .getByRole("button", { name: "主题：用户体验", exact: true })
    .click();
  await page
    .getByRole("button", { name: "编辑关联 关联", exact: true })
    .click();
  await page.getByRole("textbox", { name: "说明文字" }).fill("桌面关联说明");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await page
    .getByRole("main")
    .getByText("桌面关联说明", { exact: true })
    .waitFor();
  checks.push("relationship label editing");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "添加悬浮主题", exact: true })
    .click();
  await page.getByRole("textbox", { name: "编辑主题文字" }).fill("悬浮验收");
  await page.getByRole("textbox", { name: "编辑主题文字" }).press("Enter");
  const floatingNode = page.getByRole("button", {
    name: "主题：悬浮验收",
    exact: true,
  });
  const before = await floatingNode.boundingBox();
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + 85,
    before.y + before.height / 2 + 55,
    { steps: 8 },
  );
  await page.mouse.up();
  const after = await floatingNode.boundingBox();
  assert.ok(Math.abs(after.x - before.x - 85) < 2);
  assert.ok(Math.abs(after.y - before.y - 55) < 2);
  await floatingNode.press("Control+z");
  const restored = await floatingNode.boundingBox();
  assert.ok(Math.abs(restored.x - before.x) < 2);
  await page
    .getByRole("button", { name: "连接到中心主题", exact: true })
    .click();
  await page
    .getByRole("button", { name: "转为悬浮主题", exact: true })
    .waitFor();
  checks.push("floating drag, single-step undo and attach");
  await page
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .click();
  await page.getByRole("tab", { name: "样式", exact: true }).click();
  await page.getByRole("button", { name: "录音", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "保存到主题", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("dialog", { name: "添加语音备注" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  checks.push("recorder idle and cancel without microphone capture");
  for (const [label, extension, signature] of [
    ["YMIND 完整文档备份", "ymind", "{"],
    ["PNG 高清无损图片", "png", null],
    ["JPEG 高质量图片", "jpg", null],
    ["PDF 单页完整图", "pdf", "%PDF-"],
    ["Excel 主题与任务表", "xlsx", "PK"],
    ["TextBundle 带图片的文字压缩包", "textpack", "PK"],
  ]) {
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "导出文件", exact: true }).click();
    const file = path.join(downloads, `产品规划.${extension}`);
    for (let i = 0; i < 100; i++) {
      if (
        await fs
          .stat(file)
          .then((s) => s.size > 0)
          .catch(() => false)
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const bytes = await fs.readFile(file);
    assert.ok(bytes.length > 100);
    if (signature)
      assert.equal(bytes.subarray(0, signature.length).toString(), signature);
    if (extension === "png")
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    if (extension === "jpg")
      assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff");
    checks.push(`desktop download ${extension}`);
  }
  const mediaDocument = JSON.parse(
    await fs.readFile(path.join(downloads, "产品规划.ymind"), "utf8"),
  );
  mediaDocument.sheets[0].root.image =
    "https://example.invalid/should-not-be-fetched.png";
  const externalRequests = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  const mediaFile = path.join(qa, "embedded-policy.ymind");
  await fs.writeFile(mediaFile, JSON.stringify(mediaDocument));
  await page.locator('input[aria-label="导入文件"]').setInputFiles(mediaFile);
  await page
    .getByText("图片未内嵌，请重新插入本机位图", { exact: true })
    .waitFor();
  assert.deepEqual(externalRequests, []);
  checks.push("document media never fetches external URLs");
  // Same-origin editing in another window must not silently overwrite current data.
  await page.getByText("已保存", { exact: true }).waitFor();
  const nextWindow = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    w.loadURL(url);
  }, page.url());
  const second = await nextWindow;
  second.on("pageerror", (e) => errors.push(e.message));
  await second
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .dblclick();
  await page
    .getByRole("textbox", { name: "编辑主题文字" })
    .fill("窗口 A 先保存");
  await page.getByRole("textbox", { name: "编辑主题文字" }).press("Enter");
  await page.getByText("已保存", { exact: true }).waitFor();
  await second
    .getByRole("button", { name: "主题：核心功能", exact: true })
    .dblclick();
  await second
    .getByRole("textbox", { name: "编辑主题文字" })
    .fill("窗口 B 后保存");
  await second.getByRole("textbox", { name: "编辑主题文字" }).press("Enter");
  await second
    .getByRole("alert")
    .filter({ hasText: "其他窗口已更新文档" })
    .waitFor();
  await second.close();
  await page.reload();
  await page
    .getByRole("button", { name: "主题：窗口 A 先保存", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "主题：窗口 B 后保存", exact: true })
      .count(),
    0,
  );
  checks.push("multiple-window conflict protection");
  // Corrupt saved records remain in IndexedDB rather than being replaced by the template.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("ymind-local-v1", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put({ broken: true }, "current");
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "本地记录读取失败" })
    .waitFor();
  await page.waitForTimeout(650);
  const retained = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("ymind-local-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction("state", "readonly"),
            q = t.objectStore("state").get("current");
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
        };
      }),
  );
  assert.deepEqual(retained, { broken: true });
  checks.push("corrupt persistence preserved");
  assert.deepEqual(errors, []);
  checks.push("no renderer exceptions");
  await fs.writeFile(
    path.join(qa, "desktop-results.json"),
    JSON.stringify({ packed, checks, errors, downloads }, null, 2),
  );
  console.log(
    JSON.stringify({ packed, passed: checks.length, checks, errors }, null, 2),
  );
} finally {
  await app.close();
  const target = path.resolve(profile);
  if (
    target.startsWith(path.resolve(qa) + path.sep) &&
    path.basename(target).startsWith("desktop-profile-")
  )
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
}
