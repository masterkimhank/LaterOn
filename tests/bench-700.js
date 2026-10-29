// 性能基准：用真实 library.js 在 jsdom 里跑 100 / 300 / 700 条收藏，
// 看各环节耗时随条目数怎么增长（线性还是超线性）。
//
// 用法：
//   node tests/bench-700.js            # 三档 × 两种视图
//   node tests/bench-700.js 700        # 只测 700
//
// 口径（重要）：
//  - cards 视图 = 「等待整理」，全部条目铺成卡片，这是 700 条时最容易卡的地方。
//  - boards 视图 = 「全部项目」，默认打开收藏库看到的就是它。
//  - jsdom 的绝对耗时比 Chrome 慢一个量级，**不要横向外推**；这里看的是同一环境下的
//    增长曲线（n 变 7 倍、耗时变几倍），以及各环节之间的相对占比。
//  - 计时用内部钩子（render 开始 → 最后一批结束），不轮询查 DOM，
//    否则测量本身（在 1.8 万节点的树上反复跑选择器）会把数字撑大。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

const PROJECTS = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `项目 ${i}`, archived: false, createdAt: 1 }));

function makeItems(n, { unfiled = false } = {}) {
  const words = ['性能', '优化', '浏览器扩展', '收藏', '整理', '笔记', '视频', '教程', '前端', '存储'];
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `${words[i % words.length]} ${words[(i + 3) % words.length]} 第 ${i} 篇 - 示例站点`,
    titleAtSave: i % 3 === 0 ? `${words[i % words.length]} 收藏时原标题 ${i}` : undefined,
    description: `这是一段用于压测的摘要文字，长度接近真实抓取结果，大约一百来个字符，包含标点、英文 word、数字 ${i} 等等。`,
    image: `https://i.example.com/cover/${i}.jpg`,
    favicon: 'https://www.example.com/favicon.ico',
    source: `www.example${i % 20}.com`,
    projectId: unfiled ? null : i % 4 === 0 ? null : PROJECTS[i % PROJECTS.length].id,
    url: `https://www.example${i % 20}.com/article/${i}?from=bench`,
    savedAt: 1730000000000 - i * 60000 * 60 * 24,
    status: i % 5 === 0 ? 'done' : i % 7 === 0 ? 'reading' : 'unread',
    doneAt: i % 5 === 0 ? 1730000000000 : null
  }));
}

function makeChrome(store) {
  const json = (v) => JSON.parse(JSON.stringify(v));
  return {
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = json(store[key]);
          return out;
        },
        async set(patch) { for (const [k, v] of Object.entries(patch)) store[k] = json(v); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [], get: async () => ({}), update: async () => ({}),
      remove: async () => {}, create: async () => ({}),
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, onActivated: { addListener() {} }
    },
    runtime: { getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, lastError: null },
    i18n: { getUILanguage: () => 'zh-CN' }
  };
}

async function run(n, mode) {
  const unfiled = mode === 'cards';
  const items = makeItems(n, { unfiled });
  const store = {
    laterOnItems: items, laterOnProjects: PROJECTS, laterOnCovers: {}, laterOnOrder: {},
    laterOnActiveProject: unfiled ? 'unfiled' : 'all',
    laterOnSettings: {}, laterOnFilter: 'all', laterOnFilterChosen: true
  };
  const payloadKB = +(Buffer.byteLength(JSON.stringify(items), 'utf8') / 1024).toFixed(1);

  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const url = unfiled
    ? 'chrome-extension://lateron/library.html?from=sidepanel&project=unfiled'
    : 'chrome-extension://lateron/library.html';
  const dom = new JSDOM(read('library.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url, virtualConsole: vc });
  const { window } = dom;
  window.chrome = makeChrome(store);
  window.scrollTo = () => {};
  if (typeof window.crypto?.randomUUID !== 'function') {
    Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `fake-${Math.random().toString(36).slice(2)}` } });
  }
  window.requestIdleCallback = (fn) => { window.setTimeout(fn, 0); return 0; };
  window.cancelIdleCallback = () => {};
  for (const f of ['i18n.js', 'dialog.js', 'url-utils.js', 'tab-navigation.js']) window.eval(read(f));
  require('./helpers/item-mutation')(window);

  // 内部状态与计时钩子必须拼进同一个脚本：const/let 不挂 window，只能共享词法作用域。
  // 计时口径（分页之后）：
  //   firstRenderMs = 首屏那一次 render() 的耗时（卡片视图 = 一页 48 张；图板视图 = 整墙）；
  //   fullRenderMs  = 把上限撑到全部条目再画一遍的耗时，用来看「整库铺开」的代价。
  const epilogue = `
;globalThis.__b = {
  render, renderCardsView, applyCurrentHighlight, normalizeItems, fillProjectSelect, updateCard,
  createCard, formatTime,
  get items(){ return items }, get cardMap(){ return cardMap }, get grid(){ return grid },
  get renderLimit(){ return renderLimit },
  setRenderLimit(v){ renderLimit = v; },
  setQuery(v){ query = v; }
};
globalThis.__bench = { first: null };
const __origRender = render;
render = function () {
  const t = performance.now();
  __origRender();
  if (globalThis.__bench.first === null) globalThis.__bench.first = performance.now() - t;
};`;
  const tEval0 = now();
  window.eval(read('library.js') + epilogue);
  const evalMs = +(now() - tEval0).toFixed(1);

  await new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.__bench.first !== null || Date.now() - started > 30000) resolve();
      else window.setTimeout(tick, 2);
    };
    tick();
  });

  const b = window.__b;
  // 首屏数字取到之后，把上限撑到全部条目，量一次「整库铺开」。
  // 注意不能只掐 renderCardsView() 那一下：它同步只画一批（48 张），其余排进空闲时间，
  // 只掐那一下会把「整库」量成「一页」。这里等到卡片数量不再增长为止。
  let fullMs = -1;
  if (!unfiled) {
    fullMs = 0;
  } else {
    b.setRenderLimit(1e9);
    const tFull = now();
    b.renderCardsView();
    let prev = -1;
    for (let i = 0; i < 400; i += 1) {
      const count = window.document.querySelectorAll('#cardGrid .card').length;
      if (count === prev) break;
      prev = count;
      await new Promise((r) => window.setTimeout(r, 5));
    }
    fullMs = +(now() - tFull).toFixed(1);
  }

  const out = {
    n, mode, payloadKB, evalMs,
    firstRenderMs: window.__bench.first === null ? -1 : +window.__bench.first.toFixed(1),
    fullRenderMs: fullMs,
    cards: window.document.querySelectorAll('#cardGrid .card').length,
    nodes: window.document.querySelectorAll('#cardGrid *').length,
    boards: window.document.querySelectorAll('#boardGrid > *').length
  };
  const time = (label, fn) => { const t = now(); const v = fn(); out[label] = +(now() - t).toFixed(1); return v; };

  time('refilterSyncMs', () => b.renderCardsView());
  await new Promise((r) => window.setTimeout(r, 120));

  const pairs = [...b.cardMap.entries()];
  if (pairs.length) {
    time('updateAllCardsMs', () => {
      for (const [id, card] of pairs) {
        const item = b.items.find((it) => it.id === id);
        if (item) b.updateCard(card, item);
      }
    });
  }
  time('highlightMs', () => b.applyCurrentHighlight());
  out.batches = Math.ceil((b.grid.children.length || n) / 48);

  let built = [];
  time('createCardsMs', () => { built = b.items.map((item) => b.createCard(item)); });
  time('formatTimeAllMs', () => { for (const item of b.items) b.formatTime(item.savedAt); });
  time('jsonRoundTripMs', () => JSON.parse(JSON.stringify(items)));
  time('normalizeMs', () => b.normalizeItems(items));

  const selects = [...window.document.querySelectorAll('#cardGrid .project-select')];
  if (selects.length) {
    out.options = selects.reduce((s, el) => s + el.options.length, 0);
    time('refillAllSelectsMs', () => { for (const s of selects) b.fillProjectSelect(s, ''); });
  }
  b.setQuery('性能');
  time('searchSyncMs', () => b.renderCardsView());
  await new Promise((r) => window.setTimeout(r, 120));

  dom.window.close();
  return out;
}

(async () => {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  const list = sizes.length ? sizes : [100, 300, 700];
  const rows = [];
  for (const n of list) {
    for (const mode of ['cards', 'boards']) {
      await run(n, mode);                     // 预热，避开首次 JIT
      rows.push(await run(n, mode));
      process.stderr.write(`done n=${n} ${mode}\n`);
    }
  }
  const cols = Object.keys(rows[0]);
  const w = (c) => Math.max(c.length, 15);
  console.log(cols.map((c) => c.padEnd(w(c))).join(''));
  console.log(cols.map((c) => '-'.repeat(w(c))).join(''));
  for (const r of rows) console.log(cols.map((c) => String(r[c] ?? '').padEnd(w(c))).join(''));
})();
