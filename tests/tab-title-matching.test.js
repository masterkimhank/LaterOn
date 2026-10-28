// 「关标签页」怎么认出一篇收藏在浏览器里对应的标签页。
// 光比网址不够用：有些站点每次打开的网址都会变（换参数、SPA 换路由、短链跳转），
// 之后凭网址永远找不到那个标签页。所以入库时另存了一份「添加时的原标题」，
// 这段测试锁住三道判据：
//   ① 网址相同（含 www / utm 等变体）→ 算同一篇
//   ② 网址对不上，但「同一个站点 + 同一个标题」→ 也算（靠 titleAtSave）
//   ③ 标题太短（「登录」这种）或站点不同 → 绝不凭标题去关，宁可漏关也不能误关
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const urlUtilsSource = fs.readFileSync(`${ROOT}/url-utils.js`, "utf8");
const tabsSource = fs.readFileSync(`${ROOT}/tab-navigation.js`, "utf8");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "outside-only",
  url: "chrome-extension://lateron/library.html"
});
const { window } = dom;

let openTabs = [];
const removed = [];

window.chrome = {
  tabs: {
    query: () => Promise.resolve(openTabs),
    remove: (ids) => {
      const list = [].concat(ids);
      removed.push(...list);
      openTabs = openTabs.filter((tab) => !list.includes(tab.id));
      return Promise.resolve();
    }
  }
};

window.eval(urlUtilsSource);
window.eval(tabsSource);
const { matches, closeMatching, titleKey } = window.LaterOnTabs;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const ids = (tabs) => tabs.map((tab) => tab.id).sort((a, b) => a - b).join(",");

// 浏览器此刻开着的标签页。注意 3 号：网址和收藏里的完全不同，但标题是同一篇
// （还带着「 - 少数派」的站点后缀，这是绝大多数中文站点的标签页标题形态）。
const fixture = () => [
  { id: 1, url: "https://example.com/a1", title: "深度好文" },
  { id: 2, url: "https://www.example.com/a1/?utm_source=weixin", title: "深度好文" },
  { id: 3, url: "https://example.com/route/new-id-123", title: "深度好文 - 少数派" },
  { id: 4, url: "https://other.com/route/new-id-999", title: "深度好文" },
  { id: 5, url: "https://example.com/login", title: "登录" },
  { id: 6, url: "chrome-extension://lateron/library.html", title: "深度好文" },
  { id: 7, url: "https://example.com/other", title: "完全不同的另一篇文章" }
];

(async () => {
  console.log("── 网址相同仍然算同一篇（原有行为） ──");
  openTabs = fixture();
  let hit = await matches(["https://example.com/a1"]);
  check("纯网址字符串照样能匹配（老调用方不受影响）", ids(hit) === "1,2", ids(hit));

  console.log("\n── 网址变了：靠「同一站点 + 原标题」认出来 ──");
  openTabs = fixture();
  const saved = {
    url: "https://example.com/a1",
    title: "深度好文",
    titleAtSave: "深度好文",
    source: "少数派"
  };
  hit = await matches([saved]);
  check("同一篇的 www / utm 变体、以及换了路由但仍同标题的那个都被认出",
    ids(hit) === "1,2,3", ids(hit));
  check("别的站点即使标题一模一样也不碰", !hit.some((tab) => tab.id === 4), ids(hit));
  check("扩展自己的页面永远不算", !hit.some((tab) => tab.id === 6), ids(hit));
  check("同站点但标题不同的标签页不碰", !hit.some((tab) => tab.id === 7), ids(hit));

  console.log("\n── 标题被用户改过：仍按「添加时的原标题」去认 ──");
  openTabs = fixture();
  const renamed = {
    url: "https://example.com/never-opened",
    title: "我自己改的名字",
    titleAtSave: "深度好文",
    source: "少数派"
  };
  hit = await matches([renamed]);
  // 库里那条网址在浏览器里根本没开着；能认出来全靠 titleAtSave，
  // 于是同一站点上标题对得上的三个（含换了路由的 3 号）都算。
  check("靠原标题认出同一站点上标题对得上的 1、2、3",
    ids(hit) === "1,2,3", ids(hit));

  console.log("\n── 太短的标题不参与兜底匹配 ──");
  openTabs = fixture();
  const weak = { url: "https://example.com/login-nowhere", title: "登录", titleAtSave: "登录", source: "" };
  hit = await matches([weak]);
  check("「登录」这种没有区分度的标题不匹配任何标签页", hit.length === 0, ids(hit));
  check("titleKey 对短标题直接返回空", titleKey("登录", "") === "", JSON.stringify(titleKey("登录", "")));
  check("titleKey 会去掉站点后缀", titleKey("深度好文 - 少数派", "少数派") === "深度好文", titleKey("深度好文 - 少数派", "少数派"));
  check("标题自带破折号时不会被误砍",
    titleKey("A - B 的完整标题", "少数派") === "a - b 的完整标题",
    titleKey("A - B 的完整标题", "少数派"));

  console.log("\n── 真正关起来：只关认出来的那几个 ──");
  openTabs = fixture();
  removed.length = 0;
  const closed = await closeMatching([saved]);
  check("报告关掉了 3 个", closed === 3, String(closed));
  check("关掉的正是 1、2、3", removed.slice().sort((a, b) => a - b).join(",") === "1,2,3", removed.join(","));
  check("剩下的标签页还在（4、5、6、7）", openTabs.map((tab) => tab.id).join(",") === "4,5,6,7", openTabs.map((tab) => tab.id).join(","));

  console.log("\n── 没有可关的时候不报错 ──");
  openTabs = [];
  removed.length = 0;
  check("空白标签页集合返回 0", (await closeMatching([saved])) === 0);
  check("传入空清单也不炸", (await matches([])).length === 0 && (await closeMatching([])) === 0);

  console.log(failures ? `\n有 ${failures} 项失败` : "\n全部检查通过 🎉");
  process.exit(failures ? 1 : 0);
})();
