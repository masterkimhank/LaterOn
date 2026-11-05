// 版本号解析与比较：检查更新里最容易出错、又最容易单测的一块。
// 直接跑真实的 update-check.js（不复制一份逻辑），否则测的是抄件不是实现。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, "update-check.js"), "utf8"), context, { filename: "update-check.js" });
const U = context.LaterOnUpdate;

let failures = 0;
let total = 0;
const check = (label, ok, extra = "") => {
  total += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `  → ${extra}` : ""}`);
  if (!ok) failures += 1;
};

console.log("\n── 解析 tag ──");
check("v1.75.0 去掉 v 前缀", JSON.stringify(U.parseVersion("v1.75.0")?.parts) === "[1,75,0]");
check("1.75.0-my.1 保留后缀但版本号只到数字", (() => {
  const parsed = U.parseVersion("1.75.0-my.1");
  return parsed?.suffix === "my.1" && parsed.parts.join(".") === "1.75.0";
})(), JSON.stringify(U.parseVersion("1.75.0-my.1")));
check("前后空格不算错", U.parseVersion("  v2.0.1  ")?.parts.join(".") === "2.0.1");
check("乱七八糟的 tag 解析成 null", U.parseVersion("latest") === null && U.parseVersion("") === null && U.parseVersion(null) === null);
check("少一段也算合法（1.76）", JSON.stringify(U.parseVersion("v1.76")?.parts) === "[1,76]");

console.log("\n── 比大小 ──");
check("1.75.0 < 1.76.0", U.compare("1.75.0", "1.76.0") === -1);
// 这条是重点：字符串比较会把 1.10.0 判成比 1.9.0 小，害得人永远收不到第 10 版。
check("1.10.0 > 1.9.0（按数字比，不是按字符串比）", U.compare("1.10.0", "1.9.0") === 1, String(U.compare("1.10.0", "1.9.0")));
check("1.75 和 1.75.0 一样大", U.compare("1.75", "1.75.0") === 0);
check("同一版本的后缀不参与比较（-my.2 不算更新）", U.compare("1.75.0-my.2", "1.75.0-my.1") === 0);
check("v 前缀不影响比较", U.compare("v1.76.0", "1.75.0") === 1);
check("版本号非法时不瞎判（返回 0）", U.compare("abc", "1.75.0") === 0);
check("isNewer 用同一套规则", U.isNewer("1.76.0", "1.75.0") === true && U.isNewer("1.75.0", "1.76.0") === false);

console.log("\n── 归一化 GitHub API ──");
const api = U.fromGithubRelease({
  tag_name: "v1.76.0-my.1",
  html_url: "https://github.com/masterkimhank/LaterOn/releases/tag/v1.76.0-my.1",
  body: "本版改动…",
  published_at: "2026-11-05T00:00:00Z"
});
check("取到版本号", api?.version === "1.76.0", api?.version);
check("保留完整 tag（下载页按它定位）", api?.tag === "v1.76.0-my.1", api?.tag);
check("带上下载页地址", /releases\/tag\/v1\.76\.0-my\.1$/.test(api?.pageUrl || ""), api?.pageUrl);
check("来源标记 github", api?.source === "github");
check("tag 不合法就整条丢掉", U.fromGithubRelease({ tag_name: "nightly" }) === null);
check("响应不是对象也丢掉", U.fromGithubRelease(null) === null && U.fromGithubRelease("x") === null);
check("发版说明截到 4000 字以内", U.fromGithubRelease({ tag_name: "v2.0.0", body: "x".repeat(9000) })?.notes.length === 4000);
check("非 http(s) 的下载地址一律丢掉", U.fromGithubRelease({
  tag_name: "v2.0.0", html_url: "javascript:alert(1)"
})?.pageUrl === "");

console.log("\n── 归一化 version.json ──");
const json = U.fromVersionJson({ version: "1.76.0", tag: "v1.76.0-my.1", pageUrl: "https://example.com/r" });
check("取到版本号与来源", json?.version === "1.76.0" && json?.source === "json", JSON.stringify(json));
check("没有 notes 也不报错", json?.notes === "");

console.log("\n── 两个来源的顺序 ──");
const sources = U.sources();
check("先问 GitHub API", sources[0]?.id === "github" && /api\.github\.com/.test(sources[0].url), sources[0]?.url);
check("再退到静态 version.json", sources[1]?.id === "json" && /releases\/latest\/download\/version\.json$/.test(sources[1].url), sources[1]?.url);
check("返回的是副本，改它不影响下次调用", (() => {
  const again = U.sources();
  again[0].url = "tampered";
  return U.sources()[0].url !== "tampered";
})());

console.log("\n── 要不要提醒 ──");
const newer = { version: "1.76.0", tag: "v1.76.0", pageUrl: "https://example.com", notes: "" };
check("版本更高 → 提醒", U.evaluate(newer, "1.75.0", [])?.available === true);
check("版本相同 → 不提醒", U.evaluate(newer, "1.76.0", [])?.available === false);
check("拿回来的比当前还旧 → 不提醒", U.evaluate({ ...newer, version: "1.70.0" }, "1.75.0", []).reason === "same");
check("用户忽略过这个版本 → 不提醒", U.evaluate(newer, "1.75.0", ["1.76.0"])?.reason === "ignored");
check("忽略的是别的版本 → 照常提醒", U.evaluate(newer, "1.75.0", ["1.74.0"])?.available === true);
check("从没查过（latest 为空）→ 不提醒", U.evaluate(null, "1.75.0", [])?.available === false);
check("当前版本号读不出来 → 不提醒（宁可不提示，也别瞎提示）", U.evaluate(newer, "", [])?.reason === "bad-current");

console.log(`\n${failures === 0 ? "🎉" : "❌"} 共 ${total} 项，通过 ${total - failures}，失败 ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
