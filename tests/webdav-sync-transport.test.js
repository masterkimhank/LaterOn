// WebDAV 传输层测试：用一个内存版 WebDAV 服务器喂真实的 webdav-sync.js。
//
// 为什么值得单独测：内核算得再对，传输层「读 → 合并 → 整份覆盖」的顺序一旦出错，
// 照样会丢数据。这里重点钉三件事：
//   1) 首次接入：本地已有收藏会上传，且新建设文件用 If-None-Match: * 而不是盲写
//   2) 并发写：另一台设备在我们读取之后写了文件，服务器回 412 —— 必须重读重合并，
//      两边的数据都要在（参考实现没有这一步，会静默覆盖）
//   3) 一直抢不过就老实报 syncConflict，不会无限重试
//
// 运行：node tests/webdav-sync-transport.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const settle = async (rounds = 30) => { for (let i = 0; i < rounds; i += 1) await new Promise((r) => setTimeout(r, 0)); };

// Core.backupName 用的是「本机日期」，不是 UTC 日期 —— 凌晨 0 点到 8 点（东八区）两者差一天。
// 用例里拼备份文件名必须按本地日期来，否则「另一台设备」的写入会落到另一个文件名上：
// 干扰没生效、PUT 不冲突、断言全红。这里曾经因为用 toISOString() 在凌晨必挂。
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};

// ── 内存版 WebDAV 服务器 ────────────────────────────────────
function makeServer() {
  const files = new Map(); // name -> { body, etag }
  const requests = [];     // { method, path, ifMatch, ifNoneMatch, status }
  let seq = 0;
  const newEtag = () => `"v${++seq}"`;
  let interfere = null;    // 每次 PUT 之前插进来的「另一台设备」（由用例决定是否持续）

  const write = (name, body) => {
    const record = { body, etag: newEtag() };
    files.set(name, record);
    return record;
  };

  const respond = (status, body = "", etag = null) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (key) => (key.toLowerCase() === "etag" ? etag : key.toLowerCase() === "content-length" ? String(body.length) : null) },
    text: async () => body,
    body: null
  });

  const multistatus = (names) => `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/dav/LaterOn/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
${names.map((name) => `  <d:response><d:href>/dav/LaterOn/${name}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("\n")}
</d:multistatus>`;

  async function fetch(url, options = {}) {
    const parsed = new URL(url);
    const method = options.method || "GET";
    const name = decodeURIComponent(parsed.pathname.split("/").pop());
    const headers = options.headers || {};
    const record = { method, name, ifMatch: headers["If-Match"] || null, ifNoneMatch: headers["If-None-Match"] || null, status: 0 };
    requests.push(record);

    if (method === "MKCOL") { record.status = files.size ? 405 : 201; return respond(record.status); }
    if (method === "PROPFIND") { record.status = 207; return respond(207, multistatus([...files.keys()])); }

    if (method === "PUT") {
      // 模拟「另一台设备正好在我们读取之后写入」：改内容 + 换 ETag，使 If-Match 失效
      if (interfere) interfere(name);
      const existing = files.get(name);
      // 乐观锁语义
      if (record.ifMatch && (!existing || existing.etag !== record.ifMatch)) { record.status = 412; return respond(412); }
      if (record.ifNoneMatch === "*" && existing) { record.status = 412; return respond(412); }
      const created = write(name, options.body);
      record.status = existing ? 204 : 201;
      return respond(record.status, "", created.etag);
    }
    if (method === "GET") {
      const file = files.get(name);
      if (!file) { record.status = 404; return respond(404); }
      record.status = 200;
      return respond(200, file.body, file.etag);
    }
    if (method === "DELETE") {
      const existed = files.delete(name);
      record.status = existed ? 204 : 404;
      return respond(record.status);
    }
    record.status = 405;
    return respond(405);
  }

  return {
    fetch, files, requests, write,
    get interfere() { return interfere; },
    set interfere(hook) { interfere = hook; },
    backup() {
      const name = [...files.keys()].find((file) => /^lateron-backup-/.test(file));
      return name ? JSON.parse(files.get(name).body) : null;
    },
    puts() { return requests.filter((r) => r.method === "PUT" && /^lateron-backup-/.test(r.name)); }
  };
}

// ── chrome 桩 ──────────────────────────────────────────────
function makeChrome(store, listeners) {
  return {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return out;
        },
        async set(patch) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          // 真实 API 是异步派发事件，这里也异步，才能暴露「先落盘再收到事件」的顺序问题
          setTimeout(() => listeners.forEach((fn) => fn(changes, "local")), 0);
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    },
    alarms: {
      get: async () => undefined, create: async () => {}, clear: async () => {},
      onAlarm: { addListener() {} }
    },
    runtime: {
      id: "test-ext",
      getURL: (p) => `chrome-extension://test-ext/${p}`,
      onMessage: { addListener(fn) { (globalThis.__messageHandlers ||= []).push(fn); } },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} }
    }
  };
}

const item = (id, patch = {}) => ({
  id, url: `https://example.com/${id}`, title: `标题 ${id}`, description: "", image: "", favicon: "",
  source: "example.com", projectId: null, savedAt: Date.now(), status: "unread", ...patch
});

(async () => {
  const server = makeServer();
  const store = {
    laterOnItems: [item("local-a")],
    laterOnProjects: [], laterOnCovers: {}, laterOnOrder: {}, laterOnReadingPositions: {}
  };
  const listeners = [];
  const chrome = makeChrome(store, listeners);

  // 串行写队列（真实环境来自 background.js）
  let queue = Promise.resolve();
  const context = {
    chrome, fetch: server.fetch, console,
    crypto: globalThis.crypto, URL, TextEncoder, TextDecoder, AbortController,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    queueItemWrite: (task) => { const pending = queue.then(task); queue = pending.catch(() => {}); return pending; },
    setTimeout, clearTimeout
  };
  vm.createContext(context);
  // 传输层要和扩展里一样跑在真实的 item-store 上：索引 / 详情拆开存之后，
  // 「读出来的是不是完整条目」直接决定合并对不对。
  vm.runInContext(read("item-store.js"), context);
  vm.runInContext(read("webdav-sync-core.js"), context);
  vm.runInContext(read("webdav-directory.js"), context);
  vm.runInContext(read("webdav-sync.js"), context);
  const sync = context.LaterOnWebDAVSync;

  console.log("── 第 1 步：首次接入（启用即上传本地已有收藏）──");
  const saved = await sync.saveConfig({ enabled: true, url: "https://dav.example.com/dav/", username: "u", password: "p" });
  check("启用成功（连接测试通过：MKCOL/PROPFIND/PUT/GET/DELETE 都走通）", saved.ok === true);
  await settle();
  const first = server.backup();
  check("云端生成了当天的备份文件", !!first, [...server.files.keys()].join(", "));
  check("本地已有的收藏被上传", first?.items?.some((entry) => entry.id === "local-a"), JSON.stringify(first?.items?.map((i) => i.id)));
  check("备份格式是设置页导出那种（lateron-backup / v2）", first?.type === "lateron-backup" && first?.version === 2);
  const createPut = server.puts()[0];
  check("新建文件用 If-None-Match: *（不盲写覆盖别人刚建的）", createPut?.ifNoneMatch === "*", String(createPut?.ifNoneMatch));
  check("请求带上了 Basic 认证头", server.requests.every((r) => r.status !== 401));
  check("本地写入了同步日志", !!store.laterOnSyncState?.doc && !!store.laterOnSyncState?.device);
  check("状态记为成功", store.laterOnSyncStatus?.phase === "success", JSON.stringify(store.laterOnSyncStatus));

  console.log("\n── 第 2 步：本地新增一条，同步上去 ──");
  await chrome.storage.local.set({ laterOnItems: [...store.laterOnItems, item("local-b")] });
  await settle();
  await sync.sync(true);
  await settle();
  check("云端有两台设备都能看到的条目",
    ["local-a", "local-b"].every((id) => server.backup()?.items?.some((entry) => entry.id === id)),
    JSON.stringify(server.backup()?.items?.map((i) => i.id)));
  const updatePut = server.puts().at(-1);
  check("更新已有文件时带 If-Match（乐观锁）", /^"v\d+"$/.test(String(updatePut?.ifMatch)), String(updatePut?.ifMatch));

  console.log("\n── 第 3 步：并发写入 —— 另一台设备抢先写了，不能覆盖 ──");
  // 在模块 PUT 之前插入一次「另一台设备的写入」：加上 remote-only，并换掉 ETag
  server.interfere = () => {
    server.interfere = null; // 只干扰一次，模拟「另一台设备刚好抢先一步」
    const foreign = JSON.parse(JSON.stringify(server.backup()));
    foreign.items.push(item("remote-only", { title: "另一台设备加的" }));
    foreign.exportedAt = Date.now();
    server.write(`lateron-backup-${localDay()}.json`, JSON.stringify(foreign, null, 2));
  };
  await chrome.storage.local.set({ laterOnItems: [...store.laterOnItems, item("local-c")] });
  await settle();
  const conflictResult = await sync.sync(true);
  await settle();
  const merged = server.backup();
  const mergedIds = (merged?.items || []).map((i) => i.id).sort();
  check("第一次 PUT 被服务器拒绝（412）", server.requests.some((r) => r.method === "PUT" && r.status === 412));
  check("重读重合并后成功", conflictResult.ok === true, JSON.stringify(conflictResult));
  check("另一台设备那条没被覆盖掉", mergedIds.includes("remote-only"), mergedIds.join());
  check("本机新增的那条也在", mergedIds.includes("local-c"), mergedIds.join());
  check("三条都在（没有互相抹掉）", ["local-a", "local-b", "local-c", "remote-only"].every((id) => mergedIds.includes(id)), mergedIds.join());
  check("本地也收到了另一台设备的条目",
    (store.laterOnItems || []).some((entry) => entry.id === "remote-only"),
    (store.laterOnItems || []).map((i) => i.id).join());
  check("冲突次数记在状态里（给设置页显示）", (conflictResult.conflicts || 0) >= 1, String(conflictResult.conflicts));

  console.log("\n── 第 4 步：一直抢不过就报 syncConflict，不无限重试 ──");
  const before = server.requests.length;
  // 每次 PUT 前都有人抢先写（内容不变、只换 ETag），If-Match 必然失效
  server.interfere = () => {
    const foreign = JSON.parse(JSON.stringify(server.backup()));
    foreign.exportedAt = Date.now() + 1;
    server.write(`lateron-backup-${localDay()}.json`, JSON.stringify(foreign, null, 2));
  };
  await chrome.storage.local.set({ laterOnItems: [...store.laterOnItems, item("local-d")] });
  await settle();
  const storm = await sync.sync(true);
  await settle();
  const stormPuts = server.requests.slice(before).filter((r) => r.method === "PUT" && r.status === 412).length;
  check("最终返回失败而不是假装成功", storm.ok === false, JSON.stringify(storm));
  check("错误码是 syncConflict", storm.error === "syncConflict", String(storm.error));
  check("重试次数有上限（不是死循环）", stormPuts >= 2 && stormPuts <= 5, String(stormPuts));
  check("失败状态写进 storage（设置页能提示）", store.laterOnSyncStatus?.phase === "error" && store.laterOnSyncStatus?.error === "syncConflict",
    JSON.stringify(store.laterOnSyncStatus));

  console.log("\n── 第 5 步：配置校验 ──");
  let bad = null;
  try { sync.configValue({ enabled: true, url: "ftp://dav.example.com/", username: "u", password: "p" }); }
  catch (error) { bad = error.message; }
  check("非 http(s) 地址被拒", bad === "syncInvalidUrl", String(bad));
  let withAuth = null;
  try { sync.configValue({ enabled: true, url: "https://u:p@dav.example.com/", username: "u", password: "p" }); }
  catch (error) { withAuth = error.message; }
  check("URL 里带账号密码被拒（会被日志/截图带出去）", withAuth === "syncInvalidUrl", String(withAuth));
  check("目录固定落在 LaterOn/ 下",
    sync.directoryUrl(sync.configValue({ url: "https://dav.example.com/dav/" })) === "https://dav.example.com/dav/LaterOn/",
    sync.directoryUrl(sync.configValue({ url: "https://dav.example.com/dav/" })));
  check("已指向 LaterOn/ 的老配置不重复嵌套",
    sync.directoryUrl(sync.configValue({ url: "https://dav.example.com/dav/LaterOn/" })) === "https://dav.example.com/dav/LaterOn/");


  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.log(`❌ 测试自身出错：${error.stack || error.message}`);
  process.exit(1);
});
