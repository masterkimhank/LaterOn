// 卡片上的「收藏时：…」那一行。
// 目的：网站几天后改了标题、或者视频下架换成一句失效提示时，收藏里的标题会被更新成
// 新的那一条；当初看到的那一条必须仍然看得见，用户才能想起点开的到底是什么。
// 覆盖：
//  1) 两版标题不同 → 卡片上多一行「收藏时：原来的标题」
//  2) 两版相同 → 不占位（不显示，也不留空白）
//  3) 快照是网址/域名兜底值时 → 不显示（那不是标题）
//  4) 搜索能命中「收藏时的原标题」（用户记住的往往还是当初那一条）
//  5) 侧栏列表同一套规则
//  6) 改完标题（title 变了）后，卡片上那一行会跟着同步
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
const item = (id, extra) => ({
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "bilibili.com", url: `https://example.com/${id}`, savedAt: now, status: "unread", ...extra
});

// ── 全屏收藏库 ────────────────────────────────────────────────
function makeLibrary(items) {
  const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "chrome-extension://lateron/library.html",
    virtualConsole
  });
  const { window } = dom;
  const store = {
    laterOnItems: items,
    laterOnProjects: [],
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
          if (typeof keys === "string") return Promise.resolve({ [keys]: store[keys] });
          const list = Array.isArray(keys) ? keys : Object.keys(store);
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
        },
        remove: (key) => { delete store[key]; return Promise.resolve(); }
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) }
    },
    tabs: {
      query: () => Promise.resolve([]),
      get: () => Promise.reject(new Error("no tab")),
      update: () => Promise.resolve({}),
      remove: () => Promise.resolve(),
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    runtime: {
      getURL: (p) => `chrome-extension://lateron/${p}`,
      sendMessage: () => Promise.resolve({ ok: true }),
      onMessage: { addListener() {} }
    }
  };
  if (typeof window.crypto?.randomUUID !== "function") {
    Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
  }
  window.scrollTo = () => {};
  ["i18n.js", "dialog.js", "url-utils.js", "tab-navigation.js"].forEach((file) => {
    window.eval(fs.readFileSync(`${ROOT}/${file}`, "utf8"));
  });
  require("./helpers/item-mutation")(window);
  window.eval(fs.readFileSync(`${ROOT}/library.js`, "utf8"));
  return { window, store, changeListeners };
}

// ── 侧栏 ──────────────────────────────────────────────────────
function makeSidepanel(items) {
  const html = fs.readFileSync(`${ROOT}/sidepanel.html`, "utf8");
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "chrome-extension://lateron/sidepanel.html",
    virtualConsole
  });
  const { window } = dom;
  const store = {
    laterOnItems: items,
    laterOnProjects: [],
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
          if (typeof keys === "string") return Promise.resolve({ [keys]: store[keys] });
          const list = Array.isArray(keys) ? keys : Object.keys(store);
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
        },
        remove: (key) => { delete store[key]; return Promise.resolve(); }
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) }
    },
    tabs: {
      getCurrent: () => Promise.resolve({ id: 1, windowId: 7, active: true, url: "https://current.com" }),
      query: () => Promise.resolve([{ id: 1, windowId: 7, active: true, url: "https://current.com" }]),
      update: () => Promise.resolve({}),
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
  window.scrollTo = () => {};
  require("./helpers/item-mutation")(window);
  window.eval(fs.readFileSync(`${ROOT}/i18n.js`, "utf8"));
  window.eval(fs.readFileSync(`${ROOT}/sidepanel.js`, "utf8"));
  return { window, store, changeListeners };
}

const items = [
  // 标题已经被网站改成失效提示，原话留在快照里
  item("a1", { title: "视频去哪了呢？", titleAtSave: "当初看的那个视频：手把手教你做面包" }),
  // 两版一致：不该多出这一行
  item("a2", { title: "一直没变过的标题", titleAtSave: "一直没变过的标题" }),
  // 快照是网址兜底值：不是标题，不显示
  item("a3", { title: "没抓到标题时的一篇", titleAtSave: "https://example.com/a3" }),
  // 老数据：压根没有快照
  item("a4", { title: "老数据没有快照" })
];

(async () => {
  const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

  // ── 全屏收藏库 ─────────────────────────────────────────────
  console.log("── 全屏收藏库 ──");
  const lib = makeLibrary(items);
  await tick(160);
  const { document } = lib.window;
  // 首页是「项目概览」视图；点进「等待整理」才是一张张卡片。
  document.querySelector('.project-nav[data-project="unfiled"]').dispatchEvent(
    new lib.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await tick(160);
  const cardOf = (id) => document.querySelector(`#cardGrid .card[data-id="${id}"]`);
  const lineOf = (id) => cardOf(id)?.querySelector(".title-at-save");

  check("（准备）四张卡片都渲染出来了", ["a1", "a2", "a3", "a4"].every((id) => !!cardOf(id)));
  check("标题变了的那一篇，卡片上多一行「收藏时：…」",
    lineOf("a1")?.textContent === "收藏时：当初看的那个视频：手把手教你做面包", lineOf("a1")?.textContent);
  check("这一行是可见的（不是 hidden）", lineOf("a1")?.hidden === false);
  check("两版一致时不显示", lineOf("a2")?.hidden === true, String(lineOf("a2")?.hidden));
  check("快照是网址时不显示", lineOf("a3")?.hidden === true, String(lineOf("a3")?.hidden));
  check("没有快照的老数据不显示", lineOf("a4")?.hidden === true, String(lineOf("a4")?.hidden));
  check("这一行在标题下面、摘要上面",
    cardOf("a1").querySelector(".title-link").nextElementSibling === lineOf("a1"));

  // 搜索能命中旧标题
  const searchInput = document.querySelector("#searchInput");
  searchInput.value = "做面包";
  searchInput.dispatchEvent(new lib.window.Event("input", { bubbles: true }));
  await tick(260);
  const visibleIds = [...document.querySelectorAll("#cardGrid .card")].map((el) => el.dataset.id);
  check("搜「收藏时的原标题」里的词也能找到它", visibleIds.includes("a1"), visibleIds.join(","));

  searchInput.value = "";
  searchInput.dispatchEvent(new lib.window.Event("input", { bubbles: true }));
  await tick(260);

  // 改完标题后这一行要跟着变
  console.log("\n── 标题被改掉以后 ──");
  lib.store.laterOnItems = lib.store.laterOnItems.map((entry) =>
    entry.id === "a2" ? { ...entry, title: "被网站换掉的新标题" } : entry
  );
  lib.changeListeners.forEach((fn) => fn({ laterOnItems: { newValue: lib.store.laterOnItems } }, "local"));
  await tick(160);
  check("标题变了以后同样补出「收藏时：…」",
    lineOf("a2")?.textContent === "收藏时：一直没变过的标题" && lineOf("a2")?.hidden === false,
    lineOf("a2")?.textContent);
  check("第一张卡片的标题本身也换成了新的",
    cardOf("a2")?.querySelector(".title-link h2")?.textContent === "被网站换掉的新标题",
    cardOf("a2")?.querySelector(".title-link h2")?.textContent);

  // ── 侧栏 ───────────────────────────────────────────────────
  console.log("\n── 侧栏 ──");
  const panel = makeSidepanel(items);
  await tick(200);
  const pdoc = panel.window.document;
  const rowOf = (id) => pdoc.querySelector(`#items .item[data-id="${id}"]`);
  const plineOf = (id) => rowOf(id)?.querySelector(".title-at-save");
  check("（准备）四条都渲染出来了", ["a1", "a2", "a3", "a4"].every((id) => !!rowOf(id)),
    [...pdoc.querySelectorAll("#items .item")].map((el) => el.dataset.id).join(","));
  check("侧栏同样显示「收藏时：…」",
    plineOf("a1")?.textContent === "收藏时：当初看的那个视频：手把手教你做面包", plineOf("a1")?.textContent);
  check("侧栏两版一致时不显示", plineOf("a2")?.hidden === true, String(plineOf("a2")?.hidden));
  check("侧栏快照是网址时不显示", plineOf("a3")?.hidden === true, String(plineOf("a3")?.hidden));
  check("侧栏这一行在标题下面", rowOf("a1").querySelector("h2").nextElementSibling === plineOf("a1"));

  console.log(failures === 0 ? "\n全部检查通过 🎉" : `\n有 ${failures} 项失败`);
  if (failures) process.exitCode = 1;
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("测试脚本自身出错：", error);
  process.exitCode = 1;
  process.exit(1);
});
