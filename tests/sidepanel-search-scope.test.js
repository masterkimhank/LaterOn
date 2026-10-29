// 侧栏搜索框的范围开关：和完整界面同一套语义。
// 默认「全部」= 全局搜索（原有行为不变）；拨到「等待整理」就只搜没归到任何项目的条目。
// 覆盖：
//  1) 默认档是「全部」，搜索照样跨项目命中（回归：别把全局搜索弄丢了）
//  2) 拨到「等待整理」后，只命中未归类的条目，别处的一篇都不混进来
//  3) 占位文字、搜索框描边跟着范围变（不然人不知道自己在搜子集）
//  4) 空结果的说法要分开：全库搜不到 ≠ 等待整理里搜不到（后者要提示可以切回「全部」，否则
//     用户会以为这篇收藏丢了）；措辞也不能说「顶部」，侧栏的筛选在搜索框下面
//  5) 「未读 / 已读」那一档在收窄的范围里仍然生效
//  6) 换项目时范围自动收回「全部」，不把收窄的开关带进别的项目
// 用 jsdom 而不是真浏览器，只是为了让这个检查能在命令行里快速反复跑。
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/sidepanel.html`, "utf8");
const sidepanelSource = fs.readFileSync(`${ROOT}/sidepanel.js`, "utf8");
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");

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

// 同一个关键词「深度」散在两个项目里和等待整理里，
// 用来区分「全库搜索」和「只在等待整理里搜」。
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
  laterOnActiveProject: "unfiled",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true,
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
    query: () => Promise.resolve([{ id: 1, windowId: 7, active: true, url: "https://current.com" }]),
    update: () => Promise.resolve({ id: 1 }),
    create: () => Promise.resolve({ id: 9 }),
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} }
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (path) => `chrome-extension://lateron/${path}`,
    sendMessage: () => Promise.resolve({ ok: false, ready: true }),
    onMessage: { addListener() {} }
  }
};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

const ids = () => [...document.querySelectorAll("#items .item")].map((el) => el.dataset.id).sort();
const searchInput = () => document.querySelector("#searchInput");
const scopeButton = (scope) => document.querySelector(`.scope-option[data-scope="${scope}"]`);
const activeScope = () => document.querySelector(".scope-option.active")?.dataset.scope;
const isScoped = () => document.querySelector("#searchBox").classList.contains("is-scoped");
const emptyTitle = () => document.querySelector("#emptyState h2").textContent;
const emptyHint = () => document.querySelector("#emptyState p").textContent;
const projectButton = (id) => [...document.querySelectorAll("#projectFilters .project-filter")]
  .find((button) => button.querySelector(".project-name")?.textContent === id);

// 输入搜索词：走真实路径（input 事件 + 120ms 防抖）。
async function search(word) {
  searchInput().value = word;
  searchInput().dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(180);
}
async function scopeTo(scope) {
  click(scopeButton(scope));
  await tick(60);
}

require('./helpers/item-mutation')(window);

window.eval(i18nSource);
window.scrollTo = () => {};
window.eval(sidepanelSource);

(async () => {
  await tick(80);

  console.log("── 1. 默认档：全局搜索（原行为不许退化）──");
  check("默认选中的是「全部」", activeScope() === "all", String(activeScope()));
  check("默认档不打橙色描边", !isScoped());
  await search("深度");
  check("搜到了分散在两个项目和等待整理里的五篇", ids().join(",") === "a1,b1,d1,u1,u2", ids().join(","));

  console.log("\n── 2. 拨到「等待整理」：只搜未归类 ──");
  await scopeTo("unfiled");
  check("只剩等待整理里那两篇", ids().join(",") === "u1,u2", ids().join(","));
  check("高亮切到「等待整理」", activeScope() === "unfiled", String(activeScope()));
  check("搜索框加上了收窄标记", isScoped());
  check("占位文字说明在搜哪儿", searchInput().placeholder === "搜索等待整理", searchInput().placeholder);

  console.log("\n── 3. 范围内搜不到时的说法 ──");
  await search("工作法");
  check("一篇都没有", ids().length === 0, ids().join(",") || "(空)");
  check("标题说的是「等待整理里没有」而不是「还没有添加的网页」",
    emptyTitle() === "等待整理里没有匹配的网页", emptyTitle());
  check("提示里告诉人可以切回「全部」", emptyHint().includes("全部"), emptyHint());

  console.log("\n── 4. 全库搜不到时的说法 ──");
  await scopeTo("all");
  await search("这个词根本不存在");
  check("标题说的是「没有找到匹配的网页」", emptyTitle() === "没有找到匹配的网页", emptyTitle());
  check("提示不说「顶部」（侧栏的筛选在搜索框下面）",
    emptyHint().includes("下面") && !emptyHint().includes("顶部"), emptyHint());

  console.log("\n── 5. 收窄的范围里，阅读状态筛选仍然生效 ──");
  await scopeTo("unfiled");
  await search("深度");
  click(document.querySelector('.filter[data-filter="done"]'));
  await tick(60);
  check("「已读」只留下等待整理里那篇已读的", ids().join(",") === "u2", ids().join(","));
  click(document.querySelector('.filter[data-filter="all"]'));
  await tick(60);
  check("切回「全部」阅读档后，范围没被它带跑", ids().join(",") === "u1,u2", ids().join(","));

  console.log("\n── 6. 换项目时范围收回「全部」──");
  await scopeTo("unfiled");
  check("先确认在收窄档", activeScope() === "unfiled");
  await search("深度");
  click(projectButton("阅读"));
  await tick(80);
  check("切项目后范围回到「全部」", activeScope() === "all", String(activeScope()));
  check("描边也跟着撤掉", !isScoped());
  check("搜索词还在，并且又变成全局结果", ids().join(",") === "a1,b1,d1,u1,u2", ids().join(","));

  console.log("\n── 7. 结构：不能再用 label 包着按钮 ──");
  check("搜索框是 div（label 会把按钮点击转发给输入框）",
    document.querySelector("#searchBox").tagName === "DIV", document.querySelector("#searchBox").tagName);

  check("运行期间没有脚本报错", errors.length === 0, errors.slice(0, 2).join(" | ") || "干净");

  console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();
