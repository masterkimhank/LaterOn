#!/usr/bin/env node
/**
 * 真浏览器端到端测试：node scripts/test-e2e.js [--filter=关键字] [--headed]
 *
 * 和 test-all.js 的分工：
 *   - test-all.js   跑 tests/*.test.js，jsdom，70 个文件，约 50 秒，每次改完都跑；
 *   - test-e2e.js   跑 tests/e2e/*.spec.js，真 Chromium + 真扩展，每个几十秒，
 *                   改到界面/交互/布局时跑，或者发版前跑。
 *
 * 为什么串行：每个 spec 都要起一个 Chromium 实例。并发起来 CPU 抢占会互相拖慢，
 * 还会因为时序变慢出现假红——端到端测试的假红比慢几分钟的代价大得多。
 *
 * 前置：npm install 之后还要 `npx playwright install chromium`（只需一次）。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SPECS_DIR = path.join(ROOT, "tests", "e2e");
const args = process.argv.slice(2);
const filter = (args.find((a) => a.startsWith("--filter=")) || "").split("=")[1] || "";
const headed = args.includes("--headed");
const PER_SPEC_TIMEOUT = 5 * 60 * 1000;

const files = fs
  .readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith(".spec.js"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`没找到 spec${filter ? `（filter=${filter}）` : ""}`);
  process.exit(1);
}

function runOne(file) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(SPECS_DIR, file)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LATERON_E2E_HEADED: headed ? "1" : "" },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      output += `\n（超过 ${PER_SPEC_TIMEOUT / 1000}s，已强制结束）`;
    }, PER_SPEC_TIMEOUT);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ file, code: code === null ? 1 : code, output, ms: Date.now() - startedAt });
    });
  });
}

(async () => {
  console.log(`${headed ? "有头模式" : "无头模式"}，共 ${files.length} 个 spec\n`);
  const results = [];
  for (const file of files) {
    process.stdout.write(`▶ ${file} … `);
    const result = await runOne(file);
    results.push(result);
    console.log(`${result.code === 0 ? "✅" : "❌"}  ${result.ms}ms`);
    if (result.code !== 0) {
      console.log(
        result.output
          .trimEnd()
          .split("\n")
          .filter((line) => line.includes("❌") || line.includes("（超过"))
          .slice(-12)
          .map((line) => `   | ${line}`)
          .join("\n") || result.output.trimEnd().split("\n").slice(-15).map((line) => `   | ${line}`).join("\n")
      );
    }
  }

  const failed = results.filter((r) => r.code !== 0);
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);
  console.log(`\n${"=".repeat(52)}`);
  console.log(`共 ${results.length} 个 spec，通过 ${results.length - failed.length}，失败 ${failed.length}，耗时 ${totalMs}ms`);
  if (failed.length) {
    console.log("失败清单：");
    failed.forEach((r) => console.log(`  - ${r.file}`));
    process.exit(1);
  }
})();
