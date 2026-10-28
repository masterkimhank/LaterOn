// 侧栏的「正在读」高亮，在条目被筛掉又重建以后必须还在。
//
// ⚠️ 先说清定位：这是一条**护栏测试**，不是回归测试。
// 侧栏目前不会丢高亮，因为 renderSlice() 每画一条都会顺带写一次
// `article.classList.toggle("is-current", item.id === currentItemId)`。
// 也就是说 applyCurrentAndLocate() 里那段「prev !== next 才设置」的写法，
// 现在是被上面那行顺手兜住了 —— 属于隐式依赖。
//
// 一旦有人觉得 renderSlice 里那两行「和 applyCurrentAndLocate 重复」而删掉，
// 就会退化成真 bug（全屏页 library.js 就是这种情况，见 current-highlight-persist.test.js）：
// renderSlice 开头有 `if (!visibleIds.has(id)) { article.remove(); itemMap.delete(id); }`，
// 当前在读的那篇被筛选排除后节点被销毁，切回来是新节点、不带 is-current，
// 而 currentItemId 没变 → 整段跳过 → 高亮永远补不上。
//
// 这条测试把「用户能看到的结果」钉住，将来重构时不会静默退化。
// 覆盖：
//  1) 首屏就带高亮（基线）
//  2) 切到「已读」把当前这篇筛掉，再切回「全部」，高亮必须回来
//  3) 搜索把当前这篇滤掉再清空，高亮必须回来
//  4) 换一篇正在读，高亮正确转移
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/sidepanel.html`, "utf8");
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
  source: "未知", url: `https://example.com/${id}`, savedAt: now, read: false, ...extra
});
const store = {
  laterOnItems: [
    item("a1", { title: "Alpha 深度工作法", projectId: "work" }),
    item("a2", { title: "Beta 深度阅读", projectId: "work", savedAt: now - 1000 }),
    item("d1", { title: "Gamma 深度已完成", projectId: "work", savedAt: now - 2000, status: "done", read: true })
  ],
  laterOnProjects: [{ id: "work", name: "工作", createdAt: 1 }],
  laterOnActiveProject: "work",
  laterOnSettings: {},
  laterOnFilter: "all",
  laterOnFilterChosen: true,
  // 用户此刻正在读的就是 a1
  laterOnCurrentItem: "a1"
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
    // 当前标签页就是 a1 那一篇：侧栏会据此认定「正在读的就是 a1」。
    // （若指向一个没收藏过的网址，侧栏会主动清掉所有高亮——那是正确行为，但测不到这里要测的东西。）
    query: () => Promise.resolve([{ id: 1, windowId: 7, active: true, url: "https://example.com/a1" }]),
    update: () => Promise.resolve({ id: 1 }),
    create: () => Promise.resolve({ id: 9 }),
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} }
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: () => Promise.resolve({ ok: false, ready: true }),
    onMessage: { addListener() {} }
  }
};
if (typeof window.crypto?.randomUUID !== "function") {
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
}
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const cardOf = (id) => document.querySelector(`#items .item[data-id="${id}"]`);
const isCurrent = (id) => {
  const el = cardOf(id);
  return !!el && el.classList.contains("is-current") && el.dataset.currentLabel === "正在读";
};
const currentCards = () => [...document.querySelectorAll("#items .item.is-current")].map((el) => el.dataset.id);
const navOf = (filter) => document.querySelector(`.filter[data-filter="${filter}"]`);

async function search(word) {
  const input = document.querySelector("#searchInput");
  input.value = word;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(200);
}

require("./helpers/item-mutation")(window);
window.eval(fs.readFileSync(`${ROOT}/i18n.js`, "utf8"));
window.eval(sidepanelSource);

(async () => {
  await tick(80);

  console.log("── 基线：首屏就带高亮 ──");
  check("（准备）工作项目里三篇都在", ["a1", "a2", "d1"].every((id) => cardOf(id)), currentCards().join(","));
  check("首屏 a1 就是「正在读」高亮", isCurrent("a1"), cardOf("a1")?.className || "(没有条目)");

  console.log("\n── 切到「已读」把当前这篇筛掉，再切回来 ──");
  click(navOf("done"));
  await tick(60);
  check("（准备）只看已读时 a1 不在列表里", cardOf("a1") === null && cardOf("d1") !== null);
  check("（准备）此刻没有条目被误标成高亮", currentCards().length === 0, currentCards().join(","));
  click(navOf("all"));
  await tick(60);
  check("切回来 a1 的条目重建了", cardOf("a1") !== null);
  check("切回来 a1 仍是「正在读」高亮", isCurrent("a1"), cardOf("a1")?.className || "(没有条目)");
  check("切回来只有一条带高亮", currentCards().join(",") === "a1", currentCards().join(","));

  console.log("\n── 搜索把当前这篇滤掉再清空 ──");
  await search("Beta");
  check("（准备）搜 Beta 时 a1 不在列表里", cardOf("a1") === null && cardOf("a2") !== null);
  await search("");
  await tick(60);
  check("清空搜索后 a1 回来了", cardOf("a1") !== null);
  check("清空搜索后 a1 仍带高亮", isCurrent("a1"), cardOf("a1")?.className || "(没有条目)");

  console.log("\n── 换一篇正在读：高亮转移 ──");
  changeListeners.forEach((fn) => fn({ laterOnCurrentItem: { newValue: "a2" } }, "local"));
  await tick(60);
  check("换到 a2 后只有 a2 带高亮", currentCards().join(",") === "a2", currentCards().join(","));
  check("换到 a2 后 a1 的高亮被清掉", !isCurrent("a1"), cardOf("a1")?.className || "(没有条目)");

  console.log("\n── 清空「正在读」：所有高亮摘掉 ──");
  changeListeners.forEach((fn) => fn({ laterOnCurrentItem: { newValue: null } }, "local"));
  await tick(60);
  check("清空后没有条目带高亮", currentCards().length === 0, currentCards().join(","));

  console.log("\n── 页面没有报错 ──");
  check("控制台无异常", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log(`\n${failures === 0 ? "🎉 全部通过" : `❌ ${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
