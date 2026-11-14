// 收藏库的回收站界面：入口计数、视图内容、空态、批量条、撤销与清空。
// 数据层的软删除 / 恢复 / 彻底删除在 tests/trash.test.js 里验；
// 这里只盯「人看得见的那一层」，包括几个手工核对时才发现的问题：
//   - 回收站空了以后「清空回收站」还挂在页面上（点了只会弹个 0 篇的确认框）
//   - 空态被写成了「没有找到匹配的网页」，看起来像搜索没命中，而不是回收站本来就是空的
//   - 删掉的卡片上还留着「标已读 / 移到项目 / 编辑」
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
const librarySource = fs.readFileSync(`${ROOT}/library.js`, "utf8");
// 界面文案全靠 i18n.js：不加载它，tr() 只会把 key 原样吐回来，断言就成了比对 key。
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");

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
  source: "未知", url: `https://example.com/${id}`, savedAt: now, read: false, ...extra
});
const store = {
  laterOnItems: [
    item("keep1", { title: "还留着的甲", projectId: "work", savedAt: now - 500 }),
    item("keep2", { title: "还留着的乙", savedAt: now - 1000 }),
    item("gone1", { title: "删掉的甲", savedAt: now - 2000, deletedAt: now - 100 }),
    item("gone2", { title: "删掉的乙", projectId: "work", savedAt: now - 3000, deletedAt: now - 50 })
  ],
  laterOnProjects: [{ id: "work", name: "工作", createdAt: 1 }],
  laterOnActiveProject: "all",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true,
  laterOnCovers: {},
  laterOnOrder: { all: ["keep1", "keep2"] }
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
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: () => Promise.resolve({ ready: true }),
    onMessage: { addListener() {} }
  }
};

if (typeof window.crypto?.randomUUID !== "function") {
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
}
// jsdom 不实现 window.scrollTo，会往 virtualConsole 里塞「Not implemented」错误。
window.scrollTo = () => {};
// 确认框一律「确定」：这里验的是点确定之后界面怎么变，不是确认框本身。
let confirmCalls = 0;
window.LaterOnDialog = {
  confirm: async () => { confirmCalls += 1; return true; },
  prompt: async () => null
};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

const cardIds = () => [...document.querySelectorAll("#cardGrid .card")].map((card) => card.dataset.id).sort();
const cardOf = (id) => document.querySelector(`#cardGrid .card[data-id="${id}"]`);
const entry = () => document.querySelector("#openTrash");
const trashCount = () => document.querySelector("#trashCount");
const emptyButton = () => document.querySelector("#emptyTrash");
const emptyState = () => document.querySelector("#emptyState");
const toast = () => document.querySelector("#toast");
const visible = (el) => !!el && !el.hidden && !el.closest("[hidden]");

(async () => {
  require('./helpers/item-mutation')(window);
  window.eval(i18nSource);
  window.eval(librarySource);
  await tick(80);

  console.log("── ① 侧栏入口：有已删条目才挂数字 ──");
  check("侧栏底部有「回收站」入口", !!entry() && /回收站/.test(entry().textContent), entry()?.textContent.trim());
  check("入口上挂着 2 篇的计数", trashCount().textContent === "2" && trashCount().hidden === false, `${trashCount().textContent} / hidden=${trashCount().hidden}`);

  console.log("\n── ② 进回收站：只剩删掉的那些，控件也收起来 ──");
  click(entry());
  await tick(60);
  check("只列已删的两篇（没删的一篇都看不到）", cardIds().join(",") === "gone1,gone2", cardIds().join(","));
  const gone = cardOf("gone1");
  check("卡片带 is-trashed 标记", gone.classList.contains("is-trashed"), gone.className);
  check("删掉的卡片不许拖拽排序", [...document.querySelectorAll("#cardGrid .card")].every((card) => card.draggable === false));
  check("顶部计数是回收站的说法", /回收站 2 篇/.test(document.querySelector("#countText").textContent), document.querySelector("#countText").textContent);
  check("回收站里出现「清空回收站」", visible(emptyButton()));
  check("回收站里不再出现「关闭已打开」", !visible(document.querySelector("#closeProjectTabs")));
  check("批量条：恢复 / 彻底删除露出来，其余动作收起来",
    visible(document.querySelector("#bulkRestore")) && visible(document.querySelector("#bulkPurge"))
    && !visible(document.querySelector("#bulkDelete")) && !visible(document.querySelector("#bulkRead"))
    && !visible(document.querySelector("#bulkProject")));
  check("「退出多选」以外的勾选机制照常（能选中才谈得上批量恢复）", visible(document.querySelector("#selectMode")));

  console.log("\n── ③ 恢复一篇：回到主列表，其余不动 ──");
  const restored = await window.eval("restoreItems(['gone1'])");
  await tick(80);
  check("恢复接口报 1 条", restored?.affected === 1, String(restored?.affected));
  check("回收站里只剩另一篇", cardIds().join(",") === "gone2", cardIds().join(","));
  check("计数跟着掉到 1", trashCount().textContent === "1", trashCount().textContent);
  const kept = store.laterOnItems.find((entryItem) => entryItem.id === "gone1");
  check("存储里 deletedAt 被摘掉", !!kept && !("deletedAt" in kept), JSON.stringify(kept));

  console.log("\n── ④ 在项目里删除：进回收站，且给得出「撤销」──");
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(60);
  check("（准备）「工作」里就那一篇要删的", cardIds().join(",") === "keep1", cardIds().join(","));
  click(cardOf("keep1").querySelector(".delete"));
  await tick(150);
  check("确认框问过一句", confirmCalls >= 1, String(confirmCalls));
  check("卡片从列表里消失", !cardOf("keep1"));
  check("存储里那条只是打了标记（还在）", !!store.laterOnItems.find((entryItem) => entryItem.id === "keep1" && entryItem.deletedAt > 0));
  check("回收站计数 +1", trashCount().textContent === "2", trashCount().textContent);
  const action = toast().querySelector(".toast-action");
  check("提示条上带「撤销」按钮", !!action && /撤销/.test(action.textContent), action?.textContent || "(没有按钮)");
  check("提示条写了「移入回收站」而不是「已删除」", /移入回收站/.test(toast().textContent), toast().textContent.trim());

  console.log("\n── ⑤ 点「撤销」：原地捞回来 ──");
  click(action);
  await tick(150);
  check("卡片回到列表", !!cardOf("keep1"));
  check("存储里的标记被摘掉", !("deletedAt" in store.laterOnItems.find((entryItem) => entryItem.id === "keep1")));
  check("回收站计数回到 1", trashCount().textContent === "1", trashCount().textContent);

  console.log("\n── ⑥ 清空回收站：清完按钮要收起来，空态要说这里本来就空 ──");
  click(entry());
  await tick(60);
  check("（准备）回收站里就剩那一篇", cardIds().join(",") === "gone2", cardIds().join(","));
  click(emptyButton());
  await tick(200);
  check("回收站清空", cardIds().length === 0, cardIds().join(","));
  check("清空后「清空回收站」自己收起来（别留一个点了弹 0 篇的按钮）", !visible(emptyButton()));
  check("空态说的是「回收站是空的」", /回收站是空的/.test(emptyState().querySelector("h2").textContent), emptyState().querySelector("h2").textContent);
  check("空态提示解释了删掉的网页会去哪儿", /手动清空/.test(emptyState().querySelector("p").textContent), emptyState().querySelector("p").textContent);
  check("空回收站不挂计数", trashCount().hidden === true || trashCount().textContent === "0", `${trashCount().textContent} / hidden=${trashCount().hidden}`);
  check("真的抹掉了数据（不是又打了层标记）",
    store.laterOnItems.every((entryItem) => !entryItem.deletedAt)
    && !store.laterOnItems.some((entryItem) => entryItem.id === "gone2"),
    JSON.stringify(store.laterOnItems.map((entryItem) => entryItem.id)));

  console.log("\n── ⑦ 没删的条目全程没被牵连 ──");
  click(document.querySelector('.project-nav[data-project="unfiled"]'));
  await tick(60);
  // gone1 从回收站恢复回来、本来就没有归属项目，所以它也在「等待整理」里。
  check("「等待整理」里是「从没删过的」加「刚恢复回来的」", cardIds().join(",") === "gone1,keep2", cardIds().join(","));
  check("它身上没有 deletedAt", !!store.laterOnItems.find((entryItem) => entryItem.id === "keep2" && !("deletedAt" in entryItem)));

  console.log("\n── 页面错误 ──");
  check("整个过程没有未捕获的错误", errors.length === 0, errors.join(" | "));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
