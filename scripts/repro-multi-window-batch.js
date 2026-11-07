// 独立复现脚本 —— 刻意放在 scripts/ 下、不叫 *.test.js，因此不会被 scripts/test-all.js 收进去，
// 日常那 82 个测试仍旧全绿。
//
// 原缺陷：两个浏览器窗口先后触发「一键收藏所有标签页」时，
// laterOnPendingBatch 是 chrome.storage.session 里的一个固定单槽，第二次写入会覆盖第一次；
// 于是先那个窗口的浮层点「确认」，真正收藏到的是后一个窗口的网页，先窗口那批彻底丢失。
// 修复：每个窗口一个槽，确认时按 sender.tab.windowId 取自己那一批。
//
// 跑法：
//   node scripts/repro-multi-window-batch.js
//     实验组：两个窗口先后触发 → 修复前 4 条期望断言报红（退出码 1），修复后全绿（退出码 0）
//   REPRO_CONTROL=1 node scripts/repro-multi-window-batch.js
//     对照组：不触发第二个窗口 → 同样那 4 条断言始终全绿、退出码 0。
//     用来证明「红」确实来自第二个窗口，而不是桩本身收不了窗口 A 的网页。
//
// 桩来自 tests/save-all-tabs.test.js：vm 沙箱里把 background.js 整个跑起来，
// 只把「当前窗口」做成可切换的变量，用来模拟两个窗口各自触发。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const { URL } = require("url");

const src = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");
// 修复后每个窗口各占一个槽；修复前只有单键 laterOnPendingBatch。
const PENDING_PREFIX = "laterOnPendingBatch:";
const pendingKeyFor = (w) => `${PENDING_PREFIX}${w}`;
const CONTROL = process.env.REPRO_CONTROL === "1";

const WIN_A = 1;
const WIN_B = 2;
let currentWindowId = WIN_A;

function makeTab(id, windowId, url, title, active = false) {
  return { id, windowId, url, title, favIconUrl: "", active, status: "complete", discarded: false };
}

// 两个窗口的篇数故意不一样（3 vs 2），这样「回执篇数」也能一眼看出串台。
const tabs = [
  makeTab(1, WIN_A, "https://a1.example.com/post", "窗口A-文章一", true),
  makeTab(2, WIN_A, "https://a2.example.com/post", "窗口A-文章二"),
  makeTab(3, WIN_A, "https://a3.example.com/post", "窗口A-文章三"),
  makeTab(4, WIN_B, "https://b1.example.com/post", "窗口B-文章一", true),
  makeTab(5, WIN_B, "https://b2.example.com/post", "窗口B-文章二")
];
const A_URLS = tabs.filter((t) => t.windowId === WIN_A).map((t) => t.url);
const B_URLS = tabs.filter((t) => t.windowId === WIN_B).map((t) => t.url);

const store = {
  laterOnItems: [],
  laterOnProjects: [],
  laterOnSettings: {}
};
const session = {};
const bus = {};
const overlays = [];
const pills = [];
let pendingOverlayPayload = null;

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
      async set(obj) { Object.assign(store, obj); },
      async remove(key) { delete store[key]; }
    },
    // 关键：整个扩展只有一个 service worker，所有窗口共用这一份 session 对象。
    session: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: session[keys] };
        return { ...session };
      },
      async set(obj) { Object.assign(session, obj); },
      async remove(key) { delete session[key]; }
    },
    onChanged: { addListener() {} }
  },
  tabs: {
    query(filter = {}) {
      if (filter.url) return Promise.resolve([]);
      if (filter.currentWindow) {
        return Promise.resolve(tabs.filter((t) => t.windowId === currentWindowId && (!filter.active || t.active)));
      }
      return Promise.resolve([]);
    },
    get: (id) => {
      const tab = tabs.find((t) => t.id === id);
      return tab ? Promise.resolve(tab) : Promise.reject(new Error("no tab"));
    },
    update: async () => {},
    onUpdated: { addListener() {} },
    onRemoved: { addListener() {} },
    onCreated: { addListener() {} }
  },
  windows: {
    get: async () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    create: async () => ({ id: 99 }),
    remove: async () => {},
    update: async () => {}
  },
  scripting: {
    insertCSS: async () => {},
    executeScript(options) {
      const tabId = options.target?.tabId;
      if (typeof options.func === "function" && String(options.func).includes("lateron-picker-payload-data")) {
        pendingOverlayPayload = options.args?.[0];
        return Promise.resolve([{ result: undefined }]);
      }
      // showPickerOverlay 注入完还会再验一次「浮层宿主确实在页面上」，
      // 少了这一条桩它会误判成「没打开」并重试一次，把证据弄脏。
      if (typeof options.func === "function" && String(options.func).includes("lateron-folder-picker")) {
        return Promise.resolve([{ result: true }]);
      }
      if (options.files?.includes("content-folder-picker.js")) {
        // 两个窗口的浮层各自注入到自己那个 active 标签上，互不干扰。
        overlays.push({ tabId, windowId: tabs.find((t) => t.id === tabId)?.windowId, payload: pendingOverlayPayload });
        pendingOverlayPayload = null;
        return Promise.resolve([{ result: undefined }]);
      }
      if (Array.isArray(options.args)) {
        pills.push({ tabId, items: options.args[0] });
        return Promise.resolve([{ result: undefined }]);
      }
      if (!options.files?.includes("content-metadata.js")) return Promise.resolve([{ result: undefined }]);
      const tab = tabs.find((t) => t.id === tabId);
      return Promise.resolve([{
        result: {
          title: tab.title,
          description: `这是 ${tab.title} 的摘要`,
          image: `https://img.example.com/${tabId}.jpg`,
          favicon: "",
          source: new URL(tab.url).hostname,
          url: tab.url
        }
      }]);
    }
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
    setIcon: async () => {}
  },
  alarms: {
    get: async () => undefined,
    create: async () => {},
    onAlarm: { addListener() {} }
  },
  contextMenus: { removeAll: (cb) => cb && cb(), create() {}, onClicked: { addListener() {} } },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    getManifest: () => ({ version: "1.75.0" }),
    sendMessage: async () => {},
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(fn) { bus.listener = fn; } }
  },
  commands: { onCommand: { addListener() {} } }
};

// 模拟「某个网页里的浮层给后台发消息」，走真实的 onMessage 通道拿 sendResponse 回执。
// sender.tab.windowId 是真实浏览器里 runtime 消息自带的，必须带上才能模拟「哪个窗口的浮层点了确认」。
function sendFromPage(message, senderTabId, senderWindowId) {
  return new Promise((resolve) => {
    const kept = bus.listener(message, { tab: { id: senderTabId, windowId: senderWindowId } }, resolve);
    if (!kept) resolve(undefined);
  });
}

async function waitForBatchDone(deadlineMs = 8000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const stage = store.laterOnDiag?.lastStage;
    if (stage === "完成" || stage === "失败") return stage;
    await new Promise((r) => setTimeout(r, 20));
  }
  return store.laterOnDiag?.lastStage;
}

const sandbox = {
  chrome,
  crypto: webcrypto,
  URL,
  setTimeout,
  clearTimeout,
  console,
  Date,
  Promise,
  JSON,
  Set,
  Map,
  fetch: async () => { throw new Error("offline"); },
  AbortController: class { constructor() { this.signal = {}; } abort() {} },
  importScripts() {},
  LaterOnUrl: {
    normalize(value) {
      try { const u = new URL(value); u.hash = ""; return u.href.replace(/\/$/, ""); }
      catch { return String(value || ""); }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "background.js" });

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const urlsOf = (list) => (list || []).map((t) => t.url);
const sameUrls = (a, b) => a.length === b.length && a.every((u) => b.includes(u));

(async () => {
  console.log(`复现：两个浏览器窗口先后触发「一键收藏所有标签页」${CONTROL ? "【对照组：只触发窗口 A】" : "【实验组】"}\n`);
  console.log(`窗口 ${WIN_A}：${A_URLS.length} 篇 ${A_URLS.join(" / ")}`);
  console.log(`窗口 ${WIN_B}：${B_URLS.length} 篇 ${B_URLS.join(" / ")}\n`);

  // ── 第 1 步：窗口 A 触发，浮层挂着不确认 ──────────────────
  console.log("── 第 1 步：窗口 A 按快捷键，浮层弹出但不确认 ──");
  currentWindowId = WIN_A;
  const firstReply = await sandbox.saveAllTabsInWindow("shortcut");
  const firstPending = JSON.parse(JSON.stringify(session[pendingKeyFor(WIN_A)] || {}));
  check("窗口 A 弹出了待确认的浮层", firstReply?.pending === true, JSON.stringify(firstReply));
  check("暂存的是窗口 A 的 3 篇", sameUrls(urlsOf(firstPending.tabs), A_URLS), `${urlsOf(firstPending.tabs).length} 篇`);
  check("通知目标是窗口 A 的活动标签", firstPending.notifyTabId === 1, `notifyTabId=${firstPending.notifyTabId}`);

  if (CONTROL) {
    console.log("\n── 第 2 步（对照组）：不触发第二个窗口，直接让窗口 A 确认 ──");
  } else {
    // ── 第 2 步：窗口 B 也触发一次 ────────────────────────────
    console.log("\n── 第 2 步：窗口 B 也按了一次快捷键 ──");
    currentWindowId = WIN_B;
    const secondReply = await sandbox.saveAllTabsInWindow("shortcut");
    const secondPending = JSON.parse(JSON.stringify(session[pendingKeyFor(WIN_B)] || {}));
    check("窗口 B 也弹出了待确认的浮层", secondReply?.pending === true, JSON.stringify(secondReply));
    check("暂存的是窗口 B 的 2 篇", sameUrls(urlsOf(secondPending.tabs), B_URLS), `${urlsOf(secondPending.tabs).length} 篇`);

    console.log("\n── 观察到的机制（当前实际行为）──");
    const slots = Object.keys(session).filter((k) => k.startsWith(PENDING_PREFIX));
    console.log(`  session 里的批次槽：${slots.join(" / ") || "（空）"}`);
    slots.forEach((k) => console.log(`    ${k} → ${session[k]?.tabs?.length} 篇，窗口 ${session[k]?.windowId}`));
    console.log(`  窗口 ${WIN_A} 的 ${A_URLS.length} 篇仍完好，窗口 ${WIN_B} 的 ${B_URLS.length} 篇各占一个槽，谁也没覆盖谁`);
    console.log(`  两个浮层分别注入在标签 ${overlays.map((o) => `${o.tabId}(窗口${o.windowId})`).join(" 和 ")} 上，都还挂着`);
  }

  // ── 第 3 步：窗口 A 那个浮层点「确认」────────────────────
  console.log(`\n── 第 3 步：窗口 A 的浮层点确认（发消息的仍是标签 1）──`);
  const confirmReply = await sendFromPage({ type: "CONFIRM_BATCH_SAVE", projectId: "" }, 1, WIN_A);
  const stage = await waitForBatchDone();
  const added = store.laterOnItems.map((i) => i.url);
  console.log(`  批次结束状态：${stage}`);
  console.log(`  实际落库 ${added.length} 篇：${added.join(" / ") || "（无）"}`);

  console.log("\n── 期望断言（期望：先那个窗口点确认，收的是它自己的网页）──");
  check("确认回执说的篇数应与窗口 A 一致（3 篇）", confirmReply?.tabCount === 3, `tabCount=${confirmReply?.tabCount}`);
  check("收藏的应该正好是窗口 A 的 3 篇", sameUrls(added, A_URLS), `${added.length} 篇`);
  check("窗口 A 的网页一篇都不该被漏掉", A_URLS.every((u) => added.includes(u)), `命中 ${A_URLS.filter((u) => added.includes(u)).length}/${A_URLS.length}`);
  check("不该凭空收进窗口 B 的网页", !B_URLS.some((u) => added.includes(u)), `混进 ${B_URLS.filter((u) => added.includes(u)).length} 篇`);

  console.log("");
  if (CONTROL) {
    console.log(failures
      ? `结论：对照组本该全绿，却有 ${failures} 条报红 —— 桩或断言本身有问题，实验组结论不可信。`
      : "结论：对照组 4 条期望断言全绿 —— 断言有效，实验组的红确实来自第二个窗口，不是桩写坏了。");
    if (failures) process.exitCode = 1;
  } else if (failures) {
    console.log(`结论：缺陷已复现 —— ${failures} 条期望断言报红。`);
    console.log("窗口 A 的浮层确认后，落库的是窗口 B 的网页；窗口 A 那批标签页再也不会被收藏。");
    console.log("根因：background.js:1564 的 askFolderThenSave 无条件写入单键 laterOnPendingBatch，");
    console.log("      claimPendingBatch（:1955）取出谁算谁，且一取就删除，没有按窗口分槽、也没有「已有待确认批次」的护栏。");
    process.exitCode = 1;
  } else {
    console.log("结论：期望断言全绿 —— 多窗口串台已修复，两个窗口各收各的。");
  }
})();
