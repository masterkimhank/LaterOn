// 设置页「多设备同步」面板：界面与后台之间的契约。
//
// 这块最容易出的错都很朴素，但用户一眼就能看到：
//   · 文案键漏了（中英文各一份）→ 界面上直接显示 syncAuthError 这种原始键名
//   · 没启用时「立即同步」可点 → 点了没反应，以为坏了
//   · 改了配置没保存却显示「已同步」→ 用户以为生效了
//   · 后台报错只显示「同步失败」不说原因 → 没法排查
//
// 运行：node tests/settings-sync-panel.test.js
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
virtualConsole.on("error", (message) => errors.push(String(message)));

const dom = new JSDOM(read("settings.html"), {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "chrome-extension://lateron/settings.html",
  virtualConsole
});
const { window } = dom;
const { document } = window;

const store = { laterOnWebDAV: {}, laterOnSyncStatus: {}, laterOnSettings: { language: "zh-CN" } };
const changeListeners = [];
const sent = [];
let nextResponse = { ok: true };

window.chrome = {
  storage: {
    local: {
      get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) if (key in store) out[key] = store[key];
        return Promise.resolve(out);
      },
      set(patch) {
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = value;
        }
        window.setTimeout(() => changeListeners.forEach((fn) => fn(changes, "local")), 0);
        return Promise.resolve();
      }
    },
    onChanged: { addListener(fn) { changeListeners.push(fn); } }
  },
  runtime: {
    id: "lateron-test",
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: (message) => { sent.push(message); return Promise.resolve(nextResponse); }
  },
  tabs: { getCurrent: () => Promise.resolve({ id: 1 }), update: () => Promise.resolve({}) }
};

const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const field = (name) => document.querySelector(`#webdavForm [name="${name}"]`);
const status = () => document.querySelector("#webdavStatus");
const feedback = () => document.querySelector("#webdavFeedback");
const syncButton = () => document.querySelector("#webdavSync");

window.eval(read("i18n.js"));
window.eval(read("webdav-settings.js"));

(async () => {
  await tick(40);

  console.log("── 第 1 步：面板结构 ──");
  check("设置页有「多设备同步」分组",
    [...document.querySelectorAll(".settings-group h2")].some((h2) => h2.textContent.includes("多设备同步")));
  for (const name of ["enabled", "url", "username", "password"]) {
    check(`表单有 ${name} 字段`, !!field(name));
  }
  check("密码框是 password 类型（不会被投屏/截图看到）", field("password")?.type === "password");
  check("三个按钮齐备（测试连接 / 立即同步 / 保存）",
    !!document.querySelector("#webdavTest") && !!syncButton() && !!document.querySelector("#webdavSave"));

  console.log("\n── 第 2 步：文案键中英两套都齐全 ──");
  const i18n = window.LaterOnI18n;
  const section = [...document.querySelectorAll(".settings-group")].find((group) => group.textContent.includes("多设备同步"));
  const keys = new Set([...section.querySelectorAll("[data-i18n]")].map((el) => el.dataset.i18n));
  // 还有一批键只在 JS 里用（状态与错误），一并检查
  for (const key of ["syncDisabled", "syncPending", "syncRunning", "syncSuccess", "syncFailed", "syncLastSuccess",
    "syncConflictNote", "syncHttpError", "syncInvalidUrl", "syncAuthError", "syncDirectoryMissing", "syncInvalidData",
    "syncNetworkError", "syncTimeout", "syncTooLarge", "syncVerifyFailed", "syncConflict", "syncForbidden",
    "syncLocalError", "syncListUnsupported", "syncInvalidListing", "syncTestCleanup", "syncCancelled",
    "syncWaitingForIdle", "syncTesting", "syncProcessing", "syncTestSuccess", "syncSaved", "syncUnsaved"]) keys.add(key);
  const missingZh = [...keys].filter((key) => !i18n.dictionaries["zh-CN"][key]);
  const missingEn = [...keys].filter((key) => !i18n.dictionaries.en[key]);
  check(`中文文案齐全（${keys.size} 个键）`, missingZh.length === 0, missingZh.join(", ") || "无缺失");
  check("英文文案齐全", missingEn.length === 0, missingEn.join(", ") || "无缺失");
  const placeholder = document.querySelector('#webdavForm [data-i18n-placeholder="syncUrlPlaceholder"]');
  check("地址输入框有占位提示", !!placeholder?.placeholder && placeholder.placeholder.startsWith("https://"));

  console.log("\n── 第 3 步：未启用时的初始状态 ──");
  check("状态显示「同步已关闭」", status().textContent.trim() === "同步已关闭", JSON.stringify(status().textContent));
  check("状态带了 data-phase 供 CSS 上色", status().dataset.phase === "disabled", String(status().dataset.phase));
  check("「立即同步」在未启用时禁用", syncButton().disabled === true);

  console.log("\n── 第 4 步：保存流程 ──");
  field("enabled").checked = true;
  field("url").value = "https://dav.example.com/dav/";
  field("username").value = "me@example.com";
  field("password").value = "app-password";
  nextResponse = { ok: true };
  document.querySelector("#webdavForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await tick(40);
  const saveMessage = sent.find((message) => message.type === "WEBDAV_SAVE");
  check("提交时向后台发了 WEBDAV_SAVE", !!saveMessage, sent.map((m) => m.type).join());
  check("配置原样传给后台（含密码）",
    saveMessage?.config?.url === "https://dav.example.com/dav/" && saveMessage?.config?.password === "app-password",
    JSON.stringify(saveMessage?.config));
  check("保存成功后提示「已保存」", feedback().textContent.trim() === "已保存", JSON.stringify(feedback().textContent));
  check("保存成功后「立即同步」可点", syncButton().disabled === false);

  console.log("\n── 第 5 步：后台报错要能看懂 ──");
  nextResponse = { ok: false, error: "syncAuthError" };
  document.querySelector("#webdavTest").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(40);
  check("测试连接失败时给出中文原因", feedback().textContent.includes("账号或密码不对"), JSON.stringify(feedback().textContent));
  check("失败提示标成 error（CSS 会变红）", feedback().dataset.phase === "error");
  check("按钮在请求结束后恢复可点", document.querySelector("#webdavTest").disabled === false);

  console.log("\n── 第 6 步：状态栏随后台变化刷新 ──");
  store.laterOnSyncStatus = { phase: "error", error: "HTTP 500" };
  changeListeners.forEach((fn) => fn({ laterOnSyncStatus: { newValue: store.laterOnSyncStatus } }, "local"));
  await tick(20);
  check("HTTP 错误码翻成人话", status().textContent.includes("服务器返回 500"), JSON.stringify(status().textContent));
  check("错误状态带上 error 标记", status().dataset.phase === "error");

  store.laterOnSyncStatus = { phase: "success", lastSuccess: Date.now(), conflicts: 2 };
  changeListeners.forEach((fn) => fn({ laterOnSyncStatus: { newValue: store.laterOnSyncStatus } }, "local"));
  await tick(20);
  check("成功时显示上次成功时间", status().textContent.includes("上次成功"), JSON.stringify(status().textContent));
  check("自动合并过别的设备时说明一句", status().textContent.includes("已自动合并另一台设备的改动"), JSON.stringify(status().textContent));

  console.log("\n── 第 7 步：改了没保存不能看起来像生效 ──");
  field("url").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("输入后提示「改动还没保存」", feedback().textContent.trim() === "改动还没保存", JSON.stringify(feedback().textContent));

  console.log("\n── 第 8 步：切英文后状态文字跟着换 ──");
  window.LaterOnI18n.setLanguage("en");
  await tick(30);
  check("英文界面下状态是英文", /Sync|Synced|Waiting/i.test(status().textContent), JSON.stringify(status().textContent));
  check("英文界面下按钮文案也换了",
    document.querySelector("#webdavSave").textContent.trim() === "Save",
    document.querySelector("#webdavSave").textContent);
  check("地址占位提示不残留中文", !/[一-龥]/.test(field("url").placeholder), field("url").placeholder);

  console.log("\n── 第 9 步：没有未捕获的错误 ──");
  check("没有 jsdom 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
