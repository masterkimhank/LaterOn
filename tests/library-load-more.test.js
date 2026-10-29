// 库页分页：卡片不再一次全铺出来，首屏只铺一页（48 张），翻到底 / 点「加载更多」再续。
//
// 为什么要有这一组：以前是「分批画，但最终全画出来」——700 条时 DOM 里躺着 700 张卡、
// 一万八千多个节点，每次数据变化都要为整棵子树做一遍样式计算。分页之后「屏幕上只有一页」，
// 但**计数、排序、全选、批量打开都必须仍然按全部条目算**，否则就会冒出这几类回归：
//   ① 计数只报一页（用户以为收藏丢了）；
//   ② 全选只选到一页，按钮文字还永远变不成「取消全选」；
//   ③ 换筛选/换项目之后停在第三页，看到一片空白（其实第一页有内容）。
// 这些都不是「画得好不好看」，是「数字和操作对不对」，所以用 jsdom 盯着最合适。
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(`${ROOT}/library.html`, "utf8");
const librarySource = fs.readFileSync(`${ROOT}/library.js`, "utf8");

const PAGE = 48;          // 和 library.js 里的 LIBRARY_PAGE_SIZE 对齐
const TOTAL = 147;        // 3 页多一点：48 / 96 / 144 / 147
const DONE = 27;          // 顺手留一批「已读」，用来验证换筛选会回到第一页

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

const now = Date.now();
const items = Array.from({ length: TOTAL }, (_, i) => {
  const done = i < DONE;                       // 前 27 条是「已读」，其余未读
  return {
    id: `i${i}`,
    title: `第 ${i} 篇`,
    description: "摘要",
    image: "",
    favicon: "",
    source: "example.com",
    url: `https://example.com/${i}`,
    // savedAt 递减 → 「最近添加」排序下，id 越小越靠前，断言好写
    savedAt: now - i * 1000,
    status: done ? "done" : "unread"
  };
});

function boot(url, overrides = {}) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: url || "chrome-extension://lateron/library.html?from=sidepanel&project=unfiled&filter=unread",
    virtualConsole: vc
  });
  const { window } = dom;
  const store = {
    laterOnItems: items,
    laterOnProjects: [],
    laterOnCovers: {},
    laterOnOrder: {},
    laterOnActiveProject: "unfiled",
    laterOnSettings: {},
    laterOnFilter: "unread",
    laterOnFilterChosen: true,
    laterOnCurrentItem: "",
    ...overrides
  };
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get(keys) {
          const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
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
          window.setTimeout(() => listeners.forEach((fn) => fn(changes, "local")), 0);
          return Promise.resolve();
        },
        remove() { return Promise.resolve(); }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    },
    tabs: {
      getCurrent: () => Promise.resolve({ id: 1, windowId: 7, active: true }),
      query: () => Promise.resolve([{ id: 1, windowId: 7, active: true }]),
      update: () => Promise.resolve({ id: 1 }),
      create: () => Promise.resolve({ id: 9 }),
      remove: () => Promise.resolve()
    },
    windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
    sidePanel: { open: () => Promise.resolve() },
    runtime: {
      getURL: (file) => `chrome-extension://lateron/${file}`,
      sendMessage: () => Promise.resolve({ ready: true }),
      onMessage: { addListener() {} }
    }
  };
  if (typeof window.crypto?.randomUUID !== "function") {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` }
    });
  }
  window.scrollTo = () => {};
  window.requestIdleCallback = (fn) => window.setTimeout(fn, 0);
  window.cancelIdleCallback = () => {};
  for (const file of ["i18n.js", "dialog.js", "url-utils.js", "tab-navigation.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
  require("./helpers/item-mutation")(window);
  // 定位用例要用到「正在读哪一篇」的共享标记，必须在 library.js 求值前写进 store。
  window.eval(librarySource);
  return { window, document: window.document, store, listeners };
}

const tick = (window, ms = 60) => new Promise((resolve) => window.setTimeout(resolve, ms));
const cards = (document) => [...document.querySelectorAll("#cardGrid .card")];
const cardIds = (document) => cards(document).map((card) => card.dataset.id);
const click = (window, element) => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

(async () => {
  const { window, document } = boot();
  await tick(window, 200);

  console.log("── 首屏只铺一页，但数字是全量 ──");
  check(`首屏 DOM 里只有 ${PAGE} 张卡`, cards(document).length === PAGE, String(cards(document).length));
  // 未读的是 i27～i146（前 27 条是已读被筛掉），「最近添加」下 id 小的更新 → 首张是 i27。
  check("首屏第一张就是排序后的第一条", cardIds(document)[0] === "i27", cardIds(document)[0]);
  check(
    "顶部计数写的还是全部 147 条（不是一页）",
    /147 篇网页/.test(document.querySelector("#countText").textContent),
    document.querySelector("#countText").textContent
  );
  const footer = document.querySelector("#loadMore");
  check("页脚出现了", footer.hidden === false, `hidden=${footer.hidden}`);
  check(
    "页脚按钮写明还差多少",
    footer.querySelector("button").textContent === "加载更多（还有 72 篇）",
    footer.querySelector("button").textContent
  );
  check(
    "页脚进度写明已显示多少",
    footer.querySelector(".load-more-progress").textContent === "已显示 48 / 120 篇",
    footer.querySelector(".load-more-progress").textContent
  );

  console.log("\n── 点「加载更多」：一页一页往下接 ──");
  click(window, footer.querySelector("button"));
  await tick(window, 120);
  check("第一次点完是两页 96 张", cards(document).length === 96, String(cards(document).length));
  check(
    "续画的部分接在后面，没有把前面的顺序打乱",
    cardIds(document).slice(48, 51).join(",") === "i75,i76,i77",
    cardIds(document).slice(48, 51).join(",")
  );
  check("按钮文案跟着变", footer.querySelector("button").textContent === "加载更多（还有 24 篇）", footer.querySelector("button").textContent);

  click(window, footer.querySelector("button"));
  await tick(window, 120);
  check("第二次点完铺满 120 张", cards(document).length === 120, String(cards(document).length));
  check("铺满之后页脚收起", footer.hidden === true, `hidden=${footer.hidden}`);
  const lastCard = cards(document).at(-1);
  check("最后一张是排序末位（i146）", lastCard?.dataset.id === "i146", lastCard?.dataset.id);

  console.log("\n── 全选要覆盖全部条目，不只是已经铺出来的那几页 ──");
  click(window, document.querySelector("#selectMode"));
  await tick(window, 30);
  click(window, document.querySelector("#bulkSelectAll"));
  await tick(window, 30);
  check("已选数量是 120（全部未读），不是 48", document.querySelector("#bulkCount").textContent === "已选 120 篇", document.querySelector("#bulkCount").textContent);
  check("按钮变成「取消全选」", document.querySelector("#bulkSelectAll").textContent === "取消全选", document.querySelector("#bulkSelectAll").textContent);
  check("屏幕上的卡片都打上了选中态", cards(document).every((card) => card.classList.contains("selected")), "有卡片没选中");
  click(window, document.querySelector("#bulkSelectAll"));
  await tick(window, 30);
  check("再点一次是全部取消", document.querySelector("#bulkCount").textContent === "已选 0 篇", document.querySelector("#bulkCount").textContent);
  check("卡片上的选中态也清掉了", cards(document).every((card) => !card.classList.contains("selected")), "有卡片还选中");
  click(window, document.querySelector("#bulkDone"));
  await tick(window, 30);

  console.log("\n── 换筛选：回到第一页，不留下一页的残影 ──");
  click(window, document.querySelector('.nav-item[data-filter="done"]'));
  await tick(window, 200);
  check("切到「已读」后只有 27 条", cards(document).length === 27, String(cards(document).length));
  check("27 条不足一页，页脚收起", footer.hidden === true, `hidden=${footer.hidden}`);
  // 计数按「这个范围里一共多少条」算（147），筛选只影响铺出来的卡片；这是既有口径，别改。
  check(
    "计数仍是这个范围的总条数（147），不随阅读筛选缩水",
    /147 篇网页/.test(document.querySelector("#countText").textContent),
    document.querySelector("#countText").textContent
  );

  click(window, document.querySelector('.nav-item[data-filter="unread"]'));
  await tick(window, 200);
  check("切回「未读」又是第一页 48 张（不是停在 120 张）", cards(document).length === PAGE, String(cards(document).length));
  check("页脚重新出现", footer.hidden === false, `hidden=${footer.hidden}`);

  console.log("\n── 数据更新不打回第一页 ──");
  // 模拟「在第三页标了一篇已读」：只改一条的数据，用户不该被弹回顶部。
  click(window, footer.querySelector("button"));
  await tick(window, 120);
  click(window, footer.querySelector("button"));
  await tick(window, 120);
  check("先翻到第 120 张", cards(document).length === 120, String(cards(document).length));
  const readToggle = cards(document).at(-1).querySelector(".read-toggle");
  click(window, readToggle);
  await tick(window, 200);
  check(
    "标完已读仍然停在已经翻到的地方（48 张页面之外的内容没被收回去）",
    cards(document).length >= 96,
    String(cards(document).length)
  );

  console.log("\n── 从侧栏展开、要定位到第 100 篇：那一页得先铺出来 ──");
  const focusId = items[100].id;
  const second = boot(
    `chrome-extension://lateron/library.html?from=sidepanel&project=unfiled&filter=unread&focus=${focusId}`,
    // 「正在读哪一篇」是共享标记，页面初始化时就要在存储里，focus 才会被认下来。
    { laterOnCurrentItem: focusId }
  );
  await tick(second.window, 250);
  check(
    `目标 ${focusId} 的卡片真的在 DOM 里`,
    !!second.document.querySelector(`#cardGrid .card[data-id="${focusId}"]`),
    "卡片不在 DOM 里"
  );
  check("为了它多铺了前面几页（DOM 数量超过一页）", cards(second.document).length > PAGE, String(cards(second.document).length));
  check("页脚仍然在，说明后面还有", second.document.querySelector("#loadMore").hidden === false, "页脚 hidden");

  console.log("\n── 别的视图点开一篇文章：这边要把那一篇铺出来再高亮 ──");
  const { window: w3, document: d3, listeners } = boot();
  await tick(w3, 200);
  check("一开始只有一页", d3.querySelectorAll("#cardGrid .card").length === PAGE, String(d3.querySelectorAll("#cardGrid .card").length));
  listeners.forEach((fn) => fn({ laterOnCurrentItem: { oldValue: "", newValue: "i120" } }, "local"));
  await tick(w3, 250);
  const current = d3.querySelector('#cardGrid .card[data-id="i120"]');
  check("目标卡片被铺出来了", !!current, "卡片不在 DOM 里");
  check("顺手标上了「正在读」", !!current?.classList.contains("is-current"), current?.className || "无卡片");

  if (failures === 0) console.log("\n全部检查通过 🎉");
  else {
    console.log(`\n有 ${failures} 项失败`);
    process.exitCode = 1;
  }
})();
