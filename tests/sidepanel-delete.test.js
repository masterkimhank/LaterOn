const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8');
const helper = source.slice(source.indexOf('async function commitItemMutation('), source.indexOf('async function updateItem('));
const deletion = source.slice(source.indexOf('async function deleteItem(id)'), source.indexOf('\nfunction formatTime', source.indexOf('async function deleteItem(id)')));
let loadFailed = false, confirmed = false, writes = 0, loads = 0, lastConfig = null, closed = 0;
const context = vm.createContext({
  items: [{ id: 'a', title: 'A', url: 'https://example.com/a' }], covers: { a: 'cover' }, status: {}, tr: key => key,
  window: {}, render() {}, renderProjectFilters() {}, normalizeItems: list => list,
  // 删除时是否顺手关掉还开着的同一网页（设置页里的开关）——默认关。
  closeTabsOnDelete: false,
  ensureDialogLoaded: async () => {
    loads++;
    if (loadFailed) throw Error('load failed');
    context.window.LaterOnDialog = { confirm: async (config) => { lastConfig = config; return confirmed; } };
  },
  chrome: { runtime: { sendMessage: async () => { writes++; return { ok: true, items: [], covers: {} }; } } }
});
// 关标签页的共享模块（真实环境里由 tab-navigation.js 提供）。
context.LaterOnTabs = {
  matches: async (urls) => (urls || []).filter(Boolean).map((url, index) => ({ id: index + 1, url })),
  closeMatching: async (urls) => { closed += (urls || []).length; return (urls || []).length; }
};
vm.runInContext(helper + deletion, context);
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
  // 默认关着开关时，确认框不该提标签页，也不该去关任何东西。
  assert.ok(!/deleteWillCloseTabs/.test(lastConfig.message || ''), '开关没开就别在确认框里提关标签页');
  assert.strictEqual(closed, 0, '开关没开就不许关标签页');

  // 打开开关：确认框先写明要关几个，确认后真的关掉，并用状态条报结果。
  context.items = [{ id: 'b', title: 'B', url: 'https://example.com/b' }];
  context.closeTabsOnDelete = true;
  confirmed = false;
  await context.deleteItem('b');
  assert.ok(/deleteWillCloseTabs/.test(lastConfig.message || ''), '开关打开后确认框要写明会关几个标签页');
  assert.strictEqual(closed, 0, '取消时不能关标签页');
  confirmed = true;
  await context.deleteItem('b');
  assert.strictEqual(closed, 1, '确认后应关掉那一个标签页');
  assert.strictEqual(context.status.textContent, 'itemDeletedAndClosed', '侧栏要在状态条里说明关了几个');

  // 没有开着的标签页时，状态条不要多说什么。
  context.items = [{ id: 'c', title: 'C', url: 'https://example.com/c' }];
  context.status.textContent = '';
  context.LaterOnTabs = { matches: async () => [], closeMatching: async () => 0 };
  await context.deleteItem('c');
  assert.strictEqual(context.status.textContent, '', '没有标签页可关时不必多一句话');
  assert.strictEqual(context.items.length, 0, '收藏照常删除');
  console.log('PASS 侧栏删除必须加载确认框、加载失败/取消不删除、确认后提交并清理封面；开关打开时才关掉同网址的标签页');
})().catch(error => { console.error(error); process.exitCode = 1; });
