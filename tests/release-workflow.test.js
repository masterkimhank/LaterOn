// 发版流水线的两道契约：
//   ① scripts/release-notes.js —— tag↔manifest 版本一致性校验 + 发布说明生成
//      （本地 release.js 与 CI 共用，任何一边改了规则，这里都会炸）
//   ② .github/workflows/release.yml —— 推 tag 自动发版的关键环节不能掉
//
// 第 ② 部分是文本级检查，不是 YAML 解析（仓库不带 YAML 依赖，也不该为测试加一个）。
// 它拦的是「改工作流时手滑删掉某个参数」这类错：真跑一次 GitHub Actions 要等 tag
// 推上去才知道有没有报错，代价太高。
//
// 运行：node tests/release-workflow.test.js
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
const NOTES = require("../scripts/release-notes.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const throws = (fn) => {
  try { fn(); return null; } catch (error) { return String(error.message || error); }
};

const manifestVersion = NOTES.manifestVersion();

console.log("── 第 1 步：tag 解析 ──");
check("v1.72.1 解析出版本、无后缀",
  JSON.stringify(NOTES.parseTag("v1.72.1")) === JSON.stringify({ version: "1.72.1", suffix: "" }));
check("v1.72.1-my.2 保留 -my.2 后缀",
  JSON.stringify(NOTES.parseTag("v1.72.1-my.2")) === JSON.stringify({ version: "1.72.1", suffix: "-my.2" }));
check("v1.73.0-my.10 序号多位数也认",
  NOTES.parseTag("v1.73.0-my.10")?.suffix === "-my.10");
check("没有 v 前缀不认（避免 tag 与上游写法混用）", NOTES.parseTag("1.72.1") === null);
check("别的后缀不认（-beta 之类 Chrome 装不进去，不该发）", NOTES.parseTag("v1.72.1-beta") === null);

console.log("\n── 第 2 步：tag 与 manifest 版本必须一致 ──");
check("当前版本的 tag 通过",
  NOTES.assertTagMatches(`v${manifestVersion}-my.1`).version === manifestVersion);
const mismatch = throws(() => NOTES.assertTagMatches("v9.9.9-my.1"));
check("版本对不上时报错", !!mismatch, mismatch);
check("报错里同时给出两边的版本号",
  !!mismatch && mismatch.includes("9.9.9") && mismatch.includes(manifestVersion), mismatch);

console.log("\n── 第 3 步：发布说明的内容 ──");
const notes = NOTES.notesFor(manifestVersion);
check("有「本版改动」小节", notes.startsWith("## 本版改动"), notes.slice(0, 20));
check("有「安装」小节（下载 → 开发者模式 → 加载已解压）",
  notes.includes("## 安装") && notes.includes("chrome://extensions/") && notes.includes("加载已解压的扩展程序"));
check("安装包文件名与 manifest 版本一致", notes.includes(`LaterOn-${manifestVersion}.zip`));
check("说明里带「换目录等于换扩展 ID」的提醒", notes.includes("扩展 ID 由文件夹路径派生"));
check("正文确实抽到了 CHANGELOG 的内容（不是空壳）", notes.length > 200, `${notes.length} 字`);
const custom = NOTES.notesFor(manifestVersion, { assetName: "Custom.zip" });
check("可以指定安装包名（补发时文件名可能不同）", custom.includes("Custom.zip") && !custom.includes(`LaterOn-${manifestVersion}.zip`));
const missing = throws(() => NOTES.notesFor("9.9.9"));
check("CHANGELOG 里没有该版本时报错", !!missing && missing.includes("9.9.9"), missing);

console.log("\n── 第 4 步：命令行行为（CI 就是按这个调用的）──");
const cli = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/release-notes.js"), ...args], { cwd: ROOT, encoding: "utf8" });
const okRun = cli(["--tag", `v${manifestVersion}-my.1`]);
check("--tag 正常时退出码 0", okRun.status === 0, String(okRun.status));
check("--tag 正常时把说明打到 stdout", okRun.stdout.startsWith("## 本版改动"));
const badRun = cli(["--tag", "v9.9.9-my.1"]);
check("--tag 版本不符时退出码非 0", badRun.status !== 0, String(badRun.status));
check("失败时错误信息在 stderr（不污染 stdout）",
  badRun.stderr.includes("9.9.9") && badRun.stdout === "", JSON.stringify(badRun.stdout.slice(0, 20)));
const outFile = path.join(ROOT, "tests", ".tmp-release-notes.md");
const outRun = cli(["--tag", `v${manifestVersion}-my.1`, "--out", outFile]);
check("--out 写文件成功", outRun.status === 0 && fs.existsSync(outFile), outRun.stderr);
const written = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
check("写出的文件内容与 stdout 一致", written === okRun.stdout);
fs.rmSync(outFile, { force: true });

console.log("\n── 第 5 步：工作流的关键环节 ──");
check("推 tag 触发（v*）", /on:\s*[\s\S]*?push:\s*\n\s*tags:\s*\n\s*-\s*"v\*"/.test(WORKFLOW));
check("保留手动补建入口（workflow_dispatch + tag 输入）",
  /workflow_dispatch:/.test(WORKFLOW) && /inputs:[\s\S]*?tag:/.test(WORKFLOW));
check("给了 contents: write（否则 gh release create 会 403）", /permissions:\s*\n\s*contents:\s*write/.test(WORKFLOW));
check("检出的是 tag 而不是默认分支",
  /ref:\s*\$\{\{\s*inputs\.tag \|\| github\.ref_name\s*\}\}/.test(WORKFLOW));
check("检出阶段不留凭据", /persist-credentials:\s*false/.test(WORKFLOW));
check("说明由 scripts/release-notes.js 生成（与本地同一份实现）",
  /node scripts\/release-notes\.js --tag "\$TAG"/.test(WORKFLOW));
check("打包走 build-release.py（allowlist + 回读校验）",
  /python3 scripts\/build-release\.py/.test(WORKFLOW));
check("Release 用 --verify-tag（不会凭空造 tag）", /--verify-tag/.test(WORKFLOW));
check("Release 挂上 zip 与说明文件",
  /gh release create "\$TAG" "\$ZIP"/.test(WORKFLOW) && /--notes-file "\$RUNNER_TEMP\/release-notes\.md"/.test(WORKFLOW));
check("zip 名从 tag 里推出 manifest 版本（去掉 -my.N）",
  /VERSION="\$\{VERSION%%-my\.\*\}"/.test(WORKFLOW));
check("YAML 缩进没用 Tab（GitHub 会直接解析失败）", !/^\t/m.test(WORKFLOW));

console.log("\n── 第 6 步：工作流与脚本的接口对得上 ──");
const jobEnv = /env:\s*\n\s*TAG:\s*\$\{\{\s*inputs\.tag \|\| github\.ref_name\s*\}\}/.test(WORKFLOW);
check("工作流把 TAG 传进环境变量", jobEnv);
check("测试依赖装的是 jsdom（测试里 require('jsdom')）", /npm install[^\n]*jsdom/.test(WORKFLOW));
check("测试命令是 scripts/test-all.js（与本地同一入口）", /node scripts\/test-all\.js/.test(WORKFLOW));

console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
process.exit(failures === 0 ? 0 : 1);
