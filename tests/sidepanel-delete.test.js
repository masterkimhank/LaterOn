const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8');
const helper = source.slice(source.indexOf('async function commitItemMutation('), source.indexOf('async function updateItem('));
const deletion = source.slice(source.indexOf('async function deleteItem(id)'), source.indexOf('\nfunction formatTime', source.indexOf('async function deleteItem(id)')));
let loadFailed = false, confirmed = false, writes = 0, loads = 0, lastConfig = null, closed = 0;
const LONG_TITLE = '深度好文推荐每周精选合集';
const context = vm.createContext({
  // vm 的新 context 里没有 URL（那是宿主提供的，不是 JS 内置）——不补的话
  // tab-navigation.js 里 new URL(...) 会抛错并被自己 catch 成「不知道这是哪个网址」，
  // 于是所有标签页都匹配不上，测试会以为「分档逻辑没问题」而其实是空跑。
  URL,
  items: [{ id: 'a', title: 'A', url: 'https://example.com/a' }], covers: { a: 'cover' }, status: {}, tr: key => key,
  window: {}, render() {}, renderProjectFilters() {}, normalizeItems: list => list,
  // 删除时是否顺手关掉还开着的同一网页（设置页里的开关）——默认关。
  closeTabsOnDelete: false,
  ensureDialogLoaded: async () => {
    loads++;
    if (loadFailed) throw Error('load failed');
    context.window.LaterOnDialog = { confirm: async (config) => { lastConfig = config; return confirmed; } };
  },
  chrome: {
    runtime: { sendMessage: async () => { writes++; return { ok: true, items: [], covers: {} }; } },
    // 三个标签页：① 网址对得上（确定是这一篇）；② 网址不同但同站点同标题（只是猜的）；
    // ③ 别的站点同标题（连猜都不该猜）。tab-navigation.js 必须只把 ① 算作「会关」。
    tabs: {
      query: async () => [
        { id: 11, url: 'https://example.com/b', title: LONG_TITLE },
        { id: 12, url: 'https://example.com/other', title: LONG_TITLE },
        { id: 13, url: 'https://another-site.com/x', title: LONG_TITLE }
      ],
      remove: async (ids) => { closed += (ids || []).length; }
    }
  }
});
// 关标签页的共享模块用真的那份：本次改动的核心就是「精确 / 仅标题」两档必须在
// 真实实现里分得开，用假的桩等于什么都没验。网址归一化也加载真的 url-utils.js，
// 否则 www / utm 这些变体在测试里和线上不是同一套规则。
vm.runInContext(fs.readFileSync(path.join(__dirname, '../url-utils.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../tab-navigation.js'), 'utf8'), context);
// commitItemMutation 会用 ItemStore 把「索引 + 内存里的摘要/封面」拼回完整条目，
// 所以桩里也得装上真正的 item-store.js（和 sidepanel.html 的加载顺序一致）。
const itemStoreSource = fs.readFileSync(path.join(__dirname, '../item-store.js'), 'utf8');
vm.runInContext(`${itemStoreSource}\nconst ItemStore = globalThis.LaterOnItemStore;\n${helper}${deletion}`, context);
(async () => {
  loadFailed = true;
  await context.deleteItem('a');
  assert.strictEqual(writes, 0, '确认组件加载失败绝不能直接删除');
  assert.strictEqual(context.items.length, 1);
  assert.strictEqual(context.status.textContent, 'operationFailed');
  loadFailed = false;
  await context.deleteItem('a');
  assert.strictEqual(writes, 0, '取消不删除');
  confirmed = true;
  await context.deleteItem('a');
  assert.strictEqual(loads, 3, '每次删除先确保确认组件可用');
  assert.strictEqual(writes, 1);
  assert.strictEqual(context.items.length, 0);
  assert.deepStrictEqual(context.covers, {});
  // 默认关着开关时，确认框不该列标签页清单，也不该去关任何东西。
  assert.strictEqual(lastConfig.notice, undefined, '开关没开就别在确认框里列标签页');
  assert.strictEqual(closed, 0, '开关没开就不许关标签页');

  // 打开开关：确认框先列清单，确认后只关「网址对得上」的那一档。
  context.items = [{ id: 'b', title: LONG_TITLE, url: 'https://example.com/b', source: 'example.com' }];
  context.closeTabsOnDelete = true;
  confirmed = false;
  await context.deleteItem('b');
  const groups = lastConfig.notice || [];
  assert.strictEqual(groups.length, 2, '要分两档列出来：会关的 / 只是标题相同的');
  assert.strictEqual(groups[0].tone, 'close');
  assert.strictEqual(groups[0].items.length, 1, '网址对得上的只有那一个');
  assert.strictEqual(groups[1].tone, 'keep');
  assert.strictEqual(groups[1].items.length, 1, '同站点同标题、网址不同的那个要单独列出来');
  assert.ok(/^tabsKeepSameTitle$/.test(groups[1].title), '第二组的标题要说明「只是标题相同」');
  assert.strictEqual(closed, 0, '取消时不能关标签页');
  confirmed = true;
  await context.deleteItem('b');
  assert.strictEqual(closed, 1, '确认后只关网址对得上的那一个，不能连带关掉同标题的');
  assert.strictEqual(context.status.textContent, 'itemDeletedAndClosed', '侧栏要在状态条里说明关了几个');

  // 没有开着的标签页时，确认框不列清单，状态条也不多说一句。
  context.items = [{ id: 'c', title: 'C', url: 'https://example.com/c' }];
  context.status.textContent = '';
  context.chrome.tabs.query = async () => [];
  await context.deleteItem('c');
  assert.strictEqual(lastConfig.notice, undefined, '没有标签页可关时不该出现空清单');
  assert.strictEqual(context.status.textContent, '', '没有标签页可关时不必多一句话');
  assert.strictEqual(context.items.length, 0, '收藏照常删除');
  console.log('PASS 侧栏删除必须加载确认框、加载失败/取消不删除、确认后提交并清理封面；开关打开时分两档列清单，只关网址对得上的标签页');
})().catch(error => { console.error(error); process.exitCode = 1; });
