// 检查更新：版本号解析 / 比对，以及把两种来源的响应归一化成同一种形状。
//
// 为什么单独成文件：
//   ① 收藏库、侧栏、设置页三处都要显示「有新版本」，三处各写一遍解析就会出现三种口径
//      （把 v1.76 当成比 1.75 旧、把 v1.75.0-my.1 解析成非法……）；
//   ② 版本比较是最容易写错又最容易被测到的部分，做成纯函数（不碰 chrome.*）才能单测。
//
// 真正发请求、存状态、画角标都在 background.js 里。
(function () {
  // tag 允许 v 前缀与 -my.N 这类后缀：我们的里程碑 tag 就是 v1.75.0-my.1。
  const VERSION_RE = /^(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?$/;

  function parseVersion(raw) {
    const text = String(raw == null ? "" : raw).trim().replace(/^v/i, "");
    const match = text.match(VERSION_RE);
    if (!match) return null;
    const parts = match[1].split(".").map((piece) => Number(piece));
    if (parts.some((number) => !Number.isFinite(number) || number < 0)) return null;
    return { parts, suffix: match[2] || "", text };
  }

  // 只比数字段，不看 -my.N 后缀。
  // 理由：manifest.version 只允许数字和点（Chrome 硬性要求），扩展自己无法表达「-my.2」；
  // 同一个版本号重新发一次时，我们也没法判断手上这份代码是不是那一份。
  // 与其每天弹「1.75.0 可用（你有 1.75.0）」，不如不提醒——少提醒的代价只是手动去看一眼。
  function compare(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return 0;
    const length = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < length; i += 1) {
      const x = a.parts[i] || 0;
      const y = b.parts[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function isNewer(candidate, current) {
    return compare(candidate, current) > 0;
  }

  // 这些字符串最终会进 DOM / 提示条，来源是网络，一律先裁长度，不整段照搬。
  const cut = (value, max) => String(value == null ? "" : value).slice(0, max);

  function normalize({ version, tag, pageUrl, notes, publishedAt, source }) {
    const parsed = parseVersion(version || tag);
    if (!parsed) return null;
    return {
      version: parsed.parts.join("."),
      tag: cut(tag || `v${parsed.parts.join(".")}`, 40),
      // 只接受 http(s)：这是要拿去 chrome.tabs.create 的地址，别的协议一律丢掉。
      pageUrl: /^https?:\/\//i.test(pageUrl || "") ? cut(pageUrl, 300) : "",
      notes: cut(notes, 4000),
      publishedAt: cut(publishedAt, 40),
      source
    };
  }

  // GitHub /repos/{owner}/{repo}/releases/latest 的响应。
  function fromGithubRelease(json) {
    if (!json || typeof json !== "object") return null;
    return normalize({
      version: json.tag_name, tag: json.tag_name,
      pageUrl: json.html_url, notes: json.body,
      publishedAt: json.published_at, source: "github"
    });
  }

  // 我们自己的 version.json（发布流水线塞进 Release 资源，地址固定为
  // /releases/latest/download/version.json）。字段少、够用就行。
  function fromVersionJson(json) {
    if (!json || typeof json !== "object") return null;
    return normalize({
      version: json.version, tag: json.tag,
      pageUrl: json.pageUrl, notes: json.notes,
      publishedAt: json.publishedAt, source: "json"
    });
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  // 拉哪个地址、怎么解析。顺序有讲究：
  //   github → API 信息最全（带发版说明），但按 IP 匿名限流 60 次/小时；
  //   json   → 静态文件，不吃限流，用来兜底。
  // 两条都在 github.com 上：整站访问不了时两个都会失败，那一侧只显示「检查失败」，
  // 不弹错误框——家里人装的机器不该因为网络问题天天报红。
  const SOURCES = [
    {
      id: "github",
      url: "https://api.github.com/repos/masterkimhank/LaterOn/releases/latest",
      headers: { Accept: "application/vnd.github+json" },
      parse: (text) => fromGithubRelease(safeJson(text))
    },
    {
      id: "json",
      url: "https://github.com/masterkimhank/LaterOn/releases/latest/download/version.json",
      headers: {},
      parse: (text) => fromVersionJson(safeJson(text))
    }
  ];

  function sources() {
    return SOURCES.map((source) => ({ ...source }));
  }

  // 要不要提醒。挡住的四种情况都返回 available:false，并带上原因（设置页要照着说话）。
  function evaluate(latest, currentVersion, ignoredVersions) {
    if (!latest) return { available: false, reason: "none" };
    if (!parseVersion(currentVersion)) return { available: false, reason: "bad-current" };
    if (!isNewer(latest.version, currentVersion)) return { available: false, reason: "same", latest };
    const ignored = Array.isArray(ignoredVersions) ? ignoredVersions : [];
    if (ignored.includes(latest.version)) return { available: false, reason: "ignored", latest };
    return { available: true, reason: "newer", latest };
  }

  globalThis.LaterOnUpdate = {
    parseVersion, compare, isNewer, fromGithubRelease, fromVersionJson, sources, evaluate
  };
})();
