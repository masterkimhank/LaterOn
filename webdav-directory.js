// WebDAV 目录列举：只做一件事——把 PROPFIND 的 multistatus 解析成文件名列表。
//
// 为什么不用 DOMParser：Service Worker 里没有它（只有窗口环境才有）。所以这里手写了一个
// 极小的 namespace-aware XML 读取器，够用就好，并且对输入保持怀疑：
//   · 拒绝 DTD / 自定义实体（XXE 那类问题在扩展里同样成立）
//   · 拒绝格式不完整的 XML（标签不配对、文本混在根节点外面等）
//   · 限制长度、节点数、嵌套深度，避免一个畸形响应把 worker 拖死
//
// 只认「同一个目录下、文件名符合备份命名规则」的条目，其它一律忽略（别的应用也往这个
// 目录写东西时不会误删误读）。
(function () {
  const LEGACY = "lateron-sync-v1.json";
  const DAILY = /^lateron-backup-\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\.json$/;
  const invalid = () => { throw new Error("syncInvalidListing"); };

  function decode(text) {
    // 只放行 XML 预定义实体与数字引用，其余 & 一律视为畸形
    if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(text)) invalid();
    return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
      if (!entity.startsWith("#")) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity];
      const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) invalid();
      return String.fromCodePoint(code);
    });
  }

  function parse(xml) {
    if (typeof xml !== "string" || xml.length > 2 * 1024 * 1024) invalid();
    const document = { children: [], text: "", ns: Object.create(null) };
    const stack = [document];
    const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w.:-]*(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/g;
    let position = 0, nodes = 0;
    for (const token of xml.matchAll(tokens)) {
      // 正则覆盖不到的空隙 = 出现了不该出现的字符，直接判畸形
      if (token.index !== position) invalid();
      const value = token[0];
      position += value.length;
      const parent = stack[stack.length - 1];
      if (value.startsWith("<!--") || value.startsWith("<?")) continue;
      if (value.startsWith("<![CDATA[")) { parent.text += value.slice(9, -3); continue; }
      if (!value.startsWith("<")) { parent.text += decode(value); continue; }
      if (value.startsWith("</")) {
        if (stack.length === 1 || value.slice(2, -1).trim() !== parent.qname) invalid();
        stack.pop();
        continue;
      }
      if (++nodes > 20000 || stack.length > 32) invalid();
      const qname = /^<([^\s/>]+)/.exec(value)[1];
      const ns = { ...parent.ns };
      const attrs = new Set();
      for (const attr of value.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        if (attrs.has(attr[1])) invalid();
        attrs.add(attr[1]);
        const content = decode(attr[2] ?? attr[3]);
        if (attr[1] === "xmlns") ns[""] = content;
        else if (attr[1].startsWith("xmlns:")) ns[attr[1].slice(6)] = content;
      }
      const parts = qname.split(":");
      if (parts.length > 2 || (parts.length === 2 && !ns[parts[0]])) invalid();
      const node = { qname, name: parts.at(-1), uri: ns[parts.length === 2 ? parts[0] : ""] || "", ns, text: "", children: [] };
      parent.children.push(node);
      if (!value.endsWith("/>")) stack.push(node);
    }
    if (position !== xml.length || stack.length !== 1 || document.children.length !== 1 || document.text.trim()) invalid();
    return document.children[0];
  }

  const children = (node, name) => node.children.filter((child) => child.uri === "DAV:" && child.name === name);

  function names(xml, baseUrl) {
    const root = parse(xml);
    if (root.uri !== "DAV:" || root.name !== "multistatus") invalid();
    const base = new URL(baseUrl);
    const output = new Set();
    for (const response of children(root, "response")) {
      const hrefs = children(response, "href");
      if (hrefs.length !== 1 || hrefs[0].children.length) invalid();
      let url, name;
      try {
        url = new URL(hrefs[0].text.trim(), base);
        name = decodeURIComponent(url.pathname.split("/").pop());
      } catch { invalid(); }
      // 只留同源、同目录下的文件；子目录、查询串、别的域名一律忽略
      if (url.origin !== base.origin || url.username || url.password || url.search || url.hash
        || decodeURIComponent(new URL(".", url).pathname) !== decodeURIComponent(base.pathname)) continue;
      if (name !== LEGACY && !DAILY.test(name)) continue;
      // 有的服务器会把「某个属性不存在」单独放进一个 404 的 propstat（WebDAV 允许这样），
      // 所以这里只认同 2xx 的条目、其余跳过，而不是把整个列举判为畸形。
      const statuses = [...children(response, "status"), ...children(response, "propstat").flatMap((prop) => children(prop, "status"))];
      if (!statuses.some((node) => /^HTTP\/\d(?:\.\d)?\s+2\d\d(?:\s|$)/.test(node.text.trim()))) continue;
      output.add(name);
    }
    // 字典序 = 日期序，因为文件名里的日期是定宽 YYYY-MM-DD
    return [...output].sort();
  }

  globalThis.LaterOnWebDAVDirectory = { names, LEGACY, DAILY };
})();
