#!/usr/bin/env node
/**
 * 一条命令跑全量测试：node scripts/test-all.js [--filter=关键字]
 *
 * 为什么需要它：本仓库没有 package.json / 测试框架，每个 tests/*.test.js 都是
 * 独立进程、以退出码判定成败。手工 for 循环在 Windows 的 cmd 里写不出来，
 * 而漏跑一个文件就等于没验证。
 *
 * 约定：某个测试文件退出码为 0 才算通过。并发默认 4，兼顾速度与输出顺序。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const filter = (process.argv.find((a) => a.startsWith("--filter=")) || "").split("=")[1] || "";
const CONCURRENCY = 4;

const files = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`没找到测试文件${filter ? `（filter=${filter}）` : ""}`);
  process.exit(1);
}

const runOne = (file) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(TESTS_DIR, file)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) =>
      resolve({ file, code, output, ms: Date.now() - startedAt })
    );
  });

(async () => {
  const results = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      const result = await runOne(file);
      results.push(result);
      const mark = result.code === 0 ? "✅" : "❌";
      console.log(`${mark} ${file}  ${result.ms}ms`);
      if (result.code !== 0) {
        console.log(result.output.trimEnd().split("\n").slice(-15).map((l) => `   | ${l}`).join("\n"));
      }
    }
  };

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  const failed = results.filter((r) => r.code !== 0);
  const totalMs = Date.now() - startedAt;
  console.log(`\n${"=".repeat(52)}`);
  console.log(`共 ${results.length} 个文件，通过 ${results.length - failed.length}，失败 ${failed.length}，耗时 ${totalMs}ms`);
  if (failed.length) {
    console.log("失败清单：");
    failed.forEach((r) => console.log(`  - ${r.file}`));
    process.exit(1);
  }
})();
