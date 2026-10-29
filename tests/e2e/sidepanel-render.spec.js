/**
 * 侧栏在真浏览器里的渲染：jsdom 答不了的那几个问题。
 *
 * jsdom 能验证「DOM 里有 .thumb-img、CSS 文本里有 `~` 选择器」，但它不算布局、
 * 不做级联计算。于是下面这些事一直是「看代码觉得对」：
 *   - 透明封面到底有没有把橙色占位砖露出来（取决于 `~` 选择器是否真的命中）；
 *   - 封面的降级链走完后，坏图有没有真的消失、占位有没有真的回来；
 *   - 极窄侧栏（320px）会不会横向溢出；
 *   - 卡片右下角三颗按钮会不会叠在一起；
 *   - 新手引导是不是真的「挡住」了底下的操作。
 * 这里逐条量真值。
 *
 * 运行：node tests/e2e/sidepanel-render.spec.js
 */
const {
  createChecker,
  dismissOnboarding,
  launchExtension,
  openPage,
  setStorage,
  startSite,
  waitFor,
} = require("./helpers");

const WIDE = { width: 400, height: 820 };
const NARROW = { width: 320, height: 820 };

const item = (patch) => ({
  id: patch.id,
  title: patch.title,
  description: patch.description || "摘要内容",
  source: patch.source || "测试站点",
  url: patch.url,
  savedAt: patch.savedAt || Date.now(),
  status: patch.status || "unread",
  image: patch.image || "",
  favicon: patch.favicon || "",
  titleAtSave: patch.titleAtSave || "",
  projectId: patch.projectId ?? null,
});

(async () => {
  const c = createChecker();
  const site = await startSite({});
  const api = await launchExtension();

  try {
    const png = `${site.origin}/cover-transparent.png`;
    const seedItems = [
      item({ id: "id-cover", title: "有封面的文章", url: `${site.origin}/a.html`, image: png, favicon: png }),
      item({
        id: "id-broken",
        title: "封面加载失败的网站",
        url: `${site.origin}/b.html`,
        image: `${site.origin}/cover-broken.png`,
        favicon: png,
      }),
      item({ id: "id-noimg", title: "根本没有封面的网站", url: `${site.origin}/c.html`, status: "done" }),
    ];
    await setStorage(api, { laterOnItems: seedItems });

    // onboarding:"keep" —— 首启引导这一轮不跳过，先验证它自己的行为。
    const page = await openPage(api, "sidepanel.html", { viewport: WIDE, onboarding: "keep" });

    // ── 0. 新手引导：必须出现，且真的是模态 ──────────────
    const guideAppeared = await page
      .locator(".lon-guide.is-visible")
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true, () => false);
    c.check("首次安装会弹出新手引导", guideAppeared);

    // 列表是「先画第一屏、其余空闲时续画」的。默认筛选是「未读」，所以停在这儿的
    // 是 2 条（那条已读的要等切到「全部」才出现）——先等它铺完，否则量到的是半张列表。
    await waitFor(() => page.locator(".item").count().then((n) => n === 2), { message: "侧栏画出未读的 2 条收藏" });

    if (guideAppeared) {
      // 引导在场时底下的列表已经画好了，这时才谈得上「点不到」。
      // 用「按钮中心点上最顶层的元素属于引导」来判定模态：这比读 CSS 的
      // z-index 更实在——真正决定用户点不点得到的，是命中测试的结果。
      await waitFor(
        () =>
          page.evaluate(() => {
            const btn = document.querySelector('.filter[data-filter="done"]');
            const r = btn.getBoundingClientRect();
            if (r.width === 0) return false;
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!top && !!top.closest(".lon-guide");
          }),
        { message: "引导遮住底下的按钮", timeout: 5000 }
      );
      c.check("引导是模态的：底下的筛选按钮点不到", true);
      await dismissOnboarding(page);
      c.check("点「跳过」后浮层被移除", (await page.locator(".lon-guide").count()) === 0);
    }

    // ── 1. 骨架屏必须让位 ────────────────────────────────
    const booting = await page.evaluate(() => ({
      hasClass: document.body.classList.contains("booting"),
      skeletonVisible: (() => {
        const el = document.querySelector("#bootSkeleton");
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return getComputedStyle(el).display !== "none" && rect.height > 0;
      })(),
    }));
    c.check("真内容出来后骨架屏消失", !booting.hasClass && !booting.skeletonVisible, JSON.stringify(booting));

    // ── 2. 透明封面不能透出橙色占位砖 ────────────────────
    await waitFor(
      () => page.evaluate(() => !document.querySelector('[data-id="id-broken"] .thumb-img')),
      { message: "坏封面被移除" }
    );
    const cover = await page.evaluate(() => {
      const thumb = document.querySelector('[data-id="id-cover"] .thumb');
      const image = thumb.querySelector(".thumb-img");
      const placeholder = thumb.querySelector(".thumb-placeholder");
      return {
        hasImage: !!image,
        imageFirst: thumb.firstElementChild === image,
        naturalWidth: image ? image.naturalWidth : 0,
        placeholderDisplay: placeholder ? getComputedStyle(placeholder).display : "缺节点",
      };
    });
    c.check("有封面时封面已真实解码", cover.hasImage && cover.naturalWidth > 0, `naturalWidth=${cover.naturalWidth}`);
    c.check(
      "占位砖被 display:none 真正隐藏（不是靠叠层遮住）",
      cover.placeholderDisplay === "none",
      `display=${cover.placeholderDisplay}`
    );
    c.check("封面插在占位之前（`~` 选择器的前提）", cover.imageFirst, `imageFirst=${cover.imageFirst}`);

    // ── 3. 坏封面降级后占位要回来 ────────────────────────
    const broken = await page.evaluate(() => {
      const thumb = document.querySelector('[data-id="id-broken"] .thumb');
      const placeholder = thumb.querySelector(".thumb-placeholder");
      return {
        imageGone: !thumb.querySelector(".thumb-img"),
        placeholderDisplay: placeholder ? getComputedStyle(placeholder).display : "缺节点",
        placeholderHeight: placeholder ? placeholder.getBoundingClientRect().height : 0,
      };
    });
    c.check("坏封面被移除（不留空白块）", broken.imageGone, `imageGone=${broken.imageGone}`);
    c.check(
      "坏封面的占位恢复可见",
      broken.placeholderDisplay !== "none" && broken.placeholderHeight > 0,
      `display=${broken.placeholderDisplay} height=${Math.round(broken.placeholderHeight)}`
    );

    // ── 4. 卡片按钮不重叠、不越界 ────────────────────────
    const buttons = await page.evaluate(() => {
      const article = document.querySelector(".item");
      const card = article.getBoundingClientRect();
      return {
        card: { x: card.x, y: card.y, w: card.width, h: card.height },
        items: [".read-toggle", ".edit", ".delete"].map((sel) => {
          const r = article.querySelector(sel).getBoundingClientRect();
          return { sel, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      };
    });
    const overlapping = [];
    for (let i = 0; i < buttons.items.length; i += 1) {
      for (let j = i + 1; j < buttons.items.length; j += 1) {
        const a = buttons.items[i];
        const b = buttons.items[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlapping.push(`${a.sel}×${b.sel}`);
        }
      }
    }
    c.check(
      "三颗按钮各自有尺寸",
      buttons.items.every((b) => b.w > 0 && b.h > 0),
      buttons.items.map((b) => `${b.sel}:${Math.round(b.w)}x${Math.round(b.h)}`).join(" ")
    );
    c.check("三颗按钮互不重叠", overlapping.length === 0, overlapping.join(",") || "无重叠");
    c.check(
      "按钮都在卡片范围内（没撑破右边界）",
      buttons.items.every((b) => b.x >= buttons.card.x - 1 && b.x + b.w <= buttons.card.x + buttons.card.w + 1)
    );

    // ── 5. 极窄侧栏不横向溢出 ────────────────────────────
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const offenders = [];
        for (const el of document.querySelectorAll("#appBody *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.right > doc.clientWidth + 1) offenders.push(`${el.className || el.tagName}@${Math.round(r.right)}`);
        }
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          bodyScroll: document.body.scrollWidth,
          offenders: offenders.slice(0, 5),
        };
      });
      c.check(
        `${size.width}px 宽下无横向溢出`,
        overflow.scrollWidth <= overflow.clientWidth + 1 && overflow.bodyScroll <= overflow.clientWidth + 1,
        `scroll=${overflow.scrollWidth} client=${overflow.clientWidth} 越界=${overflow.offenders.join("|") || "无"}`
      );
    }

    // ── 6. 筛选是真的在做事（不是只有样式） ─────────────
    await page.setViewportSize(WIDE);
    const countOf = () => page.locator(".item").count();
    const titles = () => page.locator(".item h2").allTextContents();

    await page.locator('.filter[data-filter="done"]').click();
    await waitFor(() => countOf().then((n) => n === 1), { message: "「已读」只剩 1 条" });
    const doneTitles = await titles();
    c.check("「已读」只显示已读条目", doneTitles.length === 1 && doneTitles[0].includes("根本没有封面"), doneTitles.join(","));

    await page.locator('.filter[data-filter="unread"]').click();
    await waitFor(() => countOf().then((n) => n === 2), { message: "「未读」剩 2 条" });
    const unreadTitles = await titles();
    c.check(
      "「未读」既不漏未读、也不混入已读",
      unreadTitles.length === 2 && !unreadTitles.some((t) => t.includes("根本没有封面")),
      unreadTitles.join(",")
    );

    await page.locator('.filter[data-filter="all"]').click();
    await waitFor(() => countOf().then((n) => n === 3), { message: "「全部」回到 3 条" });
    c.check("「全部」恢复到全部条目", (await countOf()) === 3);

    // ── 7. 搜索范围开关：真的能点、真的收窄 ──────────────
    // 上面的数据全在「等待整理」里，分不出范围；补一条归到项目里的，
    // 让「项目筛选」和「范围开关」这对容易互相干扰的控件在真浏览器里过一遍。
    await setStorage(api, {
      laterOnItems: [
        ...seedItems,
        item({ id: "id-project", title: "项目里的封面文章", url: `${site.origin}/d.html`, projectId: "proj-1" }),
      ],
      laterOnProjects: [{ id: "proj-1", name: "技术", createdAt: Date.now() }],
    });
    await waitFor(() => page.locator(".project-filter").count().then((n) => n >= 1), { message: "项目筛选条出现" });

    await page.locator("#searchInput").fill("封面");
    // 4 条 = 原有 3 条（都在等待整理）+ 新加的项目条目。等 4 条而不是 3 条，
    // 否则新数据还没到时旧状态就是 3 条，等于没等。
    await waitFor(() => countOf().then((n) => n === 4), { message: "全局搜索命中 4 条" });
    c.check("默认范围内搜索跨项目（原行为没退化）", (await countOf()) === 4, `${await countOf()} 条`);

    // 点不动会直接超时，等于顺带验证了开关没被别的元素盖住。
    await page.locator('.scope-option[data-scope="unfiled"]').click();
    await waitFor(() => countOf().then((n) => n === 3), { message: "收窄到等待整理后剩 3 条" });
    const scopedTitles = await titles();
    c.check(
      "拨到「等待整理」后，项目里那条不再出现",
      !scopedTitles.some((t) => t.includes("项目里的封面")),
      scopedTitles.join(",")
    );
    c.check(
      "开关高亮跟着切",
      (await page.locator(".scope-option.active").getAttribute("data-scope")) === "unfiled"
    );
    c.check("搜索框加上了收窄描边", (await page.locator("#searchBox").getAttribute("class")).includes("is-scoped"));

    // 搜索框里多了两个按钮，最窄那一档更要盯住溢出。
    await page.setViewportSize(NARROW);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const narrow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      inputWidth: Math.round(document.querySelector("#searchInput").getBoundingClientRect().width),
      scopeRight: Math.round(document.querySelector(".search-scope").getBoundingClientRect().right),
      clientRight: document.documentElement.clientWidth,
    }));
    c.check("320px 下加了范围开关也不溢出", narrow.scrollWidth <= narrow.clientWidth + 1, JSON.stringify(narrow));
    c.check("320px 下输入框仍然可用（没被开关挤没）", narrow.inputWidth >= 100, `${narrow.inputWidth}px`);

    await page.locator("#searchInput").fill("");
    await page.setViewportSize(WIDE);
    // 清空搜索后回到「当前项目」的列表 —— 侧栏默认停在「等待整理」，所以是 3 条。
    await waitFor(() => countOf().then((n) => n === 3), { message: "清空搜索后回到等待整理的 3 条" });
    c.check("清空搜索后回到当前项目", (await countOf()) === 3, `${await countOf()} 条`);
    // ── 8. 页面自身不该报错 ─────────────────────────────
    const fatal = api.consoleErrors.filter((line) => !/favicon|cover-broken|net::ERR|ERR_/i.test(line));
    c.check("控制台没有意外报错", fatal.length === 0, fatal.slice(0, 3).join(" | ") || "干净");

    await page.close();
  } catch (error) {
    c.fail("侧栏渲染测试异常中止", error);
  } finally {
    await api.close();
    await site.close();
  }
  c.finish();
})();
