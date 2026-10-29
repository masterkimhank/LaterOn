#!/usr/bin/env node
/**
 * 从 CHANGELOG 抽出某个版本的发布说明，并校验 tag 与 manifest 版本是否对得上。
 *
 * 为什么单独成文件：说明的生成有两个调用方，必须共用同一份实现，否则
 * 「本地 release.js 发的说明」和「CI 打 tag 自动发的说明」会长得不一样。
 *   · scripts/release.js            发版时写进临时文件交给 gh release create
 *   · .github/workflows/release.yml 推 tag 自动发版时同样用它生成说明文件
 *
 * 用法：
 *   node scripts/release-notes.js 1.72.1                    打印到 stdout
 *   node scripts/release-notes.js --tag v1.72.1-my.2        先校验 tag，再打印
 *   node scripts/release-notes.js --tag v1.72.1-my.2 --out notes.md
 *
 * tag 规则：v<manifest 版本>[-my.<序号>]。
 * Chrome 的 manifest.version 只认数字和点（`1.73.0-my.1` 会被拒），所以「二次开发版」
 * 的序号只能挂在 git tag 上，用 -my.N 与上游的 v<版本> 区分，避免同名 tag 指向不同提交。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIN_NOTES = 40;

function fail(message) {
  const error = new Error(message);
  error.releaseNotes = true;
  throw error;
}

function manifestVersion() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const version = String(manifest.version || "").trim();
  if (!/^\d+(?:\.\d+)*$/.test(version)) fail(`manifest.json 的 version 不合法：${version || "(空)"}`);
  return version;
}

// v1.73.0 → { version: "1.73.0", suffix: "" }
// v1.73.0-my.2 → { version: "1.73.0", suffix: "-my.2" }
function parseTag(tag) {
  const hit = /^v(\d+(?:\.\d+)*)(-my\.\d+)?$/.exec(String(tag || "").trim());
  return hit ? { version: hit[1], suffix: hit[2] || "" } : null;
}

// 标签名写错是最容易发生、也最难发现的一种发版事故：包发出去了，版本却对不上。
function assertTagMatches(tag, version = manifestVersion()) {
  const parsed = parseTag(tag);
  if (!parsed) fail(`tag 格式不对：${tag}（应为 v${version} 或 v${version}-my.N）`);
  if (parsed.version !== version) {
    fail(`tag ${tag} 指向的版本是 ${parsed.version}，但 manifest.json 是 ${version}。先改版本号再打 tag。`);
  }
  return parsed;
}

function changelogSection(version) {
  const file = path.join(ROOT, "CHANGELOG.md");
  const changelog = fs.readFileSync(file, "utf8");
  // 用位置查找而不是一条正则：段与段之间既可能是「## 下一版」也可能是「---」分隔线，
  // 而 multiline 正则里的 $ 会在第一个换行就命中，惰性匹配会当场截断（踩过一次）。
  const start = changelog.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
  if (start === -1) fail(`CHANGELOG.md 里没有「## ${version}」这一段。先写记录再发版，否则版本说明是空的。`);
  const tail = changelog.slice(start + 1);
  const end = tail.search(/\n## |\n---\n/);
  const block = end === -1 ? changelog.slice(start) : changelog.slice(start, start + 1 + end);
  return block.replace(/^## [^\n]*\n/, "").trim();
}

/**
 * 生成 Release 的正文。
 * @param {string} version  manifest 里的版本号
 * @param {{assetName?: string}} options 安装包文件名（默认 LaterOn-<version>.zip）
 */
function notesFor(version, options = {}) {
  if (!/^\d+(?:\.\d+)*$/.test(String(version || ""))) fail(`版本号不合法：${version}`);
  const body = changelogSection(version);
  if (body.length < MIN_NOTES) {
    fail(`CHANGELOG「## ${version}」这段太短（${body.length} 字，至少 ${MIN_NOTES}），写清楚改了什么再发`);
  }
  const asset = options.assetName || `LaterOn-${version}.zip`;
  return [
    "## 本版改动",
    "",
    body,
    "",
    "---",
    "",
    "## 安装",
    "",
    `1. 下载 \`${asset}\`，解压到一个**固定目录**（以后别挪动）。`,
    "2. 打开 `chrome://extensions/`，右上角开启「开发者模式」。",
    "3. 点「加载已解压的扩展程序」，选择解压出来的目录。",
    "",
    "> 扩展 ID 由文件夹路径派生：换目录会变成新 ID，读不到原来的收藏。",
    "> 跨目录迁移请在旧版本「设置 → 导出 JSON」，新版本再导入。",
    "",
  ].join("\n");
}

/** 从 tag 里直接生成正文（顺手校验 tag 与 manifest 是否一致）。 */
function notesForTag(tag) {
  const { version } = assertTagMatches(tag);
  return notesFor(version);
}

function main(argv) {
  // 同时支持 `--tag v1.2.3` 与 `--tag=v1.2.3`
  const valueOf = (name) => {
    const index = argv.findIndex((item) => item === `--${name}`);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
    const inline = argv.find((item) => item.startsWith(`--${name}=`));
    return inline ? inline.split("=").slice(1).join("=") : null;
  };

  const tag = valueOf("tag");
  const out = valueOf("out");
  // 位置参数（版本号）：排除 --tag / --out 背后的那个值
  const positional = argv.filter((item, index) => {
    if (item.startsWith("--")) return false;
    const previous = argv[index - 1];
    return previous !== "--tag" && previous !== "--out";
  })[0] || null;

  let version;
  if (tag) {
    version = assertTagMatches(tag).version;
  } else {
    // 不传 tag 时可以直接指定版本（打印历史版本的说明用）；默认取 manifest 的
    version = positional || manifestVersion();
  }
  const notes = notesFor(version);

  if (out) {
    fs.writeFileSync(out, notes, "utf8");
    console.log(`✓ ${version} 的发布说明 → ${out}（${notes.length} 字）`);
  } else {
    process.stdout.write(notes);
  }
  return notes;
}

module.exports = { notesFor, notesForTag, parseTag, assertTagMatches, manifestVersion, changelogSection };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
