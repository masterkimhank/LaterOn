# RELEASE.md — 怎么发一个版本

发版只有一条命令，但前面有三件事要手动做对：**改版本号、写 CHANGELOG、提交**。

```bash
node scripts/release.js --version 1.73.0     # 1) 升版本号（要求 CHANGELOG 已有 1.73.0 段落）
git add -A && git commit -m "chore(release): 1.73.0"   # 2) 提交
node scripts/release.js --publish            # 3) 测试 → 打包 → 打 tag → 推送 → 建 Release
```

第 3 步内部的顺序是固定的：跑全量测试 → `scripts/build-release.py` 打包 → 打 tag `v1.73.0-my.N`
→ 推分支与 tag → `gh release create` 把 zip 挂上去。任何一步失败都会停下，不会留下半成品。

## 一、发版前该做的三件事

| 顺序 | 做什么 | 为什么不能省 |
| --- | --- | --- |
| 1 | 写 `CHANGELOG.md` 的 `## 1.73.0 — 日期` 段落 | 脚本会把它整段抓出来当 Release 说明；段落少于 40 字直接拒绝发版 |
| 2 | 写 `IMPROVEMENTS.md` 的对应小节 | 脚本只提醒不拦。但下次改同一块代码时，这节就是你的说明书 |
| 3 | 升 `manifest.json` 的版本号 | 用 `--version` 参数改，别手改——它会顺手校验 CHANGELOG 段落是否存在 |

另外一件事，不在上面三步里，但**改了界面 / 布局 / 交互就必须做**：跑一次
`node scripts/test-e2e.js`。它故意没接进 `release.js` 的自动化链路（要额外下 Chromium，
会把发版拖长），但它是唯一能发现「卡片按钮叠在一起」「透明封面透出 Logo 砖」
「侧栏 320px 横向溢出」「白名单漏文件导致发出去的包 404」这类问题的检查——
这些在 jsdom 里全都看不出来。

版本号规矩（Chrome 硬性限制，不是习惯问题）：

- `manifest.version` **只能是数字和点**：`1.73.0` ✓、`1.73.0-beta` ✗、`1.73.0-my.1` ✗
- 第三位加号 = 只修 bug；第二位加号 = 加了功能或做了明显优化
- git tag 用 `v<版本>-my.<序号>`：`v1.73.0-my.1`。序号由脚本自动算，同一版本第二次发就是 `-my.2`
- 加 `-my` 后缀是为了**不和上游撞名**。上游也发 `v1.73.0` 时，两者 tag 不同，`git fetch upstream` 不会因 tag 冲突报错

## 一点五、还有一条路：推 tag 让 GitHub 自己发

`release.js` 需要本机有 `gh` 登录，还要能连上 GitHub（本机靠 `http.proxy` + `sslBackend=openssl` 那套配置）。
换台电脑、代理挂了，这条路就走不通。所以仓库里另有一条纯云端的路径：

```bash
git tag -a v1.73.0-my.1 -m "1.73.0"   # 打 tag（本地 release.js 会自动做这步）
git push origin v1.73.0-my.1          # 推上去就触发了
```

`.github/workflows/release.yml` 收到 tag 后依次做：

| 步骤 | 内容 | 失败会怎样 |
| --- | --- | --- |
| 校验 | `node scripts/release-notes.js --tag <tag>`：tag 必须等于 `v<manifest 版本>[-my.N]`，CHANGELOG 必须有对应段落 | 中止，不会发出「版本号对不上」的包 |
| 测试 | 临时装 jsdom 后跑 `node scripts/test-all.js` | 测试挂 → 中止；jsdom 装不上 → 打印告警并跳过（发版门禁仍在本地 `release.js`） |
| 打包 | `python3 scripts/build-release.py`（allowlist + 回读校验） | 中止 |
| 发布 | `gh release create --verify-tag`，挂 zip + 说明 | 中止，可手动重跑 |

**手动补建 Release**：Actions 页 → Release → Run workflow → 填已有 tag（例如 `v1.72.1-my.1`）。
`--verify-tag` 保证 tag 不存在时直接失败，不会凭空造一个。

两条路产出的说明是同一份 —— 都来自 `scripts/release-notes.js`，不要在 `release.js` 里单独改文案。

## 二、`--publish` 到底做了什么

| 步骤 | 命令 | 失败会怎样 |
| --- | --- | --- |
| 跑测试 | `node scripts/test-all.js` | 直接中止，不发版 |
| 打包 | `python scripts/build-release.py` | 中止；产物在 `dist/LaterOn-<版本>.zip` |
| 打 tag | `git tag -a v<版本>-my.N` | 中止 |
| 推送 | `git push origin dev` + `git push origin <tag>` | 网络抖动自动重试 3 次，仍失败则中止（tag 留在本地） |
| 建 Release | `gh release create <tag> dist/*.zip` | 中止，但 tag 已推上去；去网页手动建 Release 即可 |

想先看结果不发版，去掉 `--publish`：它照样跑测试和打包，只是不打 tag、不推送。

**补建 / 重发 Release**：tag 推上去了但 Release 没建成（断网、gh 报错），重跑时用 `--tag` 复用那个 tag，
不要让它自动算新序号：

```bash
node scripts/release.js --publish --skip-test --tag v1.73.0-my.1
```

已经存在同名 Release 时脚本会直接拦下并给出删除命令，不会悄悄建出第二个。

**为什么全程显式 `--repo`**：本地同时有 `origin`（你的 fork）和 `upstream`（作者仓库）时，`gh` 会自己猜，
实测猜成了 `gaoyiiiii/LaterOn` 并报「tag 没推到上游仓库」。脚本现在从 `origin` 解析出 `owner/repo`，
每条 gh 命令都带上，不靠猜。

## 三、包里有什么、没有什么

`scripts/build-release.py` 用**显式白名单**（`RUNTIME_FILES`），不是「排除某些文件」。
这样测试、截图、预览页、文档不会因为疏忽泄漏进用户装的扩展里。打包后还会回读 zip 逐项校验。

- **在包里**：`manifest.json`、全部运行时 js/css/html、图标、`_locales/`、`LICENSE`
- **不在包里**：`tests/`、`scripts/`、`docs/`、`design/`、任何 `.md`、`preview-*.html`、`.gitignore`、`icon.svg`

> **加新运行时文件时必做**：把文件名加进 `scripts/build-release.py` 的 `RUNTIME_FILES`。
> 脚本只校验 `manifest.json` 里引用到的文件是否在包内——**HTML 里 `<script src>` 引用的 js 不在校验范围**，
> 漏加的话包能打成功，装上去却在控制台报 404。这是目前唯一没自动化的盲区。

## 四、Release 页面长什么样

已发布的一个实例：<https://github.com/masterkimhank/LaterOn/releases/tag/v1.72.1-my.1>

标题：`1.73.0（二次开发版）`
正文：CHANGELOG 对应段落 + 安装说明（脚本自动写入）
附件：`LaterOn-1.73.0.zip`

下载链接可以长期引用，格式固定：

```
https://github.com/masterkimhank/LaterOn/releases/download/<tag>/LaterOn-<版本>.zip
```

想让别人装：

1. 下载 zip 解压到任意固定目录
2. `chrome://extensions/` → 开「开发者模式」→「加载已解压的扩展程序」→ 选该目录
3. 扩展 ID 由包内 `manifest.key` 固定（`ahfghclmnedaflabdpffhdbbdhjikjme`），解压到哪都是同一个扩展，数据不会因为换目录读不到；只有从 **1.73.0 及更早**升级上来的人需要「先导出 JSON → 再换新版 → 再导入」

## 五、要不要发到 Chrome Web Store

可以，但成本比 GitHub Release 高得多：

| 项 | 情况 |
| --- | --- |
| 开发者账号 | 一次性 5 美元注册费 |
| 审核 | 首次通常 1~3 个工作日，涉及 `<all_urls>` 这类宽权限会被问用途，需写隐私说明 |
| 名称 | 不能和上游 LaterOn 撞名，需改名，并说明「基于 LaterOn 修改」（MIT 允许，但不得暗示原作者背书） |
| 更新 | 每次都要重新过审，不能像 GitHub 那样发完即装 |
| 数据 | 商店版和自己的解压版是**不同扩展 ID**，数据不互通（商店会用自己的开发者密钥签名，覆盖 `manifest.key` 算出的 ID） |

如果只是自己和朋友用，GitHub Release 的 zip 就够了，不必进场。

## 六、常见错误对照

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `CHANGELOG.md 里没有「## x.y.z」这一段` | 版本号改了但没写记录 | 先写 CHANGELOG 再升版本 |
| `CHANGELOG「## x.y.z」这段太短` | 只写了一行标题 | 补上「改了什么 / 影响谁」 |
| `有未提交的改动，先提交再发版` | `git status` 不干净 | 提交（或 stash）后再 `--publish` |
| `测试没全绿，不发版` | 有测试挂了 | 修好再发；`--skip-test` 只用于纯文档改动 |
| `manifest.json 的 key 有问题，不敢发` | 发布包缺 `manifest.key` | 别硬发。缺了它，每个用户装出来的扩展 ID 会随文件夹路径变化，收藏全部读不到。先 `node scripts/extension-id.js` 确认，再用 `--generate` 补一把 |
| `Release build failed: Manifest references files outside the release allowlist` | manifest 引用了新文件但没进白名单 | 加进 `RUNTIME_FILES` |
| `推送失败：... handshake failure` | 代理节点抖动 | 脚本会自动重试 3 次；仍失败就手动 `git push` |
| `gh 没登录` | token 过期 | `gh auth login` |
| `tag ... has not been pushed to gaoyiiiii/LaterOn` | gh 把目标仓库猜成了上游 | 加 `--repo masterkimhank/LaterOn`（脚本已内置，手动敲 gh 时才会遇到） |
| `已有 v1.x.y-my.N 的 Release` | 重复发同一 tag | 换新版本号，或先 `gh release delete <tag> --repo masterkimhank/LaterOn --yes` |
