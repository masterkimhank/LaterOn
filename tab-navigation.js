// Shared tab reuse for LaterOn's fullscreen library and side panel.
// A normal click returns to an already-open page (even in another window)
// instead of quietly creating a duplicate tab.
(function () {
  function comparable(url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return globalThis.LaterOnUrl?.normalize
        ? globalThis.LaterOnUrl.normalize(parsed.href)
        : (parsed.hash = "", parsed.href);
    } catch {
      return "";
    }
  }

  async function findOpen(target, options = {}) {
    const expected = comparable(target);
    if (!expected) return null;
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const matches = tabs.filter((tab) => tab.id !== options.excludeTabId
      && comparable(tab.url || tab.pendingUrl) === expected);
    return matches.find((tab) => tab.active) || matches[0] || null;
  }

  async function activate(tab) {
    if (!tab?.id) return false;
    await chrome.tabs.update(tab.id, { active: true }).catch(() => null);
    if (tab.windowId != null && typeof chrome.windows?.update === "function") {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
    }
    return true;
  }

  // 站点标识：去掉 www、转小写。用来把「标题兜底匹配」限制在同一个站点内，
  // 免得关标签页时凭一个标题去关掉别的网站（同类标题太多了）。
  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // 标题归一化：压空白、去站点后缀、转小写。
  // 只在标题尾部确实是「- 站点名 / | 站点名」时才砍掉那段——
  // 通用地把「 - 」后面全删会把「A - B」这种正题也砍坏（很多标题自己带破折号）。
  function titleKey(title, source) {
    let text = String(title || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const site = String(source || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (site) {
      const lower = text.toLowerCase();
      for (const sep of [" - ", " | ", " — ", " – ", " · ", "_", "-"]) {
        if (lower.endsWith(sep + site) && text.length > site.length + 1) {
          text = text.slice(0, text.length - sep.length - site.length).trim();
          break;
        }
      }
    }
    text = text.toLowerCase();
    // 太短的标题（「首页」「登录」「视频」）区分度不够：宁可不匹配，也别误关别人的标签页。
    // 这类仍然能靠网址匹配，只是不参与标题兜底。
    // 权重而不是字数：一个汉字顶两个字，否则「深度好文」这种四个字的正经标题会被误判成太短。
    let weight = 0;
    for (const ch of text) weight += /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? 2 : 1;
    return weight >= 8 ? text : "";
  }

  // 兼容两种入参：纯网址字符串（老调用方），或收藏条目对象（带 url / title / titleAtSave / source）。
  function asPage(entry) {
    if (typeof entry === "string") return { url: entry, title: "", source: "" };
    if (!entry || typeof entry !== "object") return null;
    return {
      url: entry.url || "",
      // 优先用「添加那一刻的网页标题」：用户后来把标题改掉了，这份快照仍是网页原本的标题，
      // 拿它去和浏览器标签页的标题比才对得上。
      title: entry.titleAtSave || entry.title || "",
      source: entry.source || ""
    };
  }

  // 这些网页此刻在浏览器里还开着哪些标签页（跨窗口）。
  // 两道判据：
  //   ① 网址相同（走 LaterOnUrl.normalize，www / 尾部斜杠 / utm 参数不同也算同一篇）；
  //   ② 网址对不上、但「同一站点 + 同一标题」——有些站点每次打开的网址都会变
  //      （换参数、SPA 换路由、短链跳转），单靠网址永远找不到那个标签页。
  // 只认 http/https：扩展自己的页面、chrome:// 之类永远不算，免得删一条收藏把 LaterOn 关掉。
  async function matches(pages) {
    const list = (pages || []).map(asPage).filter(Boolean);
    const urlKeys = new Set(list.map((page) => comparable(page.url)).filter(Boolean));
    const titlesByHost = new Map();
    for (const page of list) {
      const host = hostOf(page.url);
      const key = titleKey(page.title, page.source);
      if (!host || !key) continue;
      if (!titlesByHost.has(host)) titlesByHost.set(host, []);
      titlesByHost.get(host).push({ key, source: page.source });
    }
    if (!urlKeys.size && !titlesByHost.size) return [];
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.filter((tab) => {
      const url = tab.url || tab.pendingUrl;
      const key = comparable(url);
      if (!key) return false;
      if (urlKeys.has(key)) return true;
      const candidates = titlesByHost.get(hostOf(url));
      if (!candidates) return false;
      const tabTitle = tab.title || "";
      return candidates.some((entry) => titleKey(tabTitle, entry.source) === entry.key);
    });
  }

  // 关掉这些网页对应的标签页，返回实际关掉的数量。
  // 这里重新查一遍而不是用调用方手里的旧列表：确认框可能开了一会儿，用户中途关掉的
  // 标签页不该算进「关掉了 N 个」里，也不该让 chrome.tabs.remove 报错。
  async function closeMatching(pages) {
    const targets = await matches(pages);
    const ids = targets.map((tab) => tab.id).filter((id) => id != null);
    if (!ids.length) return 0;
    await chrome.tabs.remove(ids).catch(() => null);
    return ids.length;
  }

  globalThis.LaterOnTabs = { comparable, findOpen, activate, matches, closeMatching, titleKey };
})();
