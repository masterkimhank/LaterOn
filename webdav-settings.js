// 设置页里的「多设备同步」表单：只管界面，真正的网络与合并都在 service worker 里。
//
// 三条规矩：
//   1) 未保存的配置绝不能看起来像已经生效了 —— 任何输入都会把提示改成「改动还没保存」
//   2) 「立即同步」在同步没启用时禁用，避免点了没反应让人以为坏了
//   3) 状态文字不写 data-i18n，由这里按最新状态渲染；切语言时手动重渲染一次
(function () {
  const CONFIG = "laterOnWebDAV", STATUS = "laterOnSyncStatus";
  const form = document.querySelector("#webdavForm");
  if (!form) return;
  const t = (key, params) => (window.LaterOnI18n?.t(key, params) ?? key);
  const fields = Object.fromEntries(["enabled", "url", "username", "password"].map((key) => [key, form.elements.namedItem(key)]));
  const output = document.querySelector("#webdavStatus");
  const feedback = document.querySelector("#webdavFeedback");
  const syncButton = document.querySelector("#webdavSync");
  const legacyNote = document.querySelector("#webdavLegacyNote");
  let savedEnabled = false, busy = false;

  const showLegacyNote = (value) => { legacyNote.hidden = !value?.url || value.directoryMode === "auto"; };

  // "HTTP 500" 这类错误码单独走一条文案，其余都是 syncXxx 的键
  const errorText = (code) => /^HTTP \d{3}$/.test(code || "")
    ? t("syncHttpError", { code: code.slice(5) })
    : t(code || "syncNetworkError");

  function renderStatus(state = {}) {
    const phase = savedEnabled ? (state.phase || "pending") : "disabled";
    const labels = { disabled: "syncDisabled", pending: "syncPending", syncing: "syncRunning", success: "syncSuccess", error: "syncFailed" };
    let text = t(labels[phase] || "syncPending");
    if (phase === "error") text += ` · ${errorText(state.error)}`;
    if (state.lastSuccess) text += ` · ${t("syncLastSuccess", { time: new Date(state.lastSuccess).toLocaleString(document.documentElement.lang) })}`;
    // 自动合并过别的设备的改动时说明一下，否则用户会困惑「为什么突然多了一条」
    if (phase === "success" && state.conflicts > 0) text += ` · ${t("syncConflictNote", { n: state.conflicts })}`;
    output.removeAttribute("data-i18n");
    output.textContent = text;
    output.dataset.phase = phase;
    syncButton.disabled = busy || !savedEnabled;
  }

  const config = () => ({
    enabled: fields.enabled.checked,
    url: fields.url.value,
    username: fields.username.value,
    password: fields.password.value
  });

  function setBusy(next, message) {
    busy = next;
    form.querySelectorAll("button, input").forEach((el) => { el.disabled = next; });
    if (message) {
      feedback.textContent = message;
      feedback.dataset.phase = "pending";
    }
  }

  async function action(type) {
    if (busy) return;
    setBusy(true, t(type === "WEBDAV_TEST" ? "syncTesting" : "syncProcessing"));
    try {
      const message = type === "WEBDAV_SYNC" ? { type } : { type, config: config() };
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.ok) throw new Error(result?.error || "syncNetworkError");
      if (type === "WEBDAV_SAVE") { savedEnabled = fields.enabled.checked; legacyNote.hidden = true; }
      const success = type === "WEBDAV_TEST" ? "syncTestSuccess"
        : type === "WEBDAV_SAVE" ? "syncSaved"
          : result.disabled ? "syncDisabled" : "syncSuccess";
      feedback.textContent = t(success);
      feedback.dataset.phase = "success";
    } catch (error) {
      feedback.textContent = errorText(error.message);
      feedback.dataset.phase = "error";
    } finally {
      setBusy(false);
      try { renderStatus((await chrome.storage.local.get(STATUS))[STATUS]); }
      catch {
        feedback.textContent = t("syncLocalError");
        feedback.dataset.phase = "error";
        syncButton.disabled = !savedEnabled;
      }
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); action("WEBDAV_SAVE"); });
  document.querySelector("#webdavTest").addEventListener("click", () => action("WEBDAV_TEST"));
  syncButton.addEventListener("click", () => action("WEBDAV_SYNC"));
  // 表单改过但没保存时，界面不能看起来已经生效
  form.addEventListener("input", () => {
    if (busy) return;
    feedback.textContent = t("syncUnsaved");
    feedback.dataset.phase = "pending";
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[CONFIG]) {
      savedEnabled = !!changes[CONFIG].newValue?.enabled;
      showLegacyNote(changes[CONFIG].newValue);
    }
    // 后台每次同步都会更新状态，这里跟着刷新文字
    if (changes[STATUS]) renderStatus(changes[STATUS].newValue);
  });

  window.addEventListener("lateron-language-change", () => {
    chrome.storage.local.get(STATUS).then((stored) => renderStatus(stored[STATUS])).catch(() => {});
    if (feedback.dataset.phase === "pending" && feedback.textContent) feedback.textContent = t("syncUnsaved");
  });

  (async () => {
    await window.LaterOnI18n?.getLanguage();
    window.LaterOnI18n?.applyStatic();
    const stored = await chrome.storage.local.get([CONFIG, STATUS]);
    const value = stored[CONFIG] || {};
    showLegacyNote(value);
    fields.enabled.checked = savedEnabled = !!value.enabled;
    for (const key of ["url", "username", "password"]) fields[key].value = value[key] || "";
    renderStatus(stored[STATUS]);
  })().catch(() => {
    feedback.textContent = t("syncLocalError");
    feedback.dataset.phase = "error";
  });
})();
