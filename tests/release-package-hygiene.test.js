// 打包卫生：发布 zip 里不能混进开发用文件，包括 _locales 子目录里的。
//
// 背景（真实存在的洞）：build-release.py 的 FORBIDDEN_NAMES 存的是裸文件名
// （".DS_Store"、".md" 之类），但校验时拿包内相对路径（"_locales/en/.DS_Store"）
// 去比对，永远比不中。而 RUNTIME_DIRS 里的 _locales 是整棵收进来的，所以 macOS
// 上按一次文件夹就可能把 .DS_Store 打进发布包，且校验环节看不出来。
//
// 这里跑真实的 python 打包脚本验证：
//   1) 基线构建成功，包内没有垃圾文件
//   2) 往 _locales 子目录塞 .DS_Store 后，仍然不进包，且文件数不变
//   3) 往 _locales 子目录塞 .md 时构建直接失败（文档不能进包）
//
// 运行：node tests/release-package-hygiene.test.js
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

const PY = process.platform === "win32" ? "python" : "python3";
const py = (args, options = {}) => spawnSync(PY, args, { cwd: ROOT, encoding: "utf8", ...options });

// 没有 python 就跑不了打包脚本本身，跳过而不是判失败（打包前本来就要求装 python）。
const probe = py(["--version"]);
if (probe.error || probe.status !== 0) {
  console.log(`⚠️ 跳过：本机没有可用的 ${PY}（打包脚本本身依赖它）`);
  console.log("\n全部通过：没有失败项（已跳过）");
  process.exit(0);
}

const build = () => {
  const result = py(["scripts/build-release.py"]);
  return { ok: result.status === 0, out: `${result.stdout || ""}${result.stderr || ""}`.trim() };
};

const listZip = (version) => {
  const file = `dist/LaterOn-${version}.zip`;
  const script = "import json,zipfile,sys;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))";
  const result = py(["-c", script, file]);
  if (result.status !== 0) throw new Error(`读取 ${file} 失败：${result.stderr}`);
  return JSON.parse(result.stdout);
};

/** 读出包内某个文件的内容（用来核对 manifest 有没有被改过）。 */
const readZipFile = (version, name) => {
  const file = `dist/LaterOn-${version}.zip`;
  // 注意别用 json.dumps 包一层：那会得到一个"字符串的 JSON"，解析出来还是字符串。
  const script = "import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode('utf-8'))";
  const result = py(["-c", script, file, name]);
  if (result.status !== 0) throw new Error(`读取 ${file} 里的 ${name} 失败：${result.stderr}`);
  return result.stdout;
};

const manifestVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
const manifestKey = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).key;
const { idFromManifestKey } = require(path.join(ROOT, "scripts", "extension-id.js"));

// 注入 / 回收测试文件：无论中间怎么失败都要删干净，不然会污染仓库。
const injected = [];
const inject = (relative, content) => {
  const target = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  injected.push(target);
};
const cleanup = () => {
  for (const file of injected.splice(0)) {
    try { fs.unlinkSync(file); } catch { /* 已经不在了 */ }
  }
};
process.on("exit", cleanup);

async function main() {
  console.log("── 第 1 步：基线构建 ──");
  const baseline = build();
  check("打包脚本正常退出", baseline.ok, baseline.out.split("\n").pop());
  const baseNames = listZip(manifestVersion);
  check("包内没有 .DS_Store", !baseNames.some((name) => path.basename(name) === ".DS_Store"));
  check("包内没有 .md", !baseNames.some((name) => name.endsWith(".md")));
  check("_locales 仍在包里（没有过滤过头）",
    baseNames.includes("_locales/zh_CN/messages.json") && baseNames.includes("_locales/en/messages.json"),
    `${baseNames.filter((name) => name.startsWith("_locales/")).length} 个语言文件`);

  // 发布包里的 manifest.key 决定用户装上之后的扩展 ID。丢了 key，每个人都得到
  // 一个随路径变化的 ID，数据就互相看不见了 —— 而这件事在本地开发时完全正常。
  const packedManifest = JSON.parse(readZipFile(manifestVersion, "manifest.json"));
  check("包内 manifest 保留了 key", typeof packedManifest.key === "string" && packedManifest.key.length > 0);
  check("包内 key 推出的 ID 与仓库一致",
    idFromManifestKey(packedManifest.key) === idFromManifestKey(manifestKey),
    idFromManifestKey(packedManifest.key));
  check("包内没有私钥（extension-key.pem）", !baseNames.some((name) => name.endsWith(".pem")));

  console.log("\n── 第 2 步：子目录里的 .DS_Store 不能进包 ──");
  inject("_locales/en/.DS_Store", "macos junk");
  inject("_locales/zh_CN/.DS_Store", "macos junk");
  const withJunk = build();
  check("有垃圾文件时构建仍然成功（不是靠报错绕过）", withJunk.ok, withJunk.out.split("\n").pop());
  const junkNames = listZip(manifestVersion);
  check("_locales/en/.DS_Store 没进包", !junkNames.some((name) => name.includes(".DS_Store")),
    junkNames.filter((name) => name.includes("DS_Store")).join(", ") || "无");
  check("文件总数与基线一致", junkNames.length === baseNames.length, `${junkNames.length} vs ${baseNames.length}`);
  cleanup();

  console.log("\n── 第 3 步：子目录里的文档必须让构建失败 ──");
  inject("_locales/en/NOTES.md", "# 不该进包");
  const withDoc = build();
  check("构建被拦下（非 0 退出）", !withDoc.ok, withDoc.out.split("\n").pop());
  check("报错点名了泄漏的文件", /_locales\/en\/NOTES\.md/.test(withDoc.out), withDoc.out.split("\n")[0]);
  cleanup();

  console.log("\n── 第 4 步：清理后能重新正常打包 ──");
  const restored = build();
  check("恢复干净后构建成功", restored.ok, restored.out.split("\n").pop());
  check("包内没有残留的测试文件",
    !listZip(manifestVersion).some((name) => name.includes("NOTES.md") || name.includes(".DS_Store")));

  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log(`❌ 测试自身出错：${error.message}`);
  process.exit(1);
});
