# FORK.md — 二次开发说明与改动记录规范

这份文档只对**本分支**负责。凡是「我自己改的、上游没有的东西」，都要能在这里或
`IMPROVEMENTS.md` 里查到；凡是「上游本来就这样」的东西，不要往这里写。

## 1. 这份代码的来历

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/gaoyiiiii/LaterOn |
| 上游作者 | yiiiii |
| 开源协议 | MIT，`Copyright (c) 2026 yiiiii` |
| 分叉点 | 提交 `a1a5313`（License LaterOn under MIT…） |
| 本分支基线 | 版本 `1.72.1`，见 `git log` 里的「feat: fork 基线」 |
| 技术形态 | Chrome MV3 扩展，无构建、无框架，纯 JS 直接加载 |
| 数据存放 | `chrome.storage.local` 的 `laterOnItems` 单键，按扩展 ID 隔离 |

协议允许 fork、改名、闭源分发、商用，条件是**保留 LICENSE 文件与版权声明**，
且不能用原作者名义为自己的版本背书（详见第 7 节）。

## 2. 分支怎么用

| 分支 | 角色 | 允许的操作 |
| --- | --- | --- |
| `main` | 上游镜像，只读 | 只做 `git merge --ff-only upstream/main`，**不提交自己的改动** |
| `dev` | 开发主线，可写 | 所有改动都提交在这里，一个主题一个提交 |

这样分的好处：上游更新随时能干净地合进来；自己的改动永远有一份完整、可回溯的历史；
万一哪天不想跟上游了，直接删掉 `upstream` 远程即可，`dev` 不受影响。

远程已按 fork 惯例配好：`upstream` = 作者仓库，`origin` = `github.com/masterkimhank/LaterOn`（自己的 fork）。
推送与换机器时的补配办法见第 6 节末尾。

## 3. 一次改动的完整流程

1. **改代码**。只解决一个问题，别顺手重构旁边的文件。
2. **跑测试**：`node scripts/test-all.js`（没有 `package.json`，每个 `tests/*.test.js` 是独立进程，按退出码判定）。
   - 只跑一部分：`node scripts/test-all.js --filter=library`
   - 改了渲染 / 性能相关的东西，再跑 `node tests/bench-700.js` 对比数字。
3. **补测试**。修 bug 就先写一个能复现它的断言，再改代码。
4. **写记录**：`CHANGELOG.md` 与 `IMPROVEMENTS.md` 各加一段（分工见第 5 节）。
5. **提交**（格式见第 4 节），然后去 `chrome://extensions/` 点「重新加载」验证真实行为。
6. **要发给别人**时按 `RELEASE.md` 发版：`node scripts/release.js --publish` 一次做完测试、打包、打 tag、推送、建 Release。

## 4. 提交信息规范

```
<type>(<scope>): <一句话说清改了什么>

为什么改：现象 / 触发条件 / 根因
改了什么：关键函数与文件
怎么验证：测试文件名，或手工步骤
```

- `type`：`feat` 新功能、`fix` 修 bug、`perf` 性能、`refactor` 重构、`test` 测试、`docs` 文档、`chore` 杂务
- `scope`：`library`、`sidepanel`、`background`、`i18n`、`tabs`、`png` 之类，没有就省略
- 一个提交只做一件事。改了两个不相干的问题，就分两次提交 —— 以后出问题才好用 `git revert` 单独撤掉。
- 提交信息用中文，和 `CHANGELOG.md` 的口吻保持一致；不要写「update」「fix bug」这种等于没写的标题。

## 5. 改动记录放在哪

| 文件 | 写给谁看 | 写什么 | 什么时候更新 |
| --- | --- | --- | --- |
| `CHANGELOG.md` | 使用者 | 能看到、能感知的变化；一句现象一句原因 | 每次发版 |
| `IMPROVEMENTS.md` | 维护者（主要是未来的自己） | 根因、改法、动了哪些文件、怎么验证、踩过的坑 | 每次改动 |
| `git log` | 追溯 | 提交粒度的事实记录，能 `git show` 出完整 diff | 每次提交 |
| `FORK.md` | 接手的人 | 分支、流程、规范本身 | 规范变了才改 |

三者不重复：`CHANGELOG` 讲「你用起来有什么不一样」，`IMPROVEMENTS` 讲「为什么这么改、
以后再碰到类似的该往哪看」，`git log` 讲「当时到底改了哪几行」。

## 6. 跟上游同步

```bash
# 只在第一次需要：把浅克隆补成完整历史（本仓库已补全，共 50 个提交；新 clone 才要跑）
git fetch --unshallow upstream

# 每次同步
git fetch upstream
git checkout main && git merge --ff-only upstream/main   # main 只跟着走
git checkout dev  && git merge main                       # 把上游更新合进开发线
```

- **优先 merge，不要 rebase**：`dev` 上已经有自己的提交历史，rebase 会重写它，冲突要一遍遍重解。
- **冲突高发区**：`CHANGELOG.md`（两边都往顶部加）、`manifest.json` 的 `version`、`i18n.js` 的词典。
  处理办法：`CHANGELOG` 保留两边；`version` 取上游的再把本地版本号接上去；`i18n` 按 key 合并。
- 本仓库文件是 **CRLF**（`core.autocrlf=true`）。换机器 clone 后先确认 `git config core.autocrlf` 是 `true`，
  否则每个文件都会显示成「整个文件被改动」。
- **本机网络的两个坑**（已写进仓库配置，换机器要重配）：
  ```bash
  git config http.proxy http://127.0.0.1:7897   # 真实代理是这个端口
  git config http.sslBackend openssl            # schannel 后端连不上 GitHub
  ```
  1. 系统代理是 `127.0.0.1:7897`；如果环境变量里出现 `http_proxy=127.0.0.1:9148`，那是 WorkBuddy
     沙箱自己的网关，会把 GitHub 的请求断掉（`502` / `empty reply`）。命令行要在沙箱外跑才通。
  2. git 默认的 `schannel` 后端在本机报 `CRYPT_E_REVOCATION_OFFLINE`（证书吊销检查走不到 CRL 服务器），
     `-c http.schannelCheckRevoke=false` 也压不住，**必须**换 `openssl` 后端。
  3. `ssl/tls alert handshake failure`、`unexpected eof` 属于代理节点抖动，原样重试即可，不用改配置。

**推上自己的 fork**：`https://github.com/masterkimhank/LaterOn.git` 已配置为 `origin`
（换机器时用 `git remote add origin https://github.com/masterkimhank/LaterOn.git` 补上）。

```bash
git fetch --unshallow upstream   # 新机器才需要；本仓库已补全
git push -u origin dev
git push origin main             # 可选：让 main 也和上游保持一致
git push origin v1.72.1-my.1     # 标签要单独推，--tags 会连上游的 tag 一起带上
```

现状（2026-10-29）：`origin/dev`、`origin/main`、tag `v1.72.1-my.1` 都已推送。

提交身份已经是 `masterkimhank <masterkimhank@users.noreply.github.com>`（仓库级配置，
不影响本机其他项目）。要用别的邮箱：`git config user.email <新邮箱>`，之后新提交即生效；
已经提交过的用 `git rebase --exec 'git commit --amend --reset-author --no-edit' a1a5313` 改。

## 7. 合规

- `LICENSE` 必须留着，`manifest.json` / 发布包里也要带上版权声明（`scripts/build-release.py` 已把它打进包）。
- 改了名字或图标就明确说明「基于 LaterOn 修改」，不要暗示原作者为你的版本负责。
- MIT 不要求你开源自己的改动，但**这份仓库里**的改动记录建议保持公开可查 —— 至少对你自己可查。

## 8. 本地安装与验证

1. `chrome://extensions/` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选本目录。
2. 改完代码必须点该扩展的**「重新加载」**（圆形箭头）才生效；**不要点「移除」**，移除会连数据一起清掉。
3. 未打包扩展的 ID 由文件夹**绝对路径**派生，换目录会变成新 ID、读不到旧数据。
   迁移数据的办法：旧版本「设置 → 导出 JSON」，新版本导入。

## 9. 已记录的改动索引

| 版本 | 日期 | 一句话 | 详见 |
| --- | --- | --- | --- |
| 1.67.0 | 2026-10-23 | 搜索范围开关（标题 / 摘要 / URL） | `IMPROVEMENTS.md` §1.67.0 |
| 1.68.0 | 2026-10-23 | 项目标签显示 bug + 删除时关闭对应标签页 | §1.68.0 |
| 1.69.0 | 2026-10-23 | 入库原标题快照 + 单项目「关闭已打开」 | §1.69.0 |
| 1.70.0 | 2026-10-23 | GBK / Big5 页面乱码 | §1.70.0 |
| 1.71.0 | 2026-10-24 | 「收藏时」标题快照（卡片副标题） | §1.71.0 |
| 1.72.0 | 2026-10-27 | 700 条量级性能优化（六项） | §1.72.0 |
| 1.72.1 | 2026-10-27 | 自查修复五项（多为上版引入） | §1.72.1 |
| 下一个 | — | 见 `IMPROVEMENTS.md` 末尾「待办」 | — |

## 10. 版本号约定

Chrome 的 `manifest.version` 只接受数字和点，所以：

- 扩展内版本：`1.72.2` → `1.73.0` 顺序递增，规则同上游（第三位修 bug、第二位加功能）。
- 自己的里程碑在 git 里用带后缀的 tag 标记，例如 `v1.72.1-my.1` —— tag 没有字符限制，
  正好用来区分「哪一版是我的」。
