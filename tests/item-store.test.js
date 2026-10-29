// 索引 / 详情拆分的单元测试：先是 item-store.js 的几个纯函数，
// 再真的跑 background.js，看「收藏 → 标已读 → 改摘要 → 删除 → 老数据迁移」这条链上
// 索引与详情表各自发生了什么。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let failed = 0;
function check(label, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` —— ${detail}`}`);
}

(async () => {

  // ── ① 纯函数 ────────────────────────────────────────────────
  {
    const ctx = vm.createContext({ URL, globalThis: {} });
    vm.runInContext(read('item-store.js'), ctx);
    const S = ctx.globalThis.LaterOnItemStore;

    check('常量：两个键名', S.INDEX_KEY === 'laterOnItems' && S.DETAILS_KEY === 'laterOnItemDetails');

    const full = {
      id: 'a', title: '一篇文章', url: 'https://example.com/a',
      description: '摘要文字', image: 'https://img/cover.jpg', projectId: 'p1', status: 'unread'
    };
    const { index, detail } = S.splitItem(full);
    check('splitItem 剥掉摘要与封面', !('description' in index) && !('image' in index), JSON.stringify(index));
    check('splitItem 保住其余字段', index.title === '一篇文章' && index.projectId === 'p1' && index.status === 'unread');
    check('splitItem 把摘要与封面放进详情', detail.description === '摘要文字' && detail.image === 'https://img/cover.jpg');
    check('splitItem 不改原对象', full.description === '摘要文字' && full.image === 'https://img/cover.jpg');

    const bare = { id: 'b', title: '没有摘要的条目' };
    check('没有详情字段时返回 null 详情', S.splitItem(bare).detail === null);

    const list = [full, bare, { id: 'c', title: '第三条', description: 'x' }];
    check('indexOf 保持顺序', S.indexOf(list).map((item) => item.id).join(',') === 'a,b,c');
    check('detailsOf 只含真有详情的', Object.keys(S.detailsOf(list)).join(',') === 'a,c');

    // 详情表里的值优先；详情表缺字段时沿用索引里自带的（老数据）。
    check('hydrate：详情覆盖索引', S.hydrateItem({ id: 'a', description: '旧' }, { description: '新' }).description === '新');
    check('hydrate：详情缺字段时保留索引自带',
      S.hydrateItem({ id: 'a', description: '索引里的', image: '旧图' }, { description: '新' }).image === '旧图');
    check('hydrate：详情表里没有这条时原样返回', S.hydrate([{ id: 'z', description: '自带' }], {}).at(0).description === '自带');

    const patch = S.writePatch([full], { other: { description: '别人的' } });
    check('writePatch 写索引', patch.laterOnItems[0].description === undefined);
    check('writePatch 合并而不是覆盖详情表',
      !!patch.laterOnItemDetails.other && patch.laterOnItemDetails.a.description === '摘要文字');

    // load：用假的 local 读两个键。
    const fake = {
      async get(keys) {
        const all = {
          laterOnItems: [{ id: 'a', title: '标题' }],
          laterOnItemDetails: { a: { description: '读回来的摘要' } }
        };
        return Object.fromEntries([].concat(keys).filter((k) => k in all).map((k) => [k, all[k]]));
      }
    };
    const loaded = await S.load(fake);
    check('load 把索引与详情拼成完整条目', loaded.items[0].description === '读回来的摘要');
    check('load 同时把详情表原样给出', loaded.details.a.description === '读回来的摘要');
  }

  // ── ② 真的跑一遍后台 ────────────────────────────────────────
  const event = () => ({ addListener() {} });
  const store = { laterOnItems: [], laterOnSettings: {} };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const local = {
    async get(keys) {
      const names = typeof keys === 'string' ? [keys] : keys;
      return clone(Object.fromEntries(names.filter((k) => k in store).map((k) => [k, store[k]])));
    },
    async set(patch) { Object.assign(store, clone(patch)); },
    async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
  };
  const chrome = {
    storage: { local, onChanged: event() },
    alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
    commands: { onCommand: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (p) => `chrome-extension://fixture/${p}` },
    tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
    action: {}, sidePanel: { setPanelBehavior() {} }
  };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {} });
  vm.runInContext(read('item-store.js'), ctx);
  vm.runInContext(read('url-utils.js'), ctx);
  vm.runInContext(read('background.js'), ctx);
  ctx.showActionFeedback = async () => {};
  ctx.notifyTab = async () => {};
  const tick = () => new Promise((done) => setTimeout(done, 20));

  const page = (url, title, extra = {}) => ({
    url, title, titleAtSave: title, description: '抓到的摘要', image: 'https://img/cover.jpg', favicon: '', source: '', ...extra
  });

  await tick(); // 顶层会顺手跑一次 purge / 迁移，等它们落地

  {
    const saved = await ctx.saveItem(page('https://example.com/post/one', '第一篇文章'));
    const id = saved.item.id;
    check('收藏后索引里没有摘要', !('description' in store.laterOnItems[0]), JSON.stringify(store.laterOnItems[0]));
    check('收藏后索引里没有封面', !('image' in store.laterOnItems[0]));
    check('收藏后摘要进了详情表', store.laterOnItemDetails?.[id]?.description === '抓到的摘要');
    check('索引里该有的都还在', store.laterOnItems[0].url === 'https://example.com/post/one' && store.laterOnItems[0].title === '第一篇文章');
    check('索引明显比完整条目小',
      JSON.stringify(store.laterOnItems).length + 2 < JSON.stringify([{ ...store.laterOnItems[0], description: '抓到的摘要', image: 'https://img/cover.jpg' }]).length + 60);

    // 标已读：只动索引，详情表一个字都不该变。
    const before = JSON.stringify(store.laterOnItemDetails);
    await ctx.mutateItems({ operation: 'update', ids: [id], patch: { status: 'done' } });
    check('标已读写进索引', store.laterOnItems[0].status === 'done' && store.laterOnItems[0].read === true);
    check('标已读不动详情表', JSON.stringify(store.laterOnItemDetails) === before);
    check('标已读后摘要还在', store.laterOnItemDetails[id].description === '抓到的摘要');

    // 改摘要：写详情表，索引不受影响。
    const indexBefore = JSON.stringify(store.laterOnItems);
    await ctx.mutateItems({ operation: 'update', ids: [id], patch: { description: '我自己改的摘要' } });
    check('改摘要写进详情表', store.laterOnItemDetails[id].description === '我自己改的摘要');
    check('改摘要不落到索引里', JSON.stringify(store.laterOnItems) === indexBefore);

    // 重复收藏同一篇：读回来的是完整条目，所以「摘要不缺失」的判断才准。
    const again = await ctx.saveItem(page('https://example.com/post/one', '第一篇文章', { description: '网站现在给的摘要' }));
    check('重复收藏被认出', again.duplicated === true);
    check('用户改过的摘要没被覆盖', store.laterOnItemDetails[id].description === '我自己改的摘要');

    // 读：hydrate 后仍拿得到摘要与封面。
    const loaded = await ctx.LaterOnItemStore.load(local);
    check('读回来时摘要与封面都齐', loaded.items[0].description === '我自己改的摘要' && loaded.items[0].image === 'https://img/cover.jpg');

    // 删除：索引与详情表一起清。
    await ctx.mutateItems({ operation: 'delete', ids: [id] });
    check('删除后索引为空', store.laterOnItems.length === 0);
    check('删除后详情表里那条也没了', !store.laterOnItemDetails[id]);
  }

  // ── ③ 老数据迁移 ────────────────────────────────────────────
  {
    store.laterOnItems = [{
      id: 'legacy-1', title: '老条目', url: 'https://example.com/legacy',
      description: '老数据里的摘要', image: 'https://img/old.jpg', savedAt: 1, status: 'unread'
    }];
    store.laterOnItemDetails = { other: { description: '别的条目的摘要' } };
    const moved = await ctx.migrateLegacyDetails();
    check('迁移搬了一条', moved === 1);
    check('迁移后索引变瘦', !('description' in store.laterOnItems[0]) && !('image' in store.laterOnItems[0]));
    check('迁移后摘要进了详情表', store.laterOnItemDetails['legacy-1'].description === '老数据里的摘要');
    check('迁移不碰别人的详情', store.laterOnItemDetails.other.description === '别的条目的摘要');
    const again = await ctx.migrateLegacyDetails();
    check('再跑一次是幂等的', again === 0);
    const loaded = await ctx.LaterOnItemStore.load(local);
    check('迁移后读回来摘要还在', loaded.items[0].description === '老数据里的摘要');
  }

  assert.strictEqual(failed, 0, `${failed} 条断言失败`);
  console.log(`PASS 索引 / 详情拆分（${failed} 条失败）`);

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

