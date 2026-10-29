// 多选之后把一叠卡片一起拖进项目 —— 锁住四件事：
//   ① 拖「已选中的一张」不退出多选（以前 dragstart 一进去就 setSelectMode(false)，
//      于是多选状态下根本拖不动一组，只能一张一张搬）
//   ② 拖影是「一叠」：多一层错开的空壳 + 右上角 +N，索引里的其他选中卡片缩小淡出
//   ③ 松手落在项目行上，这一叠全部改归属（不是只搬被拖的那一张）
//   ④ 拖一张**没选中**的卡片，仍然按老规矩退出多选、只挪这一张
// 运行：node tests/select-group-drag.test.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

const item = (id, savedAt, extra = {}) => ({
  id,
  title: `标题 ${id}`,
  description: "摘要",
  image: "",
  favicon: "",
  source: "example.com",
  projectId: null,
  url: `https://example.com/${id}`,
  savedAt,
  status: "unread",
  ...extra
});

// jsdom 没有排版，getBoundingClientRect 全是 0；给每张卡铺一个假位置（一行三张）。
function layout(cards) {
  cards.forEach((card, index) => {
    const left = (index % 3) * 218;
    const top = Math.floor(index / 3) * 324;
    card.getBoundingClientRect = () => ({
      left, top, right: left + 200, bottom: top + 300, width: 200, height: 300, x: left, y: top
    });
  });
}

// 假的 DataTransfer：jsdom 没有实现拖拽数据，这里只需要 types / setData / getData。
function createDataTransfer() {
  const data = new Map();
  return {
    effectAllowed: "",
    dropEffect: "",
    get types() { return [...data.keys()]; },
    setData(type, value) { data.set(String(type), String(value)); },
    getData(type) { return data.get(String(type)) || ""; },
    setDragImage() {}
  };
}

async function boot(items) {
  const store = {
    laterOnItems: JSON.parse(JSON.stringify(items)),
    laterOnProjects: [{ id: "p1", name: "项目一" }],
    laterOnActiveProject: "unfiled",
    laterOnSettings: { sort: "custom" },
    laterOnOrder: {}
  };
  const dom = new JSDOM(read("library.html"), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "chrome-extension://lateron/library.html"
  });
  const { window } = dom;
  const { document } = window;
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of wanted) out[key] = JSON.parse(JSON.stringify(store[key] ?? null));
          return out;
        },
        set: async (patch) => {
          for (const [key, value] of Object.entries(patch)) store[key] = JSON.parse(JSON.stringify(value));
        }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [{ id: 7, windowId: 3 }],
      getCurrent: async () => ({ id: 7, windowId: 3 }),
      update: async () => ({}),
      create: async () => ({}),
      remove: async () => {},
      onCreated: { addListener() {} }
    },
    runtime: { getURL: (file) => `chrome-extension://lateron/${file}`, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    windows: { getCurrent: async () => ({ id: 3 }), create: async () => ({ id: 9 }) },
    sidePanel: { open: async () => ({}), close: async () => ({}) }
  };
  window.eval(read("i18n.js"));
  window.eval(read("dialog.js"));
  window.eval(read("url-utils.js"));
  window.eval(read("tab-navigation.js"));
  require("./helpers/item-mutation")(window);
  window.eval(read("library.js"));
  const tick = (ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
  await tick(80);
  document.querySelector('.project-nav[data-project="unfiled"]')
    ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick(60);
  return { window, document, store, tick, grid: document.querySelector("#cardGrid") };
}

const cardOf = (fx, id) => fx.document.querySelector(`#cardGrid .card[data-id="${id}"]`);
const bulkCount = (fx) => fx.document.querySelector("#bulkCount").textContent;
const toastText = (fx) => fx.document.querySelector("#toast").textContent;
const click = (fx, el) => el.dispatchEvent(new fx.window.MouseEvent("click", { bubbles: true, cancelable: true }));

async function selectCards(fx, ids) {
  click(fx, fx.document.querySelector("#selectMode"));
  await fx.tick(30);
  for (const id of ids) {
    click(fx, cardOf(fx, id).querySelector(".select-check"));
    await fx.tick(10);
  }
}

// 模拟一次拖拽：从 dragId 那张卡拖到 selector 指定的元素上，返回 dataTransfer。
async function dragTo(fx, dragId, selector) {
  const cards = [...fx.grid.querySelectorAll(".card")];
  layout(cards);
  const source = cards.find((card) => card.dataset.id === dragId);
  const transfer = createDataTransfer();

  const start = new fx.window.Event("dragstart", { bubbles: true, cancelable: true });
  start.dataTransfer = transfer;
  start.clientX = 10;
  start.clientY = 10;
  source.dispatchEvent(start);
  await fx.tick(30);

  const target = fx.document.querySelector(selector);
  if (!target) throw new Error(`找不到放置目标：${selector}`);
  const over = new fx.window.Event("dragover", { bubbles: true, cancelable: true });
  over.dataTransfer = { dropEffect: "", types: [...transfer.types] };
  over.clientX = 10;
  over.clientY = 10;
  target.dispatchEvent(over);
  await fx.tick(10);

  const drop = new fx.window.Event("drop", { bubbles: true, cancelable: true });
  drop.dataTransfer = transfer;
  drop.clientX = 10;
  drop.clientY = 10;
  target.dispatchEvent(drop);
  await fx.tick(80);

  const end = new fx.window.Event("dragend", { bubbles: true });
  end.dataTransfer = transfer;
  source.dispatchEvent(end);
  await fx.tick(30);
  return { transfer, target };
}

(async () => {
  console.log("── 多选后拖「已选中的一张」：整组一起走 ──");
  const three = [item("a", 300), item("b", 200), item("c", 100)];
  let fx = await boot(three);
  await selectCards(fx, ["a", "b"]);
  check("（准备）选了两张", bulkCount(fx) === "已选 2 篇", bulkCount(fx));

  const cards = [...fx.grid.querySelectorAll(".card")];
  layout(cards);
  const sourceA = cardOf(fx, "a");
  const transfer = createDataTransfer();
  const start = new fx.window.Event("dragstart", { bubbles: true, cancelable: true });
  start.dataTransfer = transfer;
  start.clientX = 10;
  start.clientY = 10;
  sourceA.dispatchEvent(start);
  await fx.tick(30);

  check("拖已选中的卡片不会退出多选", fx.grid.classList.contains("selecting"));
  check("网格进入「整组拖拽」状态", fx.grid.classList.contains("is-group-dragging"));
  const preview = fx.document.querySelector(".drag-group-preview");
  check("拖影是「一叠」而不是单张", !!preview && preview.querySelectorAll(".drag-group-sheet").length === 2);
  check("拖影右上角标着 +1（两篇里除去手里那张）",
    preview?.querySelector(".drag-group-count")?.textContent === "+1",
    preview?.querySelector(".drag-group-count")?.textContent);
  check("被拖那一张不在拖影里露出勾选态", !preview?.querySelector(".drag-group-top")?.classList.contains("selected"));
  check("自定义类型里带上了整组 id",
    transfer.getData("application/x-lateron-items") === JSON.stringify(["a", "b"]),
    transfer.getData("application/x-lateron-items"));
  check("text/plain 仍是单张 id（老的单张拖放照样能用）", transfer.getData("text/plain") === "a");

  // 松手前先把手松开，走完整个 drop → dragend 流程。
  const endStart = new fx.window.Event("dragend", { bubbles: true });
  endStart.dataTransfer = transfer;
  sourceA.dispatchEvent(endStart);
  await fx.tick(30);
  check("松手后整组拖拽的样式被清掉", !fx.grid.classList.contains("is-group-dragging"));
  check("松手后拖影被移除", !fx.document.querySelector(".drag-group-preview"));
  check("松手后多选仍在（拖出去没落点也不该丢选择）", fx.grid.classList.contains("selecting"));

  console.log("\n── 拖到项目行：这一叠全部改归属 ──");
  await dragTo(fx, "a", '.project-row[data-project="p1"]');
  const moved = fx.store.laterOnItems.reduce((acc, entry) => {
    acc[entry.id] = entry.projectId || null;
    return acc;
  }, {});
  check("两张都进了项目一", moved.a === "p1" && moved.b === "p1", JSON.stringify(moved));
  check("没选中的那张原地不动", moved.c === null, JSON.stringify(moved));
  check("搬完自动退出多选", !fx.grid.classList.contains("selecting"));
  check("提示语报了篇数和项目名", toastText(fx) === "已将 2 篇移到「项目一」", toastText(fx));
  check("项目行的高亮收掉了", !fx.document.querySelector(".drop-target"));

  console.log("\n── 拖一张没选中的卡片：照旧退出多选、只挪这一张 ──");
  fx = await boot([item("a", 300), item("b", 200), item("c", 100)]);
  await selectCards(fx, ["a", "b"]);
  await dragTo(fx, "c", '.project-row[data-project="p1"]');
  const after = fx.store.laterOnItems.reduce((acc, entry) => {
    acc[entry.id] = entry.projectId || null;
    return acc;
  }, {});
  check("只挪了拖的那一张", after.c === "p1" && after.a === null && after.b === null, JSON.stringify(after));
  check("拖没选中的卡片会退出多选", !fx.grid.classList.contains("selecting"));
  check("单张拖拽不出「一叠」拖影", !fx.document.querySelector(".drag-group-preview"));

  console.log("\n── 只选一张时不该被当成整组 ──");
  fx = await boot([item("a", 300), item("b", 200)]);
  await selectCards(fx, ["a"]);
  const single = createDataTransfer();
  const singleStart = new fx.window.Event("dragstart", { bubbles: true, cancelable: true });
  singleStart.dataTransfer = single;
  singleStart.clientX = 10;
  singleStart.clientY = 10;
  layout([...fx.grid.querySelectorAll(".card")]);
  cardOf(fx, "a").dispatchEvent(singleStart);
  await fx.tick(30);
  check("只有一张选中时不高亮整组拖拽", !fx.grid.classList.contains("is-group-dragging"));
  check("只有一张选中时拖影是单张", !fx.document.querySelector(".drag-group-preview"));
  check("这一张拖完仍退出多选", !fx.grid.classList.contains("selecting"));

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("测试脚本自身出错：", error);
  process.exit(1);
});
