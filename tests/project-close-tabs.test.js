// 单个项目里的「关闭已打开」：把这个项目还在浏览器里开着的标签页关掉，
// 但一条收藏都不删。
// 覆盖：
//  1) 只在单个项目（含等待整理）里出现；全部项目 / 归档里没有这个按钮
//  2) 点之前先数：确认框写明「关闭 N 个」，并明确说收藏不会被删
//  3) 取消 → 一个都不关；确认 → 只关这个项目里认出来的那几个（别的项目、别的站点不碰）
//  4) 关完收藏还在（条数、归属都没变）
//  5) 没有可关的标签页时：不弹框，只提示一句
//  6) 右键项目菜单里也有同一项
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");
const dialogSource = fs.readFileSync(`${ROOT}/dialog.js`, "utf8");
const urlUtilsSource = fs.readFileSync(`${ROOT}/url-utils.js`, "utf8");
const tabsSource = fs.readFileSync(`${ROOT}/tab-navigation.js`, "utf8");
const librarySource = fs.readFileSync(`${ROOT}/library.js`, "utf8");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
virtualConsole.on("error", (message) => errors.push(String(message)));

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "chrome-extension://lateron/library.html",
  virtualConsole
});
const { window } = dom;
const { document } = window;

const now = Date.now();
const item = (id, extra) => ({
  id, title: `标题 ${id}`, titleAtSave: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "a.com", projectId: null, url: `https://a.com/${id}`, savedAt: now, status: "unread", ...extra
});
const store = {
  laterOnItems: [
    item("w1", { title: "工作文章一", titleAtSave: "工作文章一", projectId: "work" }),
    // w2 的网址在浏览器里已经变成另一个了（换参数 / SPA 换路由），只能靠标题认出来。
    item("w2", { title: "工作文章二", titleAtSave: "工作文章二", projectId: "work", url: "https://a.com/w2-old" }),
    item("r1", { title: "别处文章", titleAtSave: "别处文章", projectId: "read" }),
    item("u1", { title: "待整理文章", titleAtSave: "待整理文章" })
  ],
  laterOnProjects: [{ id: "work", name: "工作", createdAt: 1 }, { id: "read", name: "阅读", createdAt: 2 }],
  laterOnActiveProject: "all",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true
};

let openTabs = [];
const removedTabIds = [];
const changeListeners = [];

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
  tabs: {
    getCurrent: () => Promise.resolve({ id: 90, windowId: 7, active: true }),
    query: (info) => {
      if (info && info.active) return Promise.resolve([{ id: 90, windowId: 7, active: true, url: "chrome-extension://lateron/library.html" }]);
      return Promise.resolve(openTabs);
    },
    remove: (ids) => {
      const list = [].concat(ids);
      removedTabIds.push(...list);
      openTabs = openTabs.filter((tab) => !list.includes(tab.id));
      return Promise.resolve();
    },
    update: () => Promise.resolve({ id: 90 }),
    create: () => Promise.resolve({ id: 91 })
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: () => Promise.resolve({ ready: true }),
    onMessage: { addListener() {} }
  }
};
if (typeof window.crypto?.randomUUID !== "function") {
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
}
window.scrollTo = () => {};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 40) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const rightClick = (el) => el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));

const closeButton = () => document.querySelector("#closeProjectTabs");
const dialog = () => document.querySelector(".lod-root:not([hidden])");
const dialogTitle = () => dialog()?.querySelector(".lod-title")?.textContent || "";
const dialogMessage = () => dialog()?.querySelector(".lod-message")?.textContent || "";
const toastText = () => document.querySelector("#toast").textContent;
async function confirmDialog(ok = true) {
  await tick(40);
  const target = ok ? dialog()?.querySelector(".lod-ok") : dialog()?.querySelector(".lod-cancel");
  if (target) click(target);
  await tick(340);   // 弹窗有关闭动画，等它真正 resolve
}
const navTo = async (project) => {
  click(document.querySelector(`.project-nav[data-project="${project}"]`));
  await tick(60);
};

(async () => {
  window.eval(i18nSource);
  window.eval(dialogSource);
  window.eval(urlUtilsSource);
  window.eval(tabsSource);
  require("./helpers/item-mutation")(window);
  window.eval(librarySource);
  await tick(80);

  // 浏览器里开着：工作项目的两篇（w2 网址已经变了）、阅读项目的一篇、还有两个干扰项。
  openTabs = [
    { id: 41, url: "https://a.com/w1", title: "工作文章一" },
    { id: 42, url: "https://a.com/w2-new-route", title: "工作文章二 - a.com" },
    { id: 43, url: "https://a.com/r1", title: "别处文章" },
    { id: 44, url: "https://other.com/w1", title: "工作文章一" },
    { id: 45, url: "chrome-extension://lateron/library.html", title: "LaterOn" }
  ];

  console.log("── 按钮只在单个项目里出现 ──");
  check("（准备）默认停在全部项目", closeButton().hidden === true, `hidden=${closeButton().hidden}`);
  await navTo("work");
  check("进入「工作」后出现「关闭已打开」", closeButton().hidden === false, `hidden=${closeButton().hidden}`);
  check("按钮文案是「关闭已打开」", closeButton().textContent.trim() === "关闭已打开", closeButton().textContent.trim());
  await navTo("unfiled");
  check("「等待整理」里也有", closeButton().hidden === false, `hidden=${closeButton().hidden}`);
  await navTo("read");
  check("「阅读」里也有", closeButton().hidden === false, `hidden=${closeButton().hidden}`);
  await navTo("all");
  check("回到「全部项目」就收起来", closeButton().hidden === true, `hidden=${closeButton().hidden}`);

  console.log("\n── 先说清代价，再动手 ──");
  await navTo("work");
  removedTabIds.length = 0;
  click(closeButton());
  await tick(60);
  check("确认框弹出来了", !!dialog());
  check("标题写明项目名和会关几个", /关闭「工作」里已打开的 2 个标签页/.test(dialogTitle()), dialogTitle());
  check("正文说清收藏不会被删", /收藏一条都不会删/.test(dialogMessage()), dialogMessage());
  check("取消之前一个都没关", removedTabIds.length === 0, removedTabIds.join(","));
  await confirmDialog(false);
  check("取消之后也没关", removedTabIds.length === 0, removedTabIds.join(","));

  click(closeButton());
  await tick(60);
  await confirmDialog(true);
  check("确认后关了 41、42（w2 是靠原标题认出来的）",
    removedTabIds.slice().sort((a, b) => a - b).join(",") === "41,42", removedTabIds.join(","));
  check("阅读项目的 43 没被误关", !removedTabIds.includes(43), removedTabIds.join(","));
  check("别的站点的 44、扩展页 45 没被误关",
    !removedTabIds.includes(44) && !removedTabIds.includes(45), removedTabIds.join(","));
  check("提示语说明关了几个、收藏还在",
    toastText() === "已关闭 2 个标签页，收藏都还在", toastText());

  console.log("\n── 收藏一条都没少 ──");
  check("四条收藏都还在", store.laterOnItems.length === 4, store.laterOnItems.map((entry) => entry.id).join(","));
  check("归属没被改动",
    store.laterOnItems.find((entry) => entry.id === "w1").projectId === "work"
    && store.laterOnItems.find((entry) => entry.id === "w2").projectId === "work",
    JSON.stringify(store.laterOnItems.map((entry) => [entry.id, entry.projectId])));
  check("卡片也还在", document.querySelectorAll("#cardGrid .card").length === 2,
    String(document.querySelectorAll("#cardGrid .card").length));

  console.log("\n── 没有可关的：不弹框，只说一句 ──");
  removedTabIds.length = 0;
  click(closeButton());
  await tick(80);
  check("没有弹出确认框", !dialog());
  check("提示「工作」里没有已打开的标签页",
    toastText() === "「工作」里没有已打开的标签页", toastText());
  check("也没有乱关东西", removedTabIds.length === 0, removedTabIds.join(","));

  console.log("\n── 右键项目菜单里也有同一项 ──");
  const row = document.querySelector('.project-nav[data-project="work"]');
  rightClick(row);
  await tick(40);
  const menuItems = [...document.querySelectorAll(".folder-menu .folder-menu-item")].map((button) => button.textContent.trim());
  check("菜单里出现「关闭已打开的标签页」", menuItems.includes("关闭已打开的标签页"), menuItems.join(" / "));
  const entry = [...document.querySelectorAll(".folder-menu .folder-menu-item")]
    .find((button) => button.textContent.trim() === "关闭已打开的标签页");
  openTabs = [{ id: 51, url: "https://a.com/w1", title: "工作文章一" }];
  click(entry);
  await tick(80);
  check("从菜单点开同样先问一句", /关闭「工作」里已打开的 1 个标签页/.test(dialogTitle()), dialogTitle());
  await confirmDialog(true);
  check("菜单这条路也真的关掉了", removedTabIds.join(",") === "51", removedTabIds.join(","));
  check("收藏依旧一条没少", store.laterOnItems.length === 4, store.laterOnItems.length);

  console.log("\n── 等待整理也能单独收 ──");
  await navTo("unfiled");
  openTabs = [{ id: 61, url: "https://a.com/u1", title: "待整理文章" }];
  removedTabIds.length = 0;
  click(closeButton());
  await tick(60);
  check("标题写明是「等待整理」", /关闭「等待整理」里已打开的 1 个标签页/.test(dialogTitle()), dialogTitle());
  await confirmDialog(true);
  check("只关了等待整理那一个", removedTabIds.join(",") === "61", removedTabIds.join(","));
  check("别处项目的收藏没动", store.laterOnItems.length === 4, store.laterOnItems.length);

  console.log("\n── 页面错误 ──");
  check("整个过程没有出现未捕获的错误", errors.length === 0, errors.join(" | "));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
