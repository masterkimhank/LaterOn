// Run the real backend mutation code behind browser mocks used by DOM tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../../', name), 'utf8');
const source = read('background.js');
const mutation = source.slice(source.indexOf('async function mutateItems('), source.indexOf('async function usesEnglish()'));
module.exports = function install(window) {
  if (!window.chrome?.runtime || window.__itemMutationMock) return;
  window.__itemMutationMock = true;
  const context = vm.createContext({ chrome: window.chrome, Date, Set,
    STORAGE_KEY: 'laterOnItems', COVERS_KEY: 'laterOnCovers', ORDER_KEY: 'laterOnOrder', CURRENT_ITEM_KEY: 'laterOnCurrentItem' });
  // mutateItems 把摘要 / 封面写进详情表，所以桩里也要装上真正的 item-store.js，
  // 否则 ItemStore 在这个独立上下文里不存在，一改摘要就抛错、页面只弹「操作失败」。
  vm.runInContext(`${read('item-store.js')}
const ItemStore = globalThis.LaterOnItemStore;
let queue = Promise.resolve(); function queueItemWrite(task) { const result = queue.then(task); queue = result.catch(() => {}); return result; }
${mutation}`, context);
  const original = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = async function(message, ...args) {
    if (message?.type !== 'MUTATE_ITEMS') return original?.call(this, message, ...args);
    try { return await context.mutateItems(message); }
    catch (error) { if (process.env.LATERON_DEBUG) console.error('MUTATE_ITEMS failed:', error); return { ok: false, error: error.message }; }
  };
};
