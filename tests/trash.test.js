// 回收站：软删除、恢复、彻底删除，以及它跟「已读自动清除 / 重复收藏 / 同步校验」的关系。
// 跑的是真实 background.js 与真实 webdav-sync-core.js，只把 chrome.storage 换成隔离内存。
// 不联网、不读真实收藏。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {} });
const store = {};
const local = {
  async get(keys) {
    const names = keys == null
      ? Object.keys(store)
      : (typeof keys === 'string' ? [keys] : keys);
    return clone(Object.fromEntries(names.filter((key) => key in store).map((key) => [key, store[key]])));
  },
  async set(patch) { Object.assign(store, clone(patch)); },
  async remove(keys) {
    for (const key of (typeof keys === 'string' ? [keys] : keys)) delete store[key];
  }
};
const chrome = {
  storage: { local, onChanged: event() },
  alarms: { create() {}, get: async () => null, clear() {}, onAlarm: event() },
  contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
  commands: { onCommand: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (p) => `chrome-extension://fixture/${p}` },
  tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
  action: {},
  sidePanel: { setPanelBehavior() {} }
};
const ctx = vm.createContext({
  chrome, console, URL, crypto: webcrypto,
  setTimeout, clearTimeout, setInterval, clearInterval,
  importScripts() {}
});
// 后台依赖的三个纯函数模块先装进去，再跑 background.js 本体。
for (const file of ['url-utils.js', 'item-store.js', 'webdav-sync-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
}
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx);
ctx.showActionFeedback = async () => {};
ctx.notifyTab = async () => {};

const page = (name, extra = {}) => ({
  url: `https://fixture.test/${name}`,
  title: name,
  image: '',
  status: 'unread',
  id: name,
  ...extra
});
const byId = (id) => store.laterOnItems.find((item) => item.id === id);

let total = 0;
let failures = 0;
function check(label, ok, detail = '') {
  total += 1;
  if (ok) console.log(`✅ ${label}${detail ? `  → ${detail}` : ''}`);
  else { failures += 1; console.log(`❌ ${label}${detail ? `  → ${detail}` : ''}`); }
}

(async () => {
  console.log('回收站：软删除 / 恢复 / 彻底删除\n');

  // ── ① 删除只是打标记，不抹数据 ──────────────────────────
  console.log('── ① 删除只是打标记 ──');
  store.laterOnItems = [page('a'), page('b'), page('c')];
  store.laterOnCovers = { a: 'data:a', b: 'data:b' };
  store.laterOnOrder = { all: ['a', 'b', 'c'], p1: ['a'] };
  store.laterOnCurrentItem = 'a';
  let result = await ctx.mutateItems({ operation: 'delete', ids: ['a'] });
  check('只影响命中的那一条', result.affected === 1, String(result.affected));
  check('条目还在存储里', !!byId('a'));
  check('带上了 deletedAt', Number(byId('a')?.deletedAt) > 0, String(byId('a')?.deletedAt));
  check('封面留着（撤销时要还原）', store.laterOnCovers.a === 'data:a', JSON.stringify(store.laterOnCovers));
  check('自定义顺序留着', JSON.stringify(store.laterOnOrder.all) === '["a","b","c"]', JSON.stringify(store.laterOnOrder.all));
  check('「继续阅读」指向已删条目时被清空', store.laterOnCurrentItem === null, String(store.laterOnCurrentItem));

  const firstStamp = byId('a')?.deletedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ctx.mutateItems({ operation: 'delete', ids: ['a'] });
  check('重复删除不刷新时间（回收站顺序不会乱跳）', byId('a')?.deletedAt === firstStamp, `${firstStamp} → ${byId('a')?.deletedAt}`);

  // ── ② 恢复 ──────────────────────────────────────────────
  console.log('\n── ② 恢复 ──');
  result = await ctx.mutateItems({ operation: 'restore', ids: ['a'] });
  check('恢复会影响一条', result.affected === 1, String(result.affected));
  // 条目要是压根不见了，这里也得是「红」，不能靠 in 运算符直接抛异常把整轮跑挂掉。
  const back = byId('a');
  check('deletedAt 被摘掉', !!back && !('deletedAt' in back), JSON.stringify(back));
  check('恢复后仍排在原来的位置', JSON.stringify(store.laterOnOrder.all) === '["a","b","c"]', JSON.stringify(store.laterOnOrder.all));
  result = await ctx.mutateItems({ operation: 'restore', ids: ['a'] });
  check('重复恢复不算改动', result.affected === 0, String(result.affected));

  store.laterOnProjects = [{ id: 'p1', name: '还在的项目' }];
  store.laterOnItems = [
    page('with-project', { projectId: 'p1', deletedAt: Date.now() }),
    page('orphan', { projectId: 'gone-project', deletedAt: Date.now() })
  ];
  await ctx.mutateItems({ operation: 'restore', ids: ['with-project', 'orphan'] });
  check('项目还在 → 恢复后归属保留', byId('with-project')?.projectId === 'p1', String(byId('with-project')?.projectId));
  check('项目已删 → 归属清空而不是挂在空气上', byId('orphan')?.projectId === null, String(byId('orphan')?.projectId));

  // ── ③ 彻底删除 ──────────────────────────────────────────
  console.log('\n── ③ 彻底删除 ──');
  store.laterOnProjects = [];
  store.laterOnItems = [page('a', { deletedAt: 111 }), page('b')];
  store.laterOnCovers = { a: 'data:a', b: 'data:b' };
  store.laterOnOrder = { all: ['a', 'b'] };
  store.laterOnItemDetails = { a: { description: '摘要' }, b: { description: '另一条' } };
  store.laterOnCurrentItem = 'a';
  result = await ctx.mutateItems({ operation: 'purge', ids: ['a'] });
  check('条目真的没了', JSON.stringify(store.laterOnItems.map((it) => it.id)) === '["b"]', JSON.stringify(store.laterOnItems.map((it) => it.id)));
  check('封面一起清掉', !('a' in store.laterOnCovers), JSON.stringify(store.laterOnCovers));
  check('顺序里的 id 一起清掉', JSON.stringify(store.laterOnOrder.all) === '["b"]', JSON.stringify(store.laterOnOrder.all));
  check('详情表里那一份一起清掉', !('a' in store.laterOnItemDetails), JSON.stringify(store.laterOnItemDetails));

  // ── ④ 已读自动清除不能把回收站带走 ──────────────────────
  console.log('\n── ④ 自动清除与回收站 ──');
  const longAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
  store.laterOnSettings = { autoCleanDays: 30 };
  store.laterOnItems = [
    page('done-old', { status: 'done', read: true, doneAt: longAgo }),
    page('trashed-old', { status: 'done', read: true, doneAt: longAgo, deletedAt: longAgo })
  ];
  store.laterOnCovers = {};
  store.laterOnOrder = {};
  store.laterOnItemDetails = {};
  store.laterOnCurrentItem = null;
  const expired = await ctx.purgeExpiredItemsNow();
  check('只清掉到期的那一条', expired === 1, String(expired));
  check('回收站里的没被顺手清掉', !!byId('trashed-old'), JSON.stringify(store.laterOnItems.map((it) => it.id)));

  // ── ⑤ 重新收藏回收站里的东西 = 捞回来，不是新建 ────────
  console.log('\n── ⑤ 重新收藏已删条目 ──');
  store.laterOnItems = [page('dup', { deletedAt: 123 })];
  store.laterOnCovers = {};
  store.laterOnOrder = {};
  store.laterOnItemDetails = {};
  const saved = await ctx.saveItem(
    { url: 'https://fixture.test/dup', title: 'dup', image: '', description: '新摘要' },
    { silent: true }
  );
  check('被认成「同一篇」而不是新建', saved.duplicated === true, JSON.stringify(saved));
  check('明确标出「从回收站恢复」', saved.restored === true, String(saved.restored));
  check('没有多出一条重复的', store.laterOnItems.length === 1, String(store.laterOnItems.length));
  const rescued = store.laterOnItems[0];
  check('deletedAt 被摘掉', !!rescued && !('deletedAt' in rescued), JSON.stringify(rescued));

  // ── ⑥ 同步层认这个字段，也拦得住坏值 ────────────────────
  console.log('\n── ⑥ 同步校验 ──');
  const core = ctx.LaterOnSyncCore;
  const doc = (item) => ({
    type: 'lateron-backup', version: 2, exportedAt: 1,
    items: [item], projects: [], covers: {}, order: {}
  });
  const good = { id: 'a', url: 'https://fixture.test/a', deletedAt: 1700000000000 };
  let ok = true;
  try { core.backupData(doc(good)); } catch { ok = false; }
  check('带合法的 deletedAt 能通过校验', ok);

  let rejected = false;
  try { core.backupData(doc({ ...good, deletedAt: 'oops' })); } catch (error) { rejected = error.message === 'syncInvalidData'; }
  check('字符串形式的 deletedAt 被判成脏数据', rejected);

  let negative = false;
  try { core.backupData(doc({ ...good, deletedAt: -1 })); } catch { negative = true; }
  check('负数时间戳也被拒绝', negative);

  // ── ⑦ 未知操作仍然拒绝 ──────────────────────────────────
  console.log('\n── ⑦ 操作白名单 ──');
  let invalid = false;
  try { await ctx.mutateItems({ operation: 'destroy', ids: ['a'] }); } catch (error) { invalid = /Invalid/.test(error.message); }
  check('白名单之外的操作直接报错', invalid);

  console.log(failures ? `\n有 ${failures} 项失败 / 共 ${total} 项` : `\n全部检查通过 🎉（共 ${total} 项）`);
  if (failures) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
