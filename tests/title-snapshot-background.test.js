// 「收藏时看到的标题」不能被后来的标题顶掉。
// 真实场景（用户报的那一条）：B 站某个视频，收藏当时标题好好的；几天后视频下架，
// 再收藏一次（或标签页已经被 Chrome 回收、只能靠服务端补信息），网站给回来的标题
// 已经变成「视频去哪了呢？」——原来那条真标题就此消失，用户再也想不起当初看的是什么。
// 这里把这几个关口都钉住：
//  1) 服务端兜底：页面/标签页上还是好标题时，不许拿「失效页提示」覆盖它
//  2) 重复收藏：同样不许用失效页标题替换已经存好的标题
//  3) 真发生了替换时，原来那条要留进 titleAtSave（界面上「收藏时：…」那一行）
//  4) 老数据重复收藏时补 titleAtSave，要用「已经存下来的那条」，不是这次抓到的那条
//  5) 正常情况照旧：更干净的标题依然会替换、更完整的信息依然会补
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const { URL } = require("url");

const SOURCE = path.resolve(__dirname, "..", "background.js");
const src = fs.readFileSync(SOURCE, "utf8");

const BILI_URL = "https://www.bilibili.com/video/BV1KW4y1m7B8/?spm_id_from=333.337.search-card.all.click";
const GONE_TITLE = "视频去哪了呢？_哔哩哔哩_bilibili";

const store = { laterOnItems: [], laterOnSettings: {} };
const session = {};

// 每个标签页「这一刻浏览器里显示的标题」+ 「页面自己写的标题」。
// 注入失败（injectFails）时不提供页面数据，让后台退回标签页标题——
// 这正是 Chrome 回收标签页内存、或页面卡住时的真实形态。
const tabsById = new Map();

// 服务器对某个网址返回的 og 标签（服务端兜底那条路）。
const serverMetaByUrl = new Map();

function makeTab(id, url, title, extra = {}) {
  const tab = {
    id, url, title, windowId: 1, active: true, status: "complete", discarded: false,
    favIconUrl: "https://www.bilibili.com/favicon.ico", ...extra
  };
  tabsById.set(id, tab);
  return tab;
}

// 把一份 og 标签拼成服务器返回的 HTML。
function htmlResponse(meta) {
  const tags = [
    meta.title ? `<meta property="og:title" content="${meta.title}">` : "",
    meta.description ? `<meta property="og:description" content="${meta.description}">` : "",
    `<title>${meta.title || ""}</title>`
  ].join("");
  const body = Buffer.from(`<!doctype html><html><head>${tags}</head><body></body></html>`, "utf8");
  return {
    ok: true,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "") },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    }
  };
}

function fakeFetch(url) {
  const meta = serverMetaByUrl.get(String(url));
  if (!meta) return Promise.resolve({ ok: false, headers: { get: () => "" } });
  return Promise.resolve(htmlResponse(meta));
}

const chrome = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const out = {};
          keys.forEach((k) => { out[k] = store[k]; });
          return out;
        }
        return { ...store };
      },
      async set(patch) { Object.assign(store, patch); },
      async remove(key) { delete store[key]; }
    },
    session: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: session[keys] };
        return { ...session };
      },
      async set(patch) { Object.assign(session, patch); },
      async remove(key) { delete session[key]; }
    },
    onChanged: { addListener() {} }
  },
  tabs: {
    query: () => Promise.resolve([...tabsById.values()].filter((tab) => tab.active)),
    get: (id) => (tabsById.has(id) ? Promise.resolve(tabsById.get(id)) : Promise.reject(new Error("no tab"))),
    update: async () => {},
    onUpdated: { addListener() {} },
    onRemoved: { addListener() {} },
    onCreated: { addListener() {} }
  },
  windows: { get: async () => ({ left: 0, top: 0, width: 1440, height: 900 }), create: async () => ({ id: 1 }), remove: async () => {} },
  scripting: {
    insertCSS: async () => {},
    executeScript(options) {
      const tab = tabsById.get(options.target?.tabId);
      // 页面内的提示药丸（带 args）
      if (Array.isArray(options.args)) return Promise.resolve([{ result: undefined }]);
      if (!options.files?.includes("content-metadata.js")) return Promise.resolve([{ result: undefined }]);
      if (!tab || tab.pageFails) return Promise.reject(new Error("no tab"));
      return Promise.resolve([{
        result: {
          title: tab.pageTitle || "",
          titleFrom: "page-title",
          description: "",
          image: "",
          imageFrom: "none",
          favicon: "",
          source: new URL(tab.url).hostname,
          url: tab.url
        }
      }]);
    }
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
  contextMenus: { removeAll: (cb) => cb && cb(), create() {}, onClicked: { addListener() {} } },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: async () => undefined,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} }
  },
  commands: { onCommand: { addListener() {} } }
};

const sandbox = {
  chrome, crypto: webcrypto, URL, TextDecoder, TextEncoder, Uint8Array, Buffer,
  setTimeout, clearTimeout, console, Date, Promise, JSON, Set, Map,
  fetch: fakeFetch,
  importScripts() {},
  LaterOnUrl: { normalize(value) { try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return String(value || ""); } } }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "background.js" });

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const saved = (url) => store.laterOnItems.find((entry) => entry.url === url);

(async () => {
  // ── ① 服务端兜底：不许用「失效页标题」覆盖页面上的真标题 ────────
  console.log("── ① 页面还给得出真标题，服务端却已经变成失效页 ──");
  serverMetaByUrl.set(BILI_URL, { title: GONE_TITLE, description: "该视频已失效" });
  const biliTab = makeTab(7, BILI_URL, "【原创】这就是当时看的那个视频_哔哩哔哩_bilibili", { pageFails: true });
  await sandbox.quickSave(biliTab, "shortcut");
  const biliItem = saved(BILI_URL);
  check("收藏标题仍是浏览器里那一条（没被「视频去哪了呢」顶掉）",
    biliItem?.title === "【原创】这就是当时看的那个视频_哔哩哔哩_bilibili", biliItem?.title);
  check("失效页文案没有混进标题", !/视频去哪了/.test(biliItem?.title || ""), biliItem?.title);
  check("「收藏时看到的标题」也记下了同一条", biliItem?.titleAtSave === biliItem?.title, biliItem?.titleAtSave);

  // ── ② 对照组：真需要兜底时照旧兜底 ────────────────────────────
  console.log("\n── ② 对照组：标签页标题只是站点通用名，服务端有正经标题 ──");
  const TOPBOOK_URL = "https://topbook.cc/article/2018";
  serverMetaByUrl.set(TOPBOOK_URL, { title: "AI 沟通技巧系列 ② 构建启发式 AI", description: "正文摘要" });
  const topTab = makeTab(8, TOPBOOK_URL, "Topbook - 工具、技术和数字生活", { pageFails: true });
  await sandbox.quickSave(topTab, "shortcut");
  const topItem = saved(TOPBOOK_URL);
  check("标题仍然由服务端补全（兜底能力没被削弱）",
    topItem?.title === "AI 沟通技巧系列 ② 构建启发式 AI", topItem?.title);
  check("同时留着浏览器里那个通用标题，方便对照",
    topItem?.titleAtSave === "Topbook - 工具、技术和数字生活", topItem?.titleAtSave);
  check("两版不同，界面才有「收藏时：…」可显示", topItem?.titleAtSave !== topItem?.title);

  // ── ③ 重复收藏：不许用失效页标题替换已存好的标题 ───────────────
  console.log("\n── ③ 几天后再收藏一次，网站只剩失效提示 ──");
  const beforeTitle = biliItem.title;
  const beforeSnapshot = biliItem.titleAtSave;
  const goneTab = makeTab(9, BILI_URL, GONE_TITLE, { pageTitle: "视频去哪了呢？" });
  await sandbox.quickSave(goneTab, "shortcut");
  const afterGone = saved(BILI_URL);
  check("标题没有被换成失效提示", afterGone.title === beforeTitle, afterGone.title);
  check("快照也没被动过", afterGone.titleAtSave === beforeSnapshot, afterGone.titleAtSave);

  // ── ④ 真要替换时，旧标题必须留作快照 ──────────────────────────
  console.log("\n── ④ 新标题确实更干净：替换，但旧标题进快照 ──");
  const SPAI_URL = "https://sspai.com/post/1";
  store.laterOnItems = [{ id: "sp1", title: "帖子标题 - 少数派", description: "摘要", image: "", favicon: "", source: "sspai.com", projectId: null, url: SPAI_URL, savedAt: 1, status: "unread" }];
  const spaiTab = makeTab(10, SPAI_URL, "帖子标题", { pageTitle: "帖子标题" });
  await sandbox.quickSave(spaiTab, "shortcut");
  const spaiItem = saved(SPAI_URL);
  check("标题换成了更干净的那一条", spaiItem.title === "帖子标题", spaiItem.title);
  check("旧标题进了 titleAtSave（界面据此显示「收藏时：…」）",
    spaiItem.titleAtSave === "帖子标题 - 少数派", spaiItem.titleAtSave);

  // ── ⑤ 老数据（没有 titleAtSave）重复收藏时怎么补 ────────────────
  console.log("\n── ⑤ 老数据补快照：用「已经存下来的那条」 ──");
  const LEGACY_URL = "https://www.bilibili.com/video/BV1legacy";
  store.laterOnItems = [{ id: "lg1", title: "当初收藏时记下的标题", description: "摘要", image: "", favicon: "", source: "bilibili.com", projectId: null, url: LEGACY_URL, savedAt: 1, status: "unread" }];
  serverMetaByUrl.set(LEGACY_URL, { title: GONE_TITLE });
  const legacyTab = makeTab(11, LEGACY_URL, GONE_TITLE, { pageTitle: "视频去哪了呢？" });
  await sandbox.quickSave(legacyTab, "shortcut");
  const legacyItem = saved(LEGACY_URL);
  check("标题保持不变", legacyItem.title === "当初收藏时记下的标题", legacyItem.title);
  check("快照补的是老标题，不是这次抓到的失效提示",
    legacyItem.titleAtSave === "当初收藏时记下的标题", legacyItem.titleAtSave);

  // ── ⑥ 快照只认第一次：后来的标题再变也不覆盖它 ─────────────────
  console.log("\n── ⑥ 快照一旦有了就不再改（第一次看到的最有回忆价值） ──");
  const FIRST_URL = "https://www.bilibili.com/video/BV1first";
  store.laterOnItems = [{ id: "f1", title: "第一版标题", titleAtSave: "第一版标题", description: "摘要", image: "", favicon: "", source: "bilibili.com", projectId: null, url: FIRST_URL, savedAt: 1, status: "unread" }];
  const secondTab = makeTab(12, FIRST_URL, "第二版标题", { pageTitle: "第二版标题 - 少数派" });
  await sandbox.quickSave(secondTab, "shortcut");
  const firstItem = saved(FIRST_URL);
  check("快照仍然是第一版", firstItem.titleAtSave === "第一版标题", firstItem.titleAtSave);

  // ── ⑦ 别把真标题误判成失效页 ──────────────────────────────────
  console.log("\n── ⑦ 失效页识别不能误伤正常标题 ──");
  const notGone = [
    "如何恢复已删除的照片",
    "404 错误页该怎么做才不丢用户",
    "视频剪辑入门：从素材整理到成片",
    "Page Not Found 页面的设计要点"
  ];
  notGone.forEach((title) => {
    check(`不算失效页：${title}`, sandbox.looksGoneTitle(title) === false, String(sandbox.looksGoneTitle(title)));
  });
  ["视频去哪了呢？", "页面不存在", "404", "This page isn't available", "该内容已下架"].forEach((title) => {
    check(`算失效页：${title}`, sandbox.looksGoneTitle(title) === true, String(sandbox.looksGoneTitle(title)));
  });

  console.log(failures === 0 ? "\n全部检查通过 🎉" : `\n有 ${failures} 项失败`);
  if (failures) process.exitCode = 1;
})().catch((error) => {
  console.error("测试脚本自身出错：", error);
  process.exitCode = 1;
});
