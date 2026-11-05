// 「结构性迁移要不要先问一声」的决策逻辑。
// 关键是三种情形必须分得开：
//   ① 新装的机器（没有数据）→ 静默把 schema 标上去，别为了一个空库弹确认框；
//   ② 早就迁完的机器（schema 落后但数据已是新形状）→ 同样静默，别每次升级都问一遍；
//   ③ 真有老形状数据 → 停下来问。
// 只要 ①② 判错，这个功能就会变成「每次升级都弹一次」，用户很快就学会无脑点「现在升级」。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, "migration-plan.js"), "utf8"), context, { filename: "migration-plan.js" });
const M = context.LaterOnMigrations;

let failures = 0;
let total = 0;
const check = (label, ok, extra = "") => {
  total += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `  → ${extra}` : ""}`);
  if (!ok) failures += 1;
};

console.log("\n── 注册表本身 ──");
check("schema 是个正整数", Number.isInteger(M.SCHEMA) && M.SCHEMA >= 1, String(M.SCHEMA));
check("每条迁移都有 id / schema / structural", M.MIGRATIONS.every((m) => m.id && Number.isInteger(m.schema) && typeof m.structural === "boolean"));
check("没有重复 id", new Set(M.MIGRATIONS.map((m) => m.id)).size === M.MIGRATIONS.length);
check("声明的 schema 不超过当前版本（否则永远跑不到）", M.MIGRATIONS.every((m) => m.schema <= M.SCHEMA));
check("两处老迁移都在册", M.MIGRATIONS.some((m) => m.id === "details-split") && M.MIGRATIONS.some((m) => m.id === "legacy-content"));

console.log("\n── ① 空库 / ② 早已迁完 ──");
const empty = M.plan({ storedSchema: 0, probes: { "details-split": false, "legacy-content": false } });
check("没有任何老形状数据 → 静默", empty.silent === true && empty.pending.length === 0, JSON.stringify(empty));
check("静默时也不要求确认", empty.needsConfirm === false);

const done = M.plan({ storedSchema: M.SCHEMA, probes: { "details-split": true, "legacy-content": true } });
check("schema 已经是当前版本 → 即使探测命中也不再跑", done.silent === true && done.pending.length === 0, JSON.stringify(done));

console.log("\n── ③ 真有老形状数据 ──");
const split = M.plan({ storedSchema: 0, probes: { "details-split": true, "legacy-content": false } });
check("探测命中就排进待办", split.pending.join(",") === "details-split", JSON.stringify(split));
check("结构性迁移要求先确认", split.needsConfirm === true);
check("不静默", split.silent === false);

const both = M.plan({ storedSchema: 0, probes: { "details-split": true, "legacy-content": true } });
check("两条都命中时按声明顺序排", both.pending.join(",") === "legacy-content,details-split", both.pending.join(","));
check("一条待确认就整体不跑（避免跑一半）", both.needsConfirm === true);

console.log("\n── 边角情况 ──");
check("storedSchema 缺失当成 0", M.plan({ probes: { "details-split": true } })?.pending.join(",") === "details-split");
check("storedSchema 是字符串也认", M.plan({ storedSchema: "0", probes: { "details-split": true } })?.pending.length === 1);
check("probes 整个缺失不算命中", M.plan({ storedSchema: 0 })?.silent === true);
check("探到未知 id 不会凭空多一条待办", M.plan({ storedSchema: 0, probes: { "not-a-migration": true } })?.silent === true);
check("probe 值是 \"true\" 字符串不算命中（只认布尔）", M.plan({ storedSchema: 0, probes: { "details-split": "true" } })?.silent === true);

console.log(`\n${failures === 0 ? "🎉" : "❌"} 共 ${total} 项，通过 ${total - failures}，失败 ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
