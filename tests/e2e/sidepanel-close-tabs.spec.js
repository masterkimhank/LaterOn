/**
 * 侧栏「关闭已打开」：真浏览器里真的关标签页。
 *
 * jsdom 只能证明「调了 chrome.tabs.remove 并把名单算对了」，证明不了
 * 「浏览器里那几个标签页真的消失了、而别的还在」。这里开真标签页、真点按钮、
 * 真走确认框，然后看 page.isClosed()。
 *
 * 顺带守两条容易翻车的：
 *  - 侧栏自己寄居的那个标签页不能被关掉（不然侧栏跟着没了）；
 *  - 收藏一条都不能少（这个动作的名字里有「关闭」，很容易被实现成删除）。
 *
 * 运行：node tests/e2e/sidepanel-close-tabs.spec.js
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
  waitFor,
} = require("./helpers");

const SIDEBAR = { width: 400, height: 820 };

const item = (patch) => ({
  id: patch.id,
  title: patch.title,
  description: "摘要内容",
  source: patch.source || "测试站点",
  url: patch.url,
  savedAt: Date.now(),
  status: "unread",
  image: "",
  favicon: "",
  projectId: patch.projectId ?? null,
  titleAtSave: patch.title,
});

(async () => {
  const c = createChecker("侧栏「关闭已打开」");
  const site = await startSite({
    "/a.html": { body: articlePage({ title: "甲：等待整理的 A 篇" }) },
    "/b.html": { body: articlePage({ title: "乙：等待整理的 B 篇" }) },
    "/c.html": { body: articlePage({ title: "丙：工作项目里的一篇" }) },
    "/d.html": { body: articlePage({ title: "丁：没被收藏的网页" }) },
  });
  const api = await launchExtension();

  try {
    await markOnboardingSeen(api);
    await setStorage(api, {
      laterOnProjects: [{ id: "work", name: "工作", createdAt: Date.now() }],
      laterOnItems: [
        item({ id: "a1", title: "甲：等待整理的 A 篇", url: `${site.origin}/a.html` }),
        item({ id: "b1", title: "乙：等待整理的 B 篇", url: `${site.origin}/b.html` }),
        item({ id: "c1", title: "丙：工作项目里的一篇", url: `${site.origin}/c.html`, projectId: "work" }),
      ],
      laterOnActiveProject: "unfiled",
    });

    // 三个被收藏的网页 + 一个没被收藏的，逐个开成真标签页。
    const pages = {};
    for (const name of ["a", "b", "c", "d"]) {
      const page = await api.context.newPage();
      await page.goto(`${site.origin}/${name}.html`, { waitUntil: "domcontentloaded" });
      pages[name] = page;
    }
    c.check("准备好了 4 个真标签页", Object.values(pages).every((page) => !page.isClosed()));

    const panel = await openPage(api, "sidepanel.html", { viewport: SIDEBAR });
    await waitFor(() => panel.locator(".item").count().then((n) => n >= 2), { message: "侧栏画出等待整理的收藏" });

    // ── 1. 按钮在、能点（点不动会直接超时，等于顺带验证没被别的元素盖住）──
    const button = panel.locator("#closeProjectTabs");
    await button.waitFor({ state: "visible", timeout: 8000 });
    c.check("筛选行右侧出现了「关闭已打开」", await button.isVisible());
    c.check("图标按钮带说明文字", ((await button.getAttribute("title")) || "").includes("标签页"), await button.getAttribute("title"));

    // ── 2. 先看清它要关几个，再决定 ──────────────────────
    await button.click();
    const dialog = panel.locator(".lod-root");
    await dialog.waitFor({ state: "visible", timeout: 8000 });
    const title = await panel.locator(".lod-title").textContent();
    const message = await panel.locator(".lod-message").textContent();
    c.check("确认框点名了「等待整理」和数量 2", title.includes("等待整理") && title.includes("2"), title);
    c.check("确认框明说收藏一条都不删", message.includes("收藏一条都不会删"), message);

    // 取消一次：什么都不该发生。
    await panel.locator(".lod-cancel").click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    c.check("点取消后 a、b 两个标签页都还开着", !pages.a.isClosed() && !pages.b.isClosed());

    // ── 3. 确认：真关 ────────────────────────────────────
    const closedA = new Promise((resolve) => pages.a.once("close", () => resolve("a")));
    const closedB = new Promise((resolve) => pages.b.once("close", () => resolve("b")));
    await button.click();
    await dialog.waitFor({ state: "visible", timeout: 8000 });
    await panel.locator(".lod-ok").click();
    await Promise.race([Promise.all([closedA, closedB]), new Promise((_, reject) => setTimeout(() => reject(new Error("标签页没关掉")), 8000))]);
    c.check("确认后 a、b 两个标签页真的关掉了", pages.a.isClosed() && pages.b.isClosed());

    // 等状态条报出结果再往下看：它是所有 chrome.tabs.remove 都结束之后才写的。
    // 少了这一步，「c 还开着」会在关闭动作落定之前就被读到，永远为真，等于没测
    // （第一版就是这样，反证时它没报红）。
    await waitFor(() => panel.locator("#status").textContent().then((text) => text.includes("已关闭")), {
      message: "状态条报出关闭结果",
    });

    // ── 4. 范围只到「等待整理」，别的项目和没收藏的都不能碰 ──
    c.check("工作项目那个 c 还开着", !pages.c.isClosed());
    c.check("没被收藏的 d 当然也还开着", !pages.d.isClosed());
    c.check("侧栏自己寄居的页面还在（不然侧栏会跟着消失）", !panel.isClosed());

    // ── 5. 收藏一条都不能少 ──────────────────────────────
    const stored = await getStorage(api, "laterOnItems");
    const items = stored.laterOnItems || [];
    c.check("收藏还是 3 条，一条都没被删", items.length === 3, `${items.length} 条`);
    c.check("被关掉标签页的那两条收藏还在", ["a1", "b1"].every((id) => items.some((x) => x.id === id)));

    // ── 6. 状态条给出结果 ────────────────────────────────
    const status = await panel.locator("#status").textContent();
    c.check("状态条说关掉了 2 个、收藏都还在", status.includes("已关闭 2 个标签页") && status.includes("收藏都还在"), status);

    // ── 7. 一个都不开着时，不再弹框，直接说一句 ──────────────
    await button.click();
    await panel.waitForTimeout(600);
    c.check("没有已开标签时不弹确认框", (await panel.locator(".lod-root").isVisible().catch(() => false)) === false);
    const quiet = await panel.locator("#status").textContent();
    c.check("状态条说「没有已打开的标签页」", quiet.includes("没有已打开的标签页"), quiet);

    // ── 8. 窄侧栏里这一排不许换行/溢出 ────────────────────
    await panel.setViewportSize({ width: 320, height: 820 });
    await panel.waitForTimeout(200);
    const narrow = await panel.evaluate(() => {
      const row = document.querySelector(".filter-row");
      const btn = document.querySelector("#closeProjectTabs");
      const box = btn.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        rowHeight: Math.round(row.getBoundingClientRect().height),
        buttonRight: Math.round(box.right),
        buttonWidth: Math.round(box.width),
        viewport: window.innerWidth,
      };
    });
    c.check("320px 不横向溢出", narrow.scrollWidth <= narrow.clientWidth, JSON.stringify(narrow));
    c.check("按钮没被挤出可视区", narrow.buttonRight <= narrow.viewport, JSON.stringify(narrow));
    c.check("筛选行仍然只有一行", narrow.rowHeight <= 32, `${narrow.rowHeight}px`);

    // ── 9. hidden 真的能收起它 ────────────────────────────
    // 这颗按钮自己写了 display:grid，浏览器默认的 [hidden]{display:none} 压不住它；
    // sidepanel.css 里必须有一行 `.close-tabs[hidden]`。这里在真浏览器里验一遍：
    // 只读 CSS 文本是不够的，选择器写错、被后面的规则覆盖都看不出来。
    const hiddenDisplay = await panel.evaluate(() => {
      const button = document.querySelector("#closeProjectTabs");
      button.hidden = true;
      const display = getComputedStyle(button).display;
      button.hidden = false;
      return display;
    });
    c.check("加上 hidden 后按钮真的不显示了", hiddenDisplay === "none", hiddenDisplay);
    c.check("去掉 hidden 又回来", await button.isVisible());

    const fatal = api.consoleErrors.filter((line) => !/favicon|net::ERR|ERR_/i.test(line));
    c.check("控制台没有意外报错", fatal.length === 0, fatal.slice(0, 3).join(" | ") || "干净");

    await panel.close();
  } catch (error) {
    c.fail("侧栏关闭标签页测试异常中止", error);
  } finally {
    await api.close();
    await site.close();
  }
  c.finish();
})();
