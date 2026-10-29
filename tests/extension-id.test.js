// 固定扩展 ID：manifest.key 必须在，且算出来的 ID 一个字都不能变。
//
// 背景：未打包的扩展没有 key 时，ID 由**扩展目录的绝对路径**派生。同一份代码放在
// 不同目录就是两个不同的扩展，而 chrome.storage.local 按扩展 ID 隔离 —— 换个目录
// 加载，收藏、阅读进度、同步配置全部读不到（不是报错，是被当成新装的空扩展）。
// 写死 key 之后 ID 与路径无关，换机器、换目录、从 zip 解压都能读到同一份数据。
//
// 因此 key 本身成了「用户数据的主键」：一旦改动，所有老用户的 ID 会变，等于数据丢失。
// 这里把它钉成常量，谁误删/误改都会立刻报红。
//
// 运行：node tests/extension-id.test.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const { idFromManifestKey, idFromPrivateKey, idFromPublicKeyDer } = require(path.join(
  ROOT,
  "scripts",
  "extension-id.js"
));

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

// ── 1. 算法本身 ─────────────────────────────────────────
// 期望值是硬编码的字面量，不是用被测函数现算的 —— 否则就是拿自己的输出证明自己。
// 来源可以脱离本仓库复核（openssl + tr，全程不经过 node）：
//   printf '' | openssl dgst -sha256 -r | cut -c1-32            → e3b0c44298fc1c149afbf4c8996fb924
//   printf '' | openssl dgst -sha256 -r | cut -c1-32 \
//     | tr '0123456789abcdef' 'abcdefghijklmnop'               → odlameecjipmbmbejkplpemijjgpljce
// 也就是 sha256(空) 的前 16 字节，每个半字节 0-f → a-p。
check(
  "ID 算法与 sha256 空输入向量一致",
  idFromPublicKeyDer(Buffer.alloc(0)) === "odlameecjipmbmbejkplpemijjgpljce",
  idFromPublicKeyDer(Buffer.alloc(0))
);

// ── 2. manifest 里的 key ─────────────────────────────────
const manifestPath = path.join(ROOT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

check("manifest.json 带 key 字段", typeof manifest.key === "string" && manifest.key.length > 0);
check(
  "key 是能解析的 RSA 公钥（不是随手编的字符串）",
  (() => {
    try {
      const key = crypto.createPublicKey({
        key: Buffer.from(String(manifest.key || ""), "base64"),
        format: "der",
        type: "spki",
      });
      return key.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails.modulusLength === 2048;
    } catch {
      return false;
    }
  })()
);

// ── 3. ID 是钉死的常量 ───────────────────────────────────
// 这个值用 openssl 独立算过一遍（不经本仓库的脚本）：
//   openssl pkey -in extension-key.pem -pubout -outform DER | openssl dgst -sha256 -r | cut -c1-32 \
//     | tr '0123456789abcdef' 'abcdefghijklmnop'
const EXPECTED_ID = "ahfghclmnedaflabdpffhdbbdhjikjme";
const actualId = idFromManifestKey(manifest.key);
check("扩展 ID 等于约定的常量", actualId === EXPECTED_ID, actualId);
check("ID 是 32 位且全部落在 a-p", /^[a-p]{32}$/.test(actualId), actualId);

// 同一输入必须稳定（防止哪天改成加盐、加时间戳之类）。
check("同一 key 反复计算得到同一个 ID", idFromManifestKey(manifest.key) === actualId);

// ── 4. 私钥一致性（本机有私钥时才查）─────────────────────
// 私钥不入库：它只在要上传 Chrome 商店、签 .crx 时才用得上。
// manifest.key（公钥）才是让 ID 固定的东西，公开无妨。
const keyFile = path.join(ROOT, "extension-key.pem");
if (fs.existsSync(keyFile)) {
  const fromPem = idFromPrivateKey(fs.readFileSync(keyFile, "utf8"));
  check("本机私钥能推出同一个 ID", fromPem === actualId, fromPem);
  check(
    "私钥被 .gitignore 排除",
    fs
      .readFileSync(path.join(ROOT, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .some((line) => line.trim() === "extension-key.pem")
  );
} else {
  console.log("⚠️ 跳过私钥核对：本机没有 extension-key.pem（私钥不入库，属正常）");
}

// ── 5. 发布包里带着 key 这件事 ───────────────────────────
// 从 Releases 下载 zip 的用户解压加载，靠的就是包里的 manifest.key。
// 真实校验（解开 zip 读 manifest）在 release-package-hygiene.test.js，
// 那里本来就要跑一次打包；这里只钉住白名单没把它漏掉。
const buildScript = fs.readFileSync(path.join(ROOT, "scripts", "build-release.py"), "utf8");
check("打包白名单包含 manifest.json", /"manifest\.json"/.test(buildScript));
check("私钥没有被写进打包白名单", !/extension-key\.pem/.test(buildScript));

console.log(failures === 0 ? "\n全部通过：扩展 ID 固定为 " + actualId : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
