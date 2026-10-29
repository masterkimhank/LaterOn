// 删除收藏时「同时关掉浏览器里还开着的同一网页」这个开关。
// 覆盖：
//  1) 默认关闭：删除时不去碰任何标签页，确认框也不提这回事（回归：别把默认行为改了）
//  2) 打开后：确认框列清单，「会一起关掉 N 个」只算**网址对得上**的标签页
//     （跨 www / 带 utm 参数也算同一篇），另外「只是标题相同」的单独列一组、不关
//  3) 确认后真的关掉清单第一组那几个，别的网址、扩展自己的页面一律不碰；提示语写明关了几个
//  4) 没有开着的标签页时，提示语维持原来那句（不多说一句废话）
//  5) 批量删除同样按整个选中集合来算、来关
//  6) 中途在别的标签页把开关关掉，这边不刷新也能立刻生效
//  7) 网址变了、只有标题相同的标签页：列出来给人看，但**默认不关**
//     （以前是跟着关的——这就是「关闭的标签和所选的不一致」）
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
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "少数派", url: `https://example.com/${id}`, savedAt: now, read: false, ...extra
});
const store = {
  laterOnItems: [
    item("a1", { title: "标题一" }),
    item("a2", { title: "标题二" }),
    item("a3", { title: "标题三" })
  ],
  laterOnProjects: [],
  laterOnActiveProject: "unfiled",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true
};

// 浏览器里此刻开着的标签页：a1 开了一个，另有一个带 www 和 utm 参数的同一篇；
// 其余是干扰项（别的网址、扩展自己的页面）。
let openTabs = [];
const removedTabIds = [];
const queries = [];

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
      queries.push(info || {});
      // 页面初始化时问的是「当前窗口的活动标签页」，其余时候才是「所有标签页」。
      if (info && info.active) return Promise.resolve([{ id: 90, windowId: 7, active: true, url: "chrome-extension://lateron/library.html" }]);
      return Promise.resolve(openTabs);
    },
    remove: (ids) => {
      removedTabIds.push(...[].concat(ids));
      openTabs = openTabs.filter((tab) => ![].concat(ids).includes(tab.id));
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
const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const pressKey = (el, key) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

const cardOf = (id) => document.querySelector(`#cardGrid .card[data-id="${id}"]`);
const dialog = () => document.querySelector(".lod-root:not([hidden])");
const dialogMessage = () => dialog()?.querySelector(".lod-message")?.textContent || "";
// 弹窗里的只读清单：分组读成 [{ tone, title, items }]，条目不包含「还有 N 个」那行。
const dialogNotice = () => {
  const box = dialog()?.querySelector(".lod-notice");
  if (!box || box.hidden) return [];
  return [...box.querySelectorAll(".lod-notice-group")].map((group) => ({
    tone: group.dataset.tone || "",
    title: group.querySelector(".lod-notice-title")?.textContent || "",
    items: [...group.querySelectorAll(".lod-notice-list li:not(.lod-notice-more)")]
      .map((li) => li.querySelector(".lod-notice-name")?.textContent || li.textContent)
  }));
};
const toastText = () => document.querySelector("#toast").textContent;
const clickDelete = (id) => click(cardOf(id).querySelector(".delete"));
async function confirmDialog(ok = true) {
  await tick(40);
  const target = ok ? dialog()?.querySelector(".lod-ok") : dialog()?.querySelector(".lod-cancel");
  if (target) click(target);
  await tick(340);   // 弹窗有关闭动画，等它真正 resolve
}
// 把开关写进存储并让页面收到 storage 通知（模拟在设置页拨开关）。
async function setSwitch(on) {
  store.laterOnSettings = { ...store.laterOnSettings, closeTabsOnDelete: on };
  changeListeners.forEach((fn) => fn({ laterOnSettings: { newValue: store.laterOnSettings } }, "local"));
  await tick(40);
}

(async () => {
  window.eval(i18nSource);
  window.eval(dialogSource);
  window.eval(urlUtilsSource);
  window.eval(tabsSource);
  require("./helpers/item-mutation")(window);
  window.eval(librarySource);
  await tick(80);

  openTabs = [
    { id: 11, url: "https://example.com/a1", title: "标题一" },
    { id: 12, url: "https://www.example.com/a1/?utm_source=weixin", title: "标题一" },
    { id: 13, url: "https://example.com/somewhere-else", title: "别的文章" },
    { id: 14, url: "chrome-extension://lateron/library.html", title: "LaterOn" }
  ];

  click(document.querySelector('.project-nav[data-project="unfiled"]'));
  await tick(60);
  check("（准备）三篇都在等待整理里",
    [...document.querySelectorAll("#cardGrid .card")].length === 3,
    String(document.querySelectorAll("#cardGrid .card").length));

  console.log("── 默认关闭：不碰标签页 ──");
  clickDelete("a1");
  await tick(40);
  check("确认框里没有标签页清单", dialogNotice().length === 0, JSON.stringify(dialogNotice()));
  await confirmDialog(false);
  check("取消之后标签页一个都没关", removedTabIds.length === 0, removedTabIds.join(","));

  console.log("\n── 打开开关：先说清要关几个 ──");
  await setSwitch(true);
  clickDelete("a1");
  await tick(40);
  const twoTabs = dialogNotice();
  check("确认框分出一组「会一起关掉 2 个」（同一篇的 www / utm 变体也算）",
    twoTabs.length === 1 && twoTabs[0].tone === "close" && twoTabs[0].items.length === 2,
    JSON.stringify(twoTabs));
  check("两个标签页按标题列出来了", twoTabs[0]?.items.join("|") === "标题一|标题一", (twoTabs[0]?.items || []).join("|"));
  check("取消对话仍然一个都不关", (await confirmDialog(false), removedTabIds.length === 0), removedTabIds.join(","));

  clickDelete("a1");
  await tick(40);
  await confirmDialog(true);
  check("确认后关掉的正是那两个标签页（11、12）",
    removedTabIds.slice().sort().join(",") === "11,12", removedTabIds.join(","));
  check("别的网址（13）和扩展自己的页面（14）没被误关",
    !removedTabIds.includes(13) && !removedTabIds.includes(14), removedTabIds.join(","));
  check("收藏本身被删掉了", !store.laterOnItems.some((entry) => entry.id === "a1"));
  check("提示语写明关了几个标签页", toastText() === "已删除网页，并关闭了 2 个标签页", toastText());

  console.log("\n── 没有开着的标签页时不多说废话 ──");
  removedTabIds.length = 0;
  clickDelete("a2");
  await tick(40);
  check("确认框只说「删除后无法恢复」且没有清单",
    dialogMessage() === "删除后无法恢复。" && dialogNotice().length === 0, dialogMessage());
  await confirmDialog(true);
  check("提示语还是原来那句", toastText() === "已删除网页", toastText());
  check("没有调用关标签页", removedTabIds.length === 0, removedTabIds.join(","));

  console.log("\n── 批量删除：按整个选中集合算 ──");
  click(document.querySelector("#selectMode"));
  await tick(40);
  const only = cardOf("a3");
  check("（准备）只剩 a3 可选", !!only);
  click(only.querySelector(".select-check"));
  await tick(40);
  openTabs = [{ id: 21, url: "https://example.com/a3" }];
  removedTabIds.length = 0;
  click(document.querySelector("#bulkDelete"));
  await tick(40);
  const bulkGroups = dialogNotice();
  check("批量确认框也只列「网址对得上」的那 1 个",
    bulkGroups.length === 1 && bulkGroups[0].tone === "close" && bulkGroups[0].items.length === 1,
    JSON.stringify(bulkGroups));
  await confirmDialog(true);
  check("a3 那个标签页被关掉了", removedTabIds.join(",") === "21", removedTabIds.join(","));
  check("批量提示语同时报篇数和标签数",
    toastText() === "已删除 1 篇，并关闭了 1 个标签页", toastText());

  console.log("\n── 开关关掉后立刻恢复原样（不用刷新） ──");
  store.laterOnItems = [item("b1", { title: "标题四" })];
  changeListeners.forEach((fn) => fn({ laterOnItems: { newValue: store.laterOnItems } }, "local"));
  await setSwitch(false);
  await tick(60);
  openTabs = [{ id: 31, url: "https://example.com/b1" }];
  removedTabIds.length = 0;
  // 批量删除结束后会自动退出多选，这里不用再点「选择」——多选状态下点卡片是勾选，
  // 压根走不到删除按钮。
  click(document.querySelector('.project-nav[data-project="unfiled"]'));
  await tick(60);
  clickDelete("b1");
  await tick(40);
  check("（准备）确认框确实弹出来了", !!dialog());
  check("关掉开关后确认框不再列清单", dialogNotice().length === 0, JSON.stringify(dialogNotice()));
  await confirmDialog(true);
  check("收藏被删掉了", !store.laterOnItems.some((entry) => entry.id === "b1"), store.laterOnItems.map((entry) => entry.id).join(","));
  check("也没有真的去关", removedTabIds.length === 0, removedTabIds.join(","));
  check("提示语是原来那句", toastText() === "已删除网页", toastText());

  console.log("\n── 网址变了、只有标题相同：列出来，但不关 ──");
  // 有些站点每次打开的网址都不一样（分页、SPA 路由、短链）。这种情况只能靠标题认，
  // 但标题也会撞车——所以这一档只列在确认框里给人看，默认不动它。
  // 以前是跟着一起关的：「删掉选中的 A，却关掉了根本不是 A 的那一页」。
  store.laterOnItems = [{
    id: "c1", title: "换了网址也还是同一篇", titleAtSave: "换了网址也还是同一篇",
    description: "摘要", image: "", favicon: "", source: "example.com",
    url: "https://example.com/c1-original", savedAt: Date.now(), status: "unread"
  }];
  changeListeners.forEach((fn) => fn({ laterOnItems: { newValue: store.laterOnItems } }, "local"));
  await setSwitch(true);
  await tick(60);
  openTabs = [{ id: 71, url: "https://example.com/c1-new-route", title: "换了网址也还是同一篇" }];
  removedTabIds.length = 0;
  clickDelete("c1");
  await tick(40);
  const fuzzyGroup = dialogNotice();
  check("确认框把它单独列成「只是标题相同」那一组",
    fuzzyGroup.length === 1 && fuzzyGroup[0].tone === "keep" && fuzzyGroup[0].items.length === 1,
    JSON.stringify(fuzzyGroup));
  check("这一组的标题说明了「不会关闭」", /不会关闭/.test(fuzzyGroup[0]?.title || ""), fuzzyGroup[0]?.title);
  await confirmDialog(true);
  check("确认后也没有关它（宁可漏关，不能误关）", removedTabIds.length === 0, removedTabIds.join(","));
  check("收藏本身还是被删掉了", !store.laterOnItems.some((entry) => entry.id === "c1"));

  console.log("\n── 页面错误 ──");
  check("整个过程没有出现未捕获的错误", errors.length === 0, errors.join(" | "));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
