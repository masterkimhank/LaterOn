// 多设备同步的内核：纯函数，不碰 chrome API，因此可以直接跑单测。
//
// 思路（借鉴 pasiooooo/LaterOn 的 1.67.x 实现，MIT，见 LICENSE）：
//   · 合并单位是「一条记录」而不是整份 JSON —— 两台设备改不同收藏不会互相抹掉
//   · 每条记录带 stamp = [逻辑时钟, 设备ID]，大的赢（LWW）
//   · 时钟取 max(now, 文档内最大时钟 + 1)，所以系统时间被改回过去也不会乱序
//   · 时间相同则按设备ID、再按内容哈希比 —— 两端各自算一遍结果一致，不需要协商
//   · 删除留墓碑（deleted:true）且永不清理 —— 离线设备回来不会把删掉的条目复活
//   · 传输用 delta：只发和上次同步基线不同的记录
//
// 和本项目的数据对应关系：
//   laterOnItems / laterOnProjects 是数组（按 id 映射），其余是 {id: value} 映射。
(function (root) {
  const KEYS = ["laterOnItems", "laterOnProjects", "laterOnCovers", "laterOnOrder", "laterOnReadingPositions"];
  // projectSequence 不是用户数据，只用来记住项目的排序，跟着 laterOnProjects 一起走。
  const GROUPS = [...KEYS, "projectSequence"];
  // 防原型污染：这些 key 直接当对象属性名用。
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const safeId = (id) => typeof id === "string" && id.length > 0 && !["__proto__", "constructor", "prototype"].includes(id);

  // 稳定序列化：对象键排序后逐层展开，用来做「内容是否相同」的判断与平局比较。
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  const equal = (a, b) => stable(a) === stable(b);
  const empty = () => ({ type: "lateron-webdav", version: 1, records: Object.fromEntries(GROUPS.map((key) => [key, {}])) });

  // 数组型数据（收藏、项目）按 id 摊平成映射；映射型数据原样用。
  function mapValues(key, value) {
    if (key === "laterOnItems" || key === "laterOnProjects") {
      return Object.fromEntries((Array.isArray(value) ? value : []).filter((v) => safeId(v?.id)).map((v) => [v.id, v]));
    }
    return isObject(value) ? value : {};
  }

  // 远端来的东西一律先验形状再入内存：同步文件可能被别的客户端写坏。
  function validValue(group, id, value) {
    if (group === "laterOnItems") {
      if (!isObject(value) || value.id !== id || typeof value.url !== "string") return false;
      try { if (!["http:", "https:"].includes(new URL(value.url).protocol)) return false; } catch { return false; }
      const textFields = ["title", "description", "image", "favicon", "source", "titleAtSave"];
      return textFields.every((k) => value[k] == null || typeof value[k] === "string")
        && (value.projectId == null || typeof value.projectId === "string")
        && (value.status == null || ["unread", "reading", "done"].includes(value.status));
    }
    if (group === "laterOnProjects") return isObject(value) && value.id === id && typeof value.name === "string";
    if (group === "laterOnCovers") return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
    if (group === "laterOnReadingPositions") return Number.isFinite(value) && value >= 0;
    return Array.isArray(value) && value.every(safeId);
  }

  function validate(doc) {
    if (!isObject(doc) || doc.type !== "lateron-webdav" || doc.version !== 1 || !isObject(doc.records)
      || Object.keys(doc.records).some((key) => !GROUPS.includes(key))) throw new Error("syncInvalidData");
    for (const group of GROUPS) {
      if (!isObject(doc.records[group])) throw new Error("syncInvalidData");
      for (const [id, record] of Object.entries(doc.records[group])) {
        if (!safeId(id) || !isObject(record) || !Array.isArray(record.stamp) || record.stamp.length !== 2
          || !Number.isSafeInteger(record.stamp[0]) || record.stamp[0] < 0 || record.stamp[0] >= Number.MAX_SAFE_INTEGER - 1000000
          || !safeId(record.stamp[1]) || typeof record.deleted !== "boolean"
          || (group === "projectSequence" && id !== "ids")
          || (!record.deleted && !validValue(group, id, record.value))) throw new Error("syncInvalidData");
      }
    }
    return doc;
  }

  function maxClock(doc) {
    let max = 0;
    for (const group of GROUPS) for (const record of Object.values(doc.records[group])) max = Math.max(max, record.stamp[0]);
    return max;
  }

  // 顺序：时钟 → 设备ID → 内容哈希。最后一级是兜底，保证任何两端都能算出同一个赢家。
  function compare(a, b) {
    return a.stamp[0] - b.stamp[0]
      || (a.stamp[1] < b.stamp[1] ? -1 : a.stamp[1] > b.stamp[1] ? 1 : 0)
      || (stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
  }

  function merge(a, b) {
    const out = empty();
    for (const group of GROUPS) {
      for (const id of new Set([...Object.keys(a.records[group]), ...Object.keys(b.records[group])])) {
        const left = a.records[group][id], right = b.records[group][id];
        out.records[group][id] = !left ? right : !right ? left : (compare(left, right) >= 0 ? left : right);
      }
    }
    return out;
  }

  // 完整快照与稀疏增量用同一套记录格式：增量里没出现的记录 = 没变，删除仍是显式墓碑。
  function delta(next, base) {
    const out = empty();
    for (const group of GROUPS) for (const [id, record] of Object.entries(next.records[group])) {
      if (!equal(record, base.records[group][id])) out.records[group][id] = record;
    }
    return out;
  }

  const hasRecords = (doc) => GROUPS.some((group) => Object.keys(doc.records[group]).length > 0);

  // 把「本地数据从 before 变成 after」记成一批新记录，统一盖同一个时间戳。
  function change(doc, before, after, device, now = Date.now()) {
    const out = merge(doc, empty());
    const stamp = [Math.max(now, maxClock(doc) + 1), device];
    const setDiff = (group, oldMap, newMap) => {
      for (const id of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
        if (!safeId(id) || equal(oldMap[id], newMap[id])) continue;
        const deleted = !Object.hasOwn(newMap, id);
        out.records[group][id] = deleted ? { stamp, deleted: true } : { stamp, deleted: false, value: newMap[id] };
      }
    };
    for (const key of KEYS) {
      if (!Object.hasOwn(after, key)) continue;
      setDiff(key, mapValues(key, before[key]), mapValues(key, after[key]));
      // 项目顺序单独一条记录：项目数组的先后就是顺序，内容没变但挪了位置也要记一笔。
      if (key === "laterOnProjects") {
        setDiff("projectSequence", { ids: (before[key] || []).map((p) => p.id) }, { ids: (after[key] || []).map((p) => p.id) });
      }
    }
    return out;
  }

  // 新设备上已有的本地数据：只填空缺，不能覆盖已经同步过的东西（stamp 全为 0，谁都能盖过它）。
  function seed(data, device) {
    const doc = change(empty(), {}, data, device, 0);
    for (const records of Object.values(doc.records)) for (const record of Object.values(records)) record.stamp = [0, device];
    return doc;
  }

  // 第一次真正上传前，把 stamp 为 0 的种子记录抬到当前时间，否则它们永远是最旧的。
  function activate(doc, device, now = Date.now()) {
    const out = merge(doc, empty());
    const stamp = [Math.max(now, maxClock(doc) + 1), device];
    for (const group of GROUPS) for (const [id, record] of Object.entries(out.records[group])) {
      if (record.stamp[0] === 0) out.records[group][id] = { ...record, stamp };
    }
    return out;
  }

  // 文档 → 真实的 storage 数据。顺带做三件收尾：项目顺序、收藏时间倒序、清理孤儿数据。
  function materialize(doc) {
    const out = {};
    for (const key of KEYS) {
      const entries = Object.entries(doc.records[key]).filter(([, r]) => !r.deleted).map(([id, r]) => [id, r.value]);
      out[key] = key === "laterOnItems" || key === "laterOnProjects" ? entries.map(([, value]) => value) : Object.fromEntries(entries);
    }
    const projectIds = doc.records.projectSequence.ids?.value || [];
    const ranks = new Map(projectIds.map((id, i) => [id, i]));
    out.laterOnProjects.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
    out.laterOnItems.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0) || a.id.localeCompare(b.id));
    // 项目被删掉时，里面收藏的归属一起清空，否则会挂在一个不存在的项目上。
    out.laterOnItems = out.laterOnItems.map((item) => doc.records.laterOnProjects[item.projectId]?.deleted ? { ...item, projectId: null } : item);
    const ids = new Set(out.laterOnItems.map((item) => item.id));
    for (const key of ["laterOnCovers", "laterOnReadingPositions"]) {
      out[key] = Object.fromEntries(Object.entries(out[key]).filter(([id]) => ids.has(id)));
    }
    out.laterOnOrder = Object.fromEntries(Object.entries(out.laterOnOrder).map(([key, list]) => [key, list.filter((id) => ids.has(id))]));
    return out;
  }

  // 云端按天存一份完整备份，文件名与设置页「导出 JSON」一致，任一份都能手动导入。
  function backupName(now = Date.now()) {
    const date = new Date(now);
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return `lateron-backup-${day}.json`;
  }

  function backup(doc, now = Date.now()) {
    const data = materialize(doc);
    return {
      type: "lateron-backup", version: 2, exportedAt: now,
      items: data.laterOnItems, projects: data.laterOnProjects, covers: data.laterOnCovers,
      order: data.laterOnOrder, readingPositions: data.laterOnReadingPositions
    };
  }

  // 反向：导入的 JSON（含老版本没有 readingPositions 的）变成内部数据，并逐条验形状。
  function backupData(payload) {
    if (!isObject(payload) || payload.type !== "lateron-backup" || payload.version !== 2
      || !Number.isSafeInteger(payload.exportedAt) || payload.exportedAt < 0
      || !Array.isArray(payload.items) || !Array.isArray(payload.projects)
      || !isObject(payload.covers) || !isObject(payload.order)
      || (payload.readingPositions !== undefined && !isObject(payload.readingPositions))) throw new Error("syncInvalidData");
    const data = {
      laterOnItems: payload.items, laterOnProjects: payload.projects,
      laterOnCovers: payload.covers, laterOnOrder: payload.order,
      laterOnReadingPositions: payload.readingPositions || {}
    };
    for (const key of KEYS) {
      const value = data[key];
      const entries = Array.isArray(value) ? value.map((item) => [item?.id, item]) : Object.entries(value);
      if (new Set(entries.map(([id]) => id)).size !== entries.length
        || entries.some(([id, item]) => !safeId(id) || !validValue(key, id, item))) throw new Error("syncInvalidData");
    }
    return data;
  }

  root.LaterOnSyncCore = { KEYS, empty, equal, validate, merge, delta, hasRecords, change, seed, activate, materialize, backupName, backup, backupData };
})(globalThis);
