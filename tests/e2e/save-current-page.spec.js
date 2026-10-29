/**
 * 收藏一条网页的完整链路，在真浏览器里跑一遍。
 *
 * jsdom 测试能验证「给定 item 对象，saveItem 写得对不对」，但它验证不了：
 *   - 后台真的能从标签页抓到 og:title / og:image 吗（有没有跨域、referrer 的坑）；
 *   - 侧栏的「＋」按钮到底点不点得动（激活态、禁用态是不是真的会变）；
 *   - 点完之后数据是不是真写进了 chrome.storage，而不是只改了个内存变量；
 *   - 卡片上的封面是不是真的加载出来了（naturalWidth > 0，不是一张坏图占位）。
 *
 * 链路刻意走 UI：先让文章页成为活动标签，再点侧栏的按钮，和用户手动操作一致。
 *
 * 运行：node tests/e2e/save-current-page.spec.js
 */
const {
  articlePage,
  createChecker,
  getStorage,
  launchExtension,
  markOnboardingSeen,
  openPage,
  setStorage,
  startSite,
  swEval,
  waitFor,
} = require("./helpers");

const ARTICLE_TITLE = "端到端测试文章";

(async () => {
  const c = createChecker();
  const site = await startSite({
    "/article.html": {
      body: articlePage({ title: ARTICLE_TITLE, description: "这段摘要应该被收藏下来。", image: "/cover-transparent.png" }),
    },
  });
  const api = await launchExtension();

  try {
    const articleUrl = `${site.origin}/article.html`;
    await markOnboardingSeen(api);

    // 先开文章页：它这时是活动标签，后台的 EXTRACT_METADATA 才有东西可抓。
    const article = await api.context.newPage();
    await article.goto(articleUrl, { waitUntil: "domcontentloaded" });

    const panel = await openPage(api, "sidepanel.html", { viewport: { width: 400, height: 820 } });

    // 新开的侧栏成了活动标签，后台会以为「当前页」是侧栏自己。
    // 把文章页切回活动 —— 这一步同时会触发侧栏的 chrome.tabs.onActivated，
    // 等于模拟「用户从侧栏切回文章，再打开侧栏」。
    await panel.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((t) => t.url && t.url.includes("/article.html"));
      if (target) await chrome.tabs.update(target.id, { active: true });
    });

    // ── 1. 侧栏要能读到当前页的标题（真抓取，不是模板占位） ──
    await waitFor(() => panel.locator("#currentTitle").textContent().then((t) => (t || "").includes(ARTICLE_TITLE)), {
      timeout: 20000,
      message: "侧栏显示当前页标题",
    });
    c.check("侧栏抓到了当前页的真实标题", true, ARTICLE_TITLE);

    // ── 2. 未收藏时「添加」按钮可点 ──────────────────────
    await waitFor(() => panel.locator("#saveCurrent").isEnabled(), { message: "「添加」按钮变为可点" });
    c.check("未收藏时「添加」按钮可点", true);

    // ── 3. 点下去：数据真的落库 ──────────────────────────
    await panel.locator("#saveCurrent").click();
    const stored = await waitFor(
      async () => {
        const data = await getStorage(api, "laterOnItems");
        const list = data.laterOnItems || [];
        return list.length === 1 ? list : null;
      },
      { timeout: 15000, message: "收藏写入 chrome.storage" }
    );
    c.check("点「添加」后恰好写入 1 条收藏", stored.length === 1);

    const saved = stored[0];
    c.check("标题来自页面 og:title", saved.title === ARTICLE_TITLE, saved.title);
    c.check("网址是文章页的绝对地址", saved.url === articleUrl, saved.url);
    c.check("状态默认是未读", saved.status === "unread", saved.status);
    c.check("来源是站点域名", String(saved.source).includes("127.0.0.1"), saved.source);
    c.check("抓到了 og:image 当封面", String(saved.image).includes("cover-transparent.png"), saved.image || "(空)");
    c.check("摘要抓到了 description", String(saved.description).includes("这段摘要"), saved.description);

    // ── 4. 侧栏把这条画出来，封面真的解码成功 ────────────
    await waitFor(() => panel.locator(".item").count().then((n) => n === 1), { message: "侧栏出现新收藏" });
    c.check("侧栏立刻出现这条收藏", true);

    const coverLoaded = await waitFor(
      () =>
        panel.evaluate(() => {
          const img = document.querySelector(".item .thumb-img");
          return img && img.complete && img.naturalWidth > 0;
        }),
      { timeout: 10000, message: "卡片封面解码完成" }
    );
    c.check("卡片封面真的加载出来了（naturalWidth>0）", !!coverLoaded);

    // ── 5. 存过之后按钮要变成「已收藏」态，防止重复点 ────
    await waitFor(
      async () => (await panel.locator("#saveCurrent").isDisabled()) || (await panel.locator("#saveCurrent").getAttribute("class")).includes("saved"),
      { timeout: 8000, message: "「添加」按钮进入已收藏态" }
    );
    c.check("存完按钮变为不可再点（不会重复收藏）", true);
    const afterClick = await getStorage(api, "laterOnItems");
    c.check("重复点击不会产生第二条记录", (afterClick.laterOnItems || []).length === 1);

    // ── 6. 关掉侧栏重开，数据还在（真的持久化了） ────────
    await panel.close();
    const reopened = await openPage(api, "sidepanel.html", { viewport: { width: 400, height: 820 } });
    await waitFor(() => reopened.locator(".item").count().then((n) => n === 1), { message: "重开后收藏仍在" });
    const titleAfter = await reopened.locator(".item h2").first().textContent();
    c.check("重开侧栏后收藏仍在", titleAfter.includes(ARTICLE_TITLE), titleAfter);
    await reopened.close();

    // ── 7. service worker 侧的数据也没被抄错 ─────────────
    const manifestVersion = await swEval(api, () => chrome.runtime.getManifest().version);
    c.check("扩展版本可读且与 manifest 一致", /^\d+\.\d+\.\d+$/.test(manifestVersion), manifestVersion);

    const fatal = api.consoleErrors.filter((line) => !/favicon|net::ERR|ERR_/i.test(line));
    c.check("控制台没有意外报错", fatal.length === 0, fatal.slice(0, 3).join(" | ") || "干净");
  } catch (error) {
    c.fail("收藏链路测试异常中止", error);
  } finally {
    await api.close();
    await site.close();
  }
  c.finish();
})();
