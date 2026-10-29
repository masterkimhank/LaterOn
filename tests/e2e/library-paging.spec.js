/**
 * 库页分页（真浏览器）：首屏只铺一页，滚到底自动续，按钮兜底。
 *
 * 为什么要单独一个端到端用例：条数和顺序这类事 jsdom 能测，但
 * 「滚到底真的会自己续上」「页脚真的被 CSS 藏掉了」只有真排版 + 真
 * IntersectionObserver 才答得了。`.load-more` 自己写了 `display:flex`，
 * 忘了补 `[hidden]{display:none}` 的话，jsdom 里 `hidden` 属性照样为 true、
 * 断言全绿，屏幕上却一直挂着一颗「加载更多」。
 *
 * 运行：node tests/e2e/library-paging.spec.js
 */
const {
  createChecker,
  launchExtension,
  markOnboardingSeen,
  openPage,
  setStorage,
  waitFor,
} = require("./helpers");

const DESKTOP = { width: 1280, height: 900 };
const TOTAL = 130;
const PAGE = 48;

const items = Array.from({ length: TOTAL }, (_, i) => ({
  id: `pg-${String(i).padStart(3, "0")}`,
  title: `分页测试第 ${i} 篇`,
  description: "只为验证分页，不需要真的打开。",
  source: "example.com",
  url: `https://example.com/paging/${i}`,
  savedAt: Date.now() - i * 60000,
  status: "unread",
  image: "",
  favicon: "",
  projectId: null,
}));

(async () => {
  const c = createChecker();
  const api = await launchExtension();

  try {
    await markOnboardingSeen(api);
    await setStorage(api, {
      laterOnItems: items,
      laterOnProjects: [],
      laterOnFilter: "unread",
      laterOnFilterChosen: true,
    });

    const page = await openPage(api, "library.html?from=sidepanel&project=unfiled", { viewport: DESKTOP });
    const cardCount = () => page.locator("#cardGrid .card").count();

    await waitFor(() => cardCount().then((n) => n === PAGE), { timeout: 15000, message: `首屏画出 ${PAGE} 张` });
    c.check(`首屏只铺一页（${PAGE} 张），不是 ${TOTAL} 张一起铺`, (await cardCount()) === PAGE, String(await cardCount()));

    // ── 1. 页脚：文案对、真的看得见 ─────────────────────
    const footer = page.locator("#loadMore");
    c.check("页脚在首屏下是可见的", await footer.isVisible(), "不可见");
    c.check(
      "页脚按钮写明还剩多少篇",
      (await footer.locator("button").innerText()).includes(`还有 ${TOTAL - PAGE} 篇`),
      await footer.locator("button").innerText()
    );
    c.check(
      "页脚进度写明已显示多少",
      (await footer.locator(".load-more-progress").innerText()).includes(`已显示 ${PAGE} / ${TOTAL} 篇`),
      await footer.locator(".load-more-progress").innerText()
    );

    // ── 2. 滚到底 → 自动续一页（不用点按钮）─────────────
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await waitFor(() => cardCount().then((n) => n > PAGE), { timeout: 8000, message: "滚到底后自动续页" });
    const afterScroll = await cardCount();
    c.check("滚到底自动续了一页（没有手动点按钮）", afterScroll >= PAGE * 2, `${afterScroll} 张`);
    c.check("续页没有把整库一次性铺开（仍是按页走）", afterScroll < TOTAL, `${afterScroll} 张`);

    // ── 3. 按钮兜底：点一下继续 ───────────────────────
    // 这里用脚本点、不滚动页面：真滚过去的话观察器会先动手，就测不出按钮本身了。
    // 按钮「看得见、点得到」已经在第 1 步断言过（isVisible）。
    await page.locator("#loadMore button").evaluate((el) => el.click());
    await waitFor(() => cardCount().then((n) => n === TOTAL), { timeout: 8000, message: "点按钮补齐全部" });
    c.check("点「加载更多」能一直补到全部", (await cardCount()) === TOTAL, String(await cardCount()));
    await waitFor(() => footer.isHidden(), { timeout: 4000, message: "铺满后页脚收起" });
    c.check("铺满之后页脚收起", await footer.isHidden());

    // ── 4. 换筛选：回到第一页，不留在展开状态 ────────────
    await page.locator('.nav-item[data-filter="done"]').click();
    await waitFor(() => cardCount().then((n) => n === 0), { timeout: 5000, message: "已读为空" });
    c.check("切到「已读」（一条都没有）时列表清空", (await cardCount()) === 0);
    c.check("没有内容时页脚也收起", await footer.isHidden());

    await page.locator('.nav-item[data-filter="unread"]').click();
    await waitFor(() => cardCount().then((n) => n === PAGE), { timeout: 8000, message: "切回未读回到第一页" });
    c.check("切回「未读」又回到第一页（不是停在 130 张）", (await cardCount()) === PAGE, String(await cardCount()));

    // ── 5. 页面干净 ──────────────────────────────────
    const errors = api.consoleErrors.filter((line) => line.includes("library.html"));
    c.check("整个过程没有控制台报错", errors.length === 0, errors.slice(0, 3).join(" | "));

    await page.close();
  } catch (error) {
    c.fail("分页用例执行失败", error);
  } finally {
    await api.close();
    c.finish();
  }
})();
