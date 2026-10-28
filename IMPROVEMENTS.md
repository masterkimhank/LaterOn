# 改进记录（本分支相对上游的工程记录）

- 上游基线：**1.66.1**（提交 `a1a5313`，MIT，作者 yiiiii）
- 本分支当前：**1.72.1**（fork 基线提交 `02be377`）
- 与 `CHANGELOG.md` 的分工：CHANGELOG 是**面向使用者**的发布说明（发生什么变化、怎么用）；本文件是**面向维护者**的工程记录，写清「为什么改、根因在哪、动了哪些文件、怎么验证」。
- 分支用法、提交规范、与上游同步的办法，见 `FORK.md`。

补记说明：1.67.0 ~ 1.71.0 的条目是对已有改动的回溯整理（改动发生时 CHANGELOG 已逐条记录，此处的根因、文件清单与测试数量是按代码与工作日志回补的）；1.66.1 及更早属上游作者的历史，见 `CHANGELOG.md`。

## 总览

| 版本 | 日期 | 类型 | 一句话 | 主要文件 | 新增测试 |
|---|---|---|---|---|---|
| 1.67.0 | 2026-10-23 | 新功能 | 搜索框加「全部 / 等待整理」范围开关 | `library.html` `library.css` `library.js` `i18n.js` | `library-search-scope.test.js`（24 项） |
| 1.68.0 | 2026-10-23 | 修 bug + 新功能 | 修卡片项目标签显示「等待整理」；新增删除时关标签页 | `library.js` `sidepanel.js` `tab-navigation.js` `settings.html` `theme.js` | `item-project-label.test.js`（12 项）、`close-tabs-on-delete.test.js`（约 20 项） |
| 1.69.0 | 2026-10-23 | 新功能 | 记录添加入库时的原标题；单个项目「关闭已打开」 | `background.js` `tab-navigation.js` `library.*` `i18n.js` | `tab-title-matching.test.js`、`project-close-tabs.test.js` |
| 1.70.0 | 2026-10-23 | 修 bug | GBK / Big5 站点标题与摘要乱码 | `background.js` | `gbk-charset.test.js`（31 项） |
| 1.71.0 | 2026-10-24 | 修 bug | 标题被网站「新标题」顶掉，改为保留「收藏时」那一版 | `background.js` `library.*` `sidepanel.*` `i18n.js` | `title-snapshot-background.test.js`（7 组）、`title-at-save-line.test.js`（16 项） |
| 1.72.0 | 2026-10-27 | 性能优化 | 700 条量级六项优化（渲染 / 高亮 / 下拉 / 增量更新） | `library.js` `sidepanel.js` `library.css` `sidepanel.css` | `bench-700.js`（基准）、`incremental-update.test.js`（18 项） |
| 1.72.1 | 2026-10-27 | 修 bug | 自查修掉上版优化自己带出来的 5 个问题 | `library.js` `sidepanel.js` `library.css` `sidepanel.css` | `current-highlight-persist.test.js`（14 项）、`panel-current-highlight.test.js`（护栏） |

---

## 1.67.0 — 搜索范围开关（2026-10-23）

**来源**：用户需求「目前只有全局搜索，需要添加只搜索未整理项目的搜索框」。

**决策**：确认了两点后按此实现 —— 形态选「搜索框内加范围切换」（不是加第二个输入框）；默认仍是「全部」，不改变作者「搜索必须全局」的原设计。

**改法**
- `library.html`：`.search` 由 `<label>` 改为 `<div id="searchBox">`（内含按钮，`<label>` 会把点击转发给输入框）；新增 `.search-scope` 分段开关 `[data-scope="all"|"unfiled"]`，input 补 `aria-label`。
- `library.css`：搜索框宽度 280px → `min(440px, 34vw)`；收窄时整框橙色描边 `.is-scoped`；窄屏隐藏 `⌘K`。
- `library.js`：新增状态 `searchScope` 与 `searchingInboxOnly()` / `syncSearchScopeUI()` / `setSearchScope()` / `resetSearchScope()`；`renderCardsView()` 在收窄时只取 `!item.projectId`；切换项目时自动收回「全部」。
- 文案纪律：收窄后占位文字、顶部计数、空结果提示都写明「在等待整理里」，**不允许冒充全库结论**。

**验证**：`tests/library-search-scope.test.js` 24 项；无头 Chrome 截图核对浅色 / 深色两套主题与 `⌘K` 隐藏断点。

---

## 1.68.0 — 项目标签 bug + 删除时关标签页（2026-10-23）

**问题 1（用户报的 bug）**：已经移进项目的网页，在全局搜索结果里标签仍显示「等待整理」。

**根因**：`createCard()` 调 `fillProjectSelect()` 只把选项铺进 `<select>`，**从不设 `.value`**；只有 `updateCard()` 才会设。所以任何「这一轮才新建」的卡片都停在下拉第一项。搜索时卡片正是新建的，现象最明显。

**修法**：`createCard()` 补 `projectSelect.value = item.projectId || ""`；`fillProjectSelect()` 的兜底判断改为检查 `select.options`（归档项目也能显示名字）；`refreshCardProjectOptions()` 改为按 `items` 里的 projectId 重建并选中。

**问题 2（新功能）**：删除收藏时同时关闭浏览器里对应标签页，带开关。

**修法**：`tab-navigation.js` 新增 `matches(urls)` / `closeMatching(urls)`，用 `LaterOnUrl.normalize` 比对，**只认 http/https**（不误关扩展自身页面）；设置项 `closeTabsOnDelete` 默认**关**；删除确认框先写明「同时会关掉 N 个」，批量删除按整个选中集合计算。

**验证**：`item-project-label.test.js` 12 项（**已先确认修复前会红 3 项**，避免写出「永远绿」的假测试）；`close-tabs-on-delete.test.js` 约 20 项，覆盖批量、开关热更新、URL 归一化。

**踩坑**：本机 `core.autocrlf=true`，源码正则类断言假定 LF 会红；`sed -i` 会把 `manifest.json` 的 CRLF 洗成 LF，改完必须用 node 转回。

---

## 1.69.0 — 入库原标题快照 + 单项目「关闭已打开」（2026-10-23）

**起因**：用户问「Alt+1 添加未整理会不会让页面重新加载」，并希望网址会变的站点也能对上标签页。

**先答事实**：全项目搜索 `chrome.tabs.reload` / `location.reload` **一处都没有**；`content-metadata.js` 只读 DOM，后台的 `fetch` 抓 OG 兜底也不碰标签页 —— 所以 Alt+1 不会重新加载页面。

**改法**
- 新字段 `titleAtSave`：入库那一刻的网页标题快照。写入点是 `saveItem()`（单篇 / 快捷键 / 侧栏按钮）与批量收藏的 record 创建。
- 老数据由 `backfillTitleAtSave()` 在重复收藏时补。**刻意不放进 `mergeDuplicateMetadata`** —— 那个函数的返回值语义是「内容有没有更新」，只补一个匹配用快照会被误判成更新，连带 metadata / topbook 测试变红。
- 匹配升级：`matches()` 入参从「网址字符串数组」扩展为「字符串 | 收藏条目对象」，判据 = ① `normalize` 后相同；② **同站点 + 同标题**。标题先剥掉「- 站点名」这类后缀，CJK 按权重 2 计，低于 8 视为过短（「首页」「登录」）不参与。宁可漏关，也不误关。
- 新入口：项目页右上角「关闭已打开」按钮 + 项目右键菜单项，走 `closeProjectTabs(projectId)`，**只关标签页、一条收藏都不删**。确认框写明「关闭「X」里已打开的 N 个标签页？」；一个都没开着就不弹框。

**验证**：`tab-title-matching.test.js`（纯模块单测）、`project-close-tabs.test.js`（jsdom UI 全流程）；`save-single-page` / `close-tabs-on-delete` / `folder-manage`（菜单项清单变了）各补断言。

---

## 1.70.0 — GBK / Big5 乱码（2026-10-23）

**现象**：52pojie.cn 收藏进来标题是 `�ᰮ�ƽ� - 52pojie.cn`。

**根因（实测确认）**：站点返回 `Content-Type: text/html; charset=gbk`，而 MV3 的 **`Response.text()` 永远按 UTF-8 解码**，与响应头无关 → 中文全成 U+FFFD。位置在 `refetchMetaFromServer()`。更糟的是 `applyServerMetaRescue()` 在「标题里含站点名」时就触发兜底，于是把页面里正确的中文标题覆盖成了乱码。

**修法**
- 改 `arrayBuffer()` + 自写 `decodeHtmlBuffer()`：先认响应头 `charset` → 再嗅探文档前 4KB 的 `<meta charset>`（用 `TextDecoder("latin1")` 读 ASCII 片段）→ 最后退回 UTF-8。`gb2312/gb_2312/cp936/ms936/x-gbk` 归一为 `gbk`，`cp950/x-x-big5` 归一为 `big5`。
- 防回退：`looksMojibake()`（U+FFFD / 锟斤拷 / 成片私用区字符，只认强信号）+ `recordTitle()` 入库兜底；`applyServerMetaRescue`、`mergeDuplicateMetadata`、`extractTabMetadata`、`backfillTitleAtSave` 全部接上。服务端返回乱码时绝不覆盖好标题。
- 可修复存量：对那一篇再收藏一次即可自动更正。

**验证**：`gbk-charset.test.js` 31 项，内嵌 base64 的**真实 GBK 字节**夹具 + 对照组（已确认把解码改回 UTF-8 会红 14 项）。5 个用源码正则切函数的测试补 `looksMojibake` 依赖与 `arrayBuffer` 假实现。

**连带调整**：`background-modules.test.js` 冷启动体积预算 80000 → 90000，并把计量改为**按 LF 归一后**统计（本机 CRLF 会凭空多 1822 字节）；「网页内执行的大函数不许搬回后台」三条断言保留。

---

## 1.71.0 — 「收藏时」的标题快照（2026-10-24）

**问题（B 站视频为例）**：收藏当时标题正常；几天后视频下架、再收藏一次，标题被换成「视频去哪了呢？」，原来那条真标题彻底消失。

**根因两条，都在 `background.js`**
1. `applyServerMetaRescue`：只要服务端能取到 `og:title` 就覆盖页面标题。标签页被 Chrome 回收（`tab.discarded`）或注入失败时 `titleFrom="tab"`，必然触发兜底 —— 而浏览器标签页上那时明明还显示着老标题。
2. `mergeDuplicateMetadata`：`titleHasSiteNoise` 太激进，把「标题带站名」当缺点，于是任何新标题（包括失效提示）都能替换旧标题。

**修法**
- 新增 `looksGoneTitle()` 失效页识别。中文只认固定说法（视频去哪了 / 页面不存在 / 内容已下架…）；英文只认「整条标题就是这句话」（可选 404 前缀，允许再剥一次「- 站点名」尾巴）。**刻意收紧**：「如何恢复已删除的照片」「Page Not Found 页面的设计要点」实测都不算失效页。
- 两处拦截：`applyServerMetaRescue` 在「服务端标题是失效提示 且 页面标题是正经标题」时不覆盖；`mergeDuplicateMetadata` 在「新标题是失效提示」时一律不替换。
- 快照：`extractTabMetadata` 新增返回 `pageTitle`（抢救前的页面标题）与 `browserTitle`（`tab.title`）；入库 `titleAtSave` 取 `pageTitle || browserTitle || title`。标题真被替换时，被换掉的那条也写进快照；快照只认第一次，后续不覆盖。
- 界面：卡片与侧栏在标题下加 `.title-at-save`，**只在 `titleAtSave !== title` 时显示**，平时完全不占位，文案「收藏时：{title}」；全屏页 / 侧栏 / 地址栏 `lo` 搜索都把 `titleAtSave` 纳入匹配。

**验证**：`title-snapshot-background.test.js` 7 组（含对照组与误判组）、`title-at-save-line.test.js` 16 项（jsdom，全屏页 + 侧栏）。体积预算 90000 → 96000（实测 91881）。

**踩坑**：`rememberTitleBeforeReplace()` 必须在 `mergeDuplicateMetadata` **之后**调用，且旧值只能由调用方传进来 —— merge 已经把 `existing.title` 改掉了。`.title-at-save` 用了 `display:-webkit-box`，必须配 `[hidden]{display:none}` 否则 `hidden` 失效。

---

## 1.72.0 — 700 条量级性能优化（2026-10-27）

**问题**：700 条收藏时「点一下卡一下、滚动发涩、搜索等半秒」。

**先量化再动手**：写 `tests/bench-700.js`（真实 `library.js` + jsdom，100 / 300 / 700 三档）。jsdom 绝对值比 Chrome 慢一个量级，**不对外推**，只用来看「谁跟条目数成正比、谁被重复调用了多少次」。

| 环节 | 700 条实测 | 结论 |
|---|---|---|
| 数据体积 | 345 KB（全在 `laterOnItems` 单键） | 结构问题 |
| DOM 节点 | 23,800（每卡 26 个，含 6,300 个 `<option>`） | 主要成本 |
| 图片 | 1,400（700 封面 + 700 favicon，原本无 lazy） | 次要成本 |
| 首屏铺满 | 217 / 652 / **3,186 ms**（100 / 300 / 700） | 条目 7 倍、耗时 14.7 倍，超线性 |
| 每次渲染的「当前读」高亮 | 3.2 ms × 15 批 = 48 ms | 纯浪费 |
| 重填 700 个下拉 | 61 ms | 纯浪费 |
| 后台去重 `normalizeUrl × 700` | 1.5 ms | **不是瓶颈** |

核心判断：**瓶颈不在数据量，而在「触发频率 × 每次工作量」**。点一次「标为已读」只需改 1 张卡的 2 个属性，实际却做了：重写 345KB → 广播 → 每个打开的视图重建 700 个对象 → 过滤排序 700 条 → 更新 700 张卡 → 重填 6,300 个 option → 15 批各扫 700 张卡。

**六项改动**

| # | 改动 | 位置 | 效果 |
|---|---|---|---|
| 1 | 屏外卡片跳过布局 | `.card` / `.item` 加 `content-visibility: auto` + `contain-intrinsic-size: auto …` | 真实 Chrome 收益最大（jsdom 测不出） |
| 2 | 图片懒加载 | 封面与 favicon 补 `loading="lazy" decoding="async"` | 首屏不再并发拉 1,400 张图 |
| 3 | 高亮只动两张卡 | `applyCurrentHighlight` 记 `lastHighlightId`；`renderCards` 改为整次渲染只在末尾调一次 | 3.2 ms → **0** |
| 4 | 缓存日期格式化器 | `Intl.DateTimeFormat` 提到模块级按语言缓存 | 29.2 ms → **0.8 ms**（-97%） |
| 5 | 项目下拉懒填 | 初始只放「等待整理」+ 当前归属项，首次 `pointerdown`/`focus` 才铺满 | option 6,300 → **700**，重填 60.9 → **11.9 ms** |
| 6 | 跨视图增量更新 | `diffItemsForIncremental()` 先比对出真正变了的字段 | 点已读从 700 次 DOM 更新降到只动相关卡 |

**第 6 项的安全边界（最关键）**：只要 `status` / `projectId` / `savedAt` / `source` / `read` 任一变化，或有条目增删，就**回退全量 `render()`**。因为这些字段影响「未读/已读」筛选、项目归属、排序 —— 误判增量会出现「点已读后卡片还赖在未读列表里」。只有标题 / 摘要 / 封面 / favicon 这类纯展示字段变化才走增量。

**结果**：700 条卡片视图首屏 3,186 → **2,768 ms**（-13%，jsdom 数字，`content-visibility` 的真实收益不在此列）。

**踩坑**
- `render()` 全量时卡片是**复用**的（`cardMap` 已有就走 `updateCard`，不重建节点），所以「DOM 节点引用不变」不能用来判断走了增量还是全量；要用「未读筛选下卡片是否消失」这类**行为断言**。
- 函数切片式测试里，模块级 `const`（`COLLECTION_AFFECTING_FIELDS`）必须和函数一起切，否则 `runInContext` 报未定义。
- `init()` 里「普通打开一律回首页图板视图」，基准要测卡片列表得走 `?from=sidepanel&project=unfiled`。
- 两个既有测试适配懒填语义：`cardFolderOptions` 先 `dispatch focus` 再读选项；`item-project-label` 的「移到另一项目」先 focus 再设 `value`。

---

## 1.72.1 — 自查修复（2026-10-27）

**背景**：1.72.0 的六项优化是「按测量结果动刀」，动完没有逐项回归它的副作用。这一轮专门审这些副作用，5 个问题里有 4 个是优化自己带进来的。

### ① 「正在读」高亮在切项目/筛选后永久丢失（真 bug）

**根因**：1.72.0 把 `applyCurrentHighlight()` 从「遍历全部卡片」改成「记 `lastHighlightId`，只动上一张和这一张」，开头加了一句 `if (prev === next) return;`。但卡片的 DOM 会被销毁重建 —— `renderCardsView()` 开头有 `if (!visibleIds.has(id)) { card.remove(); cardMap.delete(id); }`，当前在读的那篇被筛掉后切回来，`createCard()` 造的是全新节点（不带 `is-current`）。而 `currentItemId` 没变 → `prev === next` → 整段跳过 → 高亮永远补不上。

**修法**：去掉整段跳过，只保留「值没变就不重复写 DOM」：
```js
if (lastHighlightId && lastHighlightId !== next) { /* 清上一张 */ }
const cur = next ? cardMap.get(next) : null;
if (cur) { if (cur.dataset.currentLabel !== label) ...; if (!cur.classList.contains("is-current")) ...; }
```
成本仍是 O(1)（只碰两张卡），但不再依赖「id 没变 ⇒ 状态已正确」这个错误前提。

**验证**：新增 `tests/current-highlight-persist.test.js`（14 项）。**已反证**：把修复临时撤掉，4 项立刻变红（表现为卡片 class 只剩 `card`，没有 `is-current`）。

### ② 卡片复用 + 新项目不在下拉里 → 标签退回「等待整理」

**根因**：`updateCard()` 只有 `projectSelect.value = item.projectId`。下拉是懒填的（初始只有「等待整理」+ 当时归属项），如果归属变了而新项目还没铺进选项，`.value` 设不上（HTMLSelectElement 会退回空值）→ 显示「等待整理」。1.68.0 修的是 `createCard()` 那一路（新建卡片），这一路是**复用**的卡片：全局搜索里拖动归类、批量移动之后，卡片不重建、只走 `updateCard`。

**修法**：`updateCard()` 里先检查目标项目在不在选项里，不在就先 `fillProjectSelect(select, targetProject)` 补上再设值。补出来的仍是「等待整理 + 这一项」，不破坏懒填。

**验证**：`tests/item-project-label.test.js` 新增一段。**已反证**：撤掉修复后显示「等待整理」→ 红；恢复 → 绿。

### ③ 每改一条收藏就重建全部卡片下拉（性能回归，抵消了懒填的收益）

**根因**：`refreshCardProjectOptions()` 挂在 `renderProjects()` 末尾，而 items 每次变化都会调 `renderProjects()`（它还要更新侧栏计数）。于是点个已读 → 700 张卡各来一次 `replaceChildren()`。1.72.0 的「下拉懒填」省下的是首屏那一次，这里又把日常操作的开销还了回去，同时让「增量更新只动受影响卡片」失去意义。

**修法**：加项目指纹短路 —— `projectsFingerprint()`（id + 名字 + 归档标记 + 顺序）没变就直接 return；再在 `init()` 里初始化指纹，让首屏那次也跳过。项目真新建/改名/归档/删除时照旧全量重建。

**注意**：这条和 ② 必须一起做。先加短路会让 ② 从「潜在隐患」变成「必现 bug」（原本是 `refreshCardProjectOptions` 顺手兜住了）。

**实测**：700 条首屏 2768ms → **1974ms**；下拉重建 11.9ms → 8.9ms；累计相对上游 1.66.1 已是 3186ms → 1974ms（-38%）。

### ④ 屏外卡片高度估算偏小四成（滚动条抖动）

**根因**：1.72.0 给卡片加 `content-visibility: auto` 时填的 `contain-intrinsic-size: auto 200px` 是估的。按实际构成推算：封面 `aspect-ratio: 1.62`（列宽 190~240px → 117~148px）+ body 上下 padding 28 + 来源行 17 + 标题两行 62 + 摘要 52 + footer 52 ≈ **330~360px**。估低近四成，700 条时滚动条长度明显偏短，往下滚一截变长一截。

**修法**：改成 `auto 340px`（带「收藏时：…」那行的卡再高约 20~40px，340 取中位数）；侧栏 `.item` 同样处理，`92px → 108px`（`.copy` padding 19 + 来源行 14 + 标题两行 46 + 摘要两行 28）。

**说明**：本机 headless Chrome 的 `--dump-dom` 与 `--screenshot` 都已失效（无输出/退出码 2），无法实测像素，因此按 CSS 逐项推算并在注释里写清算式，方便以后核对。

### ⑤ 滚动时卡片反复淡入（观感卡顿）

**根因**：`.card` 上挂着 `animation: cardIn .4s ease backwards`。而 `content-visibility: auto` 让屏外卡片不进渲染树 —— 滚进视口时才开始首次渲染，那 0.4s 的淡入**正好在那一刻开始播**。700 条长列表滚起来就是一张接一张地淡入。

**修法**：动画从 `.card` 规则移到 `.grid > .card:nth-child(-n+24)`，只给首屏看得见的二十来张。副作用是拖拽重排后前 24 张可能重播一次动画（原本全部 700 张都会重播，反而变轻了）。

### ⑥ 增量判定补一道顺序检查（加固）

`diffItemsForIncremental()` 原来只比字段，不比顺序。而增量分支不重排 DOM —— 万一后台某次改写换了数组顺序（导入、同步、手工修数据），界面会停在旧顺序上，看着像「排序没生效」。加一行逐位比对，不一致就退回全量（O(n)，可忽略）。

### 一处诚实的更正

`sidepanel.js` 的 `applyCurrentAndLocate()` 里做了同样的幂等改写，但**它原本并没有这个 bug** —— 因为 `renderSlice()` 每画一条都会顺带写一次 `is-current`，把 `applyCurrentAndLocate` 的整段跳过兜住了。所以那边的改动是「消除隐式依赖」而非修 bug；`tests/panel-current-highlight.test.js` 的定位也随之写成**护栏测试**（已实测：把 sidepanel 还原成旧写法，测试仍全绿，证明原代码确实不丢高亮）。这类「看起来一样的代码，实际一个有 bug 一个没有」的差别，值得在注释里写清楚，免得以后有人照着一个改坏另一个。

---

## 仓库工程化（2026-10-29，非扩展功能改动）

这一节不改扩展行为，记的是仓库本身从「一份散着改的工作副本」变成「有历史的 fork」的过程。之前的 12 轮改动一直没进版本库，这是当时最大的风险：改坏了没有可回退的点，也说不清某一行是谁、为什么改的。

| 动作 | 结果 |
|---|---|
| 远程改名 | `origin` → `upstream`（语义正确：那是作者仓库），等自己的 GitHub fork 建好再加 `origin` |
| 新建分支 | `dev` 承载所有自己的提交；`main` 继续保持指向上游、不提交 |
| 基线提交 | `02be377`，36 个文件（12 轮改动 + 文档 + 测试），提交信息按主题分块列出 |
| 本地提交身份 | `user.name=Joehank`、`user.email=joehank@users.noreply.github.com`（仓库级，非全局） |
| 测试入口 | `scripts/test-all.js`：并发 4 跑 64 个 `tests/*.test.js`，47s，退出码反映成败 |
| 规范文档 | `FORK.md`：分支模型、五步流程、提交格式、四类记录分工、上游同步、MIT 合规 |
| 里程碑 | tag `v1.72.1-my.1`（Chrome 的 `manifest.version` 不接受后缀，后缀只用在 tag 上） |
| 备份 | 工作区外层 `LaterOn-fork-v1.72.1.bundle`（1.2MB，`git bundle verify` 通过，可完整克隆复原） |

**没做成的一件事**：`git fetch --unshallow upstream` 三次都失败——依次是
`CRYPT_E_REVOCATION_OFFLINE`（schannel 吊销检查）、`CONNECT tunnel failed 502`（本地代理没起来）、
`OpenSSL ... unexpected eof`（连接被切断）。所以本地仍是浅克隆，只有 4 个提交的历史。
影响：`git log` 看不到上游 1.66.1 之前的提交；**推送到 GitHub 前应先补全**，
否则推上去的历史会有断层。命令见 `FORK.md` 第 6 节。

---

## 待办（已提出、尚未实施）

| 项 | 说明 |
|---|---|
| 侧栏搜索范围开关 | 1.67.0 只改了全屏页，侧栏仍是纯全局搜索 |
| 侧栏「按项目关闭已打开」 | 1.69.0 的入口只在全屏页，侧栏没有 |
| P1：列表 / 详情分离 + 单条写单条 | `laterOnItems` 只留索引字段，摘要与封面按 id 分键；单键 345KB → ~80KB。需写数据迁移与老导出文件兼容 |
| P2：卡片视图虚拟滚动或「加载更多」 | 首屏从 700 张降到视口规模，5,000 条仍流畅 |
| 同站点同标题去重 | 若「标题消失」实为重新打开后 Alt+1 生成重复条目，可加去重（需具体站点复现） |
