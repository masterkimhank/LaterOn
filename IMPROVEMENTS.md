# 改进记录（本分支相对上游的工程记录）

- 上游基线：**1.66.1**（提交 `a1a5313`，MIT，作者 yiiiii）
- 本分支当前：**1.75.0**（fork 基线提交 `5270ebe`）
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
| — | 2026-10-29 | 测试基建 | 真浏览器端到端测试，补上 jsdom 测不到的界面与链路 | `scripts/test-e2e.js` `tests/e2e/*` `package.json` | 4 个 spec，72 条断言 |
| — | 2026-10-29 | 稳定性 | 固定扩展 ID，换目录/换机器不再丢数据 | `manifest.json` `scripts/extension-id.js` `tests/extension-id.test.js` `tests/e2e/extension-smoke.spec.js` `tests/release-package-hygiene.test.js` | `extension-id.test.js`（10 项）、e2e 换目录实测（2 项） |
| — | 2026-10-29 | 新功能 | 侧栏补上搜索范围开关（全部 / 等待整理） | `sidepanel.html` `sidepanel.css` `sidepanel.js` `i18n.js` | `sidepanel-search-scope.test.js`（18 项）、e2e 追加 7 项 |
| — | 2026-10-29 | 新功能 | 侧栏补上「关闭已打开」（收藏不删） | `sidepanel.html` `sidepanel.css` `sidepanel.js` | `sidepanel-close-tabs.test.js`（24 项）、e2e 新 spec（21 项） |
| — | 2026-10-29 | 性能优化 | 收藏库卡片分页：首屏一页 + 滚到底续画 | `library.js` `library.html` `library.css` `i18n.js` | `library-load-more.test.js`（30 项）、e2e 新 spec（12 项）、`card-order.test.js` 追加 7 项 |
| — | 2026-10-29 | 修复 | 同一篇文章的另一种网址被当成新条目（同站点 + 同标题 + 路径相近） | `url-utils.js` `background.js` | `article-identity.test.js`（9 组） |
| — | 2026-10-29 | 性能优化 | 收藏数据分两处存（索引 + 详情表），写一条不再重写整表 | `item-store.js` `background.js` `library.js` `sidepanel.js` `settings.js` `webdav-sync.js` | `item-store.test.js`（36 项） |
| 1.74.0 | 2026-10-30 | 发版 | 把 2026-10-29 那批改动合成一版发出去（e2e 基建 / 固定 ID / 侧栏两项 / 分页 / 认人 / 拆分）+ 发版前自查修掉 6 处 | `manifest.json` `scripts/build-release.py` `background.js` `library.js` `sidepanel.js` `tests/*` | `details-safety.test.js`（9 项）、白名单静态校验（2 项） |
| — | 2026-10-30 | 新功能 | 添加网页时的进度提示（两个界面 + 图标绿点） | `background.js` `library.html` `library.css` `library.js` `sidepanel.html` `sidepanel.css` `sidepanel.js` `i18n.js` | `save-progress.test.js`（56 项） |
| — | 2026-10-30 | 修 bug + 新功能 | 多选整组拖进项目；关闭标签页分两档、把「不会关闭」的那些单独列出来；多选加「退出多选」且点别处不再清空 | `library.js` `library.html` `library.css` `dialog.js` `dialog.css` `tab-navigation.js` `sidepanel.js` `i18n.js` | `select-group-drag.test.js`（新增，22 项）；`close-tabs-on-delete.test.js`（27 项）、`sidepanel-delete.test.js`、`select-mode.test.js` 改断言 |
| 1.75.0 | 2026-10-30 | 发版 | 把 2026-10-30 那两批改动合成一版发出去（添加进度提示 + 图标绿点 / 多选整组拖拽 + 关闭标签分两档 + 退出多选） | `manifest.json` `background.js` `library.*` `sidepanel.*` `dialog.*` `tab-navigation.js` `i18n.js` | `save-progress.test.js`（56 项）、`select-group-drag.test.js`（22 项） |

---

## 1.75.0 — 添加网页时的进度提示（2026-10-30）

**来源**：使用者反馈「添加网页时只有右上方有提示，没有进度提示，在主界面跟侧边栏加上进度提示，
可以的话在添加时扩展图标显示绿色小点表示正在工作」。

### 根因

添加一篇要抓标题 / 摘要 / 封面，`EXTRACT_TIMEOUT_MS` 给到 3 秒；「一键收藏所有标签页」是
逐篇串行（见 `runBatchSave` 的注释，串行是有意的：并发会互相抢资源、封面抓不全），
十几篇就是几十秒。这段时间**唯一的反馈**是 `showPagePills()` 注射到网页右上角的药丸，
它有三个盲区：

- 用户正盯着收藏库或侧栏时，药丸在另一个标签页上，等于没有；
- 药丸一篇一条，是**结果**不是**进度**，批量时只能靠数冒了几条来估；
- 失败时药丸一闪而过，人回头看时已经没了。

侧栏的「添加」按钮当时只是 `disabled`（`#saveCurrent:disabled{opacity:.35}`），
加上浏览器默认的禁用观感，看起来更像「点坏了」而不是「正在干活」。

### 改法

**一条广播，两个界面自己画。** 后台不认识 DOM，只广播「阶段 + 第几篇 + 共几篇 + 标题」：

- `beginSaveProgress(total, label)` → `updateSaveProgress(id, patch)` → `finishSaveProgress(id, result)`，
  状态机只有 `extract → save → done` 三档；`done` 里带 `result`（`ok / added / duplicated / title`）。
- 广播走 `chrome.runtime.sendMessage({type:"SAVE_PROGRESS"})`，**没有页面在听时它会 reject**
  （"Receiving end does not exist"），必须 `catch` 掉——进度是锦上添花，不能因为没人听就影响收藏。
- 另加 `GET_SAVE_PROGRESS`：侧栏是点图标才拉起来的，很可能收藏已经在跑，页面起步时先补一次票。

**批次号防串台。** 一次添加 = 一个自增 `id`。界面只认 `id` 不小于「收到过的最大值」的消息：
两次收藏前后脚结束时，旧那次的收尾不能把新的进度条关掉、也不能再弹一次结果。
注意判据是「收到过的最大值」而不是「当前 state 的 id」——`done` 之后 state 就清空了，
拿它比较等于没有护栏（第一版就是这么写的，测试没发现，自检时看出来）。

**什么时候开始计时。** `quickSave` 里 `beginSaveProgress` 放在「选项目浮层」**之后**：
用户可能盯着浮层犹豫半分钟，那段时间进度条一直转着，比没有更让人困惑。
`runBatchSave` 同理，放在逐篇循环之前而不是函数入口。

**图标绿点。** `applyWorkingIcon(true)` 用 `OffscreenCanvas` 把 `icon32.png` 画一遍，
在右下角盖一个白边绿点（白边是必要的：图标深浅不定，纯绿点压在深色图标上会糊），
`getImageData()` 交给 `chrome.action.setIcon({imageData})`——运行时合成，不新增图片文件。
结束时 `setIcon({path: DEFAULT_ACTION_ICON})` 恢复原图。

**串行队列（踩过的坑）。** `begin` 里是 `void setWorkingIcon(true)`（不 await，别拖慢收藏），
`finish` 里要 `await setWorkingIcon(false)`。两次调用并行跑的话，收尾可能先落地、
绿点再被画上去，图标就一直绿着了。所以 `setWorkingIcon` 内部挂了一条 promise 链串行执行。

### 动到的文件

| 文件 | 改了什么 |
|---|---|
| `background.js` | 进度状态机 + 广播 + `GET_SAVE_PROGRESS`；绿点图标合成与串行队列；`quickSave` 包 try/finally（失败也要收尾）、`runBatchSave` 每篇推一次 done |
| `sidepanel.html/.css/.js` | 一行状态（转圈 + 文字 + 秒表）、按钮 `is-working` 转圈态；收到 `done` 停 2.6 秒自己收起 |
| `library.html/.css/.js` | 顶部 2px 进度条 + 右下角胶囊；`done` 换成页面自己的 toast |
| `i18n.js` | 10 条中英文案（单篇 / 多篇分开写：多篇带 `3/12`，单篇带上反而像出错） |
| `tests/background-modules.test.js` | 体积预算 102000 → 110000（这次 +7.2KB，比前几次都肥） |
| `tests/save-progress.test.js` | 新增，56 项 |

### 验证与反证

- 单元测试 78/78（新增 `save-progress.test.js`），端到端 6/6 spec。
- 反证三次，都确认断言会真红：
  1. 去掉 `finishSaveProgress` 里的 `broadcastSaveProgress` → 后台 4 条红（「最后一条是收尾 done」「收尾带了结果」「抛错也要广播收尾」「收尾里写明失败」）；
  2. 删掉 `sidepanel.css` 的 `.save-progress[hidden]{display:none}` → 1 条红；
  3. 把侧栏的 `total === 1` 放宽成 `total >= 1` → 「整窗收藏时添加按钮不跟着转圈」红。
- **真浏览器截图时抓到一个 jsdom 抓不到的问题**：`.save-progress` 一开始写成
  `inset: 0 0 auto`（高度只有那条 2px），而胶囊是它的绝对定位子元素（`bottom:82px`）——
  参照系只有 2px 高，胶囊被推到屏幕上方，整块看不见。改成 `inset: 0` 铺满视口
  （配 `pointer-events:none`，不影响点击），并加了一条静态 CSS 断言钉住这件事。
- 同一次截图还改了两处观感：进度条渐变原来掺了绿色（这套界面里绿 = 已完成，不能拿来表示
  「正在跑」），改成深浅橙来回扫；计数文案后面多个「…」再接标题很别扭，多篇版本去掉了它。

### 考虑过但没做的

- **不做 `chrome.storage.session` 镜像进度**：能解决「页面晚于收藏打开」时的接不上，
  但 `GET_SAVE_PROGRESS` 已经覆盖了这个场景，多一份状态就多一处不一致的可能。
- **不把进度抽成共享模块**：两个页面要画的结构不一样（一行文字 vs 进度条 + 胶囊），
  真正共享的只有文案拼接那十几行。抽成新文件反而要再动一次打包白名单——
  而白名单漏文件正是 1.74.0 刚踩过的坑。

---

## 1.75.0 — 多选整组拖拽 + 关闭标签分两档（2026-10-30）

**来源**：使用者一次提了四件事——
「多选以后拖动卡片不会聚拢，然后无法一起拖到项目里面，判断标签聚拢拖动到项目是否容易实现；
如果删除标签时，关闭的标签与所选标签不一致，在关闭弹窗把不需要关闭标签的页面单独显示出来；
进入多选模式后，在选择的右边增加一个退出多选的按钮，点击其他地方不会退出多选，页面可以正常下滑」。

第一条附带一个判断请求（「是否容易实现」），结论是**容易**，见下面「为什么这个不难」。

### 根因

**① 多选拖不动一组，是 `dragstart` 主动把多选关掉了。**
`enableReorder()` 的 dragstart 第一行就是 `if (selectMode) setSelectMode(false)`——本意是
「拖拽是另一种操作，别留着旧勾选」，代价是多选一旦成立就再也拖不动整体。即使跳过这一步，
后面还有两道各自只认一张：`dataTransfer.setData("text/plain", id)` 只放被拖那张的 id，
`enableDropTarget()` 的 drop 也只 `getData("text/plain")` 然后 `updateItem(itemId, …)`。

**② 「关闭的标签和所选的不一致」，是两档匹配混在一个数组里返回。**
`tab-navigation.js` 的 `matches()` 有两道判据：网址相同（走 `normalize`，跨 www / utm 算同一篇），
以及「网址对不上但同站点同标题」（有些站点每次打开的网址都会变，只能靠标题认）。
这两档性质完全不同——前者确定是同一篇，后者是猜的——但 `matches()` 把它们**拼成一个数组**返回，
于是 `countOpenTabs()` 数的是两者之和、`closeMatching()` 关的也是两者之和。
日报类站点每天标题都一样：删掉选中的 A，会连带关掉同站点另一篇同名文章，
而确认框只写「会关掉 3 个」，用户数不出是哪三个，只觉得「关错了」。

**③ 退出多选只有一条隐式规则。** 没有任何按钮，全靠 `document` 上的 `pointerdown` 捕获：
点在 `.card / #bulkBar / #selectMode` 之外就退出。挑卡片本来就要点来点去（滚下去找、
点开看看、换个筛选），一次误触就把整批勾选清空，而且没有任何提示。

**④ 那条 `pointerdown` 连滚动都算。** 滚动从注册在捕获阶段——手指/光标在空白处按下开始滚，就已经
`setSelectMode(false)` + `clearSelection()` 了。用户感受到的是「一滑就没了」。

### 改法

**分档，而不是加一个开关。** `tab-navigation.js` 新增 `inspect(pages)`，返回
`{ exact, fuzzy }`：

- `exact`：`comparable(url)` 相等 —— 删收藏时一起关；
- `fuzzy`：同站点 + 同标题 —— **列出来给人看，默认不关**。

`matches()` 保留（= 两档合并），`closeMatching()` 改成 `closeTabs(await matches())`，
另外新增 `closeTabs(tabs)` 直接按标签页数组关。删除路径改用 `inspect()` + `closeTabs(exact)`：
「数」和「关」都只看 exact，两者永远一致。

**弹窗里分两组列出来。** `dialog.js` 加了一个 `notice` 配置（只读清单，不参与返回值）：

```js
notice: [
  { tone: "close", title: "会一起关掉 2 个打开的标签页", items: [{ title, meta: domain }] },
  { tone: "keep",  title: "另有 1 个只是标题相同…不会关闭", items: [...] }
]
```

- 每组最多显示 5 条，多的收成「还有 N 个…」——弹窗不能被清单撑爆；
- 两档视觉分开：`close` 左侧一条危险色竖线，`keep` 只有描边 + 压灰，标题本身就写着「不会关闭」；
- 清单生成放在 `tab-navigation.js` 的 `noticeGroups()`，因为**只有它知道两档的含义**，
  而全屏收藏库和侧边栏必须用同一套说法（`sidepanel.js` 的删除走同一个函数）。

**整组拖拽。** `enableReorder()` 加 `supportsMulti`（只有网格传 true，图板没有多选）：

- dragstart 里先判断 `asGroup = supportsMulti && selectMode && selectedIds.size > 1 && selectedIds.has(id)`；
  是整组就不退出多选，否则照旧退出（拖一张没选中的 = 只想挪这一张）；
- 拖影：`buildGroupDragPreview()` 在同一个浮层里画三层——最上面是卡片克隆，下面两层错开的空壳，
  右上角 `+N`。**浏览器一次只允许挂一个 drag image**，所谓「聚拢」只能画出来；
- 列表侧：`.grid.is-group-dragging .card.selected:not(.dragging)` 缩到 .93 + 透明度 .3。
  只用 `transform` + `opacity`（不占布局），所以那套「拖动开始时拍一次坐标快照」的判定不受影响；
- 整组拖拽**不拍快照、不参与列表内重排**：一叠卡片没有「插到第几个」这回事，
  拍下来反而会让 `dragover` 去写 inline `transform`，把上面那条 CSS 效果顶掉；
- 落点：`enableDropTarget()` 的 drop 先读 `groupDragIds`（内存里那一份；
  dataTransfer 的自定义类型照样 set，但 dragover 阶段浏览器给的是保护模式、`getData` 读不到），
  长度 > 1 就走 `commitItemMutation("update", ids, { projectId })` 一次批量写，然后 `finishBulk()`。

**退出多选。** `library.html` 在 `#selectMode` 右边加 `#exitSelectMode`（`hidden` 由
`setSelectMode()` 控制），删掉那段 `pointerdown` 监听。退出只剩三个入口：
这个按钮、底部工具栏的「完成」、Esc。

### 为什么这个不难

浏览器只给一个 drag image，所以「一叠跟着走」必须画在一个浮层里——但那只是画三层错开的壳、
加个角标，没有额外 API。真正要处理的只有两件事：

1. **拖拽判定和重排要解耦**：组拖拽不拍快照、不写 inline transform，否则和「缩小淡出」打架；
2. **落到项目行要改成批量写**：drop 里从「读一个 id」变成「读一组 id」，一次
   `MUTATE_ITEMS` 就完事（后台本来就支持 ids 数组）。

没有跨组件通信、没有新依赖、没有新的存储字段。工作量集中在一个函数（`enableReorder`）
和一条 drop 分支上。

### 动到的文件

| 文件 | 改了什么 |
|---|---|
| `tab-navigation.js` | `inspect()` 分两档；`closeTabs()`；`noticeGroups()` / `noticeEntries()` 生成清单 |
| `dialog.js` / `dialog.css` | `notice` 只读清单区（分组、截断、超量收成活点） |
| `library.js` | 整组拖拽（`groupDragIds` / `buildGroupDragPreview` / `is-group-dragging` / 批量 drop）；删除路径改 `inspect` + `closeTabs(exact)`；`#exitSelectMode`；删掉 `pointerdown` 退出 |
| `library.html` / `library.css` | 「退出多选」按钮；整组拖影与聚拢样式 |
| `sidepanel.js` | 删除弹窗同样走两档清单，只关 exact |
| `i18n.js` | `tabsWillClose` / `tabsKeepSameTitle` / `tabsWillCloseSameTitle` / `noticeMore` / `exitSelect`（删掉废弃的 `deleteWillCloseTabs`） |
| `tests/select-group-drag.test.js` | 新增，22 项 |
| `tests/close-tabs-on-delete.test.js` | 改断言：清单两档、网址变了那档「列出来但不关」 |
| `tests/sidepanel-delete.test.js` | 改断言；桩里加载真实的 `tab-navigation.js` + `url-utils.js` |
| `tests/select-mode.test.js` | 「点空白退出」改成「点空白不清空，按钮才退出」 |

### 验证与反证

- 单元测试 **79/79**（新增 `select-group-drag.test.js`），端到端 **6/6 spec**。
- 反证三次，都确认断言会真红：
  1. 把 `asGroup` 写死成 `false` + 批量 drop 分支写死成 `false` → 8 条红，
     其中「两张都进了项目一」实际只搬了一张（`{"a":"p1","b":null,"c":null}`）——正是这个 bug 的原貌；
  2. 把 `fuzzy` 也 `push` 进 `exact`（回到两档合并）→ 3 条红，
     那条「只是标题相同」的标签页真的被关掉了（`71`）；
  3. 把 `pointerdown` 退出加回去 → 「点空白处不清空选择」红（`已选 0 篇`）。
- **真 Chromium 实测**（临时脚本，跑完即删）：
  - 退出按钮在「选择」右边 73px 处、同高 32px；
  - 多选状态下滚轮滚动 `0 → 94`、仍在多选、计数仍是「已选 3 篇」；
  - 真实拖拽中：`is-group-dragging` 生效、`.drag-group-preview` 存在、角标 `+2`、
    另两张 `opacity: 0.3`；落在「工作」项目行后三条全部 `projectId: "p1"`，
    多选退出，提示「已将 3 篇移到「工作」」，控制台无错误。
- 顺带记一个测试坑：`vm.createContext()` 里**没有 `URL`**（它是宿主提供的，不是 JS 内置），
  于是 `tab-navigation.js` 里 `new URL()` 抛错、被自己的 `catch` 吞成「认不出网址」，
  所有标签页都匹配不上——测试会绿得毫无意义。`sidepanel-delete.test.js` 里显式注入了 `URL`。

### 考虑过但没做的

- **多选时不支持在列表内整组重排**：一叠卡片丢回列表中间没有明确落点（插到第几个？），
  硬做需要定义「整组插入的位置如何摊开」，收益低、歧义大。要排顺序先退出多选。
- **不给「仅标题相同」那档加勾选框**：默认不关已经解决了误关，加复选会把 `confirm`
  变成半个表单（`dialog.js` 里要引入 `values` 返回），多一层状态。真想把那个也关掉，手动关一下。
- **「关闭已打开」仍两档都关**：用户点它的意图是「把这个项目收干净」，漏关比多关更烦人；
  但清单照样分两档列出来（`closeFuzzy: true` 时第二组也标成会关），让人看见有这一档。

---

## 1.74.0 — 固定扩展 ID（2026-10-29）

**来源**：分析 `NHZEX/LaterOn-browser-ext` 时发现对方在 manifest 里带 `key`，对比之下我们这里是个空白。

### 根因

开发者模式加载的扩展，manifest 里没有 `key` 时，Chrome 用**扩展目录的绝对路径**派生 ID：
对路径做 SHA-256，取前 16 字节，每个半字节映射成 `a`–`p`。而 `chrome.storage.local`
是按扩展 ID 隔离的 —— 同一份代码放在两个目录里，就是两个互不相干的扩展。

后果都落在使用者身上，而且**不报错**：

- 按 README 装好，某天把文件夹从 `Downloads\LaterOn-1.73.0` 挪到 `D:\Extensions\LaterOn` →
  打开侧栏是空的，看起来像「数据丢了」。数据其实还在旧 ID 底下，但没有任何入口能读回来。
- 换机器时在新电脑上解压到别的路径 → 备份文件不导入就什么也没有。
- 我们自己在做 e2e 时也踩到：每个临时 profile 目录不同，ID 就不同，只能靠 profile 隔离，
  没法用「同一份 profile 换目录」去验证数据迁移。

这不是 Chrome 的 bug，是设计如此；但对我们「发 ZIP + 开发者模式安装」的分发方式来说，
这个代价没有一个用户能自己解决。

### 改法

1. 生成 RSA-2048 密钥对，把公钥 DER 的 base64 写进 `manifest.json` 顶层的 `key`。
   浏览器此后用公钥算 ID，与目录无关。
2. 私钥 `extension-key.pem` 只留在本机，写进 `.gitignore`。它只在要签 `.crx`、上 Chrome
   商店时才用得上；`manifest.key`（公钥）才是让 ID 固定的东西，公开无妨。
3. 新增 `scripts/extension-id.js`：`--generate` 生成密钥对并打印要粘贴的那一行；
   不带参数时报当前 ID，并核对本机私钥与 manifest 公钥是否配对（防止拿错私钥去签名）。
4. ID 钉成常量 `ahfghclmnedaflabdpffhdbbdhjikjme`，在单测和 e2e 里都硬编码。

### 动到的文件

| 文件 | 改动 |
|---|---|
| `manifest.json` | 新增 `key` 字段（392 字符 base64） |
| `scripts/extension-id.js` | 新增：ID 计算、密钥生成、公钥/私钥一致性核对 |
| `tests/extension-id.test.js` | 新增：算法向量、manifest 合法性、ID 常量、私钥排除 |
| `tests/e2e/extension-smoke.spec.js` | 断言浏览器实际分配的 ID == 常量 == 由 key 推出；解压发布包到另一目录后 ID 不变、收藏还在 |
| `tests/e2e/helpers.js` | `launchExtension` 支持 `extensionPath`（加载别的目录）与 `profileDir` + `close({keepProfile})`（两次启动共用一份 profile） |
| `tests/release-package-hygiene.test.js` | 解压真实发布包，核对包内 manifest 保留 key、ID 一致、且不含 `.pem` |
| `.gitignore` | 排除 `extension-key.pem` / `*.pem` |

### 验证

**反向实验**（先确认测试真的能抓到这个问题）。临时从 manifest 里删掉 `key`，跑同一个 spec：

| 状态 | 开发目录 ID | 发布包解压到另一目录 | 收藏 |
|---|---|---|---|
| 有 `key` | `ahfghclmnedaflabdpffhdbbdhjikjme` | 同一个 ID | 读得到 |
| 删掉 `key` | `mefafiafkjniohmmolmifkedccapmfmp` | `fienldbkjdegnikginbeebhkckdancdh` | 读不到 |

删 `key` 时恰好 5 条断言报红，全部是「固定 ID」相关的那几条，其余 20 条不受影响；
恢复后 25/25 通过。单测那边也做了同样的反向实验：改坏 `key` 报 3 项，恢复后 10/10。

**ID 算法交叉验证**：同一份公钥用两条互不相干的路径算，结果必须一致 ——

- `node scripts/extension-id.js`：SHA-256 → 取前 16 字节 → 半字节映射
- `openssl pkey -in extension-key.pem -pubout -outform DER | openssl dgst -sha256 -r | cut -c1-32 | tr '0123456789abcdef' 'abcdefghijklmnop'`

两条都得 `ahfghclmnedaflabdpffhdbbdhjikjme`。单测里的算法向量同样刻意硬编码字面量
（sha256 空输入 → `odlameecjipmbmbejkplpemijjgpljce`），而不是拿被测函数现算 ——
否则就是拿自己的输出证明自己。

**全量**：单测 71/71（52s），e2e 4/4（75s）。

### 踩坑

1. **算法向量不能自证**。第一版用 `EMPTY_SHA256_PREFIX.replace(...)` 现算期望值，
   和被测函数用的是同一个映射，永远相等。改成硬编码后又发现手算错了 8 处
   （映射是 `0→a`…`f→p`，我按 `0→a`…`9→j` 之外又错位算了一遍），最后用 `tr` 核对的。
2. **`python -c "print(json.dumps(字符串))"` 再 `JSON.parse` 得到的是字符串，不是对象**。
   读 zip 里的 manifest 时踩到：`packedManifest.key` 恒为 `undefined`，报错还指向别处。
   改成 `sys.stdout.write(...)` 直接吐原文。
3. **测试断言别让一个异常带走整组**。`idFromManifestKey` 在 key 缺失时抛错，
   第一版直接让整个 spec 异常中止，只看到一行「异常中止」，看不出是哪几项。
   改成接住异常、转成一条失败项，反证时才看得到完整的 5 条红。
4. **迁移顺序不能反**。加 key 之后老用户的 ID 会变，旧数据仍留在旧 ID 下但读不出来。
   必须「先导出 JSON → 再重新加载 → 再导入」，写反了就只能去 profile 的
   `Local Extension Settings/<旧 ID>/` 手动捞 leveldb。这一点只能靠文档提前说清。

---

## 1.74.0 — 侧栏搜索范围开关（2026-10-29）

**来源**：1.67.0 只给完整界面加了「全部 / 等待整理」范围开关，侧栏一直缺（记在待办里）。

### 根因

侧栏 `render()` 里把「搜索是全局的」写成了硬编码：

```js
const matchesProject = !!query
  || activeProject === "all"
  || (activeProject === "unfiled" ? !item.projectId : item.projectId === activeProject);
```

`!!query` 一旦为真就短路成 `true`，范围概念根本不存在。这本身是**正确**的默认（全局搜索），
问题在于没有任何办法临时收窄 —— 整理待整理时想知道「这条归好类没有」，全库结果里混着已经
归好类的条目，反而看不出来。

### 改法

把 `!!query` 换成三态判断，并补一套和完整界面同语义的状态：

```js
const matchesProject = query
  ? (searchingInboxOnly() ? !item.projectId : true)
  : (activeProject === "all"
      || (activeProject === "unfiled" ? !item.projectId : item.projectId === activeProject));
```

- `searchScope` 不持久化：它是一个临时的观察角度，不是设置项。关掉侧栏就该忘掉。
- 拨动时同步三件事：开关高亮、输入框占位文字（「搜索等待整理」）、搜索框描边（`is-scoped`，橙边）。
- 切项目时 `resetSearchScope()` 收回默认档 —— 两处触发：点项目筛选条、另一个视图改了项目
  （`onChanged` 里的 `ACTIVE_PROJECT_KEY` 分支）。
- 空结果的说法分档：`syncEmptyText()` 按「有没有搜索词 × 范围」选文案，不再一律
  「还没有添加的网页」。

### 动到的文件

| 文件 | 改动 |
|---|---|
| `sidepanel.html` | `.search` 由 `<label>` 改成 `<div role="search">`，加入 `.search-scope` 两个按钮；骨架屏 `.sk-search` 高度 36 → 43px |
| `sidepanel.css` | 输入框改 `flex:1 1 auto`（给开关让位）、`.search-scope` / `.scope-option` / `.is-scoped` 样式 |
| `sidepanel.js` | `searchScope` 状态、`searchingInboxOnly` / `syncSearchScopeUI` / `setSearchScope` / `resetSearchScope` / `syncEmptyText`；`render()` 三态判断；切项目两处重置；语言就绪后补一次 UI 同步 |
| `i18n.js` | 新增 `sideNoMatchesHint`（中英），因为完整界面那句写的是「切换**顶部**的筛选」，侧栏的筛选在搜索框下面 |
| `tests/sidepanel-search-scope.test.js` | 新增 18 项 |
| `tests/e2e/sidepanel-render.spec.js` | 新增 7 项（真点击、真收窄、320px 不溢出） |

### 验证

反向实验：把 `render()` 里的三态判断改回 `? true`（等于范围开关不生效），
`sidepanel-search-scope.test.js` 恰好 6 条报红，恢复后 18/18。

e2e 里 `page.locator('.scope-option[data-scope="unfiled"]').click()` 被遮挡会直接超时，
所以「点得动」这件事是顺带被证明的，不需要额外断言。

320px 实测：`scrollWidth=320 / clientWidth=320`，输入框仍有 171px（开关占 86px），不溢出。

### 踩坑

1. **`.search` 原来是 `<label>`，里面放按钮会把点击转发给输入框**。完整界面当年已经踩过
   这个坑（那里留了注释），侧栏照抄结论换成 `div`，并把「点图标/留白聚焦输入框」这条
   手动补回来（`searchBox` 上挂 click，排除 `.scope-option`）。单测里专门断言了
   `#searchBox` 的 `tagName === "DIV"`，防止有人改回去。
2. **骨架屏高度是写死的**。`.sk-search { height: 36px }` 对上的是旧搜索框（35px），
   加了开关之后真界面变成 43px，首屏会看到骨架比真内容矮 7px、然后跳一下。已同步改 43。
3. **空状态文案不能直接复用完整界面那句**。`noMatchesHint` 写的是「切换**顶部**的阅读状态
   筛选」，而侧栏的「未读 / 已读」在搜索框**下面**。照搬会让人往上看。新增
   `sideNoMatchesHint`，并在测试里断言它包含「下面」且不含「顶部」。
4. **e2e 里 `waitFor(n === 3)` 可能等到的是「旧状态」**。追加数据后我原本等 3 条，
   而旧数据本来就是 3 条 —— 条件立刻成立，新数据其实还没渲染，后面点开关就等不到 2 条、
   超时失败。改成等 4 条（新数据到达才可能出现的值）。这类「假等待」静默吞掉一次真实的
   失败，比报错更难查。

---

## 1.74.0 — 侧栏「关闭已打开」（2026-10-29）

**来源**：1.69.0 给完整界面做了「关闭已打开」（`library.js` 的 `closeProjectTabs`），
侧栏一直缺（记在待办里）。

### 根因

这个功能的两块料其实早就在侧栏手边：`tab-navigation.js` 已经随侧栏加载（1.68.0 起用于
「删除时顺带关标签」），`LaterOnDialog` 也已经在用（编辑、删除）。缺的只是一个入口和
一段把「当前项目 → 要关的标签页」连起来的逻辑。侧栏里 `rg closeOpenTabs`、`closeProjectTabs`
零命中。

真正的障碍是**放哪儿**：侧栏宽度下限 320px，筛选行已经放着三个阅读档 + 计数，
英文界面里计数会写成「1,024 pages」，再塞一个「关闭已打开」的胶囊必然换行。

### 改法

- 入口放在 `.filter-row` 右侧、紧跟计数，用 **22px 图标按钮**（窗口 + 叉），
  `title` / `aria-label` 用已有的 `closeProjectTabsHint`。位置和理由与卡片上的编辑/删除同族。
- 行为照抄完整界面那套：`matches()` 先数 → 一个都没开着就只说一句、不弹框 →
  确认框写明项目名和数量 → `closeMatching()` 真关。
- `projectScopeItems(projectId)` 决定范围：`unfiled` = 没有 `projectId` 的，其余按 id 精确匹配。
  归档项目里的收藏本来就不在列表里，不参与。
- **不看 `closeTabsOnDelete`**：那个设置管的是「删除收藏时顺带关标签」，而这个按钮本身就是
  在要求关标签，跟删除无关。完整界面也是这么做的。
- 侧栏没有 toast，结果写进顶部 `#status`（和删除、编辑一致）。
- `closeTabsBusy` 挡连点：确认框是异步的，连点两下会弹出两个框、关两遍。
- 可见性：`syncCloseTabsButton()` 在 `render()` 里调。HTML 上先写 `hidden`，免得骨架屏阶段
  先闪一下再消失。

### 动到的文件

| 文件 | 改动 |
|---|---|
| `sidepanel.html` | 筛选行右侧加 `.filter-meta` 包住计数 + `#closeProjectTabs`（图标按钮，初始 `hidden`） |
| `sidepanel.css` | `.filter-meta`、`.close-tabs`（22px 图标按钮）、`.close-tabs[hidden]` |
| `sidepanel.js` | `activeProjectLabel` / `projectScopeItems` / `syncCloseTabsButton` / `closeTabsForActiveProject`、`closeTabsBusy`、点击监听、`render()` 里同步可见性；顺手删掉 `render()` 里一段重复的过期注释 |
| `tests/sidepanel-close-tabs.test.js` | 新增 24 项（jsdom + 一份可变的假标签页列表） |
| `tests/e2e/sidepanel-close-tabs.spec.js` | 新增 21 项（真标签页、真确认框、真关闭） |

### 验证

三次反向实验（都先做坏，确认断言抓得住，再恢复）：

| 做坏的方式 | 结果 |
|---|---|
| `projectScopeItems()` 改成 `return items`（范围失效） | e2e 3 条报红（含「工作项目那个 c 还开着」），单测 6 条报红 |
| 删掉 `.close-tabs[hidden] { display:none; }` | e2e 1 条报红（`display === "grid"`），单测 1 条报红 |
| 确认后顺手 `laterOnItems: []` | e2e 3 条报红（「收藏还是 3 条」等） |

实测：`node scripts/test-all.js` → 73/73（50s）；`node scripts/test-e2e.js` → 5/5（91s，
共 105 条断言）。320px 实测 `scrollWidth=320 / clientWidth=320`，按钮右边缘 306px，筛选行 25px 单行。

### 踩坑

1. **自己写了 `display` 就得自己管 `hidden`**。`.close-tabs { display:grid }` 会压过浏览器
   默认的 `[hidden]{display:none}`，按钮在「不该出现」的时候照样显示。`library.css` 里早有
   同样的注释（1.69.0 踩过），这次直接照做。单测读 CSS 文本不够——选择器写错、被后面的规则
   覆盖都看不出来，所以 e2e 里在真浏览器中设一次 `hidden` 看 `getComputedStyle`。
2. **e2e 里「另一个标签还开着」这条在反证时没报红**。原因是我在 `chrome.tabs.remove` 落定
   之前就读了 `isClosed()`，那一刻它当然还是 false，断言恒真、等于没测。改成先等 `#status`
   出现「已关闭」（它是所有 remove 结束后才写的），再检查。**没跑反证的测试，不能算测过。**
3. **单测里确认框的桩默认返回 `true`**，第 3 节想「只看确认框写了什么」，结果顺手把后面两节
   要用的标签页真关了，第 5 节直接测不到东西。桩要先设成 `false`，并把这个理由写进注释。
4. **侧栏寄居的那个标签页会不会被一起关掉**。`manifest` 里 `side_panel` 只有 `default_path`
   （窗口级，不是 `per-tab`），关掉当前标签页侧栏不会消失——但那一页很可能正是用户在读的。
   确认框因此把话说全：「关闭「X」里已打开的 N 个标签页？……收藏一条都不会删」。
5. **侧栏永远没有「全部项目 / 归档」**（`normalizeProject` 会把它们折回「等待整理」），
   所以这颗按钮实际上一直在。`syncCloseTabsButton()` 里那两个判断是护栏，不是当前分支。

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

## 1.73.0 — 多设备同步 + 发版流水线（2026-10-29）

这一轮做的是「别人已经想清楚的事」：参考 `pasiooooo/LaterOn`（同源 fork，1.66.1 分叉，MIT）在 1.67.x 里的多设备同步与自动发版。它的实现思路是对的，但有两处会在真实多设备场景下丢数据，抄的时候补掉了。

### ① 侧栏透明封面透出橙色 Logo 砖

**根因**：`.thumb` 里同时存在「占位（橙色渐变 + Logo）」和「封面图」，封面用 `position:absolute; z-index:1` 盖在占位上。不透明 JPEG 看不出问题，**透明 PNG / SVG 会透出底下的渐变和 Logo**，看上去像封面坏了。

**修法**：不再叠层，改成「有封面就隐藏占位」。封面本来就 `thumb.prepend()` 插在占位**前面**，所以一条相邻兄弟选择器就够：

```css
.thumb-img ~ .thumb-placeholder { display:none; }
```

坏图降级链走完被 `image.remove()` 之后，占位自动重新出现，不需要额外 JS。

**踩坑**：全屏页 `library.js` 早就用 `cover.replaceChildren(img)` 把占位整个换掉了，所以只有侧栏有这个 bug —— 两处实现不一致，光看一个文件会以为已经修过。

### ② 打包脚本漏检子目录里的垃圾文件（真 bug）

**根因**：`FORBIDDEN_NAMES` 里存的是裸文件名（`.DS_Store`），但 `validate_archive()` 拿**包内相对路径**（`_locales/en/.DS_Store`）去比对，永远比不中；而 `RUNTIME_DIRS` 的 `_locales` 是整棵收进来的，`release_files()` 也没过滤。

**反证**（把两处临时退回旧写法跑新测试）：

| | 文件数 | 结果 |
|---|---|---|
| 旧写法 | **38**（基线 36） | 两个 `.DS_Store` 进包，校验环节仍然打印 "Verified: no tests, design drafts, previews, documentation, .DS_Store" |
| 只改 `validate_archive` | 38 | 构建直接失败（挡住是挡住了，但发不出去） |
| 两处都改 | 36 | 静默过滤，构建成功 |

**修法**：`release_files()` 里 `path.name not in FORBIDDEN_NAMES`，`validate_archive()` 里 `Path(name).name in FORBIDDEN_NAMES`。

### ③ 多设备同步：为什么是「按记录合并」而不是整份覆盖

整份 JSON 覆盖是这类功能最常见的写法，也是丢数据最快的方式：A 设备改了标题、B 设备加了收藏，谁后传谁的版本就赢，另一个人的改动直接没了。

参考实现的模型值得照搬：

| 设计 | 做法 | 解决什么 |
|---|---|---|
| 合并粒度 | 每条 item / project 一条记录 | 两台设备改不同条目互不影响 |
| 冲突判定 | `stamp = [逻辑时钟, 设备ID]` | 系统时间被改也不会乱序 |
| 平局 | 时钟 → 设备ID → 内容哈希 | 两端各算一遍结果相同，不需要协商 |
| 删除 | 墓碑 `deleted:true`，永不清理 | 离线设备回来不会「复活」删除的内容 |
| 传输 | delta：只传与基线不同的记录 | 700 条改 1 条只传 1 条 |
| 云端格式 | 每天一个 `lateron-backup-YYYY-MM-DD.json`，就是导出 JSON | 任一份都能手动导入，出问题能自救 |

**和本项目数据的对接点**：导出格式早就是 `type:"lateron-backup" / version:2`、文件名也是按天，所以复用不需要迁移。只补了两处：
- `backup()` 里加 `readingPositions`（设置页导出/导入同步补上，老文件没有该字段时按空处理）
- `validValue()` 的收藏白名单加 `titleAtSave`（本项目 1.71.0 的字段，参考实现没有）

### ④ 对参考实现的两处补强

**a) 并发写会互相覆盖（原实现没有条件写入）**

原流程是「GET 最新 → 合并 → 整份 PUT」，注释里明确写「不依赖 ETag 或条件写入」，只在 PUT 后 GET 回来跟自己写的字节比。问题：两台设备同一分钟同步时，后写的那台把先写的整份盖掉，而**回读自检永远发现不了**（它读到的正是自己刚写的）。

修法：读到 ETag 就带 `If-Match`，新建当天文件用 `If-None-Match: *`；收到 `412` 就重读最新、重新合并，最多 5 次，仍然抢不过就报 `syncConflict` 并保持云端原样。服务器不给 ETag 时退化为回读校验（行为与原实现一致），不假装有并发保护。

测试用内存版 WebDAV 服务器模拟「PUT 前另一台设备抢先写」：修复前那条 `remote-only` 会被抹掉，修复后四条都在（`local-a/b/c` + `remote-only`）。

**b) 把「属性不存在」的 404 当成畸形响应**

原 `names()` 里，只要某条 response 的各种 `status` 里没有 2xx 就 `throw syncInvalidListing`。但 WebDAV 允许服务器对「某个属性不存在」单独回一个 404 的 `propstat`（很常见），这时整次目录列举就会失败、同步永久卡在错误状态。

修法：没有 2xx 就**跳过这条**，不判整个文档畸形。真正的畸形（DTD、实体、标签不配对、两个根节点）仍然一律拒绝 —— 这部分原实现写得很稳，原样保留。

### ⑤ 发版流水线：推 tag 自动发版，说明只有一份实现

**问题**：`release.js` 只能在本机跑，而本机推送依赖 `http.proxy=127.0.0.1:7897` + `sslBackend=openssl` 这套环境；换台电脑就没法发版。

**改法**：
- `.github/workflows/release.yml`：推 `v*` tag 或手动指定已有 tag → 校验 tag↔manifest 版本 → 跑测试（jsdom 装不上则跳过并告警，发版门禁仍在本地）→ `build-release.py` 打包 → `gh release create --verify-tag`
- `scripts/release-notes.js`：把「从 CHANGELOG 抽段落 + 版本一致性校验 + 安装说明」抽成一份，`release.js` 与 CI 都 `require` 它，避免两边发出的说明不一样
- 标题带 `-my.N`（`1.73.0-my.1`），否则同一个版本号发过两次，Releases 列表会出现两条一模一样的标题

**tag 规则**：`manifest.version` 只认数字和点，所以序号只能挂在 git tag 上：`v<版本>-my.<序号>`。CI 里从 tag 推 zip 名（`${TAG#v}` 再掐掉 `-my.*`）。

### ⑥ 新增 / 改动的文件

| 文件 | 作用 |
|---|---|
| `webdav-sync-core.js` | 纯函数：合并、时钟、墓碑、delta、备份格式（可单测，无 chrome 依赖） |
| `webdav-directory.js` | PROPFIND 解析：SW 里没有 `DOMParser`，手写 namespace-aware 读取器 |
| `webdav-sync.js` | 传输层：队列、超时、MKCOL/PROPFIND/GET/PUT、CAS 重试、状态 |
| `webdav-settings.js` | 设置页面板：状态渲染、保存/测试/立即同步 |
| `settings.html` / `settings.css` / `i18n.js` | 面板结构与 44 组中英文案 |
| `settings.js` | 导出/导入补 `readingPositions` |
| `scripts/release-notes.js` | 发布说明生成（本地与 CI 共用） |
| `.github/workflows/release.yml` | 推 tag 自动发版 |
| `scripts/build-release.py` | 白名单补 4 个新 js；修子目录垃圾文件漏检 |

### ⑦ 踩坑

- **打包白名单不会自动带上新 js**：`validate_manifest()` 只校验 manifest 引用到的文件，`settings.html` 里的 `<script src>` 和 `importScripts()` 都不在校验范围。漏加就是「包能打成功、装上去 404」。
- **jsdom 不反射 `referrerPolicy` / `loading` / `decoding` 到 HTML 属性**（只存 IDL 属性），断言要读属性值不能读 attribute，否则测试必假失败。
- **`activate()` 必须在 `merge()` 之后调**：它只抬 stamp=0 的种子记录。先 activate 再 merge，等于让新设备的本地数据拿到了「现在」的时间戳，会把云端更权威的记录压掉。
- **干扰测试要能持续**：模拟「另一台设备一直抢先写」时，钩子若一次性消费掉，就只能测到一次 412，测不出「重试上限」。
- jsdom 里 `{ __proto__x: ... }` 只是普通键名，测原型污染要用 `JSON.parse('{"__proto__":...}')` 才能造出真正的自有属性。

---

## 仓库工程化（2026-10-29，非扩展功能改动）

这一节不改扩展行为，记的是仓库本身从「一份散着改的工作副本」变成「有历史的 fork」的过程。之前的 12 轮改动一直没进版本库，这是当时最大的风险：改坏了没有可回退的点，也说不清某一行是谁、为什么改的。

| 动作 | 结果 |
|---|---|
| 远程改名 | `origin` → `upstream`（语义正确：那是作者仓库），等自己的 GitHub fork 建好再加 `origin` |
| 新建分支 | `dev` 承载所有自己的提交；`main` 继续保持指向上游、不提交 |
| 基线提交 | `5270ebe`，36 个文件（12 轮改动 + 文档 + 测试），提交信息按主题分块列出 |
| 本地提交身份 | `user.name=masterkimhank`、`user.email=masterkimhank@users.noreply.github.com`（仓库级，非全局）；早期占位身份用 `git rebase --exec 'git commit --amend --reset-author --no-edit' a1a5313` 重写 |
| 远程 | `origin` = `github.com/masterkimhank/LaterOn`（自己的 fork），`upstream` = 作者仓库 |
| 测试入口 | `scripts/test-all.js`：并发 4 跑 64 个 `tests/*.test.js`，47s，退出码反映成败 |
| 规范文档 | `FORK.md`：分支模型、五步流程、提交格式、四类记录分工、上游同步、MIT 合规 |
| 里程碑 | tag `v1.72.1-my.1`（Chrome 的 `manifest.version` 不接受后缀，后缀只用在 tag 上） |
| 备份 | 工作区外层 `LaterOn-fork-v1.72.1.bundle`（1.2MB，`git bundle verify` 通过，可完整克隆复原） |
| 发版入口 | `scripts/release.js` + `RELEASE.md`：一条命令做完 版本/记录/干净度校验 → 全量测试 → 打包 → 打 tag → 推送 → 建 GitHub Release |

**补全历史与推送**：`git fetch --unshallow upstream` 一开始三次都失败——`CRYPT_E_REVOCATION_OFFLINE`（schannel 吊销检查）、
`CONNECT tunnel failed 502`、`OpenSSL ... unexpected eof`。后来逐个排掉，根因是两层：

1. **命令行网络被 WorkBuddy 沙箱接管**。环境变量 `http_proxy=127.0.0.1:9148` 指向的 `sandbox-cli.exe`（WorkBuddy 自己的沙箱网关），不是用户常用的代理；GitHub 的请求被它直接断开（502 / empty reply）。而系统代理实际是 `127.0.0.1:7897`。绕开的办法是让命令在沙箱外运行并把代理指向 7897。
2. **git 的 schannel 后端在本机连不上**。证书吊销检查走不到 CRL 服务器，即使传 `-c http.schannelCheckRevoke=false` 也不生效，报 `CRYPT_E_REVOCATION_OFFLINE`。换成 `-c http.sslBackend=openssl` 立刻通。

现在已写进仓库本地配置，以后不用每次带参数：

```bash
git config http.proxy http://127.0.0.1:7897
git config http.sslBackend openssl
```

结果：完整历史 **50 个提交**（原先只有 4 个），`origin/dev`、`origin/main`、tag `v1.72.1-my.1` 均已推送。
中间遇到过一次 `ssl/tls alert handshake failure`（代理节点抖动），原样重试即成功——这类错误不代表配置有问题。

---

## 端到端测试：把「只能靠肉眼」的那半边补上（2026-10-29）

**起因**：本机 `chrome --headless` 加载不了扩展（`--dump-dom` 连输出都没有），所以过去所有界面改动
都只能「按 CSS 推算 + 装进浏览器手点一遍」。推算错过几次：透明封面透底那轮，就是先按叠加层
想当然、后来才发现必须 `display:none` 才干净。

**关键前提（先验证再动手）**：Playwright 自带的 Chromium 用 `channel: "chromium"` 启动时是
**新版无头模式（new headless）**，它是完整 Chrome，**支持 `--load-extension`**。
`headless: true` + `channel: "chromium"` 实测拿到了 service worker、`chrome.storage`、扩展 ID，
所以整套测试可以无头跑，不需要开窗口、不需要人盯。这一点推翻了「本机不能无头测扩展」的旧结论。

**做法**

| 层 | 文件 | 职责 |
|---|---|---|
| 运行器 | `scripts/test-e2e.js` | 扫 `tests/e2e/*.spec.js`，**串行**跑（每个 spec 一个 Chromium，并发会互相拖慢+假红），单 spec 超时 5 分钟强杀，支持 `--filter=` / `--headed` |
| 公共设施 | `tests/e2e/helpers.js` | 起扩展（独立 profile，storage 天然隔离）、本地静态站点（不依赖外网）、预置 storage、`swEval`（worker 被回收时自动重取重试）、`openPage`、`dismissOnboarding`、`waitFor` |
| 用例 | `tests/e2e/*.spec.js` | 见下表 |
| 依赖 | `package.json` / `package-lock.json` | **只**放测试依赖（jsdom、playwright），扩展运行时不读它，打包白名单也不含它 |

| spec | 覆盖 | 断言数 |
|---|---|---|
| `extension-smoke` | 扩展装没装上、manifest/package 版本一致、**白名单 38 个文件在扩展内全部可取**、storage 读写、三个入口页能开且不报错 | 20 |
| `sidepanel-render` | 新手引导出现且是模态、骨架屏让位、透明封面隐藏占位砖、坏封面降级后占位回来、三颗按钮不重叠、320/400px 不溢出、三档筛选 | 18 |
| `save-current-page` | 真点「＋」→ 后台抓 og:title/og:image/description → 写 storage → 侧栏出卡片且封面解码成功 → 按钮变已收藏 → 重开仍在 | 16 |
| `library-actions` | 卡片网格布局无重叠不溢出、搜索命中/落空/清空、Ctrl+点击开新标签、普通点击当前页跳转、标已读写回存储且不误伤其它条目 | 18 |
| `sidepanel-close-tabs` | 侧栏「关闭已打开」：只关当前项目里开着的标签页、确认框写清项目名与数量、取消时一个都不关、收藏一条不删 | 21 |
| `library-paging` | 首屏只铺 48 张、页脚文案与可见性、**滚到底自动续页**、按钮兜底补到全部、切筛选回到第一页、控制台干净 | 12 |

**踩到的坑（都会反复咬人，记下来）**

1. **`npm install` 会清掉没登记的依赖**。仓库原本没有 `package.json`，jsdom 是 `--no-save` 装的；
   一装 playwright，npm 判定 node_modules 里 36 个包「多余」，直接删了，jsdom 当场不可用。
   修法：补 `package.json` 把 jsdom 和 playwright 都登记成 devDependencies，并提交 lock。
2. **首次安装必弹新手引导**，它是 `position:fixed` 的全屏模态，会拦住所有点击。
   第一版测试全部断言通过、只有点击超时，查了半天才发现是被引导挡住（`elementFromPoint`
   返回的是引导里的 `<img>`）。修法：`openPage` 默认跳过引导并提供 `onboarding:"keep"`，
   想做引导断言的用例自己处理。
3. **引导的 `opacity` 停在 0**：无头环境下过渡动画不推进，`is-visible` 有了但透明度还是 0。
   Playwright 的 `visible` 只看 bounding box，所以「可见」判定不受影响，别去等 opacity。
4. **列表是分批渲染的**（先画第一屏，其余 `requestIdleCallback` 续画）。开局就读
   `.item` 数量会读到半张列表，后续「切回全部应该 3 条」必然失败。修法：所有计数都先等
   到目标值，不读瞬时值。
5. **浏览器自己会去要 `/favicon.ico`**，本地静态站点没这个路由 → 一条假的 404 报错被算进
   「控制台干净」断言。修法：站点默认返回 204，别在断言里用宽泛的正则把真错误一起放过。
6. **库页点卡片不是「开新标签页」**。`library.js` 的 `openItem()` 会 `preventDefault`，
   先开侧栏、再把**收藏库这个标签本身**导航到文章（`chrome.tabs.update`）。
   一开始按 `target="_blank"` 写成等 popup 事件，等 15 秒也不会来。现在两条路径分开测：
   带 Ctrl 点击 → 新标签页；普通点击 → 当前页导航。**这类「代码写着 A、实际行为是 B」
   正是端到端测试最该抓的东西**，写断言前必须先读实现。
7. **开发目录加载 ≠ 发布包**。扩展自己的页面能 fetch 到根目录的 `README.md`、`package.json`，
   所以在开发目录上断言「这些文件访问不到」必然失败，且不能说明打包有问题。
   该断言只属于 `release-package-hygiene.test.js`（它直接拆 zip）。

**验证**

- `node scripts/test-e2e.js` → 6/6 spec 通过，约 105 秒（单 spec 3~33 秒）。
- `node scripts/test-all.js` → 74/74 文件通过，53 秒（升级到 jsdom 30 后无回归）。
- 反证：把 `sidepanel.css` 里 `.thumb-img ~ .thumb-placeholder{display:none}` 删掉，
  `sidepanel-render` 立刻在「透明封面隐藏占位砖」一条上报红，其它断言不受影响。

---

## 未发布 — 收藏库卡片分页（2026-10-29）

**来源**：待办里躺着一条「P2：卡片视图虚拟滚动或『加载更多』——首屏从 700 张降到视口规模，5,000 条仍流畅」。

**根因**：1.72.0 把首屏渲染切成「同步 48 张 + `requestIdleCallback` 续画」，解决的是
「一次 `render()` 长时间占住主线程」，**但最终节点数一个没少**：700 条仍是 700 张卡片，
`#cardGrid` 下约 1.8 万个节点（100 条实测 2600 个，线性放大）。于是有三处代价一直在付：

1. 每次数据变化（标已读、改标题、同步拉回一批）都要把全部卡片 `updateCard()` 走一遍，
   再让浏览器为整棵子树重算样式；
2. `content-visibility: auto` 只省了屏外卡片的布局与绘制，节点本身、事件监听、
   每张卡的项目下拉仍然占着内存；
3. 分批续画期间滚动条一路变长，往下滚一截、列表又长一截。

**为什么不选「虚拟滚动」**：这个列表同时有拖拽排序（`enableReorder` 靠真实 DOM 位置拍
布局快照）、多选（`selectedIds` 与卡片 DOM 双向同步）、入场动画和 `content-visibility`。
虚拟滚动要把这三套全部改成「按索引投影」，动的是交互模型而不只是渲染，风险远大于收益。
**分页 + 滚到底续画**能拿到同样的首屏收益（首屏固定 48 张），且保持「一张卡片 = 一条收藏」
这个已经被测试钉死的模型。

**改法**（`library.js` 为主）：

1. 新增三个状态：`visibleItems`（当前筛选 + 排序后的**完整**结果）、`renderLimit`（允许铺多少张）、
   `visibleScopeKey`（项目 + 搜索词 + 阅读筛选 + 排序 + 搜索范围的签名）。
2. `renderCards()` 画到 `min(renderLimit, visible.length)` 就停；`renderCardsView()` 裁卡片时
   除了「不在结果里」，**还要把索引 ≥ `renderLimit` 的一并卸掉**——否则用户翻三页再切项目，
   前两页的节点会一直挂在 DOM 里，分页就白做了。
3. 签名变了（换项目 / 搜索 / 筛选 / 排序 / 搜索范围）→ `renderLimit` 打回第一页；
   只是数据变了（标已读、改标题、另一台设备同步过来）→ **保留用户已经翻到的位置**，
   否则每点一次已读就弹回顶部。
4. 页脚 `#loadMore`：`IntersectionObserver`（`rootMargin: 400px`）在滚到附近时自动续一页，
   按钮是键盘用户和「没有 `IntersectionObserver`」环境的兜底。
5. **所有「按可见条目算」的口径统一到 `visibleItems`**：`updateSelectionUI()`、全选、
   `selectedItemsInViewOrder()`、`commitCardOrder()` 的锚点。这是本次最容易踩的坑（见下）。
6. 定位：`renderCardsView()` 里若 `initialLocateItemId` 在更靠后的页，先把 `renderLimit`
   撑到它所在的位置；`chrome.storage.onChanged` 的 `CURRENT_ITEM_KEY` 分支走同一个
   `revealItem()`——侧栏点开一篇文章时，全屏这边要能先铺出那一段再高亮 + 滚过去。

**踩到的坑**

1. **拖拽锚点不能读 DOM**。`commitCardOrder()` 原来拿 `grid.querySelectorAll(".card")` 算
   「插到谁前面」。分页之后 DOM 里只有一页，拖到最后一个可见位置时 `anchorId` 找不到人 →
   当成「排到最后」，一篇本来在前 50 名的文章被扔到第 120 位。
   反证跑过：改回读 DOM，`card-order.test.js` 立刻 3 条红（末尾变成 `bulk-0`、位置记成第 120 位）。
2. **「全选」的分母**。`grid.children.length` 在分页后等于「一页」，
   `selectedIds.size >= grid.children.length` 一进入多选就成立，按钮文字永远停在「取消全选」。
   改成按 `visibleItems` 的条数与 `every()` 判断；没铺出来的条目只记 id，
   等翻到它们时 `createCard()` 会照 `selectedIds` 补上勾选态。
3. **`hidden` 对 `display:flex` 无效**。`.load-more` 自己写了 `display:flex`，浏览器给
   `[hidden]` 的 `display:none` 被覆盖：jsdom 里 `hidden === true` 断言全绿，屏幕上却一直挂着
   一颗「加载更多」。补 `.load-more[hidden]{display:none}`，并让 e2e 用 `isHidden()` 兜住。
4. **续画起点不能固定从 0 开始**。`loadMoreCards()` 从 `cardMap.size` 接着往下画
   （`grid.children.length === cardMap.size` 不成立时退回 0 兜底），否则每翻一页都要把前面
   已经画好的卡片重新 `updateCard()` 一遍，翻到第 10 页就是 10 倍的无效工作。
5. **`bench-700.js` 的计时钩子会失效**。它挂在「最后一批 = `visible.length`」上，分页后永远等不到，
   每次 run 白等 30 秒超时。改成钩 `render()` 量首屏，再单独把 `renderLimit` 撑到全量量一次
   `fullRenderMs` —— 两个数字分开看，才知道「首屏快了多少、整库铺开的底价是多少」。
6. **从「已读」切回「未读」不能停在第三页**。第一版只在签名变化时重置，但没重置「已经渲染的卡片」，
   切回去看到的是空白 + 页脚（其实第一页有内容）。所以重置 `renderLimit` 之后必须让
   `renderCardsView()` 重新从头铺（它本来就是从 0 开始，靠 `cardMap` 复用）。

**文件**：`library.js`（渲染 / 分页 / 全选 / 拖拽锚点 / 定位）、`library.html`（`#loadMore`）、
`library.css`（`.load-more*`）、`i18n.js`（`loadMore` / `loadMoreProgress`，中英）、
`tests/library-load-more.test.js`（新增）、`tests/e2e/library-paging.spec.js`（新增）、
`tests/card-order.test.js`（⑧ 改成分页口径 + ⑧b 新用例）、`tests/bench-700.js`（计时口径）。

**验证**

- `node scripts/test-all.js` → 74/74 文件通过，53 秒。
- `node scripts/test-e2e.js` → 6/6 spec 通过，106 秒；新增 `library-paging` 12 条。
- 三条反证（都实测报红）：
  - 去掉 `renderCards()` 里的截断 → `library-load-more.test.js` 9 条失败；
  - 拖拽锚点改回读 DOM → `card-order.test.js` 3 条失败；
  - 删掉 `.load-more[hidden]` 的样式 → `library-paging` 卡在「铺满后页脚收起」超时。
- 真浏览器（130 条）：首屏 48 张 → 滚到底自动到 96 张 → 点按钮补到 130 张、页脚收起 →
  切「已读」清空 → 切回「未读」回到 48 张。
- `node tests/bench-700.js 700`（jsdom，只看倍率、别横向外推）：卡片视图
  `firstRenderMs` 87.7 / `fullRenderMs` 3465.2；DOM 节点 700 张 = 18,200 个，
  首屏这一页 48 张 ≈ 1,250 个。

---

## 未发布 — 同一篇文章认人（2026-10-29）

**来源**：待办里躺着一条「同站点同标题去重——现在只按 URL 去重，需要具体站点复现才能定规则」。

**根因**：`saveItem()` 一直用 `normalizeUrl(entry.url) === normalizeUrl(item.url)` 找重复。
而 `normalize` 只处理「同一个网址的不同写法」（参数顺序、utm 类跟踪参数、尾斜杠、hash、
YouTube 视频 ID），对「同一篇内容挂着两个结构上完全不同的网址」无能为力：

| 站点 | 形式 A | 形式 B |
|---|---|---|
| 微信公众号 | `/s/AbCdEfGhIjKl` | `/s?__biz=MzA5&mid=265&idx=1&sn=abc` |
| 小红书 | `/explore/65f0a1b2...` | `/discovery/item/65f0a1b2...?xsec_token=` |
| 手机版 | `m.example.com/post/x` | `example.com/post/x` |

这几类的表现都是「收藏一次没反应（其实新建了）、再收藏一次又多一条重复」。
待办里写的「标题消失」是同一个现象的另一面：重复条目把原来那条挤到了后面。

**改法**：

1. `url-utils.js` 加三个原子函数：`siteKey()`（host 去掉 www/m/mobile/amp）、
   `titleKey()`（去零宽字符、空白折叠、小写）、`pathsAlike()`（首段相同，或存在共同的
   ≥ 8 字符路径段）。刻意不做「剥掉标题里的站点后缀」——同一个站点的后缀本来就一样，
   剥掉只会多出误判的机会。
2. `background.js` 加 `findSameArticleIndex()`：先按网址（行为完全不变），再按「同站点 +
   同标题 + 路径相近」。三个条件都在才算重复，少一个就当两篇。
3. `articleTitles()`：一条收藏可用的「认人标题」集合 = `title` 与 `titleAtSave` 里
   通过 `isSolidTitle`、不是 `looksGoneTitle`、`titleKey` 长度 ≥ 4 的那些。
   用两个而不是一个：用户改过标题后 `title` 已经不是当初那个了，但 `titleAtSave` 那份快照还在。
4. 四处调用点统一：`saveItem()`、`runBatchSave()` 的单条查重、两处「这一批里有几个已经收藏过」
   的统计（新增 `countAlreadySaved()`，按命中的条目下标去重，比原来按网址去重更准）。

**踩到的坑**

1. **三个老测试自带简化的 `LaterOnUrl` 桩**（只有 `normalize`）。刚接上 `siteKey` 就报
   `LaterOnUrl.siteKey is not a function`。没去改那三个桩（它们模拟的就是老环境），而是在
   `background.js` 顶部给三个函数加了「退化为只按网址去重」的兜底：缺失时不报错、
   也不把收藏流程打断。新功能由 `article-identity.test.js`（加载真实 `url-utils.js`）盯着。
2. **路径相似不能只看首段**。微信的 `/s/AbCd` 与 `/s` 首段相同，小红书的
   `explore/<id>` 与 `discovery/item/<id>` 首段不同。只写首段会漏掉后者，只写「有共同段」
   会让 `/a/item/b` 与 `/c/item/b` 也算相似。所以是「首段相同 **或** 有共同的 ≥ 8 字符路径段」。
3. **标题太短不能当认人凭证**。「关于」「更新」这类两三个字的标题在同一个栏目里撞上的
   概率不低，所以 `titleKey` 长度不足 4 的直接不参与。
4. **测试文件被写空**。改测试结构时用 `io.open(p, 'w', newline='\n')`——`open(..., 'w')`
   先截断、随后 `newline` 校验抛 `ValueError`，文件就变成 0 字节了。写文件要么先校验参数，
   要么用 `newline=''` 自己管换行。

**文件**：`url-utils.js`（三个原子函数）、`background.js`（`articleTitles` / `findSameArticleIndex` /
`countAlreadySaved` + 四处调用点）、`tests/article-identity.test.js`（新增）。

**验证**

- `node scripts/test-all.js` → 75/75 文件通过，54 秒。
- `node tests/article-identity.test.js` → 9 组场景全过（微信 / 小红书 / 手机版 / 不同标题 /
  跨栏目 / 改过标题 / 网址兜底标题 / 失效标题 / 重复时补摘要）。
- 反证：把 `findSameArticleIndex` 的第二道判断改成 `if (true) return -1;`，
  同一份测试立刻 5 组失败（微信、小红书、手机版、改过标题、补摘要）。

---

## 未发布 — 收藏数据分两处存（2026-10-29）

**来源**：待办表里最后一条「P1：列表 / 详情分离 + 单条写单条」。

**根因**：`laterOnItems` 是**整表一个键**。`chrome.storage.local.set` 的最小单位就是键，
所以「把 1 条标成已读」= 把 700 条重新序列化一遍写回去。而一条收藏里最占地方的是
`description`（一百多字）与 `image`（封面地址），这两个字段只在「画卡片」和「改摘要 / 封面」
时才用得上；标已读、挪项目、拖顺序、判断搜索命中，全都不需要它们，却每次都被一起搬。

按 700 条模拟数据实测（JSON 字节）：

| | 字节 | 占完整条目 |
|---|---|---|
| 完整条目（改动前每次写入的量） | 399,784 | 100% |
| 索引（只留轻量字段） | 190,669 | 48% |
| 详情表（摘要 + 封面） | 218,880 | 55% |

两张表相加略超 100%，因为详情表按 id 又包了一层 key。

**待办里「345KB → ~80KB」的估算是乐观的**：`url` / `title` / `id` / `savedAt` / `status` /
`projectId` / `favicon` 本来就都得留在索引里（搜索、去重、标签页匹配全指着它们），摘要与封面
合起来只占一半上下。实际拿到的是：标已读、挪项目、拖顺序这类高频写从 400KB 降到 191KB；
改一条摘要从 400KB 降到 219KB，而且完全不碰索引。要再往下压就得把 `url` / `title` 也挪走，
那就得给搜索和去重再造一套倒排索引，代价不成比例，到此为止。

**改法**：

1. 新增 `item-store.js`（IIFE，挂 `globalThis.LaterOnItemStore`），background / library /
   sidepanel / settings / webdav-sync 共用：`splitItem`（完整条目 → 索引 + 详情）、`indexOf`、
   `detailsOf`、`hydrateItem` / `hydrate`（读回来拼成完整条目，**详情缺字段时沿用索引里的**，
   这就是老数据的兼容路径）、`writePatch`（一次 set 需要的两个键）、`load`（一次读两个键）。
   **为什么是一张表而不是「一条一个键」**：WebDAV 同步与导出都按「键」组织（`webdav-sync-core`
   的 `KEYS` 是固定数组），一条一个键就得在同步层枚举成千上万个键，换来的只是「改一条摘要
   少写一百多 KB」——而改摘要本来就不是高频操作。
2. `background.js`：`mutateItems` 把 patch 里的详情字段拆到 `detailPatch` 只写详情表；删除时
   同一次 set 里把详情表对应项也删掉；被改动到的条目顺手把索引里遗留的详情字段剥掉（值在同
   一批写进详情表，不丢）；`purgeExpiredItemsNow` 清过期条目时连详情一起清；新增
   `migrateLegacyDetails()`（幂等，先写详情后写索引，中途失败也只是详情表多几条，不会丢摘要），
   启动时排进同一条写队列执行；`saveItem` / `runBatchSave` 改用 `load()` 拿完整条目、
   `writePatch()` 写回；omnibox 搜索与选择浮层改用 `load()`。
3. `library.js` / `sidepanel.js`：初始化一次读两个键；`onChanged` 分两条路——索引变了就用内存里
   现成的详情补齐，只对**新出现的 id** 读一次详情表（带 token 防乱序），详情表变了就按 id 覆盖。
4. **同步与导入导出的边界拼合**：`webdav-sync.js` 内部只认完整条目，`readKeys` / `commit` 两头
   拆开拼上——云端文件与导出 JSON 的格式一个字没改，`lateron-backup` v2 照旧。
   `settings.js` 导出用 `load()`，导入用 `writePatch()`，清空时连详情表一起 `remove`。

**踩到的坑**

1. **只回索引，页面立刻画回旧封面**。`MUTATE_ITEMS` 改成只返回索引后，页面 `items` 里就没了
   `description` / `image`，「移除封面」明明写进了库，卡片还显示旧图，要等 `onChanged` 才纠正。
   改法：后台在响应里多带一份 `details`（**只含这次真改到的那几条**，不回整表），页面用
   `detailsOf(items)` 的内存值打底再叠加它。
2. **剥字段等于删数据**。索引里剥掉 `description` / `image` 时，老数据的值如果不在详情表里，
   剥完就真没了。所以只在「这条被改动」时剥，且同一个 `set` 里把它的详情写进详情表。
3. **只加载 `library.js` 的 DOM 测试全红**（14 个文件）。页头那个「缺模块就退化成不拆分」的
   兜底对象漏了新加的方法，`ItemStore.hydrate is not a function` 被 `commitItemMutation` 的
   `catch` 吞掉，界面只弹「操作失败，请重试」。兜底对象要跟着模块一起长。
4. **共享测试桩只抠 `mutateItems` 那段源码**（`tests/helpers/item-mutation.js`），它把函数体
   单独放进一个干净上下文跑，没有 `ItemStore` → 一改摘要就抛错。桩里也得先跑
   `item-store.js` 并 `const ItemStore = globalThis.LaterOnItemStore`。
5. **兜底 `load()` 传字符串键**，而测试桩都按「传数组」实现，读出来是空的（地址栏搜索那条
   用例整页没卡片）。统一按数组读。
6. **`background.js` 体积预算**：96,000 → 102,000（认人 + 拆分共 +5.1KB）。守的底线没变——
   网页内执行的大函数一条都不许搬回 service worker（三条断言还在）。

**文件**：`item-store.js`（新增）、`background.js`、`library.js`、`sidepanel.js`、`settings.js`、
`webdav-sync.js`、`library.html` / `sidepanel.html` / `settings.html`（各加一行 `<script>`）、
`tests/item-store.test.js`（新增）、`tests/helpers/item-mutation.js`、`tests/cover-upload.test.js`、
`tests/edit-item.test.js`、`tests/sidepanel-delete.test.js`、`tests/background-modules.test.js`、
`tests/e2e/save-current-page.spec.js`。

**验证**

- `node scripts/test-all.js` → **76/76 文件通过**，51 秒（新增 `item-store.test.js`，36 项断言）。
- `node scripts/test-e2e.js` → **6/6 spec 通过**，104 秒。其中「收藏当前网页」那条的断言改成
  去详情表看封面与摘要，并新增一条「索引里不再带摘要 / 封面」。
- 反证一：`splitItem` 直接 `return { index: item, detail: null }`（等于不拆分）→
  `item-store.test.js`、`cover-upload.test.js`、`edit-item.test.js` 三份全部退出码 1。
- 反证二：`migrateLegacyDetails` 开头 `return 0`（等于不迁移）→ 迁移那组断言报红、退出码 1。

---

## 1.74.0 发版前自查（2026-10-30）

**为什么单独一轮**：索引 / 详情拆分动了存储格式，而「顺手把整个索引写回去」这类写法读上去完全正常、
出错也不报错（只是数据少了）。所以照着这条线索把全仓的 `set({ laterOnItems: … })`、
`ItemStore.indexOf(…)`、打包白名单、时间相关的用例逐个过了一遍，抓到 6 处。

| # | 问题 | 不修的后果 | 改法 |
|---|---|---|---|
| 1 | `cleanupLegacyContent()` 清 1.14.0 的旧正文时只写索引 | 从很老的版本一路升上来的用户，摘要会跟着被剥掉，且不报错 | 改用 `writePatch(cleaned, 现详情表)` |
| 2 | `library.js` init 补写 `doneAt` 时只写索引 | 同上 | 同上（用 `loaded.details`） |
| 3 | `build-release.py` 的 `RUNTIME_FILES` 漏了 `item-store.js` | 发布包缺文件 → `importScripts` 失败，**service worker 直接起不来**，装上就废；而打包脚本只校验 manifest 的引用，看不见 `<script src>` / `importScripts` | 补白名单 + 加静态护栏（解析白名单，比对三个 HTML 的 `script src` 与 background 的 `importScripts`） |
| 4 | 侧栏 `seg.bytes` 只量索引 | 「网页数据异常大」那条自检提示永远触发不了（阈值 300KB，索引只剩一半） | 索引 + 详情表一起量 |
| 5 | `webdav-sync-transport.test.js` 用 `toISOString()` 拼备份文件名 | 内核 `backupName` 用的是**本地**日期，东八区凌晨 0–8 点差一天 → 用例必红（9 条断言） | 按本地日期拼，并写清为什么 |
| 6 | `library-load-more.test.js` 用固定 `sleep(250)` 等分页铺完 | 分页是每批 48 张靠 rAF 续的，慢机器上没铺完 → 偶发假红（目标卡片不在 DOM、页脚 hidden） | 改成轮询等目标卡片出现（最多 3 秒） |

**考虑过、最后没做的**：担心「还停在旧版的设备上传的记录里没有 `description`，会把别的设备的摘要
盖成空」。查下来不会：每台设备上传的都是**从它自己存储里拼出来的完整条目**，而拆分只发生在已经升级的
那台机器上 —— 旧版设备的存储本来就带着摘要；备份格式 `Core.backupData()` 也会把缺字段归一化。
真要「修」就得回答「用户主动清空摘要（`""`）和旧版读不到（缺字段）怎么区分」，这个二义带来的风险
大于收益，所以只在 CHANGELOG 里写「建议所有设备一起升级」。

**顺带收紧的两处**：迁移时详情表优先（索引里残留的旧值不再覆盖详情表里的新值）；
`webdav-sync-transport.test.js` 改为加载真实的 `item-store.js`（以前跑的是退化版，测不到拆分后的真实路径）。

**验证**

- `node scripts/test-all.js` → **77/77**，51 秒（新增 `details-safety.test.js`）。
- `node scripts/test-e2e.js` → 6/6 spec。
- 反证：把第 1、2 处的 `writePatch` 改回「只写索引」→ `details-safety.test.js` 4 条断言红、退出码 1；
  从 `RUNTIME_FILES` 删掉 `item-store.js` → 白名单校验报红（`item-store.js`）；
  `revealItem` 直接 `return false` → `library-load-more.test.js` 2 条红。

---

## 待办（已提出、尚未实施）

暂无。
