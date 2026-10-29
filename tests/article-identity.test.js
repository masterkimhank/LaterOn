// 同一篇文章认人：网址规范化之外，还要能认出「同一个站点 + 同一个标题」的另一种网址。
// 两段：① url-utils 里的三个原子函数；② 真的跑 background.js 的 saveItem 看存了几条。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const root = path.resolve(__dirname, '..');

// ── ① 原子函数 ──────────────────────────────────────────────
{
  const ctx = vm.createContext({ URL, globalThis: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'url-utils.js'), 'utf8'), ctx);
  const { normalize, siteKey, titleKey, pathsAlike } = ctx.globalThis.LaterOnUrl;

  // 站点键：手机版 / m / amp / www 都是同一个站点。
  assert.strictEqual(siteKey('https://m.zhihu.com/question/1'), 'zhihu.com');
  assert.strictEqual(siteKey('https://www.zhihu.com/question/1'), 'zhihu.com');
  assert.strictEqual(siteKey('https://amp.example.com/a'), 'example.com');
  assert.strictEqual(siteKey('https://www.m.example.com/a'), 'example.com');
  assert.notStrictEqual(siteKey('https://zhihu.com/a'), siteKey('https://zhuanlan.zhihu.com/a'));
  assert.strictEqual(siteKey('这不是网址'), '');

  // 标题键：空白折叠、大小写不敏感、零宽字符不算数。
  assert.strictEqual(titleKey('  Hello   World  '), 'hello world');
  assert.strictEqual(titleKey('标题\u200b里有零宽'), '标题里有零宽');
  assert.strictEqual(titleKey(null), '');

  // 路径像不像同一个栏目。
  assert.ok(pathsAlike('https://mp.weixin.qq.com/s/AbCdEf', 'https://mp.weixin.qq.com/s?__biz=MzA'), '首段相同');
  assert.ok(pathsAlike('https://x.com/explore/65f0a1b2c3d4e5f6', 'https://x.com/discovery/item/65f0a1b2c3d4e5f6?t=1'), '长 id 段相同');
  assert.ok(pathsAlike('https://x.com/', 'https://x.com'), '首页与首页');
  assert.ok(!pathsAlike('https://x.com/news/hot', 'https://x.com/blog/hot'), '不同栏目不算');
  assert.ok(!pathsAlike('https://x.com/', 'https://x.com/a'), '首页与内页不算');
  assert.ok(!pathsAlike('https://x.com/a/item/b', 'https://x.com/c/item/b'), '短段相同不算数');

  // normalize 本身认不出这两种网址，所以第二道判断确实是必需的。
  assert.notStrictEqual(
    normalize('https://mp.weixin.qq.com/s/AbCdEf'),
    normalize('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265&idx=1&sn=abc')
  );
  console.log('PASS 站点键 / 标题键 / 路径相似');
}

// ── ② 真的收藏两次 ──────────────────────────────────────────
(async () => {
  const event = () => ({ addListener() {} });
  const store = { laterOnItems: [], laterOnSettings: {} };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const names = typeof keys === 'string' ? [keys] : keys;
          return clone(Object.fromEntries(names.filter((k) => k in store).map((k) => [k, store[k]])));
        },
        async set(patch) { Object.assign(store, clone(patch)); }
      },
      onChanged: event()
    },
    alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
    commands: { onCommand: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (p) => `chrome-extension://fixture/${p}` },
    tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
    action: {}, sidePanel: { setPanelBehavior() {} }
  };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'url-utils.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx);
  ctx.showActionFeedback = async () => {};
  ctx.notifyTab = async () => {};

  const save = (url, title, extra = {}) => ctx.saveItem({
    url, title, titleAtSave: title, description: '摘要', image: 'https://img/cover.jpg', favicon: '', source: '', ...extra
  });
  const count = () => store.laterOnItems.length;
  const reset = () => { store.laterOnItems = []; };

  const cases = [];

  // 1. 微信公众号：短路径与参数串是同一篇。
  reset();
  {
    const first = await save('https://mp.weixin.qq.com/s/AbCdEfGhIjKl', '一篇文章的标题');
    const second = await save('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265&idx=1&sn=abc', '一篇文章的标题');
    cases.push(['微信短链与参数串合并', count() === 1 && second.duplicated === true && first.duplicated === false]);
  }

  // 2. 小红书：explore 与 discovery 是同一篇（xsec_token 不算数）。
  reset();
  {
    await save('https://www.xiaohongshu.com/explore/65f0a1b2c3d4e5f6a7b8c9d0', '今天吃什么');
    const second = await save('https://www.xiaohongshu.com/discovery/item/65f0a1b2c3d4e5f6a7b8c9d0?xsec_token=CBabc', '今天吃什么');
    cases.push(['小红书两种入口合并', count() === 1 && second.duplicated === true]);
  }

  // 3. 手机版与桌面版。
  reset();
  {
    await save('https://example.com/post/hello-world', '一篇长标题的文章');
    const second = await save('https://m.example.com/post/hello-world', '一篇长标题的文章');
    cases.push(['手机版与桌面版合并', count() === 1 && second.duplicated === true]);
  }

  // 4. 同站点不同标题：两篇不同文章，各存一条。
  reset();
  {
    await save('https://example.com/post/first', '第一篇的标题');
    await save('https://example.com/post/second', '第二篇的标题');
    cases.push(['同站点不同标题分开存', count() === 2]);
  }

  // 5. 同站点同标题，但分属两个栏目：不合并。
  reset();
  {
    await save('https://example.com/news/topic', '今天的热门话题');
    await save('https://example.com/blog/topic', '今天的热门话题');
    cases.push(['跨栏目的同标题不合并', count() === 2]);
  }

  // 6. 用户改过标题：靠 titleAtSave 照样认得出是同一篇，且不覆盖他改的标题。
  reset();
  {
    await save('https://mp.weixin.qq.com/s/AbCdEfGhIjKl', '原标题很长很长');
    store.laterOnItems[0].title = '我自己改的名字';
    store.laterOnItems[0].titleEdited = true;
    const second = await save('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265', '原标题很长很长');
    cases.push([
      '改过标题仍认得出、且不覆盖',
      count() === 1 && second.duplicated === true && store.laterOnItems[0].title === '我自己改的名字'
    ]);
  }

  // 7. 标题是网址兜底值 / 失效提示：不拿来认人。
  reset();
  {
    await save('https://example.com/a/one', 'https://example.com/a/one');
    const second = await save('https://example.com/a/two', 'https://example.com/a/two');
    cases.push(['网址兜底标题不参与认人', count() === 2 && second.duplicated === false]);
  }
  reset();
  {
    await save('https://www.bilibili.com/video/BV1xx411c7mD', '视频去哪了呢？');
    const second = await save('https://www.bilibili.com/video/BV1yy411c7mE', '视频去哪了呢？');
    cases.push(['失效提示标题不参与认人', count() === 2 && second.duplicated === false]);
  }

  // 8. 重复收藏时该补的信息照补（摘要缺失 → 用这次抓到的补上）。
  reset();
  {
    await save('https://mp.weixin.qq.com/s/AbCdEfGhIjKl', '同一篇的标题', { description: '暂无摘要' });
    await save('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265', '同一篇的标题', { description: '这次抓到了摘要' });
    cases.push([
      '重复时把缺的摘要补上',
      count() === 1 && store.laterOnItems[0].description === '这次抓到了摘要'
    ]);
  }

  let failed = 0;
  for (const [label, ok] of cases) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  }
  assert.strictEqual(failed, 0, `${failed} 条断言失败`);
  console.log(`PASS 同一篇文章认人（${cases.length} 组）`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
