// 回归测试：GBK 站点的标题乱码（52pojie.cn 实测）
//
// 现象：收藏 52pojie.cn 的页面后，卡片标题显示成「�ᰮ�ƽ� - 52pojie.cn」。
// 根因：后台「服务端 meta 兜底」用 response.text() 读 HTML，而它**永远按 UTF-8 解码**，
//      不管响应头写的是什么。52pojie.cn 返回 charset=gbk，中文就被解成了替换符。
//      更糟的是这条兜底会在「标题里带站点名」时被触发，于是把页面里本来正确的标题
//      覆盖成了乱码。
//
// 这个测试把 background.js 里真实的解码 / 兜底函数拿出来，喂一段真的 GBK 字节，
// 断言：① 解码正确；② 不认识的编码有兜底；③ 乱码永远不会被当成好标题。
//
// 运行：node tests/gbk-charset.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? `\n       → ${detail}` : ""}`);
  }
}

// ── 从 background.js 里按大括号配对取出整段函数 ──────────────
// 不能只靠 /^}/，因为要取的函数里有嵌套代码块；这里做一次真正的括号配对。
function extractFunction(name) {
  const head = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(SOURCE);
  if (!head) throw new Error(`没找到函数 ${name}`);
  const start = head.index;
  const open = SOURCE.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    const ch = SOURCE[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 的大括号没配对`);
}

function extractConst(name) {
  const matched = new RegExp(`^const ${name} = [\\s\\S]*?^};?$`, "m").exec(SOURCE);
  if (!matched) throw new Error(`没找到常量 ${name}`);
  return matched[0];
}

const NEEDED = [
  extractConst("CHARSET_ALIASES"),
  "const SERVER_META_TIMEOUT_MS = 8000;",
  extractFunction("charsetFromContentType"),
  extractFunction("charsetFromHtmlHead"),
  extractFunction("decodeHtmlBuffer"),
  extractFunction("looksMojibake"),
  extractFunction("isPlaceholderText"),
  extractFunction("isSolidTitle"),
  extractFunction("looksGoneTitle"),
  extractFunction("recordTitle"),
  extractFunction("withTimeout"),
  extractFunction("isIconLikeImage"),
  extractFunction("titleHasSiteNoise"),
  extractFunction("refetchMetaFromServer"),
  extractFunction("applyServerMetaRescue")
].join("\n\n");

// ── 夹具：一段真正的 GBK 字节 ────────────────────────────────
// 内容（GBK 编码）：
//   <!doctype html><html><head><meta charset="gbk"><title>吾爱破解 - 52pojie.cn</title>
//   <meta property="og:title" content="吾爱破解 - 52pojie.cn">
//   <meta name="description" content="吾爱破解论坛"></head><body>gbk</body></html>
// 用 UTF-8 解同一段字节，标题会变成「�ᰮ�ƽ� - 52pojie.cn」，正是线上看到的乱码。
const GBK_PAGE = Buffer.from(
  "PCFkb2N0eXBlIGh0bWw+PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0iZ2JrIj48dGl0bGU+zuGwrsbGveIgLSA1MnBvamllLmNuPC90aXRsZT48bWV0YSBwcm9wZXJ0eT0ib2c6dGl0bGUiIGNvbnRlbnQ9Is7hsK7Gxr3iIC0gNTJwb2ppZS5jbiI+PG1ldGEgbmFtZT0iZGVzY3JpcHRpb24iIGNvbnRlbnQ9Is7hsK7Gxr3iwtvMsyI+PC9oZWFkPjxib2R5PmdiazwvYm9keT48L2h0bWw+",
  "base64"
);
const GBK_TITLE = "吾爱破解 - 52pojie.cn";

// 同样结构的 UTF-8 页面，用来确认「正常站点没被改坏」。
const UTF8_PAGE = Buffer.from(
  '<!doctype html><html><head><meta charset="utf-8"><title>普通中文站点 - 例子</title>' +
    '<meta property="og:title" content="普通中文站点 - 例子"><meta name="description" content="一段正常摘要"></head></html>',
  "utf8"
);

// ── 把函数装进沙箱 ──────────────────────────────────────────
let fetchImpl = async () => {
  throw new Error("测试没有设置 fetch");
};
const sandbox = {
  console,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  ArrayBuffer,
  Promise,
  JSON,
  RegExp,
  URL,
  setTimeout,
  clearTimeout,
  fetch: (...args) => fetchImpl(...args),
  // 假响应：只实现 refetchMetaFromServer 用到的那几个成员。
  __makeResponse: (buffer, contentType) => ({
    ok: true,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(NEEDED, sandbox, { filename: "background-slice.js" });

(async () => {
  console.log("\n── 编码声明解析 ──");
  check(
    "响应头 charset=GBK 能读出来并转小写",
    sandbox.charsetFromContentType("text/html; charset=GBK") === "gbk",
    sandbox.charsetFromContentType("text/html; charset=GBK")
  );
  check(
    "响应头没写 charset 时返回空字符串",
    sandbox.charsetFromContentType("text/html") === "",
    sandbox.charsetFromContentType("text/html")
  );
  check(
    "响应头没有时，从文档开头的 <meta charset> 嗅探",
    sandbox.charsetFromHtmlHead(new Uint8Array(GBK_PAGE)) === "gbk",
    sandbox.charsetFromHtmlHead(new Uint8Array(GBK_PAGE))
  );

  console.log("\n── 解码本身 ──");
  const viaHeader = sandbox.decodeHtmlBuffer(GBK_PAGE, "text/html; charset=gbk");
  check("按 GBK 解码后标题是正确中文", viaHeader.includes(GBK_TITLE), viaHeader.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
  check("按 GBK 解码后没有替换符", !viaHeader.includes("\uFFFD"));
  check(
    "摘要也一起恢复正常",
    viaHeader.includes("吾爱破解论坛"),
    viaHeader.match(/name="description" content="([^"]*)"/)?.[1]
  );
  check(
    "响应头丢了 charset 也能靠 <meta> 救回来",
    sandbox.decodeHtmlBuffer(GBK_PAGE, "text/html").includes(GBK_TITLE),
    sandbox.decodeHtmlBuffer(GBK_PAGE, "text/html").match(/<title>([\s\S]*?)<\/title>/)?.[1]
  );
  check(
    "响应头声明了不认识的编码也不会抛错，退回 UTF-8",
    sandbox.decodeHtmlBuffer(UTF8_PAGE, "text/html; charset=x-not-a-real-charset").includes("普通中文站点"),
    ""
  );
  // 这条是回归基线：证明「原来那样按 UTF-8 解」确实是坏的。
  const asUtf8 = new TextDecoder("utf-8").decode(new Uint8Array(GBK_PAGE));
  check(
    "对照组：同一段字节按 UTF-8 解会变成乱码（即原来的表现）",
    !asUtf8.includes(GBK_TITLE) && asUtf8.includes("\uFFFD"),
    JSON.stringify(asUtf8.match(/<title>([\s\S]*?)<\/title>/)?.[1])
  );
  check("UTF-8 页面解码后内容不变", sandbox.decodeHtmlBuffer(UTF8_PAGE, "text/html; charset=utf-8").includes("普通中文站点"));

  console.log("\n── 乱码识别 ──");
  check("「�ᰮ�ƽ� - 52pojie.cn」判为乱码", sandbox.looksMojibake("�ᰮ�ƽ� - 52pojie.cn"));
  check("「锟斤拷」判为乱码", sandbox.looksMojibake("锟斤拷锟斤拷"));
  check("正常中文标题不误判", !sandbox.looksMojibake(GBK_TITLE));
  check("长一点的正常中文不误判", !sandbox.looksMojibake("吾爱破解论坛深耕软件逆向工程与反病毒技术领域"));
  check("英文标题不误判", !sandbox.looksMojibake("DeepSeek-V4 release notes"));
  check("空值不误判", !sandbox.looksMojibake("") && !sandbox.looksMojibake(null));
  check("网址不误判", !sandbox.looksMojibake("https://www.52pojie.cn/thread-1-1-1.html"));

  console.log("\n── 入库前的兜底 ──");
  check("乱码标题退回网址", sandbox.recordTitle("�ᰮ�ƽ�", "https://www.52pojie.cn/") === "https://www.52pojie.cn/");
  check("正常标题原样保留", sandbox.recordTitle(GBK_TITLE, "https://www.52pojie.cn/") === GBK_TITLE);
  check("标题为空时退回网址", sandbox.recordTitle("", "https://a.com/x") === "https://a.com/x");

  console.log("\n── 服务端兜底（真实调用链） ──");

  // ① GBK 站点：兜底抓回来的 og 标签必须是能读的中文
  fetchImpl = async () => sandbox.__makeResponse(GBK_PAGE, "text/html; charset=gbk");
  const gbkMeta = await sandbox.refetchMetaFromServer("https://www.52pojie.cn/");
  check("兜底抓到的标题是正确中文", gbkMeta?.title === GBK_TITLE, JSON.stringify(gbkMeta?.title));
  check("兜底抓到的标题不是乱码", !!gbkMeta && !sandbox.looksMojibake(gbkMeta.title));
  check("兜底抓到的摘要也是正确中文", gbkMeta?.description === "吾爱破解论坛", JSON.stringify(gbkMeta?.description));

  // ② 页面里标题正常、只是带站点名（会触发兜底）：不能把好标题换成乱码
  fetchImpl = async () => sandbox.__makeResponse(GBK_PAGE, "text/html; charset=gbk");
  const rescued = await sandbox.applyServerMetaRescue({
    title: GBK_TITLE,
    titleFrom: "page-title",
    description: "暂无摘要",
    image: "",
    source: "52pojie.cn",
    url: "https://www.52pojie.cn/"
  });
  check("触发兜底后标题仍然是正确中文", rescued.title === GBK_TITLE, JSON.stringify(rescued.title));
  check("兜底结果里没有替换符", !rescued.title.includes("\uFFFD") && !rescued.description.includes("\uFFFD"));
  check("摘要被正确补上", rescued.description === "吾爱破解论坛", JSON.stringify(rescued.description));

  // ③ 万一服务器还是吐乱码（比如站点把字节写坏了），绝不覆盖页面里的好标题
  fetchImpl = async () =>
    sandbox.__makeResponse(Buffer.from('<html><head><meta property="og:title" content="\uFFFD\uFFFD\uFFFD"></head></html>', "utf8"), "text/html");
  const guarded = await sandbox.applyServerMetaRescue({
    title: "一篇正常的中文标题",
    titleFrom: "page-title",
    description: "暂无摘要",
    image: "",
    source: "52pojie.cn",
    url: "https://www.52pojie.cn/thread-1.htm"
  });
  check("服务器标题是乱码时，保留页面里的好标题", guarded.title === "一篇正常的中文标题", JSON.stringify(guarded.title));
  check("乱码摘要不会被塞进来", guarded.description === "暂无摘要", JSON.stringify(guarded.description));

  // ④ 反向：页面标题本身是乱码时，兜底要能救回来
  fetchImpl = async () => sandbox.__makeResponse(GBK_PAGE, "text/html; charset=gbk");
  const healed = await sandbox.applyServerMetaRescue({
    title: "�ᰮ�ƽ� - 52pojie.cn",
    titleFrom: "page-title",
    description: "暂无摘要",
    image: "",
    source: "52pojie.cn",
    url: "https://www.52pojie.cn/"
  });
  check("页面标题是乱码时，用服务端的好标题替换", healed.title === GBK_TITLE, JSON.stringify(healed.title));

  console.log("\n── 源码约束 ──");
  // 只看代码行：注释里会解释「为什么不能用 response.text()」，不能算命中。
  const codeOnly = SOURCE.replace(/^\s*\/\/.*$/gm, "");
  check("后台不再用 response.text() 读 HTML", !/response\.text\(\)/.test(codeOnly));
  check("HTML 改读字节后自己解码", /response\.arrayBuffer\(\)/.test(codeOnly) && /decodeHtmlBuffer\(/.test(codeOnly));

  console.log(`\n${failed === 0 ? "🎉" : "❌"} 共 ${passed + failed} 项，通过 ${passed}，失败 ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
