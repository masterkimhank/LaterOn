// 收藏条目的「索引 / 详情」拆分。
//
// 为什么拆：`laterOnItems` 是整表一个键，每次 chrome.storage.local.set 都要把整份
// 数组序列化一遍。一条收藏里最占体积的是摘要（一百多个字符）和封面地址，实测 700 条
// 时它们占掉四成多（353KB → 204KB）。而这两样东西只在「画卡片」和「改摘要/封面」时
// 才用得上：标已读、挪项目、换顺序、判断搜索命中，全都不需要。
//
// 所以：索引（laterOnItems）只留轻量字段，摘要与封面进另一张表
// （laterOnItemDetails = { id: { description, image } }）。
// 标已读只写索引；改摘要写详情表。两张表分开，谁也拖不动谁。
//
// 为什么是「一张表」而不是「一条一个键」：WebDAV 同步与导出都是按「键」组织的
// （`webdav-sync-core` 的 KEYS 是固定数组）。一条一个键就得在同步层枚举成千上万个键，
// 复杂度换来的只是「改一条摘要少写一百多 KB」——而改摘要本来就不是高频操作。
//
// 兼容：老数据（索引里自带 description / image）不迁移也能正常读 ——
// 读的时候「详情表里没有就沿用索引里的值」，写法上不会把老值弄丢。
(function () {
  const INDEX_KEY = "laterOnItems";
  const DETAILS_KEY = "laterOnItemDetails";
  // 一条收藏里最占体积、又只在卡片/详情里用到的两个字段。
  const DETAIL_FIELDS = ["description", "image"];

  // 一条完整条目 → { index, detail }。index 里不再有详情字段。
  function splitItem(item) {
    if (!item || typeof item !== "object") return { index: item, detail: null };
    const detail = {};
    let hasDetail = false;
    for (const field of DETAIL_FIELDS) {
      if (field in item) { detail[field] = item[field]; hasDetail = true; }
    }
    if (!hasDetail) return { index: item, detail: null };
    const index = { ...item };
    for (const field of DETAIL_FIELDS) delete index[field];
    return { index, detail };
  }

  // 一批完整条目 → 只含轻量字段的索引数组（保持顺序）。
  function indexOf(items) {
    return (items || []).map((item) => splitItem(item).index);
  }

  // 一批完整条目 → { id: detail }（只含有详情的那些）。
  function detailsOf(items) {
    const out = {};
    for (const item of items || []) {
      if (!item || !item.id) continue;
      const { detail } = splitItem(item);
      if (detail) out[item.id] = detail;
    }
    return out;
  }

  // 索引 + 详情 → 完整条目。详情表里没有的字段，沿用索引里自带的值（老数据）。
  function hydrateItem(item, detail) {
    if (!item || typeof item !== "object" || !detail) return item;
    const next = { ...item };
    for (const field of DETAIL_FIELDS) {
      if (field in detail) next[field] = detail[field];
    }
    return next;
  }

  function hydrate(index, detailMap) {
    if (!Array.isArray(index)) return [];
    const map = detailMap || {};
    return index.map((item) => (item && item.id && map[item.id] ? hydrateItem(item, map[item.id]) : item));
  }

  // 把一批条目拼成「一次 set 就能提交」的写入对象：索引 + 合并后的详情表。
  // currentDetails 传存储里现有的那张表 —— 别的条目的详情不能因为这次写入而丢掉。
  function writePatch(items, currentDetails) {
    return {
      [INDEX_KEY]: indexOf(items),
      [DETAILS_KEY]: { ...(currentDetails || {}), ...detailsOf(items) }
    };
  }

  // 读：索引与详情表一次读回来，拼成完整条目。
  async function load(local) {
    const stored = await local.get([INDEX_KEY, DETAILS_KEY]);
    const index = Array.isArray(stored?.[INDEX_KEY]) ? stored[INDEX_KEY] : [];
    const details = stored && stored[DETAILS_KEY] && typeof stored[DETAILS_KEY] === "object" ? stored[DETAILS_KEY] : {};
    return { index, details, items: hydrate(index, details) };
  }

  globalThis.LaterOnItemStore = {
    INDEX_KEY,
    DETAILS_KEY,
    DETAIL_FIELDS,
    splitItem,
    indexOf,
    detailsOf,
    hydrateItem,
    hydrate,
    writePatch,
    load
  };
})();
