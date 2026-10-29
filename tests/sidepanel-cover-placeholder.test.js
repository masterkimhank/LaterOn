// 侧栏缩略图：有封面时必须「隐藏」占位，而不是靠叠一层盖住。
//
// 背景：占位是橙色渐变 + LaterOn Logo 砖（.thumb-placeholder），封面图绝对定位盖在
// 它上面。视觉上不透明的 JPEG 没问题，但透明 PNG / SVG 会透出底下的橙色渐变和 Logo，
// 看上去像封面坏了。正确做法是封面存在时把占位 display:none，由 .thumb 的
// var(--cover-bg) 当底色。
//
// 这里验证三件事：
//   1) 有封面（远程 URL 与 local:// 两条来源）时，封面是 .thumb 的第一个子元素，
//      且 CSS 里确实有 `.thumb-img ~ .thumb-placeholder{display:none}` 这条规则
//      —— 两者缺一，占位就不会被隐藏。
//   2) 封面被移除后，图片节点消失、占位重新可见。
//   3) 图片加载失败且降级链走完时，坏图被移除、占位恢复（不会留一块空白）。
//
// 运行：node tests/sidepanel-cover-placeholder.test.js
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const html = read("sidepanel.html");
const sidepanelSource = read("sidepanel.js");
const sidepanelCss = read("sidepanel.css");
const tabNavigationSource = read("tab-navigation.js");
const i18nSource = read("i18n.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

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
window.scrollTo = () => {};

const now = Date.now();
const REMOTE_COVER = "https://img.example.com/cover.png";
const UPLOADED = "data:image/png;base64,UPLOADEDCOVER";
const store = {
  laterOnItems: [
    // 远程抓到的封面
    { id: "remote", title: "远程封面", description: "d", image: REMOTE_COVER, favicon: "", source: "example.com", projectId: null, url: "https://example.com/1", savedAt: now, status: "unread" },
    // 用户自己上传的封面：条目里只存 local://<id> 指针
    { id: "local", title: "本地上传封面", description: "d", image: "local://local", favicon: "", source: "example.com", projectId: null, url: "https://example.com/2", savedAt: now - 1000, status: "unread" },
    // 没有封面
    { id: "none", title: "没有封面", description: "d", image: "", favicon: "", source: "example.com", projectId: null, url: "https://example.com/3", savedAt: now - 2000, status: "unread" }
  ],
  laterOnCovers: { local: UPLOADED },
  laterOnProjects: [],
  laterOnActiveProject: "unfiled",
  laterOnSettings: {}
};

const changeListeners = [];
const browserTabs = [{ id: 1, windowId: 7, active: true, url: "https://current.com" }];
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
    query: (queryInfo = {}) => Promise.resolve(queryInfo.active ? browserTabs.filter((tab) => tab.active) : browserTabs.slice()),
    update: (id, options) => Promise.resolve({ id, ...options }),
    create: (options) => Promise.resolve({ id: 99, ...options }),
    onActivated: { addListener() {} },
    onUpdated: { addListener() {} }
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: () => Promise.resolve({ ok: true }),
    onMessage: { addListener() {} }
  }
};

const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const itemOf = (id) => document.querySelector(`.item[data-id="${id}"]`);
const thumbOf = (id) => itemOf(id)?.querySelector(".thumb");
const imgOf = (id) => thumbOf(id)?.querySelector("img.thumb-img");
const placeholderOf = (id) => thumbOf(id)?.querySelector(".thumb-placeholder");

window.eval(i18nSource);
window.eval(tabNavigationSource);
window.eval(sidepanelSource);

(async () => {
  await tick(60);

  console.log("── 第 1 步：CSS 契约 ──");
  // 光有 JS 把封面插在前面不够，必须同时有这条规则把占位隐藏掉。
  const hideRule = /\.thumb-img\s*~\s*\.thumb-placeholder\s*\{[^}]*display\s*:\s*none/.test(sidepanelCss);
  check("sidepanel.css 有 .thumb-img ~ .thumb-placeholder{display:none}", hideRule);
  // 占位自己不能被设成常隐，否则没封面时就只剩一块纯色。
  check("占位本身仍然是 display:grid（没封面时照常显示）",
    /\.thumb-placeholder\s*\{[^}]*display\s*:\s*grid/.test(sidepanelCss));
  check("封面不再靠 z-index 压在占位上（占位已隐藏，不需要叠层）",
    !/\.thumb\s+\.thumb-img\s*\{[^}]*z-index/.test(sidepanelCss));

  console.log("\n── 第 2 步：有封面时，封面在占位「前面」且占位存在 ──");
  const remoteImg = imgOf("remote");
  check("远程封面渲染出来了", !!remoteImg && remoteImg.getAttribute("src") === REMOTE_COVER);
  check("远程封面是 .thumb 的第一个子元素（相邻兄弟选择器才生效）",
    !!remoteImg && thumbOf("remote").firstElementChild === remoteImg,
    thumbOf("remote")?.firstElementChild?.className);
  check("远程封面卡片仍保留占位节点（靠 CSS 隐藏，不是删掉）", !!placeholderOf("remote"));
  // jsdom 只存 IDL 属性、不反射成 HTML 属性（真实 Chrome 会反射），所以这里读属性值。
  check("封面声明了 no-referrer（小红书等 CDN 会拒绝扩展 Referer）",
    remoteImg?.referrerPolicy === "no-referrer");
  check("封面是 lazy + async（700 条时不阻塞首屏）",
    remoteImg?.loading === "lazy" && remoteImg?.decoding === "async");

  const localImg = imgOf("local");
  check("local:// 指针解析成 covers 里的真实图片",
    !!localImg && localImg.getAttribute("src") === UPLOADED,
    localImg?.getAttribute("src")?.slice(0, 40));
  check("本地上传封面同样排在占位前面",
    !!localImg && thumbOf("local").firstElementChild === localImg);

  console.log("\n── 第 3 步：没有封面时只剩占位 ──");
  check("无封面卡片没有 img.thumb-img", !imgOf("none"));
  check("无封面卡片有占位", !!placeholderOf("none"));
  check("无封面卡片占位在第一位（不会被上面的规则误伤，因为没有 .thumb-img 兄弟）",
    thumbOf("none").firstElementChild === placeholderOf("none"));

  console.log("\n── 第 4 步：移除封面后，图片消失、占位恢复 ──");
  const before = store.laterOnItems.find((item) => item.id === "remote");
  const oldList = store.laterOnItems;
  store.laterOnItems = store.laterOnItems.map((item) => item.id === "remote" ? { ...item, image: "" } : item);
  changeListeners.forEach((fn) => fn({ laterOnItems: { oldValue: oldList, newValue: store.laterOnItems } }, "local"));
  await tick(60);
  check("封面节点被移除", !imgOf("remote"));
  check("占位还在（透明背景砖重新可见）", !!placeholderOf("remote"));
  check("其他卡片的封面没被牵连", !!imgOf("local"), imgOf("local") ? "还在" : "被误删");
  // 复原，后面的失败降级要基于有封面的卡片
  store.laterOnItems = store.laterOnItems.map((item) => item.id === "remote" ? { ...item, image: before.image } : item);
  changeListeners.forEach((fn) => fn({ laterOnItems: { oldValue: oldList, newValue: store.laterOnItems } }, "local"));
  await tick(60);
  check("重新设置封面后图片回来了", !!imgOf("remote"));

  console.log("\n── 第 5 步：图片加载失败且没有降级可用时，坏图移除、占位恢复 ──");
  const broken = imgOf("remote");
  broken.dispatchEvent(new window.Event("error"));
  await tick(40);
  check("坏图节点被移除（不会留白）", !imgOf("remote"));
  check("占位恢复显示", !!placeholderOf("remote"));

  console.log("\n── 第 6 步：全程没有未捕获的错误 ──");
  check("没有 jsdom 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
