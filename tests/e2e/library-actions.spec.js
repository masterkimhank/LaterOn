/**
 * 全屏收藏库（library.html）的主路径：搜索、打开、标已读。
 *
 * 库页是用户真正天天看的界面，但过去只有 jsdom 测试：能确认「搜索框的 input
 * 事件调了 filter」，确认不了「输入之后卡片真的只剩一张」；能确认「a 标签的
 * href 写对了」，确认不了「点下去真的开了那个网址的新标签页」。
 *
 * 运行：node tests/e2e/library-actions.spec.js
 */
const {
  createChecker,
  getStorage,
  launchExtension,
  markOnboardingSeen,
  openPage,
  setStorage,
  startSite,
  waitFor,
} = require("./helpers");

const DESKTOP = { width: 1280, height: 900 };

const item = (patch) => ({
  id: patch.id,
  title: patch.title,
  description: patch.description,
  source: "测试站点",
  url: patch.url,
  savedAt: Date.now() - (patch.age || 0),
  status: "unread",
  image: "",
  favicon: "",
  projectId: null,
});

(async () => {
  const c = createChecker();
  const site = await startSite({
    "/alpha.html": { body: "<!doctype html><title>甲页面</title><h1>alpha</h1>" },
    "/beta.html": { body: "<!doctype html><title>乙页面</title><h1>beta</h1>" },
    "/gamma.html": { body: "<!doctype html><title>丙页面</title><h1>gamma</h1>" },
  });
  const api = await launchExtension();

  try {
    await markOnboardingSeen(api);
    await setStorage(api, {
      laterOnItems: [
        item({ id: "p1", title: "深入理解浏览器扩展的消息传递", description: "讲 runtime.sendMessage", url: `${site.origin}/alpha.html` }),
        item({ id: "p2", title: "CSS Grid 布局实战手册", description: "网格与自适应", url: `${site.origin}/beta.html`, age: 1000 }),
        item({ id: "p3", title: "WebDAV 同步协议笔记", description: "PROPFIND 与 If-Match", url: `${site.origin}/gamma.html`, age: 2000 }),
      ],
    });

    const page = await openPage(api, "library.html", { viewport: DESKTOP });

    // 「全部项目」是图板墙（一个类目一张板），卡片列表只出现在「等待整理」或
    // 单个项目里。这三条都没归类，所以进「等待整理」才看得见它们。
    await page.locator(".project-nav.inbox-card").click();
    // 拨到「全部」，否则标为已读后卡片会从未读列表里消失，后面的断言就落空了。
    await page.locator('.nav-item[data-filter="all"]').click();

    await waitFor(() => page.locator("#cardGrid .card").count().then((n) => n === 3), {
      timeout: 15000,
      message: "库页画出 3 张卡片",
    });
    c.check("库页渲染出全部 3 张卡片", true);

    // ── 1. 卡片布局：有宽度、不互相重叠、不溢出容器 ───────
    const layout = await page.evaluate(() => {
      const grid = document.querySelector("#cardGrid");
      const gridRect = grid.getBoundingClientRect();
      const cards = [...grid.querySelectorAll(".card")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const overlap = [];
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i];
          const b = cards[j];
          if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) {
            overlap.push(`${i}×${j}`);
          }
        }
      }
      return {
        grid: { x: gridRect.x, w: gridRect.width, right: gridRect.right },
        cards,
        overlap,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    c.check("卡片都有实际尺寸", layout.cards.every((card) => card.w > 120 && card.h > 80), layout.cards.map((x) => `${Math.round(x.w)}x${Math.round(x.h)}`).join(" "));
    c.check("卡片之间不重叠", layout.overlap.length === 0, layout.overlap.join(",") || "无");
    c.check(
      "卡片没有超出网格容器",
      layout.cards.every((card) => card.x + card.w <= layout.grid.right + 1),
      `grid.right=${Math.round(layout.grid.right)}`
    );
    c.check("页面没有横向滚动条", layout.docOverflow <= 0, `溢出 ${layout.docOverflow}px`);

    // ── 2. 搜索真的在过滤 ────────────────────────────────
    await page.locator("#searchInput").fill("WebDAV");
    await waitFor(() => page.locator("#cardGrid .card").count().then((n) => n === 1), {
      message: "搜索 WebDAV 后只剩 1 张卡片",
    });
    const hit = await page.locator("#cardGrid .card h2").first().textContent();
    c.check("搜索命中正确的条目", hit.includes("WebDAV"), hit);

    await page.locator("#searchInput").fill("CSS Grid");
    await waitFor(() => page.locator("#cardGrid .card h2").first().textContent().then((t) => (t || "").includes("CSS Grid")), {
      message: "改关键词后命中另一条",
    });
    c.check("换关键词也能正确命中", true);

    await page.locator("#searchInput").fill("绝对不存在的关键词xyz");
    await waitFor(() => page.locator("#cardGrid .card").count().then((n) => n === 0), { message: "无结果时卡片清空" });
    c.check("搜不到时列表为空", true);

    await page.locator("#searchInput").fill("");
    await waitFor(() => page.locator("#cardGrid .card").count().then((n) => n === 3), { message: "清空搜索后恢复 3 张" });
    c.check("清空搜索后恢复全部卡片", true);

    // ── 3. 按住 Ctrl 点标题：走浏览器默认行为，开新标签页 ──
    // 库页的普通点击被 JS 接管了（先开侧栏、再把当前标签页导航到文章），
    // 只有带修饰键时才把决定权还给浏览器。两条路径都验，见第 5 步。
    const card = page.locator('#cardGrid .card[data-id="p1"]');
    await card.locator(".title-link").scrollIntoViewIfNeeded();
    const linkHref = await card.locator(".title-link").getAttribute("href");
    c.check("卡片标题的 href 指向收藏的网址", linkHref === `${site.origin}/alpha.html`, linkHref || "(空)");

    const popupPromise = api.context.waitForEvent("page", { timeout: 15000 });
    await card.locator(".title-link").click({ modifiers: ["Control"] });
    const opened = await popupPromise;
    await opened.waitForLoadState("domcontentloaded").catch(() => {});
    c.check("Ctrl+点击打开了新标签页", opened.url().startsWith(site.origin), opened.url());
    c.check("打开的是这张卡片对应的地址", opened.url().includes("/alpha.html"), opened.url());
    await opened.close();

    // ── 4. 标为已读要真的写进存储 ────────────────────────
    await card.locator(".read-toggle").click();
    const doneStatus = await waitFor(
      async () => {
        const data = await getStorage(api, "laterOnItems");
        const target = (data.laterOnItems || []).find((x) => x.id === "p1");
        return target && target.status === "done" ? target.status : null;
      },
      { timeout: 10000, message: "状态写回 chrome.storage" }
    );
    c.check("「标为已读」真的写回了存储", doneStatus === "done", String(doneStatus));

    const cardClass = await card.getAttribute("class");
    c.check("卡片外观同步变成已读态", /is-read|done/.test(cardClass), cardClass);

    // 只影响被点的那一张，别把别的条目一起改了。
    const others = await getStorage(api, "laterOnItems");
    const untouched = (others.laterOnItems || []).filter((x) => x.id !== "p1").every((x) => x.status === "unread");
    c.check("没有误改其它条目的状态", untouched);

    // ── 5. 普通点击：收藏库这一页自己跳到文章（这是设计，不是新标签） ──
    // 代码见 library.js 的 openItem()：先开侧栏，再把收藏库标签导航过去，
    // 这样不会为了看一篇文章多留一个空白标签页。放最后做，因为它会毁掉当前页。
    await card.locator(".title-link").click();
    const navigated = await page
      .waitForURL(/\/alpha\.html/, { timeout: 15000 })
      .then(() => true, () => false);
    c.check("普通点击后当前标签页导航到文章", navigated, page.url());
    c.check("导航的地址正确", page.url().includes("/alpha.html"), page.url());

    const fatal = api.consoleErrors.filter((line) => !/favicon|net::ERR|ERR_/i.test(line));
    c.check("控制台没有意外报错", fatal.length === 0, fatal.slice(0, 3).join(" | ") || "干净");

    await page.close();
  } catch (error) {
    c.fail("库页操作测试异常中止", error);
  } finally {
    await api.close();
    await site.close();
  }
  c.finish();
})();
