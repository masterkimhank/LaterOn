// 「正在读」的高亮必须在卡片被筛掉又重建以后还在。
//
// 1.72.0 的 P0 优化把 applyCurrentHighlight() 从「遍历全部卡片」改成
// 「记一个 lastHighlightId，只动上一张和这一张」，并且开头加了
// `if (prev === next) return;` 的提前返回。
//
// 这个提前返回有个洞：卡片的 DOM 是会被销毁重建的。
// renderCardsView() 里 `if (!visibleIds.has(id)) { card.remove(); cardMap.delete(id); }`
// —— 当前读的那篇一旦被筛选条件排除（切到别的项目、切到「已读」、搜索词把它过滤掉），
// 它的卡片就被 remove + delete；切回来时 createCard() 造的是**全新节点**，不带 is-current。
// 而 currentItemId 一直没变，于是 next === prev，提前返回 → 新卡片永远补不上高亮。
//
// 现象：正在读那篇文章的橙色描边（和「正在读」角标）在切一次项目/筛选后消失，
// 切回原项目也不会回来，除非换一篇正在读。
//
// 覆盖：
//  1) 首屏就带高亮（基线）
//  2) 切到别的项目（原卡片被销毁）→ 切回来，高亮必须还在
//  3) 搜索把当前这篇过滤掉再清空，高亮必须还在
//  4) 换一篇正在读，高亮正确转移（旧卡清掉、新卡标上）
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");
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
    item("w1", { title: "Alpha 深度工作法", projectId: "work" }),
    item("w2", { title: "Delta 专注力", projectId: "work", savedAt: now - 500 }),
    item("r1", { title: "Beta 深度阅读", projectId: "reading", savedAt: now - 1000 }),
    item("u1", { title: "Gamma 深度待整理", projectId: null, savedAt: now - 2000 })
  ],
  laterOnProjects: [
    { id: "work", name: "工作", createdAt: 1 },
    { id: "reading", name: "阅读", createdAt: 2 }
  ],
  laterOnActiveProject: "all",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true,
  // 用户此刻正在读的就是 w1
  laterOnCurrentItem: "w1"
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
window.scrollTo = () => {};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const cardOf = (id) => document.querySelector(`#cardGrid .card[data-id="${id}"]`);
// 高亮的完整表现：is-current 类（橙色描边）+ data-current-label（「正在读」角标文案）
const isCurrent = (id) => {
  const card = cardOf(id);
  return !!card && card.classList.contains("is-current") && card.dataset.currentLabel === "正在读";
};
const currentCards = () => [...document.querySelectorAll("#cardGrid .card.is-current")].map((card) => card.dataset.id);

async function search(word) {
  const input = document.querySelector("#searchInput");
  input.value = word;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(220);
}

(async () => {
  window.eval(i18nSource);
  require("./helpers/item-mutation")(window);
  window.eval(librarySource);
  await tick(60);

  console.log("── 基线：首屏就带高亮 ──");
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(80);
  check("（准备）工作项目里是 w1", cardOf("w1") !== null);
  check("首屏 w1 就是「正在读」高亮", isCurrent("w1"), cardOf("w1")?.className || "(没有卡片)");

  console.log("\n── 切到别的项目再切回来：卡片被销毁重建，高亮不能丢 ──");
  click(document.querySelector('#projectList .project-nav[data-project="reading"]'));
  await tick(80);
  check("（准备）阅读项目里只有 r1，w1 的卡片已被销毁", cardOf("w1") === null && cardOf("r1") !== null);
  check("（准备）此刻没有任何卡片被误标成高亮", currentCards().length === 0, currentCards().join(","));

  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(80);
  check("切回工作：w1 的卡片重建了", cardOf("w1") !== null);
  check("切回工作：重建的卡片仍然是「正在读」高亮", isCurrent("w1"), cardOf("w1")?.className || "(没有卡片)");
  check("切回工作：只有一张卡片带高亮", currentCards().join(",") === "w1", currentCards().join(","));

  console.log("\n── 搜索把当前这篇过滤掉再清空 ──");
  await search("Beta");
  check("（准备）搜 Beta 时 w1 不在列表里", cardOf("w1") === null && cardOf("r1") !== null);
  await search("");
  await tick(80);
  check("清空搜索后 w1 回来了", cardOf("w1") !== null);
  check("清空搜索后 w1 仍带高亮", isCurrent("w1"), cardOf("w1")?.className || "(没有卡片)");

  console.log("\n── 换一篇正在读：高亮转移，旧卡清干净 ──");
  // 回到「工作」项目：w1 与 w2 在同一个视图里，才谈得上「这一张转给那一张」。
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(80);
  check("（准备）工作项目里两张卡都在", cardOf("w1") && cardOf("w2"), currentCards().join(","));
  changeListeners.forEach((fn) => fn({ laterOnCurrentItem: { newValue: "w2" } }, "local"));
  await tick(80);
  check("换到 w2 后只有 w2 带高亮", currentCards().join(",") === "w2", currentCards().join(","));
  check("换到 w2 后 w1 的高亮被清掉", !isCurrent("w1"), cardOf("w1")?.className || "(没有卡片)");

  console.log("\n── 清空「正在读」：所有高亮都要摘掉 ──");
  changeListeners.forEach((fn) => fn({ laterOnCurrentItem: { newValue: null } }, "local"));
  await tick(80);
  check("清空后没有任何卡片带高亮", currentCards().length === 0, currentCards().join(","));

  console.log("\n── 页面没有报错 ──");
  check("控制台无异常", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log(`\n${failures === 0 ? "🎉 全部通过" : `❌ ${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
