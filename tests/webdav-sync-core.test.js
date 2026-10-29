// WebDAV 同步内核与目录解析的单测。
//
// 这些是纯函数，不碰 chrome API，所以能直接跑：内核决定「谁赢」，一旦算错就是
// 静默的数据丢失（不报错、只是某条收藏变回旧值），必须有用例钉住。
//
// 覆盖：
//   1) LWW：时钟大者赢 + 同一时钟按设备 ID 定序 + 两端各自算结果一致
//   2) 墓碑：删掉的条目不会被离线设备"复活"
//   3) materialize：项目删除后归属清空、孤儿封面/阅读位置清理、项目顺序按 sequence
//   4) delta：只带变化的记录
//   5) seed / activate：新设备的本地数据只能填空缺，不能覆盖已同步的记录
//   6) 备份格式：与「导出 JSON」同构，能来回转换，且拒绝畸形输入
//   7) 目录列举：PROPFIND 解析、只认同目录下的备份文件、拒绝畸形 XML
//
// 运行：node tests/webdav-sync-core.test.js
require("../webdav-sync-core.js");
require("../webdav-directory.js");

const Core = globalThis.LaterOnSyncCore;
const Directory = globalThis.LaterOnWebDAVDirectory;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const throws = (fn, code) => {
  try { fn(); return false; } catch (error) { return !code || error.message === code; }
};
const item = (id, patch = {}) => ({ id, url: `https://example.com/${id}`, title: `标题 ${id}`, projectId: null, savedAt: 1000, status: "unread", ...patch });
const data = (patch = {}) => ({
  laterOnItems: [], laterOnProjects: [], laterOnCovers: {}, laterOnOrder: {}, laterOnReadingPositions: {}, ...patch
});
const stampsOf = (doc, group) => Object.fromEntries(Object.entries(doc.records[group]).map(([id, r]) => [id, r.stamp[0]]));

console.log("── 第 1 步：LWW 与收敛性 ──");
const devA = "device-aaa", devB = "device-bbb";
const a1 = Core.change(Core.empty(), data(), data({ laterOnItems: [item("x", { title: "A 的版本" })] }), devA, 1000);
const b1 = Core.change(Core.empty(), data(), data({ laterOnItems: [item("x", { title: "B 的版本" })] }), devB, 1000);
// 同一时刻两台设备改同一条：按设备 ID 定序，devB > devA，所以 B 赢
const winner = Core.materialize(Core.merge(a1, b1)).laterOnItems[0].title;
check("同时改同一条：设备 ID 大的赢（确定，不靠随机）", winner === "B 的版本", winner);
check("交换合并顺序结果一致（两端不需要协商）",
  Core.equal(Core.merge(a1, b1), Core.merge(b1, a1)));
const later = Core.change(Core.empty(), data(), data({ laterOnItems: [item("x", { title: "后来的" })] }), devA, 5000);
check("时钟大的赢，与设备 ID 无关",
  Core.materialize(Core.merge(b1, later)).laterOnItems[0].title === "后来的");
check("时钟取 max(now, 文档内最大 + 1)：同一次改动内多条记录共享一个时间戳",
  Object.values(a1.records.laterOnItems).every((r) => r.stamp[0] === 1000) && a1.records.laterOnItems.x.stamp[1] === devA);

console.log("\n── 第 2 步：墓碑（删除不能被离线设备复活）──");
const withItem = Core.change(Core.empty(), data(), data({ laterOnItems: [item("y")] }), devA, 2000);
// 删除 = 新数据里没有这条
const deleted = Core.change(withItem, data({ laterOnItems: [item("y")] }), data(), devA, 3000);
check("删除记为墓碑而不是消失", deleted.records.laterOnItems.y.deleted === true);
const offline = Core.change(Core.empty(), data(), data({ laterOnItems: [item("y")] }), devB, 1500);
const afterMerge = Core.merge(deleted, offline);
check("离线设备的旧记录盖不过墓碑",
  Core.materialize(afterMerge).laterOnItems.length === 0,
  JSON.stringify(Core.materialize(afterMerge).laterOnItems));
check("墓碑在 materialize 后不出现在数据里", !("y" in Core.materialize(afterMerge).laterOnItems));
const revived = Core.change(afterMerge, data(), data({ laterOnItems: [item("y", { title: "重新收藏" })] }), devA, 4000);
check("重新收藏可以盖过墓碑（时间更新）",
  Core.materialize(revived).laterOnItems[0]?.title === "重新收藏");

console.log("\n── 第 3 步：materialize 的收尾逻辑 ──");
const rich = Core.change(Core.empty(), data(), data({
  laterOnProjects: [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }],
  laterOnItems: [item("i1", { projectId: "p1", savedAt: 500 }), item("i2", { projectId: "p2", savedAt: 900 }), item("i3", { projectId: null, savedAt: 700 })],
  laterOnCovers: { i1: "data:image/png;base64,AAA", ghost: "data:image/png;base64,BBB" },
  laterOnReadingPositions: { i2: 320, ghost: 10 },
  laterOnOrder: { all: ["i1", "i2", "ghost"] }
}), devA, 6000);
const materialized = Core.materialize(rich);
check("收藏按保存时间倒序", materialized.laterOnItems.map((i) => i.id).join() === "i2,i3,i1", materialized.laterOnItems.map((i) => i.id).join());
check("项目按保存的顺序排列", materialized.laterOnProjects.map((p) => p.id).join() === "p1,p2");
check("孤儿封面被清掉", !("ghost" in materialized.laterOnCovers) && "i1" in materialized.laterOnCovers);
check("孤儿阅读位置被清掉", !("ghost" in materialized.laterOnReadingPositions) && materialized.laterOnReadingPositions.i2 === 320);
check("排序列表里的孤儿 id 被过滤", materialized.laterOnOrder.all.join() === "i1,i2");

// 删掉项目 p1 之后，i1 的归属要清空，否则会挂在一个不存在的项目上
const projectGone = Core.change(rich, { laterOnProjects: [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }] },
  { laterOnProjects: [{ id: "p2", name: "项目二" }] }, devA, 7000);
const afterProjectDelete = Core.materialize(projectGone);
check("项目被删后，里面的收藏归属清空",
  afterProjectDelete.laterOnItems.find((i) => i.id === "i1")?.projectId === null,
  String(afterProjectDelete.laterOnItems.find((i) => i.id === "i1")?.projectId));

console.log("\n── 第 4 步：delta 只带变化 ──");
const beforeDelta = Core.change(Core.empty(), data(), data({ laterOnItems: [item("d1"), item("d2")] }), devA, 8000);
const afterDelta = Core.change(beforeDelta, data({ laterOnItems: [item("d1"), item("d2")] }),
  data({ laterOnItems: [item("d1", { status: "done" }), item("d2")] }), devA, 9000);
const patch = Core.delta(afterDelta, beforeDelta);
check("只有改动的那条进 delta", Object.keys(patch.records.laterOnItems).join() === "d1", Object.keys(patch.records.laterOnItems).join());
check("没变的组完全为空",
  Object.entries(patch.records).filter(([group]) => group !== "laterOnItems").every(([, records]) => Object.keys(records).length === 0));
check("合并回基线后与目标一致", Core.equal(Core.merge(beforeDelta, patch), afterDelta));
check("空 delta 用 hasRecords 判定为空", !Core.hasRecords(Core.delta(afterDelta, afterDelta)));

console.log("\n── 第 5 步：seed / activate（新设备接入）──");
const seeded = Core.seed(data({ laterOnItems: [item("s1")] }), devB);
check("种子记录的时钟为 0（谁都能盖过它）", stampsOf(seeded, "laterOnItems").s1 === 0);
const remoteNewer = Core.change(Core.empty(), data(), data({ laterOnItems: [item("s1", { title: "云端的" })] }), devA, 11000);
// 真实流程：先 merge 再 activate（activate 只抬那些仍然 stamp=0 的记录）
check("已同步记录不会被同 id 的本地种子覆盖：先合并",
  Core.materialize(Core.merge(seeded, remoteNewer)).laterOnItems[0].title === "云端的");
check("种子记录在合并后不会顶掉云端记录：再 activate 也不变",
  Core.materialize(Core.activate(Core.merge(seeded, remoteNewer), devB, 12000)).laterOnItems[0].title === "云端的");
const activated = Core.activate(seeded, devB, 12000);
check("activate 把（没有被云端覆盖的）种子记录抬到当前时间", stampsOf(activated, "laterOnItems").s1 >= 12000, String(stampsOf(activated, "laterOnItems").s1));

console.log("\n── 第 6 步：备份格式（与「导出 JSON」同构）──");
const backup = Core.backup(rich, 1700000000000);
check("type/version 与设置页导出一致", backup.type === "lateron-backup" && backup.version === 2);
check("带上了阅读位置", "readingPositions" in backup && backup.readingPositions.i2 === 320);
check("文件名按天", Core.backupName(new Date("2026-10-29T10:00:00").getTime()) === "lateron-backup-2026-10-29.json",
  Core.backupName(new Date("2026-10-29T10:00:00").getTime()));
const roundTrip = Core.backupData(JSON.parse(JSON.stringify(backup)));
check("导出再导入不丢条目", roundTrip.laterOnItems.length === 3 && roundTrip.laterOnProjects.length === 2);
check("老导出（没有 readingPositions）仍可导入",
  Core.backupData({ ...JSON.parse(JSON.stringify(backup)), readingPositions: undefined }) !== null);
check("拒绝错误 type", throws(() => Core.backupData({ ...backup, type: "other" }), "syncInvalidData"));
check("拒绝条目不合法（url 不是 http/https）",
  throws(() => Core.backupData({ ...backup, items: [{ id: "z", ur: "x" }] }), "syncInvalidData"));
check("拒绝重复 id", throws(() => Core.backupData({ ...backup, items: [item("dup"), item("dup")] }), "syncInvalidData"));
check("拒绝原型污染用的 id",
  throws(() => Core.backupData({ ...backup, covers: { constructor: "data:image/png;base64,AA" } }), "syncInvalidData"));
// JSON.parse 才会造出真正的自有属性 __proto__（对象字面量里的 __proto__ 是设原型）
check("拒绝 __proto__ 作为 id",
  throws(() => Core.backupData({
    ...backup,
    covers: JSON.parse('{"__proto__":"data:image/png;base64,AA"}')
  }), "syncInvalidData"));

console.log("\n── 第 7 步：validate 对畸形文档的态度 ──");
check("合法文档通过", Core.validate(Core.change(Core.empty(), data(), data({ laterOnItems: [item("v1")] }), devA, 1)) !== null);
check("拒绝错的 type", throws(() => Core.validate({ ...Core.empty(), type: "x" }), "syncInvalidData"));
check("拒绝多出来的组", throws(() => Core.validate({ ...Core.empty(), records: { ...Core.empty().records, junk: {} } }), "syncInvalidData"));
check("拒绝不存在的状态值",
  throws(() => Core.validate(Core.change(Core.empty(), data(), data({ laterOnItems: [item("v2", { status: "archived" })] }), devA, 1)), "syncInvalidData"));
check("拒绝 stamp 里的非安全整数",
  throws(() => Core.validate({ ...Core.empty(), records: { ...Core.empty().records, laterOnItems: { a: { stamp: [1.5, devA], deleted: true } } } }), "syncInvalidData"));

console.log("\n── 第 8 步：PROPFIND 目录解析 ──");
const BASE = "https://dav.example.com/dav/LaterOn/";
const entry = (href, status = "HTTP/1.1 200 OK") => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>${status}</d:status></d:propstat></d:response>`;
const multistatus = (body) => `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`;
const xml = multistatus([
  ` <d:response><d:href>/dav/LaterOn/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
  entry("/dav/LaterOn/lateron-backup-2026-10-28.json"),
  entry("/dav/LaterOn/lateron-backup-2026-10-29.json"),
  entry("/dav/LaterOn/notes.txt"),
  entry("/dav/Other/lateron-backup-2026-10-27.json")
].join("\n"));
const names = Directory.names(xml, BASE);
check("只列出本目录下的备份文件，按日期排序",
  names.join() === "lateron-backup-2026-10-28.json,lateron-backup-2026-10-29.json", names.join());
check("别的目录的备份不算", !names.includes("lateron-backup-2026-10-27.json"));
check("不认识的文件忽略", !names.includes("notes.txt"));
check("404 的条目（墓碑）不算", Directory.names(multistatus(entry("/dav/LaterOn/lateron-backup-2026-10-30.json", "HTTP/1.1 404 Not Found")), BASE).length === 0);
check("带命名空间前缀换一个也认（ns1:）",
  Directory.names(`<?xml version="1.0"?><ns1:multistatus xmlns:ns1="DAV:" xmlns:d="DAV:">${entry("/dav/LaterOn/lateron-backup-2026-10-29.json")}</ns1:multistatus>`, BASE).join() === "lateron-backup-2026-10-29.json");
check("URL 编码的文件名能解出来",
  Directory.names(multistatus(entry("/dav/LaterOn/lateron-backup-2026-10-31.json")), BASE).includes("lateron-backup-2026-10-31.json"));

console.log("\n── 第 9 步：畸形 XML 一律拒绝 ──");
const bad = [
  ["带 DOCTYPE（XXE 入口）", `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><d:multistatus xmlns:d="DAV:"/>`],
  ["自定义实体", multistatus(`<d:response><d:href>&evil;</d:href></d:response>`)],
  ["标签不配对", `<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus>`],
  ["两个根节点", `<d:multistatus xmlns:d="DAV:"/><d:multistatus xmlns:d="DAV:"/>`],
  ["根节点不是 multistatus", `<d:propfind xmlns:d="DAV:"/>`],
  ["超长（>2MB）", `<d:multistatus xmlns:d="DAV:">${"x".repeat(2 * 1024 * 1024 + 10)}</d:multistatus>`]
];
for (const [label, payload] of bad) {
  check(`拒绝：${label}`, throws(() => Directory.names(payload, BASE), "syncInvalidListing"));
}
check("拒绝非字符串输入", throws(() => Directory.names(null, BASE), "syncInvalidListing"));

console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
process.exit(failures === 0 ? 0 : 1);
