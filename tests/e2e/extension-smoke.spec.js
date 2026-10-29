/**
 * 装进浏览器之后的冒烟检查：扩展到底有没有完整地跑起来。
 *
 * 这里查的是只有真加载才暴露的问题：
 *   - 发布包白名单（build-release.py 的 RUNTIME_FILES）里的每个文件，
 *     在真正装好的扩展里都能取到 200。历史上就踩过「新加的 js 忘了进白名单，
 *     发出去的包里 404，本地一切正常」——jsdom 测试对此完全无感。
 *   - manifest 的版本号和 package.json 的版本号是否还一致。
 *   - service worker 真的能读写 chrome.storage（不是只有函数签名）。
 *   - 三个入口页面在真浏览器里都能打开且不抛错。
 *
 * 运行：node tests/e2e/extension-smoke.spec.js
 */
const fs = require("fs");
const path = require("path");
const {
  EXT_ROOT,
  createChecker,
  launchExtension,
  markOnboardingSeen,
  openPage,
  swEval,
} = require("./helpers");

/** 从打包脚本里读白名单，而不是在测试里抄一份——抄一份就一定会忘记同步。 */
function runtimeFiles() {
  const source = fs.readFileSync(path.join(EXT_ROOT, "scripts", "build-release.py"), "utf8");
  const block = source.match(/RUNTIME_FILES\s*=\s*\(([\s\S]*?)\)/);
  if (!block) throw new Error("没在 build-release.py 里找到 RUNTIME_FILES");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

(async () => {
  const c = createChecker();
  const api = await launchExtension();

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "manifest.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "package.json"), "utf8"));

    // ── 1. 扩展真的装上了 ────────────────────────────────
    c.check("扩展 ID 是合法的 32 位小写字母", /^[a-p]{32}$/.test(api.extensionId), api.extensionId);

    const liveManifest = await swEval(api, () => chrome.runtime.getManifest());
    c.check("浏览器里读到的就是这份 manifest", liveManifest.version === manifest.version, liveManifest.version);
    c.check("manifest 版本号是三段数字", /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version);
    c.check(
      "package.json 版本号与 manifest 一致",
      pkg.version === manifest.version,
      `package=${pkg.version} manifest=${manifest.version}`
    );

    const permissions = liveManifest.permissions || [];
    for (const required of ["storage", "sidePanel", "alarms", "tabs"]) {
      c.check(`声明了 ${required} 权限`, permissions.includes(required));
    }

    // ── 2. 白名单里的每个文件在扩展里都取得到 ────────────
    const files = runtimeFiles();
    c.check("打包白名单非空", files.length > 10, `${files.length} 个文件`);
    const missing = [];
    const failed = await swEval(
      api,
      async (names) => {
        const bad = [];
        for (const name of names) {
          const url = chrome.runtime.getURL(name);
          try {
            const response = await fetch(url);
            if (!response.ok) bad.push(`${name}(${response.status})`);
          } catch (error) {
            bad.push(`${name}(异常)`);
          }
        }
        return bad;
      },
      files
    );
    missing.push(...failed);
    c.check("白名单里每个文件都能在扩展内取到", missing.length === 0, missing.join(",") || `${files.length} 个全部命中`);

    // ── 3. service worker 真的能读写存储 ─────────────────
    const roundTrip = await swEval(api, async () => {
      await chrome.storage.local.set({ __e2e_probe: { at: 123, ok: true } });
      const read = await chrome.storage.local.get("__e2e_probe");
      await chrome.storage.local.remove("__e2e_probe");
      return read.__e2e_probe || null;
    });
    c.check("chrome.storage 能写能读能删", roundTrip && roundTrip.at === 123 && roundTrip.ok === true, JSON.stringify(roundTrip));

    // ── 4. 三个入口页面都能打开且不报错 ──────────────────
    await markOnboardingSeen(api);
    for (const [file, viewport] of [
      ["sidepanel.html", { width: 400, height: 820 }],
      ["library.html", { width: 1280, height: 900 }],
      ["settings.html", { width: 900, height: 820 }],
    ]) {
      const before = api.consoleErrors.length;
      const page = await openPage(api, file, { viewport });
      const title = await page.title();
      const bodyLength = await page.evaluate(() => document.body.innerText.trim().length);
      const newErrors = api.consoleErrors.slice(before).filter((line) => !/favicon|net::ERR|ERR_/i.test(line));
      c.check(
        `${file} 能打开并渲染出内容`,
        bodyLength > 20,
        `标题="${title}" 文本 ${bodyLength} 字`
      );
      c.check(`${file} 打开时没有报错`, newErrors.length === 0, newErrors.slice(0, 2).join(" | ") || "干净");
      await page.close();
    }

    // ── 5. 版本号之外，能力也得对得上 ────────────────────
    // 注意：这里加载的是开发目录本身，扩展自己的页面能 fetch 到 README.md，
    // 所以「开发期文件有没有混进发布包」这件事在这里验不了——那是
    // tests/release-package-hygiene.test.js 的活（它直接拆 zip 看内容）。
    const hasSidePanel = Boolean(liveManifest.side_panel?.default_path);
    const hasBackground = Boolean(liveManifest.background?.service_worker);
    c.check("manifest 声明了侧栏入口", hasSidePanel, liveManifest.side_panel?.default_path || "(无)");
    c.check("manifest 声明了后台 service worker", hasBackground, liveManifest.background?.service_worker || "(无)");

    const workerAlive = await swEval(api, () => typeof self.chrome === "object" && !!chrome.runtime?.id);
    c.check("service worker 上下文里的 chrome API 可用", workerAlive);
  } catch (error) {
    c.fail("扩展冒烟测试异常中止", error);
  } finally {
    await api.close();
  }
  c.finish();
})();
