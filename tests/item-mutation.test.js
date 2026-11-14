// 真实后台代码 + 隔离、复制式 storage；不抓取网络、不读取真实收藏。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {} });
const store = { laterOnItems: [], laterOnSettings: {} };
let failWrite = false;
const local = {
  async get(keys) {
    const names = typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(names.filter(k => k in store).map(k => [k, store[k]])));
  },
  async set(patch) {
    if (failWrite && patch.laterOnItems) { failWrite = false; throw new Error('fixture write failure'); }
    Object.assign(store, clone(patch));
  }
};
const chrome = {
  storage: { local, onChanged: event() },
  alarms: { create() {}, onAlarm: event() },
  contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
  commands: { onCommand: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: p => `chrome-extension://fixture/${p}` },
  tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
  action: {}, sidePanel: { setPanelBehavior() {} }
};
const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {} });
vm.runInContext(fs.readFileSync(path.join(root, 'url-utils.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx);
ctx.showActionFeedback = async () => {};
ctx.notifyTab = async () => {};
const page = name => ({ url: `https://fixture.test/${name}`, title: name, image: "", id: name });
(async () => {
  store.laterOnItems = [page('delete'), page('keep'), page('recent')];
  store.laterOnCovers = { delete: 'data:delete', keep: 'data:keep' };
  store.laterOnOrder = { all: ['delete', 'keep'], project: ['delete', 'recent'] };
  store.laterOnCurrentItem = 'delete';
  let result = await ctx.mutateItems({ operation: 'delete', ids: ['delete', 'missing'] });
  assert.strictEqual(result.affected, 1);
  // 软删除：条目还在，只是带上了 deletedAt；封面、顺序都留着，撤销时才能原位还原。
  assert.deepStrictEqual(store.laterOnItems.map(it => it.id), ['delete', 'keep', 'recent']);
  assert.ok(store.laterOnItems.find(it => it.id === 'delete').deletedAt > 0, '删除应写入回收站标记');
  assert.deepStrictEqual(store.laterOnCovers, { delete: 'data:delete', keep: 'data:keep' });
  assert.deepStrictEqual(store.laterOnOrder, { all: ['delete', 'keep'], project: ['delete', 'recent'] });
  assert.strictEqual(store.laterOnCurrentItem, null);

  store.laterOnItems = [page('keep'), page('delete')];
  await Promise.all([
    ctx.saveItem(page('concurrent'), { silent: true }),
    ctx.mutateItems({ operation: 'delete', ids: ['delete'] }),
    ctx.mutateItems({ operation: 'update', ids: ['delete'], patch: { status: 'reading' } })
  ]);
  assert.deepStrictEqual(store.laterOnItems.map(it => it.title).sort(), ['concurrent', 'delete', 'keep'], '并发添加保留，迟到的状态更新不能复活已删除网页');
  assert.ok(store.laterOnItems.find(it => it.id === 'delete').deletedAt > 0, '迟到的状态更新不该把回收站标记抹掉');

  store.laterOnCovers = { keep: 'data:keep' };
  const before = clone(store);
  failWrite = true;
  await assert.rejects(ctx.mutateItems({ operation: 'delete', ids: ['keep'] }), /fixture write failure/);
  assert.deepStrictEqual(store, before, '提交失败时网页、封面和排序均不改变');
  result = await ctx.mutateItems({ operation: 'delete', ids: ['keep'] });
  assert.strictEqual(result.affected, 1, '失败后可以重试，队列不会堵塞');
  // 软删除不动封面：撤销 / 恢复回来还得用它。
  assert.strictEqual(store.laterOnCovers.keep, 'data:keep');

  store.laterOnItems = [{ ...page('done'), status: 'done', doneAt: 123 }];
  await ctx.mutateItems({ operation: 'update', ids: ['done'], patch: { status: 'done' } });
  assert.strictEqual(store.laterOnItems[0].doneAt, 123, '已读日期不因重复标记重置');
  await assert.rejects(ctx.mutateItems({ operation: 'invalid', ids: [] }), /Invalid/);
  console.log('PASS 删除原子提交、封面/排序/阅读标记清理、并发添加/修改、失败保留与重试');
})().catch(error => { console.error(error); process.exitCode = 1; });
