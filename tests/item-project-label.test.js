// 卡片上的「所属项目」标签必须一开始就对。
// 回归的 bug：卡片是复用的 DOM，新建那张卡片时只把项目选项铺进了 <select>，
// 却没有把 value 选中——于是任何「这一轮才新建出来」的卡片都会停在下拉第一项
// 「等待整理」上。最典型的就是全局搜索：人在「等待整理」里把某篇移进了项目，
// 再一搜，那篇是新建的卡片，明明已经归了项目却显示成等待整理，要再触发一次
// updateCard 才纠正过来。
// 覆盖：
//  1) 首屏新建的卡片就显示它真正所属的项目
//  2) 全局搜索里新建出来的卡片同样正确（这就是被报上来的场景）
//  3) 项目改名后，已经画好的卡片跟着显示新名字（走 refreshCardProjectOptions）
//  4) 移动收藏到另一个项目后，卡片标签立刻跟上
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
const i18nSource = fs.readFileSync(`${ROOT}/i18n.js`, "utf8");
const librarySource = fs.readFileSync(`${ROOT}/library.js`, "utf8");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
virtualConsole.on("error", (message) => errors.push(String(message)));

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "chrome-extension://lateron/library.html",
  virtualConsole
});
const { window } = dom;
const { document } = window;

const now = Date.now();
const item = (id, extra) => ({
  id, title: `标题 ${id}`, description: "摘要", image: "", favicon: "",
  source: "少数派", url: `https://example.com/${id}`, savedAt: now, read: false, ...extra
});
const store = {
  laterOnItems: [
    item("w1", { title: "Alpha 深度工作法", projectId: "work" }),
    item("r1", { title: "Beta 深度阅读", projectId: "reading", savedAt: now - 1000 }),
    item("u1", { title: "Gamma 深度待整理", projectId: null, savedAt: now - 2000 })
  ],
  laterOnProjects: [
    { id: "work", name: "工作", createdAt: 1 },
    { id: "reading", name: "阅读", createdAt: 2 }
  ],
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
    query: () => Promise.resolve([{ id: 1, windowId: 7, active: true }]),
    update: () => Promise.resolve({ id: 1 }),
    create: () => Promise.resolve({ id: 9 })
  },
  windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
  sidePanel: { open: () => Promise.resolve() },
  runtime: {
    getURL: (p) => `chrome-extension://lateron/${p}`,
    sendMessage: () => Promise.resolve({ ready: true }),
    onMessage: { addListener() {} }
  }
};
if (typeof window.crypto?.randomUUID !== "function") {
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
}
window.scrollTo = () => {};

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

const cardOf = (id) => document.querySelector(`#cardGrid .card[data-id="${id}"]`);
// 卡片上那个下拉「显示」的项目名 = 选中项的文字（这正是用户看到的那行字）。
const labelOf = (id) => {
  const select = cardOf(id)?.querySelector(".project-select");
  if (!select) return "(没有卡片)";
  const selected = select.selectedOptions?.[0] || [...select.options].find((option) => option.value === select.value);
  return selected ? selected.textContent : "(空白)";
};
const cardIds = () => [...document.querySelectorAll("#cardGrid .card")].map((card) => card.dataset.id).sort();
async function search(word) {
  const input = document.querySelector("#searchInput");
  input.value = word;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(220);
}

(async () => {
  window.eval(i18nSource);
  require("./helpers/item-mutation")(window);
  window.eval(librarySource);
  await tick(60);

  console.log("── 首屏：新建的卡片就该显示正确的项目 ──");
  click(document.querySelector('.project-nav[data-project="unfiled"]'));
  await tick(60);
  check("（准备）等待整理里只有 u1", cardIds().join(",") === "u1", cardIds().join(","));
  check("未归类的条目显示「等待整理」", labelOf("u1") === "等待整理", labelOf("u1"));

  // 进「工作」项目：这一轮卡片是新建的，正是 bug 的现场。
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(60);
  check("（准备）工作项目里是 w1", cardIds().join(",") === "w1", cardIds().join(","));
  check("归到「工作」的条目，卡片标签是「工作」而不是「等待整理」", labelOf("w1") === "工作", labelOf("w1"));

  console.log("\n── 全局搜索：新建出来的卡片同样要正确 ──");
  await search("深度");
  check("搜索能同时搜到三个项目里的条目", cardIds().join(",") === "r1,u1,w1", cardIds().join(","));
  check("项目「工作」里的 w1 标签是「工作」", labelOf("w1") === "工作", labelOf("w1"));
  check("项目「阅读」里的 r1 标签是「阅读」", labelOf("r1") === "阅读", labelOf("r1"));
  check("等待整理里的 u1 才是「等待整理」", labelOf("u1") === "等待整理", labelOf("u1"));

  console.log("\n── 项目改名：已经画好的卡片跟着改 ──");
  store.laterOnProjects = store.laterOnProjects.map((project) =>
    project.id === "work" ? { ...project, name: "工作台" } : project);
  changeListeners.forEach((fn) => fn({ laterOnProjects: { newValue: store.laterOnProjects } }, "local"));
  await tick(80);
  check("卡片标签换成了新名字「工作台」", labelOf("w1") === "工作台", labelOf("w1"));
  check("别的项目不受影响", labelOf("r1") === "阅读", labelOf("r1"));

  console.log("\n── 移到另一个项目：标签立刻跟上 ──");
  await search("");
  click(document.querySelector('#projectList .project-nav[data-project="work"]'));
  await tick(60);
  const select = cardOf("w1").querySelector(".project-select");
  // 下拉选项是懒填的：真实用户先点开下拉（focus/pointerdown）触发铺满，才能选到别的项目。
  select.dispatchEvent(new window.Event("focus"));
  select.value = "reading";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(240);
  check("存储里的归属已经改成 reading",
    store.laterOnItems.find((entry) => entry.id === "w1")?.projectId === "reading",
    String(store.laterOnItems.find((entry) => entry.id === "w1")?.projectId));

  click(document.querySelector('.project-nav[data-project="all"]'));
  await tick(60);
  click(document.querySelector('#projectList .project-nav[data-project="reading"]'));
  await tick(60);
  check("移到「阅读」后，卡片标签是「阅读」", labelOf("w1") === "阅读", labelOf("w1"));

  console.log("\n── 卡片被复用、而新项目还不在下拉里：标签也不能退回「等待整理」 ──");
  // 上面那条验证的是「卡片重建」（切到 reading 项目时 w1 是新造的卡，走 createCard）。
  // 这一条走的是另一条路：卡片留在原地被 updateCard 复用，归属变成下拉里还没有的项目。
  // 现实里发生在全局搜索里拖动归类、或批量移动之后——搜索结果不受项目限制，
  // 卡片一直都在，只是 select 里的选项还没被懒填过。
  await search("深度");
  const optionsBefore = [...cardOf("u1").querySelector(".project-select").options].map((option) => option.textContent);
  check("（准备）u1 的下拉还没铺满，只有「等待整理」",
    optionsBefore.length === 1 && optionsBefore[0] === "等待整理", optionsBefore.join(" / "));
  const movedU1 = store.laterOnItems.map((entry) => entry.id === "u1" ? { ...entry, projectId: "work" } : entry);
  changeListeners.forEach((fn) => fn({ laterOnItems: { oldValue: store.laterOnItems, newValue: movedU1 } }, "local"));
  store.laterOnItems = movedU1;
  await tick(120);
  // 注意：上面「项目改名」那一段已经把 work 改成「工作台」，这里要跟着用新名字。
  check("复用中的卡片把归属改到没铺过的项目，标签仍是「工作台」", labelOf("u1") === "工作台", labelOf("u1"));

  console.log("\n── 页面错误 ──");
  check("整个过程没有出现未捕获的错误", errors.length === 0, errors.join(" | "));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
