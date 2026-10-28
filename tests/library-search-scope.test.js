// 搜索框的范围开关：默认「全部」= 全局搜索（原有行为不变），
// 拨到「等待整理」就只搜没归到任何项目的条目。
// 覆盖：
//  1) 默认档是「全部」，占位文字和原来一致（回归：别把全局搜索弄丢了）
//  2) 拨到「等待整理」后，搜到的只有未归类的条目，别处的一篇都不混进来
//  3) 计数 / 占位文字 / 空状态都写明「在等待整理里」，不冒充全库结果
//  4) 人在某个项目里拨到「等待整理」照样只搜未归类的条目（范围开关优先于当前项目）
//  5) 「未读 / 已读」那一档仍然生效
//  6) 换一屏（切项目）范围自动收回「全部」，不把收窄的开关带进别的项目
// 用 jsdom 而不是真浏览器，只是为了让这个检查能在命令行里快速反复跑。
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
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

// ── 假数据：同一个关键词散在「工作」「阅读」和「等待整理」里，
//    等待整理那两篇一篇未读、一篇已读，用来验证阅读状态筛选仍然生效。 ──
const now = Date.now();
const item = (id, extra) => ({
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "未知", url: `https://example.com/${id}`, savedAt: now, read: false, ...extra
});
const store = {
  laterOnItems: [
    item("a1", { title: "Alpha 深度工作法", projectId: "work" }),
    item("a2", { title: "Beta 不相干", projectId: "work", savedAt: now - 1000 }),
    item("b1", { title: "Gamma 深度工作笔记", projectId: "read", savedAt: now - 2000 }),
    item("u1", { title: "Delta 有深度的思考", projectId: null, savedAt: now - 3000 }),
    item("u2", { title: "Zeta 深度待整理已读", projectId: null, savedAt: now - 3500, status: "done", read: true }),
    item("d1", { title: "Epsilon 深度已完成", projectId: "read", savedAt: now - 4000, status: "done", read: true })
  ],
  laterOnProjects: [
    { id: "work", name: "工作", createdAt: 1 },
    { id: "read", name: "阅读", createdAt: 2 }
  ],
  laterOnActiveProject: "all",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true
};

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
    getCurrent: () => Promise.resolve({ id: 1, windowId: 7, active: true }),
    query: () => Promise.resolve([{ id: 1, windowId: 7, active: true }]),
    update: () => Promise.resolve({ id: 1 }),
    create: () => Promise.resolve({ id: 9 })
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (path) => `chrome-extension://lateron/${path}`,
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
const tick = (ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

const searchBox = () => document.querySelector("#searchInput");
const scopeButton = (scope) => document.querySelector(`.scope-option[data-scope="${scope}"]`);
const activeScope = () => document.querySelector(".scope-option.active")?.dataset.scope;
const scopedFrame = () => document.querySelector("#searchBox").classList.contains("is-scoped");
const cardIds = () => [...document.querySelectorAll("#cardGrid .card")].map((card) => card.dataset.id).sort();
const countText = () => document.querySelector("#countText").textContent;
const emptyTitle = () => document.querySelector("#emptyState h2").textContent;

async function search(word) {
  searchBox().value = word;
  searchBox().dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(180);
}
async function scopeTo(scope) {
  click(scopeButton(scope));
  await tick(30);
}

(async () => {
  require('./helpers/item-mutation')(window);
  window.eval(librarySource);
  await tick(60);

  console.log("── 默认档：还是全局搜索 ──");
  check("开关默认停在「全部」", activeScope() === "all", String(activeScope()));
  check("「全部」按钮 aria-pressed 为 true", scopeButton("all").getAttribute("aria-pressed") === "true");
  check("「等待整理」按钮 aria-pressed 为 false", scopeButton("unfiled").getAttribute("aria-pressed") === "false");
  check("占位文字还是「搜索网页」", searchBox().placeholder === "搜索网页", searchBox().placeholder);
  check("整框没有收窄色边", scopedFrame() === false);
  await search("深度");
  check("默认搜的是全库（5 篇，跨项目 + 等待整理）", cardIds().join(",") === "a1,b1,d1,u1,u2", cardIds().join(","));
  check("计数写的是「在全部网页里」", /在全部网页里找到 5 篇/.test(countText()), countText());

  console.log("\n── 拨到「等待整理」：只搜未归类的那几条 ──");
  await scopeTo("unfiled");
  check("关键词还在，结果按新范围重算（只剩等待整理的 2 篇）", cardIds().join(",") === "u1,u2", cardIds().join(","));
  check("计数改成「在等待整理里」", /在等待整理里找到 2 篇 · 1 篇没看完/.test(countText()), countText());
  check("占位文字跟着说明在搜哪儿", searchBox().placeholder === "搜索等待整理", searchBox().placeholder);
  check("整框加了收窄色边", scopedFrame() === true);
  check("开关高亮在「等待整理」上", activeScope() === "unfiled" && scopeButton("unfiled").getAttribute("aria-pressed") === "true");
  check("拨完开关，光标回到输入框（可以接着打字）", document.activeElement === searchBox());
  check("搜索不会把侧栏高亮改走", document.querySelector('.project-nav[data-project="all"]').classList.contains("active"));

  console.log("\n── 「未读 / 已读」那一档在收窄范围里仍然生效 ──");
  click(document.querySelector('.nav-item[data-filter="done"]'));
  await tick(30);
  check("只看已读时，只剩等待整理里标完成的那篇", cardIds().join(",") === "u2", cardIds().join(","));
  check("计数跟着变", /在等待整理里找到 1 篇 · 0 篇没看完/.test(countText()), countText());
  click(document.querySelector('.nav-item[data-filter="all"]'));
  await tick(30);
  check("切回全部又恢复 2 篇", cardIds().join(",") === "u1,u2", cardIds().join(","));

  console.log("\n── 人在别的项目里，收窄范围照样只搜等待整理 ──");
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(30);
  check("（准备）切项目会把范围和关键词一起收掉：只剩工作项目的 2 篇", cardIds().join(",") === "a1,a2", cardIds().join(","));
  check("范围已自动回到「全部」", activeScope() === "all" && scopedFrame() === false, String(activeScope()));
  check("占位文字也回到「搜索网页」", searchBox().placeholder === "搜索网页", searchBox().placeholder);
  await search("深度");
  check("默认档下还是全库 5 篇", cardIds().join(",") === "a1,b1,d1,u1,u2", cardIds().join(","));
  await scopeTo("unfiled");
  check("拨到等待整理后，哪怕人还在「工作」项目里，也只有未归类的那 2 篇", cardIds().join(",") === "u1,u2", cardIds().join(","));
  check("计数写明范围", /在等待整理里找到 2 篇/.test(countText()), countText());

  console.log("\n── 等待整理里搜不到时，提示别冒充全库结论 ──");
  await search("这个词肯定没有");
  check("卡片列表空", cardIds().length === 0);
  check("空状态用的是「等待整理里没有匹配的网页」",
    document.querySelector("#emptyState").hidden === false && /等待整理里没有匹配的网页/.test(emptyTitle()), emptyTitle());
  check("提示里指了出路：可以切回「全部」", /切到「全部」/.test(document.querySelector("#emptyState p").textContent));
  check("计数如实报 0 篇", /在等待整理里找到 0 篇/.test(countText()), countText());

  console.log("\n── 清空关键词 / 切回全部档 ──");
  await scopeTo("all");
  check("拨回「全部」：同一关键词又搜出全库 0 篇（注意此时词还在）", /在全部网页里找到 0 篇/.test(countText()), countText());
  await search("");
  check("清空关键词后回到「工作」项目的卡片列表", cardIds().join(",") === "a1,a2", cardIds().join(","));
  check("清空后计数回到项目的说法", /2 篇网页 · 2 篇没看完/.test(countText()), countText());

  console.log("\n── 页面错误 ──");
  check("整个过程没有出现未捕获的错误", errors.length === 0, errors.join(" | "));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
