// 三个页面（收藏库 / 侧栏 / 设置）共用的「有新版本」「待确认的数据迁移」提示条。
//
// 为什么要共用：这两条提示在三个界面都要出现，文案、按钮顺序、点了之后发什么消息
// 必须完全一致。各写一份的结果是——收藏库里点「忽略」记住了，侧栏里还在闪。
//
// 用法：页面上留一个空容器，调 LaterOnUpdateUI.mount("#updateStrip")。
// 容器自己不用写任何内容，这里负责 replaceChildren 并按状态显示 / 隐藏。
(function () {
  const t = (key, vars) => globalThis.LaterOnI18n?.t?.(key, vars) || key;
  const RELEASES = "https://github.com/masterkimhank/LaterOn/releases/latest";

  let host = null;
  let state = null;
  let migration = null;
  let busy = false;
  // 「稍后」只在本页面生效：数据迁移还没做是事实，下次打开该再提一次。
  let dismissed = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function send(message) {
    try {
      const sent = chrome.runtime.sendMessage(message);
      return sent && typeof sent.then === "function" ? sent.catch(() => null) : Promise.resolve(null);
    } catch {
      // 后台还是老版本 / 测试环境里没这条消息：当作没有结果，界面保持原样。
      return Promise.resolve(null);
    }
  }

  function openExternal(url) {
    // 地址来自网络，只认 http(s)，别拿它去开 chrome-extension:// 之类的东西。
    if (!/^https?:\/\//i.test(url || "")) return;
    try { chrome.tabs.create({ url }); } catch { /* 没有 tabs 权限就算了 */ }
  }

  function button(label, className, onClick) {
    const element = node("button", className, label);
    element.type = "button";
    element.addEventListener("click", onClick);
    return element;
  }

  function render() {
    if (!host) return;
    host.replaceChildren();
    if (dismissed || (!migration && !state?.available)) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    // 迁移挡着数据，优先级高于「有新版本」：先让人把数据的事处理掉。
    host.classList.toggle("is-migration", !!migration);
    if (migration) renderMigration();
    else renderUpdate();
  }

  function renderUpdate() {
    const version = state.latest?.version || "";
    host.append(node("span", "lu-strip-text", t("updateAvailable", { version })));
    if (state.latest?.pageUrl || RELEASES) {
      host.append(button(t("updateViewRelease"), "lu-strip-action", () => openExternal(state.latest?.pageUrl || RELEASES)));
    }
    host.append(button("×", "lu-strip-close", async () => {
      dismissed = true;
      render();
      // 让后台记住「这个版本别再提了」：否则下次检查又冒出来。
      await send({ type: "IGNORE_UPDATE", version });
    }));
  }

  function renderMigration() {
    host.append(node("span", "lu-strip-text", t("migrationBody")));
    host.append(button(t("migrationExport"), "lu-strip-link", () => {
      try { chrome.runtime.openOptionsPage(); } catch { /* 打不开设置页就只能自己找了 */ }
    }));
    const run = button(t("migrationRun"), "lu-strip-action", async () => {
      if (busy) return;
      busy = true;
      run.disabled = true;
      run.textContent = t("migrationRunning");
      const result = await send({ type: "RUN_MIGRATIONS" });
      busy = false;
      if (result?.ok) {
        migration = null;
        render();
        // 数据形状变了，这个页面手里的还是旧的：重新加载最干净。
        location.reload();
        return;
      }
      run.disabled = false;
      run.textContent = t("migrationRun");
      const text = host.querySelector(".lu-strip-text");
      if (text) text.textContent = t("migrationFailed", { error: result?.error || "" });
    });
    host.append(run);
    // 这里是文字按钮（「稍后」），不能套 .lu-strip-close —— 那是给「×」的 24px 圆点，
    // 套上去两个汉字会被挤成竖排。
    host.append(button(t("migrationLater"), "lu-strip-link", () => {
      dismissed = true;
      render();
    }));
  }

  function apply(payload) {
    if (payload && "state" in payload) state = payload.state;
    if (payload && "migration" in payload) migration = payload.migration;
    render();
  }

  async function refresh() {
    const response = await send({ type: "GET_UPDATE_STATE" });
    if (response?.ok) apply({ state: response.state, migration: response.migration });
  }

  function mount(target) {
    host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return;
    host.hidden = true;
    // 另一个页面点了「忽略」、或者后台刚好检查完：这里跟着变，两边说法一致。
    chrome.runtime.onMessage?.addListener((message) => {
      if (message?.type === "UPDATE_STATE") apply({ state: message.state });
      if (message?.type === "MIGRATIONS_DONE") location.reload();
    });
    refresh();
  }

  globalThis.LaterOnUpdateUI = { mount, refresh, render };
})();
