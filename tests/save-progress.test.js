// 添加进度：后台广播 → 收藏库顶部进度条 / 侧栏那一行 / 图标右下角的绿点。
//
// 背景：添加一篇要抓标题 / 摘要 / 封面，最长等 3 秒；「一键收藏所有标签页」十几篇就是
// 几十秒。这段时间原来只有网页右上角会冒药丸，收藏库和侧栏一动不动——
// 用户以为没点上、又按一次，然后收到「这个网页已经添加过了」。
//
// 这里盯三件事：
//   ① 后台：一次添加会依次广播 读取 → 保存 → 收尾（带结果），批次号一路不变；
//      工作期间换成带绿点的图标，结束时换回原图，且顺序不能反。
//   ② 侧栏：那一行文字 / 秒表 / 按钮转圈，收尾后 2.6 秒自己收起。
//   ③ 收藏库：顶部进度条按「读一半 / 写一半」的节奏走，收尾换成 toast。
// 运行：node tests/save-progress.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
}

// ── ① 后台：进度广播 + 图标绿点 ──────────────────────────────
async function partBackground() {
  console.log("\n── ① 后台：广播顺序与图标 ──");
  const store = { laterOnItems: [], laterOnProjects: [], laterOnSettings: {} };
  const session = {};
  const progressMessages = [];
  const iconCalls = [];
  let messageListener = null;
  const event = () => ({ addListener() {} });
  const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of [].concat(keys)) if (key in store) out[key] = clone(store[key]);
          return out;
        },
        async set(patch) { Object.assign(store, clone(patch)); },
        async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
      },
      session: {
        async get(keys) {
          const out = {};
          for (const key of [].concat(keys)) if (key in session) out[key] = clone(session[key]);
          return out;
        },
        async set(patch) { Object.assign(session, clone(patch)); },
        async remove(keys) { for (const key of [].concat(keys)) delete session[key]; }
      },
      onChanged: event()
    },
    alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
    commands: { onCommand: event() },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: { addListener(fn) { messageListener = fn; } },
      getURL: (file) => `chrome-extension://fixture/${file}`,
      // 后台广播进度就走这一条；顺手记下来，下面按顺序断言。
      sendMessage(message) {
        if (message?.type === "SAVE_PROGRESS") progressMessages.push({ ...message.progress });
        return Promise.resolve({ ok: true });
      }
    },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      onCreated: event(),
      query: async () => [],
      get: async (id) => ({ id, url: "https://site.com/x", title: "x", windowId: 1 }),
      sendMessage: async () => ({})
    },
    scripting: { insertCSS: async () => {}, executeScript: async () => [{ result: null }] },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
      setIcon: async (details) => { iconCalls.push(details); }
    },
    sidePanel: { setPanelBehavior() {} }
  };

  const ctx = vm.createContext({
    chrome,
    console,
    URL,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    importScripts() {},
    // 绿点是在 service worker 里用离屏画布现画的，这里给一套能跑通的最小替身。
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    createImageBitmap: async () => ({ width: 32, height: 32 }),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() {
        return {
          drawImage() {},
          beginPath() {},
          arc() {},
          fill() {},
          getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
        };
      }
    }
  });

  vm.runInContext(read("item-store.js"), ctx);
  vm.runInContext(read("url-utils.js"), ctx);
  vm.runInContext(read("background.js"), ctx);
  await new Promise((done) => setTimeout(done, 30));

  // 网页提取要真注入脚本，这里直接换掉：只验进度这条链路。
  ctx.extractTabMetadata = async (tab) => ({
    title: tab.title, url: tab.url, description: "摘要", image: "",
    favicon: "", source: "site.com", titleFrom: "tab", imageFrom: "none"
  });

  // —— 单篇 ——
  const single = { id: 11, url: "https://site.com/a", title: "单篇标题", windowId: 1, active: true };
  await ctx.quickSave(single, "panel");

  const phases = progressMessages.map((entry) => entry.phase);
  const ids = new Set(progressMessages.map((entry) => entry.id));
  check("先广播「正在读取网页」", phases[0] === "extract", phases.join(","));
  check("中间会广播「正在保存」", phases.includes("save"), phases.join(","));
  check("最后一条是收尾 done", phases[phases.length - 1] === "done", phases.join(","));
  check("收尾不再带「正在干」的阶段标记", !progressMessages.slice(-1).some((entry) => entry.phase === "extract"));
  check("整批共用一个批次号（不会被自己拆成两批）", ids.size === 1, [...ids].join(","));
  check("单篇时 total 一直是 1", progressMessages.every((entry) => entry.total === 1));
  const doneSingle = progressMessages[progressMessages.length - 1];
  check("收尾带了结果：ok / added=1", doneSingle.result?.ok === true && doneSingle.result?.added === 1,
    JSON.stringify(doneSingle.result));

  const dotCalls = iconCalls.filter((entry) => entry.imageData);
  const restoreCalls = iconCalls.filter((entry) => entry.path);
  check("工作期间换了一次带绿点的图标", dotCalls.length === 1, `共 ${iconCalls.length} 次 setIcon`);
  check("绿点是一张 ImageData（不是图片文件）", dotCalls[0]?.imageData?.width === 32);
  check("结束时把图标换回原图", restoreCalls.length === 1 && restoreCalls[0].path["32"] === "icon32.png",
    JSON.stringify(restoreCalls[0]?.path));
  check("先点绿点、再恢复（顺序不能反，否则图标一直绿着）",
    iconCalls.indexOf(dotCalls[0]) < iconCalls.indexOf(restoreCalls[0]));

  // —— 收尾后：页面来问「现在有没有进度」 ——
  let reply = null;
  messageListener({ type: "GET_SAVE_PROGRESS" }, {}, (value) => { reply = value; });
  check("空闲时查进度返回 null（页面不会挂一条假进度）", reply?.ok === true && reply.progress === null,
    JSON.stringify(reply));

  // —— 跑着的时候来问：能接上 ——
  progressMessages.length = 0;
  const runningId = await ctx.beginSaveProgress(3, "批量");
  reply = null;
  messageListener({ type: "GET_SAVE_PROGRESS" }, {}, (value) => { reply = value; });
  check("工作中查进度能拿到当前这一批", reply?.progress?.total === 3 && reply.progress.id === runningId);
  await ctx.finishSaveProgress(runningId, { ok: true, added: 3 });

  // —— 批量：3 篇 ——
  progressMessages.length = 0;
  iconCalls.length = 0;
  const tabs = [1, 2, 3].map((i) => ({ id: i, url: `https://site.com/${i}`, title: `第 ${i} 篇`, windowId: 1, active: i === 1 }));
  const batch = await ctx.runBatchSave({ tabs, projectId: null });
  check("批量收藏本身成功", batch.ok === true && batch.added === 3, JSON.stringify(batch));
  check("批量：total = 标签页数", progressMessages[0]?.total === 3, String(progressMessages[0]?.total));
  check("批量：done 一路推到 3", Math.max(...progressMessages.map((entry) => entry.done)) === 3,
    progressMessages.map((entry) => entry.done).join(","));
  check("批量：每篇都会把标题推给界面",
    progressMessages.filter((entry) => entry.label).some((entry) => entry.label.includes("第 2 篇")),
    progressMessages.map((entry) => entry.label).join(" | "));
  check("批量：也是一批一个批次号", new Set(progressMessages.map((entry) => entry.id)).size === 1);
  check("批量：结束把绿点收掉", iconCalls.filter((entry) => entry.path).length >= 1);

  // —— 失败也要收尾：进度条不能一直挂着 ——
  progressMessages.length = 0;
  ctx.extractTabMetadata = async () => { throw new Error("页面读不到"); };
  const failedResult = await ctx.quickSave({ id: 12, url: "https://site.com/bad", title: "坏的" }).catch(() => null);
  const lastMessage = progressMessages[progressMessages.length - 1];
  check("抓取抛错时 quickSave 会把异常抛给上层", failedResult === null || failedResult.ok === false);
  check("抛错也要广播收尾", lastMessage?.phase === "done", lastMessage?.phase);
  check("收尾里写明失败", lastMessage?.result?.ok === false, JSON.stringify(lastMessage?.result));
}

// ── 页面通用：造一个能跑 sidepanel.js / library.js 的最小环境 ──
function bootPage(file, store) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
  virtualConsole.on("error", (message) => errors.push(String(message)));

  const dom = new JSDOM(read(file), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: `chrome-extension://lateron/${file}`,
    virtualConsole
  });
  const { window } = dom;
  const { document } = window;
  window.scrollTo = () => {};

  const messageListeners = [];
  const changeListeners = [];
  const memStore = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (memStore.has(key) ? memStore.get(key) : null),
      setItem: (key, value) => memStore.set(key, String(value)),
      removeItem: (key) => memStore.delete(key)
    }
  });

  window.chrome = {
    storage: {
      local: {
        get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return Promise.resolve(out);
        },
        set(patch) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = JSON.parse(JSON.stringify(value));
          }
          window.setTimeout(() => changeListeners.forEach((fn) => fn(changes, "local")), 0);
          return Promise.resolve();
        },
        remove(keys) {
          for (const key of [].concat(keys)) delete store[key];
          return Promise.resolve();
        }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    },
    tabs: {
      query: async (info = {}) => (info.active ? [{ id: 1, windowId: 7, active: true, url: "https://current.com" }] : [{ id: 1, windowId: 7, active: true, url: "https://current.com" }]),
      get: async (id) => ({ id, url: "https://site.com/x", title: "x", windowId: 7 }),
      getCurrent: async () => ({ id: 1, windowId: 7 }),
      update: async (id, options) => ({ id, ...options }),
      create: async (options) => ({ id: 99, ...options }),
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    windows: { getCurrent: async () => ({ id: 7 }) },
    runtime: {
      getURL: (p) => `chrome-extension://lateron/${p}`,
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener(fn) { messageListeners.push(fn); } }
    },
    sidePanel: { open: async () => true }
  };

  const emit = (message) => messageListeners.forEach((fn) => fn(message, {}, () => {}));

  window.eval(read("i18n.js"));
  window.eval(read("dialog.js"));
  window.eval(read("item-store.js"));
  if (file === "library.html") window.eval(read("library.js"));
  else {
    window.eval(read("url-utils.js"));
    window.eval(read("tab-navigation.js"));
    window.eval(read("sidepanel.js"));
  }
  return { dom, window, document, store, emit, errors };
}

// ── ② 侧栏：一行状态 + 按钮转圈 ──────────────────────────────
async function partSidepanel() {
  console.log("\n── ② 侧栏 ──");
  const now = Date.now();
  const page = bootPage("sidepanel.html", {
    laterOnItems: [{
      id: "a1", title: "已收藏的一篇", description: "d", image: "", favicon: "",
      source: "site.com", projectId: null, url: "https://current.com", savedAt: now, status: "unread"
    }],
    laterOnProjects: [],
    laterOnActiveProject: "unfiled",
    laterOnSettings: {}
  });
  const { document, window, emit } = page;
  const tick = (ms = 60) => new Promise((resolve) => window.setTimeout(resolve, ms));
  await tick(120);

  const row = document.querySelector("#saveProgress");
  const text = document.querySelector("#saveProgressText");
  const time = document.querySelector("#saveProgressTime");
  const button = document.querySelector("#saveCurrent");
  check("侧栏里真的有这一行（有 DOM 才谈得上显示）", !!row && !!text && !!time);
  check("默认是藏起来的", row.hidden === true);
  // 自己写了 display:flex，就必须自己写 [hidden]，否则 hidden 属性压不过类选择器。
  check("sidepanel.css 自己补了 .save-progress[hidden]{display:none}",
    /\.save-progress\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(read("sidepanel.css")));

  console.log("· 单篇：读取阶段");
  emit({
    type: "SAVE_PROGRESS",
    progress: { id: 1, total: 1, done: 0, label: "标题", phase: "extract", startedAt: Date.now() - 2500 }
  });
  await tick(30);
  check("进度行出现了", row.hidden === false);
  check("写着「正在读取网页信息…」", text.textContent.includes("正在读取网页信息"), text.textContent);
  check("添加按钮进入工作态", button.classList.contains("is-working"));
  check("按钮文字换成「添加中…」", button.querySelector(".save-label").textContent.includes("添加中"),
    button.querySelector(".save-label").textContent);
  check("秒表在走（>=2 秒）", /^\d+s$/.test(time.textContent) && parseInt(time.textContent, 10) >= 2, time.textContent);

  console.log("· 单篇：保存阶段");
  emit({
    type: "SAVE_PROGRESS",
    progress: { id: 1, total: 1, done: 0, label: "标题", phase: "save", startedAt: Date.now() - 3000 }
  });
  await tick(20);
  check("阶段换成「正在保存…」", text.textContent.includes("正在保存"), text.textContent);

  console.log("· 批量：带 2/3 计数，且不动添加按钮");
  emit({
    type: "SAVE_PROGRESS",
    progress: { id: 2, total: 3, done: 1, label: "第二篇的标题很长很长很长很长很长很长", phase: "save", startedAt: Date.now() }
  });
  await tick(20);
  check("多篇时显示第几篇", text.textContent.includes("2/3"), text.textContent);
  check("标题被压短（侧栏只有 320px）", text.textContent.length <= 46, `${text.textContent.length}`);
  check("整窗收藏时添加按钮不跟着转圈", !button.classList.contains("is-working"));

  console.log("· 收尾");
  emit({ type: "SAVE_PROGRESS", progress: { id: 2, total: 3, done: 3, phase: "done", result: { ok: true, added: 2 }, startedAt: Date.now() } });
  await tick(20);
  check("收尾显示结果", text.textContent.includes("已添加 2 篇"), text.textContent);
  check("转圈换成实心点（is-done）", row.classList.contains("is-done"));
  check("秒表清空", time.textContent === "");
  await tick(2900);
  check("2.6 秒后自己收起（不占着地方）", row.hidden === true);

  console.log("· 失败与迟到消息");
  emit({ type: "SAVE_PROGRESS", progress: { id: 3, total: 1, done: 0, phase: "save", startedAt: Date.now() } });
  await tick(10);
  emit({ type: "SAVE_PROGRESS", progress: { id: 3, total: 1, done: 1, phase: "done", result: { ok: false, error: "x" } } });
  await tick(10);
  check("失败时说「添加失败」", text.textContent.includes("添加失败"), text.textContent);
  // 更早那一批的迟到消息不能把界面顶回去「正在添加」。
  emit({ type: "SAVE_PROGRESS", progress: { id: 2, total: 1, done: 0, phase: "save", startedAt: Date.now() } });
  await tick(10);
  check("旧批次的迟到消息被忽略", text.textContent.includes("添加失败"), text.textContent);
  check("侧栏没有脚本报错", page.errors.length === 0, page.errors.join(" | "));
}

// ── ③ 收藏库：顶部进度条 + toast ─────────────────────────────
async function partLibrary() {
  console.log("\n── ③ 收藏库 ──");
  const now = Date.now();
  const page = bootPage("library.html", {
    laterOnItems: [{
      id: "b1", title: "一篇", description: "d", image: "", favicon: "",
      source: "site.com", projectId: null, url: "https://site.com/1", savedAt: now, status: "unread"
    }],
    laterOnProjects: [],
    laterOnActiveProject: "unfiled",
    laterOnFilter: "all",
    laterOnFilterChosen: true,
    laterOnSettings: {}
  });
  const { document, window, emit } = page;
  const tick = (ms = 80) => new Promise((resolve) => window.setTimeout(resolve, ms));
  await tick(150);

  const row = document.querySelector("#saveProgress");
  const fill = document.querySelector("#saveProgressFill");
  const text = document.querySelector("#saveProgressText");
  const time = document.querySelector("#saveProgressTime");
  const toast = document.querySelector("#toast");
  check("收藏库里真的有进度条（有 DOM 才谈得上显示）", !!row && !!fill && !!text && !!time);
  check("默认是藏起来的", row.hidden === true);
  check("library.css 自己补了 .save-progress[hidden]{display:none}",
    /\.save-progress\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(read("library.css")));
  check("整块不接收点击（绝不挡住下面的卡片）",
    /\.save-progress\s*\{[^}]*pointer-events\s*:\s*none/.test(read("library.css")));
  // 容器是胶囊（position:absolute; bottom:82px）的定位参照。
  // 只写到 `inset:0 0 auto`（高度 = 那条 2px）的话，胶囊会被推到屏幕上方看不见——
  // 真浏览器里踩过一次，所以这里钉住「必须铺满视口」。
  check("进度条容器铺满视口（否则胶囊会被推出屏幕外）",
    /\.save-progress\s*\{[^}]*inset\s*:\s*0\s*;/.test(read("library.css")));

  console.log("· 批量第 2/4 篇，正在写库");
  emit({
    type: "SAVE_PROGRESS",
    progress: { id: 7, total: 4, done: 1, label: "第二篇", phase: "save", startedAt: Date.now() - 4000 }
  });
  await tick(30);
  check("进度条出现了", row.hidden === false);
  const percent = parseFloat(fill.style.width);
  // 写完这一篇之前是 (1 + 0.75) / 4 = 43.75%，不能是 25%（那样看着像没动）
  check("进度条宽度按「这一篇写了一半多」算", percent > 40 && percent < 50, `${percent}%`);
  check("文案带第几篇", text.textContent.includes("2/4"), text.textContent);
  check("秒表在走", /^\d+s$/.test(time.textContent), time.textContent);

  console.log("· 收尾：换成 toast");
  emit({ type: "SAVE_PROGRESS", progress: { id: 7, total: 4, done: 4, phase: "done", result: { ok: true, added: 4 } } });
  await tick(30);
  check("进度条收起", row.hidden === true);
  check("结果用页面自己的 toast 说", toast.textContent.includes("已添加 4 篇"), toast.textContent);
  check("toast 是显示状态", toast.classList.contains("show"));

  console.log("· 失败");
  emit({ type: "SAVE_PROGRESS", progress: { id: 8, total: 1, done: 1, phase: "done", result: { ok: false, error: "boom" } } });
  await tick(30);
  check("失败时说「添加失败」", toast.textContent.includes("添加失败"), toast.textContent);
  check("收藏库没有脚本报错", page.errors.length === 0, page.errors.join(" | "));
}

(async () => {
  await partBackground();
  await partSidepanel();
  await partLibrary();
  if (failed) {
    console.error(`\n${failed} 项失败`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS 添加时有进度：后台广播、页面画出来、图标点绿点");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
