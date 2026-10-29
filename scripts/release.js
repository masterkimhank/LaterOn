#!/usr/bin/env node
/**
 * 发版一条龙：校验 → 测试 → 打包 → 打 tag → 推送 → 建 GitHub Release
 *
 * 用法（在仓库根目录）：
 *   node scripts/release.js                      只校验 + 打包，不发布（先看结果）
 *   node scripts/release.js --version 1.73.0     把 manifest 版本升上去，再校验打包
 *   node scripts/release.js --publish            真正发版：tag + push + gh release
 *   node scripts/release.js --publish --skip-test  跳过测试（不推荐）
 *   node scripts/release.js --publish --tag v1.73.0-my.1  复用已有 tag（Release 建失败后重发）
 *
 * 发布目标固定取 origin，全程显式 --repo：本地同时有 origin 和 upstream 时，
 * gh 会自己猜成上游（作者的仓库）。
 *
 * 它拦的是发版最容易出的四类错：
 *   1) manifest 版本和 CHANGELOG 段落对不上
 *   2) 有未提交的改动被打进包里
 *   3) 测试挂了还发出去
 *   4) tag 名字写错、zip 忘了带上 release
 *
 * 打包本身交给 scripts/build-release.py（作者写的 allowlist 脚本，别绕过它：
 * 它会把 tests/、.md、preview-*.html 挡在包外，并校验 manifest 引用的文件都在包内）。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  return true;
};
const has = (name) => process.argv.some((a) => a === `--${name}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  if (result.error) return { ok: false, out: String(result.error.message) };
  return { ok: result.status === 0, out: `${result.stdout || ""}${result.stderr || ""}`.trim() };
};

// gh 不在 PATH 里也能用（WorkBuddy 会话的 PATH 是启动时快照，新装的 gh 找不到）
function ghBinary() {
  if (run("gh", ["--version"]).ok) return "gh";
  for (const candidate of [
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    "/usr/bin/gh",
    "/usr/local/bin/gh",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// gh 默认按 remote 猜仓库，本地同时存在 origin 和 upstream 时会猜成上游（作者的仓库），
// 结果报「tag 没推到 gaoyiiiii/LaterOn」。所以所有 gh 命令一律显式 --repo。
function repoSlug() {
  const url = run("git", ["remote", "get-url", "origin"]).out.trim();
  if (!url) fail("没有 origin 远程，不知道该发到哪个仓库（git remote add origin ...）");
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/) || url.match(/github\.com[:/]([^/]+)\/([^/]+)/);
  if (!m) fail(`看不懂 origin 地址：${url}`);
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

// ── 1. 读版本 ────────────────────────────────────────────
const manifestPath = path.join(ROOT, "manifest.json");
const raw = fs.readFileSync(manifestPath, "utf8");
const versionMatch = raw.match(/"version"\s*:\s*"([^"]+)"/);
if (!versionMatch) fail("manifest.json 里找不到 version");
let version = versionMatch[1];

const wanted = arg("version");
if (wanted && wanted !== true) {
  if (!/^\d+\.\d+\.\d+$/.test(wanted)) fail(`版本号必须是 x.y.z（Chrome 只认数字和点）：${wanted}`);
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  if (!new RegExp(`^## ${wanted.replace(/\./g, "\\.")}\\b`, "m").test(changelog)) {
    fail(`CHANGELOG.md 里没有「## ${wanted}」这一段。先写记录再升版本号，否则发出去的版本说明是空的。`);
  }
  version = wanted;
  // 只替换版本那一处，保留文件原有缩进与行尾
  fs.writeFileSync(manifestPath, raw.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`), "utf8");
  console.log(`· manifest.json 版本 → ${version}（记得和 CHANGELOG 一起提交）`);
}

// ── 2. 校验记录与分支 ────────────────────────────────────
// CHANGELOG 段落的抽取和「这段太短就拒发」的判断都在 scripts/release-notes.js 里：
// 打 tag 自动发版的 GitHub Actions 用的是同一份实现，本地和 CI 的说明必须一致。
const { notesFor } = require("./release-notes");
let notes;
try {
  notes = notesFor(version);
} catch (error) {
  fail(error.message);
}

if (!fs.readFileSync(path.join(ROOT, "IMPROVEMENTS.md"), "utf8").includes(version)) {
  console.log(`· 提醒：IMPROVEMENTS.md 里没有提到 ${version}，工程记录可能漏了`);
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch !== "dev") console.log(`· 提醒：当前在 ${branch} 分支，发版通常在 dev 上`);

const dirty = run("git", ["status", "--porcelain"]).out;
if (dirty) {
  const lines = dirty.split("\n");
  console.log(`· 工作区有 ${lines.length} 处未提交改动：`);
  lines.slice(0, 8).forEach((l) => console.log(`    ${l}`));
  if (has("publish")) fail("有未提交的改动，先提交再发版（否则打出去的包和 tag 对不上仓库里的代码）");
}

// ── 3. 测试 ──────────────────────────────────────────────
if (!has("skip-test")) {
  console.log("· 跑测试（约 50s，--skip-test 可跳过）…");
  const t = run(process.execPath, [path.join(ROOT, "scripts", "test-all.js")]);
  const summary = t.out.split("\n").filter((l) => l.includes("共 ") && l.includes("失败")).pop();
  if (!t.ok) {
    console.error(t.out.split("\n").slice(-25).join("\n"));
    fail("测试没全绿，不发版");
  }
  console.log(`  ${summary || "全部通过"}`);
} else {
  console.log("· 跳过测试（--skip-test）");
}

// ── 4. 打包 ──────────────────────────────────────────────
const build = run(process.platform === "win32" ? "python" : "python3", [path.join("scripts", "build-release.py")]);
if (!build.ok) fail(`打包失败：\n${build.out}`);
console.log(`  ${build.out.split("\n")[0]}`);

const zipPath = path.join(DIST, `LaterOn-${version}.zip`);
if (!fs.existsSync(zipPath)) fail(`没找到预期产物 ${zipPath}`);
const zipKb = (fs.statSync(zipPath).size / 1024).toFixed(1);

// ── 5. tag（本地已存在同版本 tag 时自动接 .2 / .3）───────
const tags = run("git", ["tag", "-l", `v${version}-my.*`]).out.split("\n").filter(Boolean);
const nextSeq = tags.reduce((max, t) => Math.max(max, Number(t.split(".").pop()) || 0), 0) + 1;
const forcedTag = arg("tag");
let tag = `v${version}-my.${nextSeq}`;
if (forcedTag && forcedTag !== true) {
  // 复用已有 tag：适用于「tag 推过了、但 Release 没建成功 / 忘了挂包」的情况
  if (!run("git", ["rev-parse", "--verify", `refs/tags/${forcedTag}`]).ok) {
    fail(`本地没有 tag ${forcedTag}`);
  }
  tag = forcedTag;
}
const tagExists = run("git", ["rev-parse", "--verify", `refs/tags/${tag}`]).ok;

console.log(`\n${"=".repeat(52)}`);
console.log(`版本   ${version}`);
console.log(`分支   ${branch}`);
console.log(`产物   dist/LaterOn-${version}.zip（${zipKb} KB）`);
console.log(`标签   ${tag}${tagExists ? "（已存在，复用它）" : tags.length ? `（同版本已有 ${tags.join(", ")}）` : ""}`);
console.log(`仓库   ${repoSlug()}`);

if (!has("publish")) {
  console.log(`\n这只是演练。确认无误后发版：`);
  console.log(`  node scripts/release.js --publish --skip-test`);
  process.exit(0);
}

// ── 6. 发布 ──────────────────────────────────────────────
const gh = ghBinary();
if (!gh) fail("找不到 gh。装一个（winget install --id GitHub.cli -e）或去掉 --publish 手动发");
if (!run(gh, ["auth", "status"]).ok) fail("gh 没登录：先在终端跑 gh auth login");

const noteFile = path.join(os.tmpdir(), `lateron-release-${version}.md`);
// notes 已经是完整正文（含「本版改动」与「安装」两节），直接写盘
fs.writeFileSync(noteFile, notes, "utf8");

const slug = repoSlug();

// 同名 Release 已存在就别重复建，否则 gh 会报一个很难懂的错误
const existing = run(gh, ["release", "view", tag, "--repo", slug, "--json", "url"]);
if (existing.ok) {
  fail(`仓库 ${slug} 上已有 ${tag} 的 Release：\n${existing.out}\n要重发先删：gh release delete ${tag} --repo ${slug} --yes`);
}

console.log("\n· 打 tag…");
if (tagExists) {
  console.log(`  ${tag} 已存在，直接复用`);
} else {
  const tagResult = run("git", ["tag", "-a", tag, "-m", `LaterOn ${version}（基于上游 ${version} 的二次开发版）`]);
  if (!tagResult.ok) fail(`打 tag 失败：${tagResult.out}`);
}

console.log("· 推送分支与 tag…");
for (const args of [["push", "origin", branch], ["push", "origin", tag]]) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = run("git", args);
    if (r.ok) { last = null; break; }
    last = r.out;
    // 代理节点抖动会让握手偶发失败，原样重试通常就过
    if (!/handshake|unexpected eof|502|TLS/i.test(r.out)) break;
    console.log(`  （第 ${attempt} 次失败，重试）`);
  }
  if (last) fail(`推送失败：\n${last}`);
}

console.log("· 创建 GitHub Release…");
const rel = run(gh, [
  "release", "create", tag, zipPath,
  "--repo", slug,
  // 标题带上 -my.N：同一个版本号可能发过好几次（my.1 / my.2），
  // 只用版本号会让 Releases 列表里出现两条一模一样的标题。
  "--title", `${tag.replace(/^v/, "")}（二次开发版）`,
  "--notes-file", noteFile,
]);
if (!rel.ok) fail(`Release 创建失败（tag 已经推上去了，可重试或到网页手动建）：\n${rel.out}`);

console.log(`\n✓ 发版完成：${rel.out.split("\n").filter(Boolean).pop() || tag}`);
console.log(`  包：dist/LaterOn-${version}.zip`);
console.log(`  装法：解压后在 chrome://extensions/ 用「加载已解压的扩展程序」选该目录`);
