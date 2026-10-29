// WebDAV 传输层：只跑在 service worker 里。账号密码永远不进同步文档、导出文件、
// 页面脚本、URL 或诊断信息。
//
// 与内核的分工：
//   webdav-sync-core.js  decide「谁赢」（纯逻辑、可单测）
//   本文件               负责「怎么搬」（网络、队列、重试、状态）
//
// 关键约束：
//   · 网络请求绝不占用本地写队列（queueItemWrite），否则一次慢请求会卡住收藏
//   · 只有「读现状 / 合并 / 落盘」这一小段进队列，和收藏、删除、清理互斥
//   · 上传用 ETag 做乐观锁（If-Match），412 就重读重合并——这是对参考实现的补强：
//     原实现只做「上传后回读自检」，两台设备同时写时校验不出「别人刚改过」
//   · 服务器不给 ETag 时退化成「回读比对」，并在状态里标记，不假装有并发保护
(function () {
  const Core = globalThis.LaterOnSyncCore;
  const CONFIG = "laterOnWebDAV", STATE = "laterOnSyncState", STATUS = "laterOnSyncStatus";
  const APPLIED = "laterOnSyncApplied", ALARM = "laterOnWebDAVSync";
  const QUIET = "laterOnSyncQuietUntil", LOCAL_IDLE_MS = 30000;
  const FILE = "lateron-sync-v1.json", MAX_BYTES = 50 * 1024 * 1024;
  const BASE = "laterOnWebDAVBase";
  const MAX_ATTEMPTS = 5;

  let localQueue = Promise.resolve(), active = null, debounce = null, generation = 0;
  let quietUntil = 0;
  const controllers = new Set();
  let rerun = false;

  // 和收藏共用同一条写队列：所有「读最新 → 改 → 写回」都串起来，避免互相覆盖。
  const serial = (task) => {
    const run = () => typeof queueItemWrite === "function" ? queueItemWrite(task) : task();
    const pending = localQueue.then(run);
    localQueue = pending.catch(() => {});
    return pending;
  };

  function configValue(raw, stored = false) {
    const config = {
      enabled: !!raw?.enabled, url: String(raw?.url || "").trim(),
      username: String(raw?.username || ""), password: String(raw?.password || ""),
      directoryMode: stored && raw?.directoryMode !== "auto" ? "legacy" : "auto"
    };
    if (!config.url && !config.enabled) return config;
    let url;
    try { url = new URL(config.url); } catch { throw new Error("syncInvalidUrl"); }
    // URL 里不许带账号密码/查询串（会被日志或截图带出去），用户名里不许有冒号（Basic 认证分隔符）
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || config.username.includes(":")) throw new Error("syncInvalidUrl");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    config.url = url.href;
    return config;
  }

  // 用户在设置里填的是「网盘根地址」，数据放在它下面的 LaterOn/ 目录；
  // 老配置可能已经直接指向数据目录，继续按原样读，等用户重新保存再升级。
  function directoryUrl(config) {
    if (!config.url || config.directoryMode === "legacy" || new URL(config.url).pathname.endsWith("/LaterOn/")) return config.url;
    return new URL("LaterOn/", config.url).href;
  }

  async function status(patch) {
    const old = (await chrome.storage.local.get(STATUS))[STATUS] || {};
    await chrome.storage.local.set({ [STATUS]: { ...old, ...patch } });
  }

  function errorCode(error) {
    const message = String(error?.message || "");
    return /^sync[A-Za-z]+$/.test(message) || /^HTTP \d{3}$/.test(message) ? message : "syncNetworkError";
  }

  // 一次提交写三样东西：同步日志（STATE）、本地数据（变了才写）、以及「这是我写的」标记。
  async function commit(doc, device, base) {
    const next = Core.materialize(doc);
    const current = await chrome.storage.local.get(Core.KEYS);
    const patch = { [STATE]: { device, doc }, [APPLIED]: crypto.randomUUID(), [QUIET]: quietUntil };
    if (base) patch[BASE] = base;
    for (const key of Core.KEYS) {
      if (!Core.equal(current[key] ?? (Array.isArray(next[key]) ? [] : {}), next[key])) patch[key] = next[key];
    }
    await chrome.storage.local.set(patch);
  }

  // 从 storage 读出「当前应该是什么」，并补上可能没记进日志的本地改动。
  async function readCurrentState() {
    const stored = await chrome.storage.local.get([...Core.KEYS, STATE]);
    const state = stored[STATE];
    if (!state) throw new Error("syncLocalError");
    const data = Object.fromEntries(Core.KEYS.map((key) => [
      key, stored[key] ?? (key === "laterOnItems" || key === "laterOnProjects" ? [] : {})
    ]));
    // 用户写入之后、日志落盘之前 worker 被挂掉时，这里把差额补记成一次本地改动。
    // 数据和日志是同一次 set 写的，所以任何差异都只可能来自本地编辑。
    return { device: state.device, doc: Core.change(state.doc, Core.materialize(state.doc), data, state.device) };
  }

  async function initialize() {
    return serial(async () => {
      const stored = await chrome.storage.local.get([...Core.KEYS, STATE, CONFIG, QUIET]);
      if (Number.isFinite(stored[QUIET])) quietUntil = Math.max(quietUntil, stored[QUIET]);
      if (!stored[STATE] && !stored[CONFIG]?.enabled) return;
      const device = stored[STATE]?.device || crypto.randomUUID();
      const doc = stored[STATE]?.doc;
      const data = Object.fromEntries(Core.KEYS.map((key) => [
        key, stored[key] ?? (key === "laterOnItems" || key === "laterOnProjects" ? [] : {})
      ]));
      const next = doc ? Core.change(doc, Core.materialize(doc), data, device) : Core.seed(data, device);
      if (doc && !Core.equal(next, doc)) quietUntil = Date.now() + LOCAL_IDLE_MS;
      await commit(next, device);
    });
  }

  async function scheduleAlarm(enabled) {
    if (!enabled) { await chrome.alarms.clear(ALARM); return; }
    // MV3 会随机挂起 worker，setTimeout 靠不住；闹钟是唯一可靠的定时来源
    if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.5 });
  }

  function soon() {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; sync().catch(() => {}); }, Math.max(0, quietUntil - Date.now()));
  }

  const ready = initialize();
  ready.catch(() => status({ phase: "error", error: "syncLocalError" }).catch(() => {}));

  // 本地任何一处写了这五个键，都记进日志并重新计时。收 APPLIED 标记说明是自己写的，忽略。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || changes[APPLIED] || !Core.KEYS.some((key) => changes[key])) return;
    // 同步设成「静默期」，否则一个正在飞的轮询可能把刚改的内容当成远端更新
    quietUntil = Date.now() + LOCAL_IDLE_MS;
    serial(async () => {
      const stored = await chrome.storage.local.get([STATE]);
      const state = stored[STATE];
      if (!state) { await chrome.storage.local.set({ [QUIET]: quietUntil }); return; }
      const before = {}, after = {};
      for (const key of Core.KEYS) {
        if (!changes[key]) continue;
        before[key] = changes[key].oldValue;
        after[key] = changes[key].newValue;
      }
      // 记录这次事件的实际差额，而不是整份快照：避免把「同时发生的远端更新」又写回去
      const next = Core.change(state.doc, before, after, state.device);
      await commit(next, state.device);
      soon();
    }).catch(() => status({ phase: "error", error: "syncLocalError" }).catch(() => {}));
  });

  function authorization(config) {
    const bytes = new TextEncoder().encode(`${config.username}:${config.password}`);
    let value = "";
    for (const byte of bytes) value += String.fromCharCode(byte);
    return `Basic ${btoa(value)}`;
  }

  async function request(config, method, headers = {}, body, path = FILE, epoch = generation) {
    if (epoch !== generation) throw new Error("syncCancelled");
    const abort = new AbortController();
    controllers.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(new URL(path, directoryUrl(config)).href, {
        method,
        headers: { Authorization: authorization(config), ...headers },
        body,
        signal: abort.signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      // 响应体也在同一个超时里读完，否则一个卡住的下载能让同步永远「进行中」
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("syncTooLarge");
      let text = "";
      if ((method === "GET" || method === "PROPFIND") && response.ok) {
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) { await reader.cancel(); throw new Error("syncTooLarge"); }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } else text = await response.text();
      } else await response.body?.cancel();
      if (epoch !== generation) throw new Error("syncCancelled");
      return { status: response.status, ok: response.ok, etag: response.headers.get("etag"), text };
    } catch (error) {
      if (epoch !== generation) throw new Error("syncCancelled");
      if (abort.signal.aborted) throw new Error("syncTimeout");
      throw error;
    } finally {
      clearTimeout(timeout);
      controllers.delete(abort);
    }
  }

  function httpError(code) {
    if (code === 401 || code === 403) return new Error("syncAuthError");
    if (code === 409) return new Error("syncDirectoryMissing");
    return new Error(`HTTP ${code}`);
  }

  async function ensureDirectory(config, epoch) {
    if (config.directoryMode === "legacy") return;
    // 已存在时 MKCOL 返回 405（含另一台设备同时创建的情况）；后面读写会暴露真正的问题
    const response = await request(config, "MKCOL", {}, undefined, "", epoch);
    if (!response.ok && response.status !== 405) throw httpError(response.status);
  }

  function parseRemote(response) {
    if (!response.ok) throw httpError(response.status);
    let doc;
    try { doc = JSON.parse(response.text); } catch { throw new Error("syncInvalidData"); }
    return Core.validate(doc);
  }

  async function listSnapshots(config, epoch) {
    const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
    let response = await request(config, "PROPFIND", { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body, "", epoch);
    if (response.status === 404 && config.directoryMode !== "legacy") {
      await ensureDirectory(config, epoch);
      response = await request(config, "PROPFIND", { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body, "", epoch);
    }
    if ([405, 501].includes(response.status)) throw new Error("syncListUnsupported");
    if (!response.ok) throw httpError(response.status);
    return LaterOnWebDAVDirectory.names(response.text, directoryUrl(config));
  }

  function checkQuiet(manual) {
    if (!manual && Date.now() < quietUntil) throw new Error("syncWaitingForIdle");
  }

  async function exchange(config, epoch, manual) {
    const identity = JSON.stringify([directoryUrl(config), config.username]);
    const savedBase = (await chrome.storage.local.get(BASE))[BASE];
    const base = savedBase?.identity === identity ? Core.validate(savedBase.doc) : null;
    let conflicts = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const names = await listSnapshots(config, epoch);
      const latestName = names.filter((name) => LaterOnWebDAVDirectory.DAILY.test(name)).at(-1);
      let remote = Core.empty(), remoteData = null, etag = null, retry = false;

      if (latestName) {
        // 当天的备份是可变的（同一天多次改动写同一个文件），所以每次都读实际内容；
        // 更早的日期是历史还原点，绝不参与日常合并，否则删掉的内容会被历史带回来。
        const response = await request(config, "GET", {}, undefined, latestName, epoch);
        if (response.status === 404) continue;
        if (!response.ok) throw httpError(response.status);
        etag = response.etag;
        let payload;
        try { payload = JSON.parse(response.text); } catch { throw new Error("syncInvalidData"); }
        remoteData = Core.backupData(payload);
        // 每台设备记住自己上次同步成功的基线。用它和完整远端备份对比，就能算出
        // 「远端删了什么」——不需要把内部同步日志写进用户能看到的导出 JSON。
        remote = base
          ? Core.change(base, Core.materialize(base), remoteData, "webdav-backup", payload.exportedAt)
          : Core.activate(Core.seed(remoteData, "webdav-backup"), "webdav-backup", payload.exportedAt);
        Core.validate(remote);
      } else {
        // 兼容更早的快照/增量文件：读进来合并，旧文件不删；一旦有当日完整备份就以它为准
        for (const name of names) {
          const response = await request(config, "GET", {}, undefined, name, epoch);
          if (response.status === 404) { retry = true; break; }
          remote = Core.merge(remote, parseRemote(response));
        }
      }
      if (retry) continue;

      const local = await serial(async () => {
        if (epoch !== generation) throw new Error("syncCancelled");
        checkQuiet(manual);
        return readCurrentState();
      });

      // 首次连接：本机已有数据只填空缺，不能盖掉最新备份里已有的记录
      const localDoc = latestName && !base ? Core.seed(Core.materialize(local.doc), local.device) : local.doc;
      const merged = Core.validate(Core.activate(Core.merge(localDoc, remote), local.device));
      const data = Core.materialize(merged);
      const today = Core.backupName();
      // 系统时间被往回调时不能改写历史日期：宁可写到已有的最近那份上
      const target = latestName && latestName > today ? latestName : today;

      if (target !== latestName || !Core.equal(data, remoteData)) {
        const body = JSON.stringify(Core.backup(merged), null, 2);
        if (new TextEncoder().encode(body).length > MAX_BYTES) throw new Error("syncTooLarge");
        checkQuiet(manual);
        // 乐观锁：读到过 ETag 就带 If-Match；新建当天文件用 If-None-Match: *，
        // 避免和另一台设备「同时创建」时把对方刚写的内容盖掉。
        const headers = { "Content-Type": "application/json; charset=utf-8" };
        if (etag) headers["If-Match"] = etag;
        else if (!latestName) headers["If-None-Match"] = "*";
        const result = await request(config, "PUT", headers, body, target, epoch);
        if (result.status === 412) {
          // 别人在我们读取之后写过：重读、重合并，本次结果作废，绝不覆盖
          conflicts += 1;
          if (attempt < MAX_ATTEMPTS - 1) continue;
          throw new Error("syncConflict");
        }
        if (!result.ok) throw httpError(result.status);
        const verify = await request(config, "GET", {}, undefined, target, epoch);
        if (!verify.ok) throw httpError(verify.status);
        // 回读比对：服务器不返回 ETag 时，这是唯一能发现「写坏了」的手段。
        // 任何情况下都不删历史备份——上传失败也不能连带抹掉本机和云端的数据。
        if (verify.text !== body) throw new Error("syncVerifyFailed");
      }

      await serial(async () => {
        if (epoch !== generation) throw new Error("syncCancelled");
        const latest = await readCurrentState();
        // 只保留「本轮捕获本地状态之后」新产生的改动，避免首次同步的重定基线
        // 把旧记录又带回来
        const final = Core.merge(merged, Core.delta(latest.doc, local.doc));
        await commit(final, latest.device, { identity, doc: merged });
        if (!Core.equal(final, merged)) rerun = true;
      });
      return { conflicts };
    }
    throw new Error("syncConflict");
  }

  async function sync(manual = false) {
    if (active) {
      if (manual) { await active; return sync(true); }
      rerun = true;
      return active;
    }
    const epoch = generation;
    const work = async () => {
      await ready;
      const raw = (await chrome.storage.local.get(CONFIG))[CONFIG];
      if (!raw?.enabled) return { ok: true, disabled: true };
      if (!manual && Date.now() < quietUntil) { soon(); return { ok: true, pending: true }; }
      const config = configValue(raw, true);
      await status({ phase: "syncing", error: null });
      try {
        const result = await exchange(config, epoch, manual);
        if (epoch === generation) {
          await status({ phase: "success", lastSuccess: Date.now(), error: null, conflicts: result.conflicts || 0 });
        }
        return { ok: true, conflicts: result.conflicts || 0 };
      } catch (error) {
        if (epoch === generation && error.message === "syncWaitingForIdle") {
          soon();
          await status({ phase: "pending", error: null });
          return { ok: true, pending: true };
        }
        if (epoch === generation) await status({ phase: "error", error: errorCode(error) });
        return { ok: false, error: errorCode(error) };
      }
    };
    active = work().finally(() => {
      active = null;
      if (rerun) { rerun = false; soon(); }
    });
    return active;
  }

  async function saveConfig(raw) {
    const config = configValue(raw);
    // 启用前先验证「能列目录 + 能写能读能改」，避免存了一份用不了的配置
    if (config.enabled) await testConnection(config);
    generation++;
    for (const controller of controllers) controller.abort();
    if (debounce !== null) { clearTimeout(debounce); debounce = null; }
    await ready;
    await serial(async () => {
      const stored = await chrome.storage.local.get([CONFIG, STATE, ...Core.KEYS, STATUS]);
      const device = stored[STATE]?.device || crypto.randomUUID();
      const previous = stored[CONFIG]?.url ? configValue(stored[CONFIG], true) : null;
      const changedServer = !previous || directoryUrl(previous) !== directoryUrl(config) || previous.username !== config.username;
      const patch = {
        [CONFIG]: config,
        [STATUS]: {
          phase: config.enabled ? "pending" : "disabled", error: null, conflicts: 0,
          lastSuccess: changedServer ? null : (stored[STATUS]?.lastSuccess || null)
        }
      };
      // 换账号/换目录时必须重置：一个账号的墓碑绝不能删掉另一个账号的数据
      if (!stored[STATE] || changedServer) {
        patch[STATE] = { device, doc: Core.seed(stored, device) };
        patch[BASE] = null;
      }
      await chrome.storage.local.set(patch);
    });
    await scheduleAlarm(config.enabled);
    if (config.enabled) soon();
    return { ok: true };
  }

  async function testConnection(raw) {
    const config = configValue({ ...raw, enabled: true });
    // 只碰一个用完就删的临时文件，绝不拿用户的同步文件当试验品
    const path = `.lateron-check-${crypto.randomUUID()}.json`;
    const epoch = generation;
    let created = false;
    try {
      await ensureDirectory(config, epoch);
      await listSnapshots(config, epoch);
      const put = await request(config, "PUT", { "Content-Type": "application/json" }, "{}", path, epoch);
      if (!put.ok) throw httpError(put.status);
      created = true;
      const get = await request(config, "GET", {}, undefined, path, epoch);
      if (!get.ok) throw httpError(get.status);
      if (get.text !== "{}") throw new Error("syncVerifyFailed");
      const updatedBody = '{"lateron":"connection-test"}';
      const update = await request(config, "PUT", { "Content-Type": "application/json" }, updatedBody, path, epoch);
      if (!update.ok) throw httpError(update.status);
      const verify = await request(config, "GET", {}, undefined, path, epoch);
      if (!verify.ok) throw httpError(verify.status);
      if (verify.text !== updatedBody) throw new Error("syncVerifyFailed");
      return { ok: true };
    } finally {
      if (created) {
        const removed = await request(config, "DELETE", {}, undefined, path, epoch);
        if (!removed.ok && removed.status !== 404) throw new Error("syncTestCleanup");
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const actions = {
      WEBDAV_SAVE: () => saveConfig(message.config),
      WEBDAV_SYNC: () => sync(true),
      WEBDAV_TEST: () => testConnection(message.config)
    };
    if (!actions[message?.type]) return;
    // 配置与网络操作只允许设置页调用，内容脚本和网页脚本都不行
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("settings.html")) {
      sendResponse({ ok: false, error: "syncForbidden" });
      return;
    }
    Promise.resolve().then(actions[message.type]).then(sendResponse).catch((error) => sendResponse({ ok: false, error: errorCode(error) }));
    return true;
  });

  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) sync().catch(() => {}); });

  async function resume() {
    await ready;
    const enabled = !!(await chrome.storage.local.get(CONFIG))[CONFIG]?.enabled;
    await scheduleAlarm(enabled);
    if (enabled) await sync();
  }
  chrome.runtime.onStartup.addListener(() => resume().catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => resume().catch(() => {}));
  resume().catch(() => {});

  // 供测试注入用（不暴露到 chrome 消息接口）
  globalThis.LaterOnWebDAVSync = { sync, saveConfig, testConnection, configValue, directoryUrl, ALARM };
})();
