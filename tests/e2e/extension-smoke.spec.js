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
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  EXT_ROOT,
  createChecker,
  getStorage,
  launchExtension,
  markOnboardingSeen,
  openPage,
  setStorage,
  swEval,
} = require("./helpers");
const { idFromManifestKey } = require(path.join(EXT_ROOT, "scripts", "extension-id.js"));

/** 固定扩展 ID 的约定值。改了 manifest.key，这个数字必须跟着改，否则老用户数据读不到。 */
const EXPECTED_ID = "ahfghclmnedaflabdpffhdbbdhjikjme";

/** 从打包脚本里读白名单，而不是在测试里抄一份——抄一份就一定会忘记同步。 */
function runtimeFiles() {
  const source = fs.readFileSync(path.join(EXT_ROOT, "scripts", "build-release.py"), "utf8");
  const block = source.match(/RUNTIME_FILES\s*=\s*\(([\s\S]*?)\)/);
  if (!block) throw new Error("没在 build-release.py 里找到 RUNTIME_FILES");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * 把发布包解压到一个临时目录，模拟「用户从 Releases 下载 zip、解压、加载」。
 * 返回 null 表示本机没 python（打包脚本本身就要求 python，跳过而不是判失败）。
 */
function unpackRelease(version) {
  const PY = process.platform === "win32" ? "python" : "python3";
  const probe = spawnSync(PY, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return null;

  const built = spawnSync(PY, ["scripts/build-release.py"], { cwd: EXT_ROOT, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`打包失败：${built.stderr || built.stdout}`);

  const zip = path.join(EXT_ROOT, "dist", `LaterOn-${version}.zip`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lateron-release-"));
  const unpacked = spawnSync(
    PY,
    ["-c", "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dir],
    { encoding: "utf8" }
  );
  if (unpacked.status !== 0) throw new Error(`解压失败：${unpacked.stderr}`);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

(async () => {
  const c = createChecker();
  const api = await launchExtension();

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "manifest.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "package.json"), "utf8"));

    // ── 1. 扩展真的装上了，而且 ID 就是钉死的那个 ────────
    c.check("扩展 ID 是合法的 32 位小写字母", /^[a-p]{32}$/.test(api.extensionId), api.extensionId);

    // manifest.key 只有被浏览器真正采纳，装出来的 ID 才会等于用它算出的值；
    // 没有 key 时 Chrome 按扩展目录的绝对路径派生 ID，换个路径就是另一个扩展。
    // key 缺失时 idFromManifestKey 会抛错——这里接住，让它变成一条失败项，
    // 而不是让整个 spec 异常中止（那样后面的检查全都不跑，反而看不出问题在哪）。
    let derivedId = null;
    try {
      derivedId = idFromManifestKey(manifest.key);
    } catch {
      derivedId = null;
    }
    c.check("manifest 里有能算出 ID 的 key", Boolean(derivedId), derivedId || "(缺失)");
    c.check(
      "浏览器分配的 ID 等于 manifest.key 算出来的 ID",
      api.extensionId === derivedId,
      `实际=${api.extensionId} 期望=${derivedId || "(无)"}`
    );
    c.check(
      "扩展 ID 与约定的常量一致（改 key 等于清空老用户数据）",
      api.extensionId === EXPECTED_ID,
      api.extensionId
    );

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

    // ── 6. 换个目录装，还是同一个扩展、还是同一份数据 ────
    // 这是「固定扩展 ID」的全部意义。不固定 ID 时，把扩展换个目录加载就等于装了
    // 一个新扩展，收藏看起来「全没了」——其实是另一个 ID 下的空 storage，不报错。
    // 这里用同一份 profile 起两次：先在开发目录存一条，再换成发布包解压出来的目录读。
    const release = unpackRelease(manifest.version);
    if (!release) {
      console.log("⚠️ 跳过「换目录数据是否存活」：本机没有可用的 python（打包脚本依赖它）");
    } else {
      const sharedProfile = fs.mkdtempSync(path.join(os.tmpdir(), "lateron-profile-"));
      try {
        const before = await launchExtension({ profileDir: sharedProfile });
        const idBefore = before.extensionId;
        await setStorage(before, {
          laterOnItems: [
            {
              id: "e2e-cross-dir",
              title: "换目录之前存的收藏",
              description: "换目录之后必须读得到",
              source: "example.com",
              url: "https://example.com/cross-dir",
              savedAt: Date.now(),
              status: "unread",
            },
          ],
        });
        await before.close({ keepProfile: true });

        const after = await launchExtension({ profileDir: sharedProfile, extensionPath: release.dir });
        c.check(
          "发布包解压到另一个目录后 ID 不变",
          after.extensionId === idBefore,
          `${idBefore} → ${after.extensionId}`
        );
        const seen = await getStorage(after, "laterOnItems");
        const kept = (seen.laterOnItems || []).find((item) => item.id === "e2e-cross-dir");
        c.check("换了目录之后原来的收藏还在", Boolean(kept), kept ? kept.title : "读不到（说明 ID 变了）");
        await after.close();
      } finally {
        fs.rmSync(sharedProfile, { recursive: true, force: true });
        release.cleanup();
      }
    }
  } catch (error) {
    c.fail("扩展冒烟测试异常中止", error);
  } finally {
    await api.close();
  }
  c.finish();
})();
