// 「结构性数据迁移要不要先问你一声」的决策逻辑。纯函数，不碰 chrome.*。
//
// 背景：升级到新版时，有些迁移会挪动或改写已有数据（把摘要从索引搬进详情表、删掉旧正文）。
// 以前这类迁移在 service worker 一起来就静默跑完：顺利时无感，出事时（断电、存储写满、
// 另一台设备正在同步）用户是「打开发现摘要没了」才察觉，而且没有备份可回。
//
// 现在分两步：
//   ① 先只探测「有没有东西要迁」——只读，不写；
//   ② 有的话先停下来问一句（界面提示「建议先导出备份 → 现在升级 / 稍后」），
//      没有的话直接把 schema 版本标上去，不打扰任何人。
//
// 这样「刚装的新机器」和「早就迁完的老机器」都不会看到提示，只有真正要动数据的那次会。
(function () {
  // 数据格式版本。以后每次真正改动**已有数据**的形状，就把这个数字 +1，并在下面加一条。
  // 只新增字段（老代码读不到也无所谓）不算——那种不值得让人停下来确认。
  const SCHEMA = 1;

  const MIGRATIONS = [
    // 1.14.0 起不再保存网页正文：去掉 index 上残留的 contentHtml / wordCount / byline。
    { id: "legacy-content", schema: 1, structural: true },
    // 1.74.0 的「摘要 / 封面搬进详情表」：搬完索引里就没有这两个字段了。
    { id: "details-split", schema: 1, structural: true }
  ];

  // probes: { "legacy-content": true/false, "details-split": true/false }
  // 由调用方（background.js）真读一遍存储算出来——这里只做决策，不读存储。
  function plan({ storedSchema, probes }) {
    const from = Number.isFinite(Number(storedSchema)) ? Number(storedSchema) : 0;
    const pending = MIGRATIONS.filter((migration) => migration.schema > from && probes?.[migration.id] === true);
    return {
      schema: SCHEMA,
      // 真要跑的迁移 id（按声明顺序，跑的时候也按这个顺序）
      pending: pending.map((migration) => migration.id),
      // 其中需要先确认的：只要有一条，就一条都不跑，等用户点了「现在升级」再一起跑。
      // 为什么不一并跑掉非结构性的：迁移常常前后依赖（先拆详情、再清旧正文），
      // 跑一半停下来比一条都不跑更难解释。
      needsConfirm: pending.some((migration) => migration.structural),
      // 没有任何东西要迁：直接把 schema 标上去。
      silent: pending.length === 0
    };
  }

  globalThis.LaterOnMigrations = { SCHEMA, MIGRATIONS, plan };
})();
