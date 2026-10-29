// 侧栏「关闭已打开」：把当前项目里还摊在浏览器里的标签页收干净，收藏一条都不删。
// 覆盖：
//  1) 按钮只在单个项目下出现，且带得有 title / aria-label（图标按钮没有文字，全靠它）
//  2) 一个标签都没开着：不弹框，顶部状态条直接说一句
//  3) 开着几个：先数、确认框里写清数量和项目名，并且明说「收藏不会删」
//  4) 点「取消」：一个标签都不许关，收藏也不许动
//  5) 点「确认」：只关这个项目的，别的项目开着的标签页留着；收藏一条都没少
//  6) 切到别的项目后，范围跟着换（别拿等待整理的名单去关工作项目的标签）
//  7) 空项目：说「还没有收藏」，不是「没有已打开的标签页」
//  8) 结构：CSS 必须自己管 [hidden]（作者写了 display 就压过浏览器默认的 hidden 规则）
// 用 jsdom + 一份可变的假标签页列表，能在命令行里快速反复跑；真实关闭行为由
// tests/e2e/sidepanel-close-tabs.spec.js 在真浏览器里验证。
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/sidepanel.html`, "utf8");
const css = fs.readFileSync(`${ROOT}/sidepanel.css`, "utf8");
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");
const urlSource = fs.readFileSync(`${ROOT}/url-utils.js`, "utf8");
const tabNavSource = fs.readFileSync(`${ROOT}/tab-navigation.js`, "utf8");
const sidepanelSource = fs.readFileSync(`${ROOT}/sidepanel.js`, "utf8");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
virtualConsole.on("error", (message) => errors.push(String(message)));

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "chrome-extension://lateron/sidepanel.html",
  virtualConsole
});
const { window } = dom;
const { document } = window;

const now = Date.now();
const item = (id, extra) => ({
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "example.com", url: `https://example.com/${id}`, savedAt: now, ...extra
});
const store = {
  laterOnItems: [
    item("u1", { projectId: null }),
    item("u2", { projectId: null }),
    item("w1", { projectId: "work" }),
    item("w2", { projectId: "work" })
  ],
  laterOnProjects: [
    { id: "work", name: "工作", createdAt: 1 },
    { id: "empty", name: "空项目", createdAt: 2 }
  ],
  laterOnActiveProject: "unfiled",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true
};
const itemsSnapshot = () => JSON.stringify(store.laterOnItems);

// 浏览器里此刻开着哪些标签页。测试会真的从这里删，所以「关没关」看的是它。
const currentTab = { id: 1, windowId: 7, active: true, url: "https://current.com/", title: "当前页" };
let openTabs = [
  currentTab,
  { id: 2, windowId: 7, url: "https://example.com/u1", title: "标题 u1" },
  { id: 3, windowId: 7, url: "https://example.com/u2", title: "标题 u2" },
  { id: 4, windowId: 7, url: "https://example.com/w1", title: "标题 w1" }
];
const tabIds = () => openTabs.map((tab) => tab.id).sort((a, b) => a - b).join(",");

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
    getCurrent: () => Promise.resolve({ ...currentTab }),
    query: () => Promise.resolve(openTabs.map((tab) => ({ ...tab }))),
    update: () => Promise.resolve({ id: 2 }),
    create: () => Promise.resolve({ id: 90 }),
    remove(ids) {
      const list = Array.isArray(ids) ? ids : [ids];
      openTabs = openTabs.filter((tab) => !list.includes(tab.id));
      return Promise.resolve();
    },
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} }
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }), update: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (file) => `chrome-extension://lateron/${file}`,
    sendMessage: () => Promise.resolve({ ok: false, ready: true }),
    onMessage: { addListener() {} }
  }
};

// 确认框：不真的拉 dialog.js（jsdom 里加载不了脚本标签），直接换成一个记账的桩。
let confirmCalls = [];
let confirmAnswer = true;
let dialogReady = true;
window.LaterOnDialog = {
  confirm(options) {
    confirmCalls.push(options);
    return Promise.resolve(confirmAnswer);
  },
  prompt: () => Promise.resolve(null)
};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

const tabsButton = () => document.querySelector("#closeProjectTabs");
const statusText = () => document.querySelector("#status").textContent;
const projectButton = (id) => [...document.querySelectorAll("#projectFilters .project-filter")]
  .find((button) => button.querySelector(".project-name")?.textContent === id);

require("./helpers/item-mutation")(window);

window.eval(urlSource);
window.eval(tabNavSource);
window.eval(i18nSource);
window.scrollTo = () => {};
window.eval(sidepanelSource);

(async () => {
  await tick(120);

  console.log("── 1. 按钮本身 ──");
  const button = tabsButton();
  check("筛选行里有这颗按钮", !!button);
  check("单个项目下它是出现的", !!button && !button.hidden);
  check("图标按钮带了说明文字（不然没人知道它是干什么的）",
    (button.getAttribute("title") || "").includes("标签页") && !!button.getAttribute("aria-label"),
    button.getAttribute("title") || "(空)");
  check("它排在这一排里、没把计数挤掉",
    document.querySelector("#itemCount").textContent.length > 0 && !!button.closest(".filter-row"),
    document.querySelector("#itemCount").textContent);
  check("CSS 自己管 hidden（作者写了 display 就压过浏览器默认规则）",
    /\.close-tabs\[hidden\]\s*\{\s*display:\s*none/.test(css));

  console.log("\n── 2. 一个都没开着：不弹框，直接说一句 ──");
  confirmCalls = [];
  openTabs = [currentTab];
  const beforeSilent = itemsSnapshot();
  click(button);
  await tick(120);
  check("没有弹出确认框", confirmCalls.length === 0, `${confirmCalls.length} 次`);
  check("状态条说的是「没有已打开的标签页」",
    statusText().includes("没有已打开的标签页"), statusText());
  check("状态条里点名了当前项目", statusText().includes("等待整理"), statusText());
  check("收藏没被动过", itemsSnapshot() === beforeSilent);

  console.log("\n── 3. 开着两个：先数，再问 ──");
  // 这一节只看确认框里写了什么，所以让它回答「取消」——不然点下去就真关了，
  // 后面的取消/确认两节就没得测（第一版就是这么把自己测挂的）。
  confirmAnswer = false;
  confirmCalls = [];
  openTabs = [
    currentTab,
    { id: 2, windowId: 7, url: "https://example.com/u1", title: "标题 u1" },
    { id: 3, windowId: 7, url: "https://example.com/u2", title: "标题 u2" },
    { id: 4, windowId: 7, url: "https://example.com/w1", title: "标题 w1" }
  ];
  click(button);
  await tick(150);
  check("弹出了确认框", confirmCalls.length === 1, `${confirmCalls.length} 次`);
  const asked = confirmCalls[0] || {};
  check("标题里写了项目名和数量", String(asked.title).includes("等待整理") && String(asked.title).includes("2"), asked.title);
  check("说明里明说收藏一条都不删", String(asked.message).includes("收藏一条都不会删"), asked.message);
  check("确认按钮不是「删除」那种语气", asked.confirmText === "关闭标签页", asked.confirmText);

  console.log("\n── 4. 点「取消」：一个都不许关 ──");
  confirmAnswer = false;
  const beforeCancel = tabIds();
  const beforeItems = itemsSnapshot();
  click(button);
  await tick(150);
  check("标签页一个都没少", tabIds() === beforeCancel, tabIds());
  check("收藏也一条没少", itemsSnapshot() === beforeItems);
  check("没关就不该报「已关闭」", !statusText().includes("已关闭"), statusText());

  console.log("\n── 5. 点「确认」：只关这个项目的 ──");
  confirmAnswer = true;
  click(button);
  await tick(200);
  check("等待整理的 u1 / u2 关掉了", !openTabs.some((tab) => tab.id === 2 || tab.id === 3), tabIds());
  check("工作项目的 w1 还开着（范围没串）", openTabs.some((tab) => tab.id === 4), tabIds());
  check("侧栏自己寄居的那个标签页没被关掉", openTabs.some((tab) => tab.id === 1), tabIds());
  check("状态条报了「已关闭 2 个」，并说明收藏都还在",
    statusText().includes("已关闭 2 个标签页") && statusText().includes("收藏都还在"), statusText());
  check("收藏一条都没被删", store.laterOnItems.length === 4, `${store.laterOnItems.length} 条`);

  console.log("\n── 6. 换个项目，范围跟着换 ──");
  click(projectButton("工作"));
  await tick(120);
  confirmCalls = [];
  openTabs = [
    currentTab,
    { id: 4, windowId: 7, url: "https://example.com/w1", title: "标题 w1" }
  ];
  click(tabsButton());
  await tick(150);
  check("这次确认框点名的是「工作」", String(confirmCalls[0]?.title || "").includes("工作"), confirmCalls[0]?.title);
  confirmAnswer = true;
  await tick(10);
  click(tabsButton());
  await tick(200);
  check("关掉的是工作项目那一个", !openTabs.some((tab) => tab.id === 4), tabIds());

  console.log("\n── 7. 空项目 ──");
  click(projectButton("空项目"));
  await tick(120);
  confirmCalls = [];
  openTabs = [currentTab, { id: 4, windowId: 7, url: "https://example.com/w1", title: "标题 w1" }];
  click(tabsButton());
  await tick(150);
  check("空项目不弹框", confirmCalls.length === 0, `${confirmCalls.length} 次`);
  check("说的是「还没有收藏」，不是「没有已打开的标签页」",
    statusText().includes("还没有收藏"), statusText());
  check("别的项目的标签页当然也没动", openTabs.some((tab) => tab.id === 4), tabIds());

  console.log("\n── 8. 连点两下只问一次 ──");
  click(projectButton("工作"));
  await tick(120);
  confirmCalls = [];
  openTabs = [currentTab, { id: 4, windowId: 7, url: "https://example.com/w1", title: "标题 w1" }];
  const twice = tabsButton();
  click(twice);
  click(twice);
  await tick(200);
  check("两个点击只换来一个确认框", confirmCalls.length === 1, `${confirmCalls.length} 次`);

  check("运行期间没有脚本报错", errors.length === 0, errors.slice(0, 2).join(" | ") || "干净");

  console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();
