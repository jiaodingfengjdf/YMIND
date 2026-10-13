const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
app.setName("YMIND");
app.setPath(
  "userData",
  process.env.YMIND_TEST_DATA_DIR || path.join(app.getPath("appData"), "YMIND"),
);
function launch() {
  const window = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 800,
    minHeight: 620,
    title: "YMIND",
    show: process.env.YMIND_TEST_MODE !== "1",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, "../dist/index.html"));
}
app.whenReady().then(launch);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) launch();
});
