// 增量更新（P0-6）：700 条时点一下「标为已读」只该动 1 张卡，而不是全量重绘。
// 覆盖：
//  1) diffItemsForIncremental：纯展示字段（title/description/image）变化 → safe，返回 changedIds
//  2) 增删条目 → 不安全（safe:false）
//  3) status / projectId / savedAt / source 变化 → 不安全（会影响筛选或排序）
//  4) onChanged 收到纯展示变化时，只 updateCard 受影响的那张，不整页 render
//  5) onChanged 收到 status 变化时，走全量 render（卡片集合会变）
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const now = Date.now();
let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 30) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
const item = (id, extra) => ({
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "example.com", url: `https://example.com/${id}`, savedAt: now, status: "unread", ...extra
});

// ── 纯函数层：diffItemsForIncremental ──────────────────────
(function testDiff() {
  const src = fs.readFileSync(path.join(ROOT, "library.js"), "utf8");
  // 把常量声明和函数一起切出来（函数里引用了 COLLECTION_AFFECTING_FIELDS）。
  const constStart = src.indexOf("const COLLECTION_AFFECTING_FIELDS");
  const fnStart = src.indexOf("function diffItemsForIncremental");
  const rest = src.slice(fnStart + "function diffItemsForIncremental".length);
  const fnEnd = rest.indexOf("\nfunction ") + 1;
  const fnSrc = "function diffItemsForIncremental" + rest.slice(0, fnEnd);
  const constSrc = src.slice(constStart, fnStart);
  const vm = require("vm");
  const ctx = vm.createContext({});
  vm.runInContext(constSrc + "\n" + fnSrc, ctx);
  const diff = ctx.diffItemsForIncremental;

  const base = [item("a"), item("b"), item("c")];
  const baseObj = (over) => ({ a: item("a"), b: item("b"), c: item("c"), ...over });

  console.log("── diffItemsForIncremental ──");

  let r = diff(base, base);
  check("完全没变 → safe 且 changedIds 空", r.safe && r.changedIds.size === 0, JSON.stringify(r));

  const onlyTitle = [item("a", { title: "新标题" }), item("b"), item("c")];
  r = diff(base, onlyTitle);
  check("只改标题 → safe，changedIds 含 a", r.safe && r.changedIds.size === 1 && r.changedIds.has("a"), [...r.changedIds]);

  const onlyDesc = [item("a", { description: "新摘要" }), item("b"), item("c")];
  r = diff(base, onlyDesc);
  check("只改摘要 → safe，changedIds 含 a", r.safe && r.changedIds.has("a"), JSON.stringify(r));

  const onlyImage = [item("a", { image: "https://x/y.jpg" }), item("b"), item("c")];
  r = diff(base, onlyImage);
  check("只改封面 → safe，changedIds 含 a", r.safe && r.changedIds.has("a"), JSON.stringify(r));

  const deleted = [item("a"), item("b")];
  r = diff(base, deleted);
  check("删一条 → 不安全", r.safe === false, JSON.stringify(r));

  const added = [...base, item("d")];
  r = diff(base, added);
  check("加一条 → 不安全", r.safe === false, JSON.stringify(r));

  const statusChanged = [item("a", { status: "done", doneAt: now }), item("b"), item("c")];
  r = diff(base, statusChanged);
  check("改 status → 不安全（影响未读/已读筛选）", r.safe === false, JSON.stringify(r));

  const projectChanged = [item("a", { projectId: "work" }), item("b"), item("c")];
  r = diff(base, projectChanged);
  check("改 projectId → 不安全（影响项目筛选）", r.safe === false, JSON.stringify(r));

  const savedAtChanged = [item("a", { savedAt: now + 999 }), item("b"), item("c")];
  r = diff(base, savedAtChanged);
  check("改 savedAt → 不安全（影响时间排序）", r.safe === false, JSON.stringify(r));

  const sourceChanged = [item("a", { source: "other.com" }), item("b"), item("c")];
  r = diff(base, sourceChanged);
  check("改 source → 不安全（影响按来源排序）", r.safe === false, JSON.stringify(r));

  r = diff(null, base);
  check("旧值是 null → 不安全", r.safe === false, JSON.stringify(r));

  r = diff([], []);
  check("两个空数组 → safe（没变化，不触发）", r.safe && r.changedIds.size === 0, JSON.stringify(r));
})();

// ── 集成层：onChanged 分支行为 ─────────────────────────────
(async () => {
  const html = fs.readFileSync(path.join(ROOT, "library.html"), "utf8");
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "chrome-extension://lateron/library.html?from=sidepanel&project=unfiled",
    virtualConsole: vc
  });
  const { window } = dom;
  const store = {
    laterOnItems: [item("a"), item("b"), item("c")],
    laterOnProjects: [],
    laterOnActiveProject: "unfiled",
    laterOnSettings: {},
    laterOnFilter: "unread",
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
        set(patch) { Object.assign(store, patch); return Promise.resolve(); }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    },
    tabs: {
      query: () => Promise.resolve([]), get: () => Promise.reject(new Error("x")),
      update: () => Promise.resolve({}), remove: () => Promise.resolve(),
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} }
    },
    runtime: { getURL: (p) => p, sendMessage: () => Promise.resolve({ ok: true }), onMessage: { addListener() {} } }
  };
  if (typeof window.crypto?.randomUUID !== "function") {
    Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
  }
  window.scrollTo = () => {};
  window.requestIdleCallback = (fn) => { window.setTimeout(fn, 0); return 0; };
  window.cancelIdleCallback = () => {};
  for (const f of ["i18n.js", "dialog.js", "url-utils.js", "tab-navigation.js"]) window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  require("./helpers/item-mutation")(window);
  window.eval(fs.readFileSync(path.join(ROOT, "library.js"), "utf8"));
  await tick(120);

  const titleOf = (id) => window.document.querySelector(`#cardGrid .card[data-id="${id}"] .title-link h2`)?.textContent;

  console.log("\n── onChanged 增量分支 ──");
  check("首屏三张卡都在", window.document.querySelectorAll("#cardGrid .card").length === 3, String(window.document.querySelectorAll("#cardGrid .card").length));

  // 记下标题 DOM 节点，验证「只改标题」时其它卡不被重建（同一 DOM 节点引用不变）
  const cardBNode = window.document.querySelector('#cardGrid .card[data-id="b"]');
  const cardCNode = window.document.querySelector('#cardGrid .card[data-id="c"]');

  // 模拟后台改了 a 的标题（纯展示字段）
  const nextTitle = [...store.laterOnItems];
  nextTitle[0] = { ...nextTitle[0], title: "改过的标题 A" };
  changeListeners.forEach((fn) => fn({ laterOnItems: { oldValue: store.laterOnItems, newValue: nextTitle } }, "local"));
  store.laterOnItems = nextTitle; // 同步 store，模拟真实 storage 已被写入
  await tick(80);

  check("a 的标题更新了", titleOf("a") === "改过的标题 A", titleOf("a"));
  check("b 的卡片节点没被重建（复用）", window.document.querySelector('#cardGrid .card[data-id="b"]') === cardBNode, "同引用");
  check("c 的卡片节点没被重建（复用）", window.document.querySelector('#cardGrid .card[data-id="c"]') === cardCNode, "同引用");
  check("卡片总数没变", window.document.querySelectorAll("#cardGrid .card").length === 3, String(window.document.querySelectorAll("#cardGrid .card").length));

  // 模拟后台把 b 标为已读（status 变化 → 走全量）
  const statusChanged = store.laterOnItems.map((it) => it.id === "b" ? { ...it, status: "done", doneAt: now } : it);
  changeListeners.forEach((fn) => fn({ laterOnItems: { oldValue: store.laterOnItems, newValue: statusChanged } }, "local"));
  store.laterOnItems = statusChanged;
  await tick(80);
  // 「未读」筛选下，status 变 done 的 b 必须从列表消失。
  // 只有全量 render 会重新按 filter 过滤；若被误判为增量（只 updateCard），
  // b 的卡片会赖在「未读」列表里不消失——这正是这条测试要抓的回归。
  const bAfter = window.document.querySelector('#cardGrid .card[data-id="b"]');
  check("「未读」筛选下 status 变已读后，b 从列表消失", bAfter === null, "b 卡片仍存在");

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
