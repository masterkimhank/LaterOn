#!/usr/bin/env node
/**
 * 生成 dist/version.json —— 扩展「检查更新」的兜底数据源。
 *
 * 为什么需要这个文件：检查更新先问 GitHub API（/releases/latest，信息最全），
 * 但它是按 IP 匿名限流 60 次/小时；版本一多、设备一多就可能被限。
 * 所以第二个来源是 Release 资源里的一个小 JSON —— 静态文件，不吃限流。
 *
 * 地址是固定的，靠 GitHub 的 latest 重定向：
 *   https://github.com/<repo>/releases/latest/download/version.json
 * 只要每次发版都把这个文件带上，地址永远指向最新那一份。
 *
 * 用法：
 *   node scripts/version-json.js --tag v1.76.0-my.1
 *   node scripts/version-json.js --tag v1.76.0-my.1 --out dist/version.json
 *
 * ⚠️ 它必须和 zip 一起上传，否则兜底就断了（check-release-assets 会在 CI 里校验）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function arg(name, fallback = null) {
  const index = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index < 0) return fallback;
  const hit = process.argv[index];
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) return next;
  return true;
}

// v1.76.0-my.1 → 1.76.0（manifest 版本，扩展自己只会拿这个比大小）
function versionFromTag(tag) {
  const raw = String(tag || "").trim().replace(/^v/, "");
  const head = raw.split("-")[0];
  return /^\d+(?:\.\d+)*$/.test(head) ? head : "";
}

const tag = String(arg("tag", "") || "").trim();
if (!tag) {
  console.error("✗ 缺少 --tag，例如：node scripts/version-json.js --tag v1.76.0-my.1");
  process.exit(1);
}
const version = versionFromTag(tag);
if (!version) {
  console.error(`✗ tag 里的版本号不合法：${tag}`);
  process.exit(1);
}

// 和 manifest 对一遍：对不上说明 tag 打错了，这时候发出去会让所有人的
// 「检查更新」都指向一个不存在（或版本不符）的页面。
let manifestVersion = "";
try {
  manifestVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version || "";
} catch (error) {
  console.error(`✗ 读不到 manifest.json：${error.message}`);
  process.exit(1);
}
if (manifestVersion !== version) {
  console.error(`✗ tag 是 ${version}，但 manifest.json 是 ${manifestVersion}。先改 manifest 再加 tag。`);
  process.exit(1);
}

const slug = process.env.GITHUB_REPOSITORY || "masterkimhank/LaterOn";
const payload = {
  version,
  tag,
  pageUrl: `https://github.com/${slug}/releases/tag/${tag}`,
  publishedAt: new Date().toISOString()
};

const outIndex = process.argv.findIndex((a) => a === "--out" || a.startsWith("--out="));
const outPath = outIndex >= 0
  ? (process.argv[outIndex].includes("=")
    ? process.argv[outIndex].split("=").slice(1).join("=")
    : process.argv[outIndex + 1])
  : path.join(ROOT, "dist", "version.json");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`· 已写出 ${path.relative(ROOT, outPath)} → ${version}（${tag}）`);
