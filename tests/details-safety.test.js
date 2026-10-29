// 「顺手写回」不能把老数据的摘要弄丢。
//
// 索引里已经不存 description / image（见 item-store.js），所以任何「把整个索引写回去」的地方
// 都必须走 ItemStore.writePatch：它会在同一次 set 里把剥下来的摘要 / 封面落进详情表。
// 只写索引的老写法（`set({ laterOnItems: ItemStore.indexOf(items) })`）读上去完全正常，
// 但会把还没搬家的老摘要直接抹掉，而且不报错。这里把两处盯住：
//   ① 后台 1.14.0 那次「清理旧正文」（cleanupLegacyContent）
//   ② 收藏库初始化时补写 doneAt（library.js init）
// 运行：NODE_PATH=<jsdom 路径> node tests/details-safety.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
}

// ── ① 后台：清理旧正文时不许顺手删摘要 ──────────────────────
async function partBackground() {
  console.log("\n── ① 清理旧正文（background.cleanupLegacyContent）──");
  const event = () => ({ addListener() {} });
  const store = {
    laterOnItems: [{
      id: "legacy-1", title: "带正文的老条目", url: "https://example.com/old",
      contentHtml: "<p>一千字的正文</p>", wordCount: 1000,
      description: "老数据里的摘要", image: "https://img/old.jpg", savedAt: 1, status: "unread"
    }],
    laterOnSettings: {}
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const names = [].concat(keys);
          return clone(Object.fromEntries(names.filter((k) => k in store).map((k) => [k, store[k]])));
        },
        async set(patch) { Object.assign(store, clone(patch)); },
        async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
      },
      onChanged: event()
    },
    alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
    commands: { onCommand: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (p) => `chrome-extension://fixture/${p}` },
    tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
    action: {}, sidePanel: { setPanelBehavior() {} }
  };
  const ctx = vm.createContext({
    chrome, console, URL, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {}
  });
  vm.runInContext(read("item-store.js"), ctx);
  vm.runInContext(read("url-utils.js"), ctx);
  vm.runInContext(read("background.js"), ctx);
  await new Promise((done) => setTimeout(done, 20));

  await ctx.cleanupLegacyContent();
  const index = store.laterOnItems[0];
  const detail = store.laterOnItemDetails?.["legacy-1"] || {};
  check("旧正文被清掉", !("contentHtml" in index) && !("wordCount" in index), Object.keys(index).join(","));
  check("索引里不再留摘要 / 封面", !("description" in index) && !("image" in index), Object.keys(index).join(","));
  check("摘要搬进了详情表（没有被顺手删掉）", detail.description === "老数据里的摘要", String(detail.description));
  check("封面也搬进了详情表", detail.image === "https://img/old.jpg", String(detail.image));
}

// ── ② 收藏库：初始化补 doneAt 时不许顺手删摘要 ───────────────
async function partLibrary() {
  console.log("\n── ② 补写 doneAt（library.js init）──");
  const dom = new JSDOM(read("library.html"), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "chrome-extension://lateron/library.html"
  });
  const { window } = dom;
  const { document } = window;
  const now = Date.now();
  // 典型的老数据：索引里既有摘要与封面，又有一条 done 但没有 doneAt（本版本之前标的）。
  const store = {
    laterOnItems: [{
      id: "legacy-2", title: "老收藏", url: "https://example.com/legacy",
      description: "老收藏的摘要", image: "https://img/legacy.jpg",
      favicon: "", source: "example.com", projectId: null,
      savedAt: now - 5000, read: true, status: "done"
    }],
    laterOnProjects: [],
    laterOnActiveProject: "unfiled",
    laterOnSettings: {},
    laterOnFilter: "all",
    laterOnFilterChosen: true
  };
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of names) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        },
        async set(patch) {
          for (const [key, value] of Object.entries(patch)) store[key] = JSON.parse(JSON.stringify(value));
        }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, active: true }],
      getCurrent: async () => ({ id: 1, windowId: 1 }),
      update: async () => ({}), create: async () => ({})
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    runtime: { getURL: (file) => `chrome-extension://lateron/${file}`, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    sidePanel: { open: async () => true }
  };
  window.scrollTo = () => {};

  window.eval(read("i18n.js"));
  window.eval(read("dialog.js"));
  window.eval(read("item-store.js"));
  window.eval(read("library.js"));
  await new Promise((done) => window.setTimeout(done, 120));
  // 首页是「全部项目」的图板，钻进某个范围才会铺卡片列表。
  document.querySelector('.project-nav[data-project="unfiled"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((done) => window.setTimeout(done, 60));

  const index = store.laterOnItems[0];
  const detail = store.laterOnItemDetails?.["legacy-2"] || {};
  check("补齐的 doneAt 写回了存储", Number(index.doneAt) > 0, String(index.doneAt));
  check("写回后索引里不再带摘要 / 封面",
    !("description" in index) && !("image" in index), Object.keys(index).join(","));
  check("摘要搬进了详情表（没有被顺手删掉）", detail.description === "老收藏的摘要", String(detail.description));
  check("封面也搬进了详情表", detail.image === "https://img/legacy.jpg", String(detail.image));
  check("卡片照旧画得出来", !!document.querySelector('.card[data-id="legacy-2"]'));
}

(async () => {
  await partBackground();
  await partLibrary();
  if (failed) {
    console.error(`\n${failed} 项失败`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS 老数据的摘要不会在「顺手写回」时被丢掉");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
