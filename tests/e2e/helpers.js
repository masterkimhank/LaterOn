/**
 * 真浏览器端到端测试的公共设施。
 *
 * 为什么需要这一层：`tests/*.test.js` 全部跑在 jsdom 里，jsdom 不排版、不算
 * `getBoundingClientRect`、不加载扩展、没有 `chrome.*` 的真实实现。凡是
 * 「看起来对吗」「点下去真的存住了吗」这类问题，jsdom 一律答不了。
 *
 * 关键前提（本机实测）：Playwright 自带的 Chromium 用 `channel: "chromium"`
 * 打开的是新版无头模式（new headless），它是完整 Chrome，**支持加载扩展**。
 * 系统里那个 `chrome --headless` 加载不了扩展，别再往那条路上试。
 *
 * 用法见 tests/e2e/*.spec.js；运行 `node scripts/test-e2e.js`。
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const EXT_ROOT = path.resolve(__dirname, "..", "..");

// 1×1 透明 PNG。用它当封面，能直接测出「透明图会不会透出底下的橙色占位砖」。
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

/** 与 tests/*.test.js 一致的断言口径：逐条打印，退出码定胜负。 */
function createChecker() {
  const state = { total: 0, failures: 0 };
  return {
    check(label, ok, extra = "") {
      state.total += 1;
      if (!ok) state.failures += 1;
      console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `  → ${extra}` : ""}`);
      return ok;
    },
    /** 把异常也变成一条失败，而不是让进程崩掉、只剩一行栈。 */
    fail(label, error) {
      state.total += 1;
      state.failures += 1;
      console.log(`❌ ${label}  → ${String(error?.message || error).split("\n")[0]}`);
    },
    finish() {
      console.log(`\n${state.failures ? "❌" : "✅"} ${state.total - state.failures}/${state.total} 条通过`);
      process.exit(state.failures ? 1 : 0);
    },
  };
}

/**
 * 起一个本地静态站点。E2E 绝不依赖外网：外网站点会改标题、加反爬、掉图，
 * 测试就会莫名其妙地红。
 */
async function startSite(routes = {}) {
  const table = {
    "/cover-transparent.png": { body: TRANSPARENT_PNG, type: "image/png" },
    "/cover-broken.png": { body: "not really a png", type: "image/png" },
    // 浏览器会自己去要 /favicon.ico，别让它变成一条假的 404 报错。
    "/favicon.ico": { body: "", type: "image/x-icon", status: 204 },
    ...routes,
  };

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const route = table[pathname];
    if (!route) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>404</title><h1>not found</h1>");
      return;
    }
    const { body = "", type = "text/html; charset=utf-8", status = 200, delay = 0 } = route;
    const send = () => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (delay) setTimeout(send, delay);
    else send();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

/** 构造一个带 og 信息的普通文章页。 */
function articlePage({ title = "测试文章标题", description = "这是一段摘要。", image = "/cover-transparent.png" } = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8" />
<title>${title}</title>
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
${image ? `<meta property="og:image" content="${image}" />` : ""}
</head><body><h1>${title}</h1><p>${description}</p></body></html>`;
}

/**
 * 启动一个装了 LaterOn 的浏览器实例。
 * 每个实例用独立 profile 目录，`chrome.storage.local` 天然隔离，
 * 测试之间不会互相看到对方的收藏。
 */
async function launchExtension({ headless = !process.env.LATERON_E2E_HEADED, viewport } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lateron-e2e-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium", // 新版无头：唯一能加载扩展的无头模式
    headless,
    viewport: viewport || { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXT_ROOT}`,
      `--load-extension=${EXT_ROOT}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const consoleErrors = [];
  const failedRequests = [];
  context.on("page", (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`${page.url()} :: ${msg.text()}`);
    });
    page.on("pageerror", (error) => consoleErrors.push(`${page.url()} :: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
    });
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;

  const api = {
    context,
    extensionId,
    consoleErrors,
    failedRequests,
    profileDir,
    /** 扩展页面的完整 URL。 */
    url: (file) => `chrome-extension://${extensionId}/${file}`,
    async close() {
      await context.close().catch(() => {});
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  };
  return api;
}

/**
 * MV3 的 service worker 空闲会被浏览器回收，`evaluate` 就会撞上 "Target closed"。
 * 这里统一取最新的 worker 并重试，调用方不必关心它是不是刚被回收过。
 */
async function swEval(api, fn, arg) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const worker = api.context.serviceWorkers().at(-1);
      if (!worker) throw new Error("service worker 不在");
      return await worker.evaluate(fn, arg);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`service worker 调用失败：${String(lastError?.message || lastError).split("\n")[0]}`);
}

const setStorage = (api, data) => swEval(api, (payload) => chrome.storage.local.set(payload), data);
const getStorage = (api, keys = null) => swEval(api, (k) => chrome.storage.local.get(k), keys);
const clearStorage = (api) => swEval(api, () => chrome.storage.local.clear());

/**
 * 在扩展页面里等一等条件成立。
 * 为什么不用 waitForTimeout：固定等待既拖慢又会在慢机器上假红。
 */
async function waitFor(fn, { timeout = 8000, interval = 100, message = "条件" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${message}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** 打开一个扩展内页面（sidepanel.html / settings.html / library.html）。 */
async function openPage(api, file, options = {}) {
  const page = await api.context.newPage();
  if (options.viewport) await page.setViewportSize(options.viewport);
  await page.goto(api.url(file), { waitUntil: "domcontentloaded" });
  // 新 profile = 首次安装 = 侧栏会弹新手引导。它是全屏模态，会挡住所有点击，
  // 所以默认先跳过；需要验证引导本身的测试传 onboarding:"keep" 自己处理。
  if (options.onboarding !== "keep") await dismissOnboarding(page).catch(() => false);
  return page;
}

/**
 * 关掉新手引导。返回它这次到底有没有出现——这是一个有用的信号：
 * 返回 false 说明引导按「已看过」的逻辑被正确跳过了。
 */
async function dismissOnboarding(page, { timeout = 10000 } = {}) {
  const guide = page.locator(".lon-guide.is-visible");
  try {
    await guide.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await page.locator(".lon-guide-skip").click({ timeout });
  await waitFor(() => page.locator(".lon-guide").count().then((n) => n === 0), {
    timeout,
    message: "新手引导关闭",
  });
  return true;
}

/** 预置「已看过引导」，让页面别再弹。用于不关心引导流程的测试。 */
const markOnboardingSeen = (api) => setStorage(api, { laterOnOnboardingSeen: true });

module.exports = {
  EXT_ROOT,
  TRANSPARENT_PNG,
  articlePage,
  clearStorage,
  createChecker,
  dismissOnboarding,
  getStorage,
  launchExtension,
  markOnboardingSeen,
  openPage,
  setStorage,
  startSite,
  swEval,
  waitFor,
};
