// 检查更新 + 数据迁移门禁：跑真实 background.js（不复制逻辑），只把 chrome.* 和网络换成桩。
//
// 这一份盯的是「接起来之后还对不对」，纯函数那两份测不到：
//   · 第一个来源（GitHub API）挂了，会不会真的退到 version.json；
//   · 两个都挂时是不是安静地失败（家里人装的机器不该天天弹红）；
//   · 24 小时内是不是真的不再发请求（service worker 一天会醒几十次）；
//   · 用户点过「忽略」之后，角标会不会清掉；
//   · 库里还有老形状数据时，启动是不是**真的不做迁移**、只挂一个待确认。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");

let failures = 0;
let total = 0;
const check = (label, ok, extra = "") => {
  total += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `  → ${extra}` : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

const API_URL = "https://api.github.com/repos/masterkimhank/LaterOn/releases/latest";
const JSON_URL = "https://github.com/masterkimhank/LaterOn/releases/latest/download/version.json";

// responses 按调用顺序消费：{ ok, text } 或 "throw"（模拟断网）
function boot({ store: seed = {}, responses = [], version = "1.75.0", settings = {} } = {}) {
  const store = { ...seed };
  store.laterOnSettings = { language: "zh-CN", ...settings };
  const fetchCalls = [];
  const badges = [];
  const titles = [];
  const broadcasts = [];
  let messageListener = null;

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: store[keys] };
          const out = {};
          for (const key of (Array.isArray(keys) ? keys : Object.keys(store))) out[key] = store[key];
          return out;
        },
        async set(patch) { Object.assign(store, patch); },
        async remove(key) {
          for (const name of (Array.isArray(key) ? key : [key])) delete store[name];
        }
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [],
      get: async () => null,
      update: async () => ({}),
      create: async () => ({ id: 1 }),
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      onActivated: { addListener() {} }
    },
    action: {
      setBadgeText: async ({ text }) => { badges.push(text); },
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ title }) => { titles.push(title); },
      setIcon: async () => {}
    },
    alarms: { create() {}, get: async () => undefined, onAlarm: { addListener() {} } },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    runtime: {
      lastError: null,
      getManifest: () => ({ version }),
      getURL: (file) => `chrome-extension://lateron/${file}`,
      sendMessage: (message) => { broadcasts.push(message); return Promise.resolve({}); },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { messageListener = fn; } }
    },
    scripting: { insertCSS: async () => {}, executeScript: async () => [] },
    windows: { update: async () => {}, create: async () => ({}) },
    sidePanel: { setPanelBehavior: async () => true }
  };

  const sandbox = {
    chrome,
    // 只把真正被测的三个模块加载进来；其余（WebDAV / 阅读进度）与本次无关，
    // 加载它们只会把桩拖成一团，反而看不清测的是什么。
    importScripts(...files) {
      for (const file of files) {
        if (!["item-store.js", "update-check.js", "migration-plan.js"].includes(file)) continue;
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
      }
    },
    LaterOnUrl: {
      normalize(value) {
        try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); }
        catch { return String(value || ""); }
      }
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      if (!responses.length) throw new Error("network down");
      const next = responses.shift();
      if (next === "throw") throw new Error("network down");
      return {
        ok: next.ok !== false,
        text: async () => next.text,
        json: async () => JSON.parse(next.text)
      };
    },
    AbortController,
    URL, console, Date, Promise, JSON, Set, Map, RegExp, Object, Array, Math,
    String, Number, Boolean, Error, setTimeout, clearTimeout
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BACKGROUND, sandbox, { filename: "background.js" });

  // 发一条消息给后台，拿它的返回值（对应真实页面里的 chrome.runtime.sendMessage）
  const send = (message) => new Promise((resolve) => {
    if (!messageListener) { resolve(null); return; }
    const async = messageListener(message, {}, resolve);
    if (!async) setTimeout(() => resolve(null), 0);
  });

  return { store, sandbox, fetchCalls, badges, titles, broadcasts, responses, send };
}

const apiOk = (tag) => ({
  ok: true,
  text: JSON.stringify({
    tag_name: tag,
    html_url: `https://github.com/masterkimhank/LaterOn/releases/tag/${tag}`,
    body: "本版改动"
  })
});
const jsonOk = (version) => ({
  ok: true,
  text: JSON.stringify({ version, tag: `v${version}-my.1`, pageUrl: "https://example.com/r" })
});

(async () => {
  console.log("\n── 来源一成功就不必再问来源二 ──");
  {
    const app = boot({ responses: [apiOk("v1.76.0-my.1")] });
    await tick(80);
    check("确实发了请求", app.fetchCalls.length === 1, String(app.fetchCalls.length));
    check("问的是 GitHub API", app.fetchCalls[0] === API_URL, app.fetchCalls[0]);
    check("存下了新版本号", app.store.laterOnUpdateState?.latest?.version === "1.76.0", JSON.stringify(app.store.laterOnUpdateState?.latest));
    check("角标亮起 ↑", app.badges.at(-1) === "↑", app.badges.join(" → "));
    check("图标提示里带版本号", /1\.76\.0/.test(app.titles.at(-1) || ""), app.titles.at(-1));
  }

  console.log("\n── 来源一挂了要退到 version.json ──");
  {
    const app = boot({ responses: [{ ok: false, text: "rate limited" }, jsonOk("1.76.0")] });
    await tick(80);
    check("两个来源都试了", app.fetchCalls.length === 2, app.fetchCalls.join(" | "));
    check("第二个是静态 version.json", app.fetchCalls[1] === JSON_URL, app.fetchCalls[1]);
    check("仍然拿到了版本号", app.store.laterOnUpdateState?.latest?.version === "1.76.0");
    check("没被当成失败", app.store.laterOnUpdateState?.error === "", app.store.laterOnUpdateState?.error);
  }

  console.log("\n── 两个来源都挂了：安静地失败 ──");
  {
    const app = boot({ responses: ["throw", "throw"] });
    await tick(80);
    check("记下了「这次没查到」", app.store.laterOnUpdateState?.error === "unreachable", app.store.laterOnUpdateState?.error);
    check("没有亮角标", !app.badges.includes("↑"), app.badges.join(" → "));
    check("但检查时间也记了（避免每分钟重试）", app.store.laterOnUpdateState?.checkedAt > 0);
  }

  console.log("\n── 断网时不能把「有新版本」这个已知事实抹掉 ──");
  {
    const app = boot({
      store: { laterOnUpdateState: { checkedAt: 0, latest: { version: "1.76.0", tag: "v1.76.0", pageUrl: "https://example.com" }, ignored: [] } },
      responses: ["throw", "throw"]
    });
    await tick(80);
    check("上次查到的版本还在", app.store.laterOnUpdateState?.latest?.version === "1.76.0");
    check("角标仍然亮着", app.badges.includes("↑"), app.badges.join(" → "));
  }

  console.log("\n── 已经是最新版：不提示 ──");
  {
    const app = boot({ responses: [apiOk("v1.75.0-my.1")] });
    await tick(80);
    check("角标是空的", app.badges.at(-1) === "", app.badges.join(" → "));
    check("悬浮说明回到默认入口", /打开 LaterOn 侧栏/.test(app.titles.at(-1) || ""), app.titles.at(-1));
  }

  console.log("\n── 24 小时内不重复联网 ──");
  {
    const app = boot({ responses: [apiOk("v1.76.0-my.1")] });
    await tick(80);
    const before = app.fetchCalls.length;
    app.store.laterOnUpdateState.checkedAt = Date.now();   // 刚刚查过
    await app.sandbox.checkForUpdate();
    await tick(20);
    check("自动检查被时间窗挡住", app.fetchCalls.length === before, `${before} → ${app.fetchCalls.length}`);
    // 补一条应答：不然强制检查会因为没数据而连走两个来源，次数就对不上了
    app.responses.push(apiOk("v1.76.0-my.1"));
    await app.sandbox.checkForUpdate({ force: true });
    await tick(20);
    check("手动「立即检查」不受时间窗限制", app.fetchCalls.length === before + 1, `${before} → ${app.fetchCalls.length}`);
  }

  console.log("\n── 关掉自动检查就真的不联网 ──");
  {
    const app = boot({ responses: [apiOk("v1.76.0-my.1")], settings: { autoCheckUpdate: false } });
    await tick(80);
    check("一次请求都没发", app.fetchCalls.length === 0, String(app.fetchCalls.length));
    check("没有角标", !app.badges.includes("↑"));
    await app.sandbox.checkForUpdate({ force: true });
    await tick(20);
    check("手动检查仍然可用", app.fetchCalls.length === 1, String(app.fetchCalls.length));
  }

  console.log("\n── 点「忽略」之后角标要清掉 ──");
  {
    const app = boot({ responses: [apiOk("v1.76.0-my.1")] });
    await tick(80);
    check("先亮着", app.badges.at(-1) === "↑");
    await app.send({ type: "IGNORE_UPDATE", version: "1.76.0" });
    await tick(20);
    check("忽略后角标清空", app.badges.at(-1) === "", app.badges.join(" → "));
    check("版本号进了忽略名单", app.store.laterOnUpdateState?.ignored?.includes("1.76.0"), JSON.stringify(app.store.laterOnUpdateState?.ignored));
  }

  console.log("\n── 库里没有老数据：静默把 schema 标上去 ──");
  {
    const app = boot({
      store: { laterOnItems: [{ id: "a", title: "A", url: "https://a.test/" }] },
      responses: [apiOk("v1.75.0-my.1")]
    });
    await tick(80);
    check("schema 直接落到当前版本", app.store.laterOnDataSchema === app.sandbox.LaterOnMigrations.SCHEMA, String(app.store.laterOnDataSchema));
    check("没有挂待确认", app.store.laterOnMigrationPending === undefined);
    const state = await app.send({ type: "GET_UPDATE_STATE" });
    check("页面问状态时 migration 是空的", !state?.migration, JSON.stringify(state?.migration));
  }

  console.log("\n── 库里还有老形状数据：先停下，不动数据 ──");
  {
    const app = boot({
      store: {
        laterOnItems: [
          { id: "a", title: "A", url: "https://a.test/", description: "旧摘要", image: "https://a.test/c.png" },
          { id: "b", title: "B", url: "https://b.test/", contentHtml: "<p>旧正文</p>" }
        ],
        laterOnItemDetails: {}
      },
      responses: [apiOk("v1.75.0-my.1")]
    });
    await tick(80);
    const pending = app.store.laterOnMigrationPending;
    check("挂上了待确认", Array.isArray(pending?.ids) && pending.ids.length === 2, JSON.stringify(pending));
    check("要求确认", pending?.needsConfirm === true);
    check("索引里的摘要**还在**（没有偷偷迁）", app.store.laterOnItems[0].description === "旧摘要");
    check("详情表还是空的", Object.keys(app.store.laterOnItemDetails || {}).length === 0);
    check("schema 没有前进", app.store.laterOnDataSchema === undefined, String(app.store.laterOnDataSchema));

    const state = await app.send({ type: "GET_UPDATE_STATE" });
    check("页面能问到这个待确认", state?.migration?.ids?.length === 2, JSON.stringify(state?.migration));

    const result = await app.send({ type: "RUN_MIGRATIONS" });
    await tick(60);
    check("确认后执行成功", result?.ok === true, JSON.stringify(result));
    check("详情表拿到摘要与封面", app.store.laterOnItemDetails?.a?.description === "旧摘要", JSON.stringify(app.store.laterOnItemDetails?.a));
    check("索引里的摘要被剥掉（拆分生效）", !("description" in app.store.laterOnItems[0]), JSON.stringify(app.store.laterOnItems[0]));
    check("旧正文也被清掉了", !("contentHtml" in app.store.laterOnItems[1]), JSON.stringify(app.store.laterOnItems[1]));
    check("待确认清空", app.store.laterOnMigrationPending === undefined);
    check("schema 落到当前版本", app.store.laterOnDataSchema === app.sandbox.LaterOnMigrations.SCHEMA, String(app.store.laterOnDataSchema));
    check("迁移完成的广播发出去了", app.broadcasts.some((m) => m?.type === "MIGRATIONS_DONE"));
  }

  console.log("\n── 静态护栏（结构层面的两个老坑）──");
  {
    const css = fs.readFileSync(path.join(ROOT, "update-ui.css"), "utf8");
    // 自己写了 display:flex，就必须自己补 [hidden]{display:none}：浏览器默认规则
    // 压不过作者样式，漏了就是「明明设置了 hidden，提示条照样显示」。
    check("提示条自己写了 [hidden] 规则", /\.lu-strip\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(css));
    check("整块不接收点击以外的意外布局伤害（不写死宽度）", !/\.lu-strip\s*\{[^}]*width\s*:\s*\d+px/.test(css));

    for (const page of ["library.html", "sidepanel.html", "settings.html"]) {
      const html = fs.readFileSync(path.join(ROOT, page), "utf8");
      check(`${page} 有提示条容器`, /id="updateStrip"/.test(html));
      check(`${page} 引了 update-ui.css`, /href="update-ui\.css"/.test(html));
      check(`${page} 引了 update-ui.js`, /src="update-ui\.js"/.test(html));
    }

    // 三个界面都要能显示「有新版本」，任何一处漏挂客户端模块，那一处就永远静悄悄。
    const clients = ["library.js", "sidepanel.js", "settings.js"].filter((file) => {
      const code = fs.readFileSync(path.join(ROOT, file), "utf8");
      return /LaterOnUpdateUI\?\.mount\(/.test(code);
    });
    check("三个页面都挂载了提示条", clients.length === 3, clients.join(","));
  }

  console.log(`\n${failures === 0 ? "🎉" : "❌"} 共 ${total} 项，通过 ${total - failures}，失败 ${failures}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
