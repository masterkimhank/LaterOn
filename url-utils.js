// Shared URL canonicalization for matching the active tab with saved items.
(function () {
  function normalize(url) {
    try {
      const parsed = new URL(url);
      // 同一 YouTube 视频可能来自稍后观看、播放列表、短链接或移动端。
      // 用视频 ID 匹配；保留原始网址用于实际打开，不改变播放时间或列表。
      const hostname = parsed.hostname.toLowerCase();
      const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname);
      let videoId = "";
      if (["http:", "https:"].includes(parsed.protocol) && !parsed.port) {
        if (["youtu.be", "www.youtu.be"].includes(hostname)) {
          videoId = parsed.pathname.match(/^\/([^/]+)\/?$/)?.[1] || "";
        } else if (youtube) {
          videoId = /^\/watch\/?$/.test(parsed.pathname)
            ? parsed.searchParams.get("v") || ""
            : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] || "";
        }
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return `https://youtube.com/watch?v=${videoId}`;
      }
      const host = parsed.host.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      const keep = [...parsed.searchParams.entries()]
        .filter(([key]) => !/^(utm_|fbclid|gclid|mc_|ref|spm|igshid)/i.test(key))
        .sort(([a], [b]) => a.localeCompare(b));
      const search = keep.length
        ? "?" + keep.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")
        : "";
      return `${parsed.protocol}//${host}${path}${search}`;
    } catch {
      return String(url || "").trim().toLowerCase();
    }
  }

  // ── 「是不是同一篇文章」的三个零件 ──────────────────────────
  // normalize 只认「同一个网址的不同写法」：参数顺序、跟踪参数、尾斜杠、hash、
  // YouTube 视频 ID。但同一个内容常常挂着两个**结构上完全不同**的网址：
  //   微信公众号   /s/AbCdEf               ←→  /s?__biz=MzA...&mid=...&sn=...
  //   小红书       /explore/<id>           ←→  /discovery/item/<id>?xsec_token=...
  //   手机版       m.example.com/a         ←→  example.com/a
  // 这类只能靠「同一个站点 + 同一个标题」认人。下面三个函数只做原子判断，
  // 「标题够不够格」这类业务判断留在 background.js（那边才有 isSolidTitle）。

  // 站点键：host 去掉 www / m / mobile / amp 这类前缀。
  // 手机版与桌面版是同一篇文章，只是域名前面多了一截。
  function siteKey(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^(?:(?:www|m|mobile|amp)\.)+/, "");
    } catch {
      return "";
    }
  }

  // 标题键：去掉零宽字符、把任意空白折叠成一个空格、转小写。
  // 不做「去站点后缀」——同一个站点后缀本来就一样，剥掉只会多出误判的机会。
  function titleKey(title) {
    return String(title || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // 两条网址的路径像不像「同一个栏目下的不同入口」。
  // 只拦「同站点同标题但确实不是一篇」：不同栏目的同名文章默认不合并。
  function pathsAlike(a, b) {
    const segments = (url) => {
      try {
        return new URL(url).pathname.split("/").filter(Boolean);
      } catch {
        return [];
      }
    };
    const left = segments(a);
    const right = segments(b);
    // 都只有域名：首页跟首页算同一处，首页跟内页不算。
    if (!left.length || !right.length) return left.length === right.length;
    if (left[0] === right[0]) return true;
    // 首段不同（小红书 explore / discovery），那就看有没有一段够长的路径相同：
    // 长 id 段（≥8 字符）撞上的概率很低，短段（item / video / s）撞上不算数。
    const long = new Set(left.filter((segment) => segment.length >= 8));
    return right.some((segment) => segment.length >= 8 && long.has(segment));
  }

  globalThis.LaterOnUrl = { normalize, siteKey, titleKey, pathsAlike };
})();
