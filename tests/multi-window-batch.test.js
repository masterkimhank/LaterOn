// 回归测试：待确认的「一键收藏」批次按浏览器窗口分槽。
//
// 修的缺陷：原来 laterOnPendingBatch 是 chrome.storage.session 里的一个固定单槽，
// 窗口 A 弹出选项目浮层后，窗口 B 再按一次快捷键就把 A 的暂存覆盖掉；
// A 的浮层点确认会收到 B 的网页，A 那批标签页彻底丢失。
//
// 现在每个窗口各占一个槽，确认时按 sender.tab.windowId 取自己那一批。
// 本文件用 vm 沙箱把 background.js 整个跑起来（桩来自 save-all-tabs.test.js），
// 每个场景单独一个 harness，避免诊断状态互相污染。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const { URL } = require("url");

const src = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");
const PREFIX = "laterOnPendingBatch:";
const LEGACY_KEY = "laterOnPendingBatch";

function tab(id, windowId, url, title, active = false) {
  return { id, windowId, url, title, favIconUrl: "", active, status: "complete", discarded: false };
}

const W1 = [
  tab(1, 1, "https://a1.example.com/p", "A1", true),
  tab(2, 1, "https://a2.example.com/p", "A2"),
  tab(3, 1, "https://a3.example.com/p", "A3")
];
const W2 = [
  tab(4, 2, "https://b1.example.com/p", "B1", true),
  tab(5, 2, "https://b2.example.com/p", "B2")
];
const A_URLS = W1.map((t) => t.url);
const B_URLS = W2.map((t) => t.url);
const C_URLS = ["https://c1.example.com/p", "https://c2.example.com/p"];

function createHarness(initialTabs, initialSession = {}) {
  let tabs = initialTabs.slice();
  let currentWindowId = initialTabs[0]?.windowId ?? 1;
  const store = { laterOnItems: [], laterOnProjects: [], laterOnSettings: {} };
  const session = { ...initialSession };
  const bus = {};
  const overlays = [];
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
      // 整个扩展只有一个 service worker，所有窗口共用这一份 session 对象。
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
        const found = tabs.find((t) => t.id === id);
        return found ? Promise.resolve(found) : Promise.reject(new Error("no tab"));
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
        // showPickerOverlay 注入完会再验一次宿主的 shadowRoot，少了这桩会误判「没打开」。
        if (typeof options.func === "function" && String(options.func).includes("lateron-folder-picker")) {
          return Promise.resolve([{ result: true }]);
        }
        if (options.files?.includes("content-folder-picker.js")) {
          overlays.push({ tabId, windowId: tabs.find((t) => t.id === tabId)?.windowId });
          pendingOverlayPayload = null;
          return Promise.resolve([{ result: undefined }]);
        }
        if (Array.isArray(options.args)) return Promise.resolve([{ result: undefined }]);
        if (!options.files?.includes("content-metadata.js")) return Promise.resolve([{ result: undefined }]);
        const found = tabs.find((t) => t.id === tabId);
        return Promise.resolve([{
          result: {
            title: found?.title || "",
            description: `这是 ${found?.title || ""} 的摘要`,
            image: `https://img.example.com/${tabId}.jpg`,
            favicon: "",
            source: found?.url ? new URL(found.url).hostname : "",
            url: found?.url || ""
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
    alarms: { get: async () => undefined, create: async () => {}, onAlarm: { addListener() {} } },
    contextMenus: { removeAll: (cb) => cb && cb(), create() {}, onClicked: { addListener() {} } },
    runtime: {
      getURL: (p) => `chrome-extension://lateron/${p}`,
      getManifest: () => ({ version: "1.76.0" }),
      sendMessage: async () => {},
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { bus.listener = fn; } }
    },
    commands: { onCommand: { addListener() {} } }
  };

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

  // 走真实的 runtime.onMessage 通道；windowId 省略时模拟「旧调用没带窗口信息」。
  function send(message, tabId, windowId) {
    return new Promise((resolve) => {
      const senderTab = { id: tabId, ...(windowId === undefined ? {} : { windowId }) };
      const kept = bus.listener(message, { tab: senderTab }, resolve);
      if (!kept) resolve(undefined);
    });
  }
  async function confirm(projectId, tabId, windowId) {
    // 上一批跑完后 lastStage 会停在「完成」，不清掉会让下一次 waitDone 立刻返回。
    if (store.laterOnDiag) store.laterOnDiag.lastStage = "确认中";
    return send({ type: "CONFIRM_BATCH_SAVE", projectId }, tabId, windowId);
  }
  function cancel(tabId, windowId) {
    return send({ type: "CANCEL_BATCH_SAVE" }, tabId, windowId);
  }
  async function waitDone(deadlineMs = 6000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      const stage = store.laterOnDiag?.lastStage;
      if (stage === "完成" || stage === "失败") return stage;
      await new Promise((r) => setTimeout(r, 20));
    }
    return store.laterOnDiag?.lastStage;
  }

  return {
    store,
    session,
    overlays,
    setWindow(w) { currentWindowId = w; },
    setTabs(next) { tabs = next.slice(); },
    trigger: () => sandbox.saveAllTabsInWindow("shortcut"),
    confirm,
    cancel,
    waitDone,
    slot: (w) => session[`${PREFIX}${w}`],
    items: () => store.laterOnItems.map((i) => i.url)
  };
}

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const same = (a, b) => a.length === b.length && a.every((u) => b.includes(u));
const urlsOf = (list) => (list || []).map((t) => t.url);

(async () => {
  // ── 1. 两个窗口各点各的（原来会串台的那条主链路）────────────
  console.log("── 1. 两个窗口各点各的 ──");
  const h1 = createHarness([...W1, ...W2]);
  h1.setWindow(1);
  const r1 = await h1.trigger();
  check("窗口 1 弹出待确认浮层（3 篇）", r1?.pending === true && r1?.tabCount === 3, JSON.stringify(r1));
  check("批次落在 :1 槽", h1.slot(1)?.tabs?.length === 3);
  check("槽里记着自己的窗口", h1.slot(1)?.windowId === 1);
  check("不再写旧版单键", h1.session[LEGACY_KEY] === undefined);

  h1.setWindow(2);
  const r2 = await h1.trigger();
  check("窗口 2 弹出待确认浮层（2 篇）", r2?.pending === true && r2?.tabCount === 2, JSON.stringify(r2));
  check("批次落在 :2 槽", h1.slot(2)?.tabs?.length === 2);
  check("窗口 1 的 3 篇没被覆盖", h1.slot(1)?.tabs?.length === 3 && same(urlsOf(h1.slot(1).tabs), A_URLS));
  check("窗口 2 的槽也记着自己的窗口", h1.slot(2)?.windowId === 2);
  check("通知目标跟着各自窗口", h1.slot(1)?.notifyTabId === 1 && h1.slot(2)?.notifyTabId === 4);
  check("两个浮层各注入在各自窗口的标签上", h1.overlays.length === 2 && h1.overlays[0].windowId === 1 && h1.overlays[1].windowId === 2);

  const c1 = await h1.confirm("", 1, 1);
  check("窗口 1 确认回执说 3 篇", c1?.ok === true && c1?.tabCount === 3, JSON.stringify(c1));
  await h1.waitDone();
  check("只收进窗口 1 的 3 篇", same(h1.items(), A_URLS), h1.items().join(" / "));
  check("只删了 :1，窗口 2 的批次还在", h1.slot(1) === undefined && h1.slot(2)?.tabs?.length === 2);

  const c2 = await h1.confirm("", 4, 2);
  check("窗口 2 确认回执说 2 篇", c2?.ok === true && c2?.tabCount === 2, JSON.stringify(c2));
  await h1.waitDone();
  check("两窗口合计 5 篇都在库里", same(h1.items(), [...A_URLS, ...B_URLS]), `${h1.items().length} 篇`);
  check("没选项目时都落在等待整理", h1.store.laterOnItems.every((i) => !i.projectId));
  check("两个槽最终都清空", h1.slot(1) === undefined && h1.slot(2) === undefined);

  // ── 2. 同窗口重复触发：仍然只覆盖自己那一批 ────────────────
  console.log("\n── 2. 同窗口重复触发 ──");
  const h2 = createHarness(W1);
  h2.setWindow(1);
  await h2.trigger();
  check("第一次暂存 3 篇", h2.slot(1)?.tabs?.length === 3);
  h2.setTabs([
    tab(1, 1, C_URLS[0], "C1", true),
    tab(2, 1, C_URLS[1], "C2")
  ]);
  await h2.trigger();
  check("重入后本窗口的批次被替换成 2 篇", h2.slot(1)?.tabs?.length === 2 && same(urlsOf(h2.slot(1).tabs), C_URLS));
  check("没有多出第二个槽", Object.keys(h2.session).filter((k) => k.startsWith(PREFIX)).length === 1);
  await h2.confirm("", 1, 1);
  await h2.waitDone();
  check("确认后收的是后一批", same(h2.items(), C_URLS), h2.items().join(" / "));

  // ── 3. 取消只删自己那一槽 ──────────────────────────────────
  console.log("\n── 3. 取消只影响自己 ──");
  const h3 = createHarness([...W1, ...W2]);
  h3.setWindow(1);
  await h3.trigger();
  h3.setWindow(2);
  await h3.trigger();
  const cancelled = await h3.cancel(1, 1);
  check("窗口 1 取消成功", cancelled?.ok === true && cancelled?.cancelled === true, JSON.stringify(cancelled));
  check("只删了 :1，:2 还在", h3.slot(1) === undefined && h3.slot(2)?.tabs?.length === 2);
  await h3.confirm("", 4, 2);
  await h3.waitDone();
  check("窗口 2 仍能收自己的 2 篇", same(h3.items(), B_URLS), h3.items().join(" / "));

  // ── 4. 过期批次会被顺手清掉 ────────────────────────────────
  console.log("\n── 4. 过期批次清理 ──");
  const h4 = createHarness([tab(9, 3, "https://c.example.com/p", "C", true)], {
    [`${PREFIX}1`]: { createdAt: Date.now() - 11 * 60 * 1000, windowId: 1, tabs: [{ id: 1, url: "https://old.example.com/p", title: "过期的" }] },
    [`${PREFIX}2`]: { createdAt: Date.now(), windowId: 2, tabs: [{ id: 4, url: B_URLS[0], title: "B1" }] }
  });
  h4.setWindow(3);
  await h4.trigger();
  check("11 分钟前的过期槽被清掉", h4.slot(1) === undefined);
  check("没过期的槽保留", h4.slot(2)?.tabs?.length === 1);
  check("新批次落在 :3", h4.slot(3)?.tabs?.length === 1);

  // ── 5. 旧版单键兼容：扩展重载后旧浮层还在 ──────────────────
  console.log("\n── 5. 旧版单键兼容 ──");
  const legacyUrl = "https://legacy.example.com/p";
  const h5 = createHarness([tab(1, 1, legacyUrl, "旧浮层那篇", true)], {
    [LEGACY_KEY]: { createdAt: Date.now(), source: "shortcut", notifyTabId: 1, tabs: [{ id: 1, url: legacyUrl, title: "旧浮层那篇" }] }
  });
  const c5 = await h5.confirm("", 1, 1);
  check("旧单键批次仍能被确认收尾", c5?.ok === true && c5?.tabCount === 1, JSON.stringify(c5));
  await h5.waitDone();
  check("收的是旧批次那一篇", same(h5.items(), [legacyUrl]), h5.items().join(" / "));
  check("旧单键已删除", h5.session[LEGACY_KEY] === undefined);

  // ── 6. 两个批次并存又没带窗口信息：绝不乱挑 ────────────────
  console.log("\n── 6. 没带窗口信息时不乱挑 ──");
  const h6 = createHarness([...W1, ...W2]);
  h6.setWindow(1);
  await h6.trigger();
  h6.setWindow(2);
  await h6.trigger();
  const c6 = await h6.confirm("", 1, undefined);
  check("拒绝执行，而不是随便认领一批", c6?.ok === false, JSON.stringify(c6));
  check("两个槽都还在", h6.slot(1)?.tabs?.length === 3 && h6.slot(2)?.tabs?.length === 2);
  check("一条都没收", h6.items().length === 0);

  // ── 7. 别的窗口点确认，不会认领唯一的批次 ──────────────────
  console.log("\n── 7. 别的窗口不能认领 ──");
  const h7 = createHarness(W1);
  h7.setWindow(1);
  await h7.trigger();
  const c7 = await h7.confirm("", 9, 3);
  check("窗口 3 点确认不会拿走窗口 1 的批次", c7?.ok === false, JSON.stringify(c7));
  check("窗口 1 的批次仍在", h7.slot(1)?.tabs?.length === 3);
  const c7b = await h7.confirm("", 1, 1);
  check("窗口 1 自己确认正常", c7b?.ok === true && c7b?.tabCount === 3, JSON.stringify(c7b));
  await h7.waitDone();
  check("只收窗口 1 的 3 篇", same(h7.items(), A_URLS), h7.items().join(" / "));

  console.log(failures === 0 ? "\n全部检查通过 🎉" : `\n有 ${failures} 项失败`);
  if (failures) process.exitCode = 1;
})().catch((error) => {
  console.error("测试脚本自身出错：", error);
  process.exitCode = 1;
});
