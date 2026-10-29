// 后台冷启动体积回归：网页内执行的大函数必须留在独立文件里，不能重新塞回 service worker。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const background = read("background.js");
const metadata = read("content-metadata.js");
const translation = read("content-translation.js");
const picker = read("content-folder-picker.js");

assert.ok(!background.includes("function extractPageMetadataForShortcut"), "网页提取函数不应在后台冷启动时解析");
assert.ok(!background.includes("function togglePageTranslation"), "翻译函数不应在后台冷启动时解析");
assert.ok(!background.includes("function showFolderPickerOverlay"), "批量选择浮层不应在后台冷启动时解析");

// 体积怎么算：先归一换行再数字节。
// Windows 上 core.autocrlf=true 会把工作区的 LF 变成 CRLF，凭空多出约 1.7KB；
// 那是 checkout 的产物，不是真的把代码写胖了，拿它当超限依据会误报。
const backgroundBytes = Buffer.byteLength(background.replace(/\r\n/g, "\n"));
// 预算 80000 → 90000：1.69.0 的「添加时原标题」快照、1.70.0 的服务端 meta 编码嗅探
// （GBK / Big5 站点按站点自己的编码解码）都在这个文件里，加了约 6.8KB。
// 预算 90000 → 96000：1.71.0 起「收藏时看到的标题」要一直留着（titleAtSave 快照 +
// 失效页标题的识别与拦截），又加了约 3.9KB。
// 预算 96000 → 102000：同一篇文章认人（siteKey / titleKey / pathsAlike 三道判断、
// 四处调用点统一）与「索引 / 详情分开存」的读写改造，加了约 5.1KB。
// 仍然守住的底线是：网页内执行的大函数一律不许搬回来（下面三条断言）。
assert.ok(backgroundBytes < 102000, `background.js 重新膨胀到 ${backgroundBytes} bytes`);

assert.ok(metadata.includes("function extractPageMetadataForShortcut"));
assert.ok(translation.includes("function togglePageTranslation"));
assert.ok(picker.includes("function showFolderPickerOverlay"));
assert.match(background, /files:\s*\["content-metadata\.js"\]/);
assert.match(background, /files:\s*\["content-translation\.js"\]/);
assert.match(background, /files:\s*\["picker-ui\.js",\s*"content-folder-picker\.js"\]/);
assert.match(picker, /function safeRuntimeMessage\(message\)/);
assert.match(picker, /try \{ return Promise\.resolve\(chrome\.runtime\.sendMessage\(message\)\)\.catch\(\(\) => null\); \}\s*catch \{ return Promise\.resolve\(null\); \}/);

console.log("PASS background 模块按需注入，冷启动脚本", backgroundBytes, "bytes");
