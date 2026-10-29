#!/usr/bin/env node
/**
 * 固定扩展 ID 的工具。
 *
 * 未打包的扩展（load unpacked）没有 `key` 时，ID 由**扩展目录的绝对路径**派生：
 * 同一份代码放在 D:\a\LaterOn 和 C:\Users\x\LaterOn，算出来是两个不同的 ID。
 * 而 chrome.storage.local 是按扩展 ID 隔离的 —— 换个目录就等于换了个新扩展，
 * 收藏、阅读进度、同步配置全部读不到。
 *
 * 在 manifest 里写死 `key`（公钥）之后，ID 就是一个常量，与路径无关。
 *
 * 用法：
 *   node scripts/extension-id.js                 打印 manifest 里的 ID，并核对私钥
 *   node scripts/extension-id.js --generate      生成一对密钥（私钥写 extension-key.pem）
 *   node scripts/extension-id.js --generate --force   覆盖已存在的私钥（ID 会变！）
 *   node scripts/extension-id.js --key-file=x.pem --id   只看某个私钥对应的 ID
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "manifest.json");
const DEFAULT_KEY_FILE = path.join(ROOT, "extension-key.pem");

/**
 * Chrome 的扩展 ID 算法：对公钥的 DER（SubjectPublicKeyInfo）做 SHA-256，
 * 取前 16 字节，每个半字节 0-f 映射成 a-p。
 * 也就是把 32 个十六进制字符里的每个字符 c 换成 String.fromCharCode(97 + parseInt(c, 16))。
 */
function idFromPublicKeyDer(der) {
  const hash = crypto.createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i += 1) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

/** manifest.key 是 base64 编码的公钥 DER。 */
function idFromManifestKey(base64) {
  const clean = String(base64 || "").replace(/\s+/g, "");
  if (!clean) throw new Error("manifest.key 为空");
  return idFromPublicKeyDer(Buffer.from(clean, "base64"));
}

/** 从私钥（PKCS#8 PEM）反推 ID —— 用来核对 manifest 里的公钥是不是这把私钥配的。 */
function idFromPrivateKey(pem) {
  const der = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  return idFromPublicKeyDer(der);
}

/** 生成 RSA-2048 密钥对。Chrome 商店接受 2048 位；这是常用默认值。 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    key: publicKey.toString("base64"),
    pem: privateKey,
    id: idFromPublicKeyDer(publicKey),
  };
}

function readManifestKey(file = MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  return manifest.key || null;
}

/** 把 key 写进 manifest.json，保留原来的 2 空格缩进与键顺序（新增的排在末尾）。 */
function writeManifestKey(key, file = MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.key = key;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function main(argv) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };

  const keyFile = valueOf("key-file") || DEFAULT_KEY_FILE;

  if (has("--generate")) {
    if (fs.existsSync(keyFile) && !has("--force")) {
      console.error(
        `私钥已存在：${path.relative(ROOT, keyFile)}\n` +
          `覆盖会让扩展 ID 变化、已存的收藏全部读不到。确认要换就加 --force。`
      );
      return 1;
    }
    const pair = generateKeyPair();
    fs.writeFileSync(keyFile, pair.pem, { encoding: "utf8", mode: 0o600 });
    console.log(`已生成私钥：${path.relative(ROOT, keyFile)}（不要提交、不要外传）`);
    console.log(`扩展 ID  ：${pair.id}`);
    console.log("");
    console.log("把下面这行写进 manifest.json（顶层，与 version 同级）：");
    console.log(`  "key": "${pair.key}",`);
    return 0;
  }

  if (valueOf("key-file") || has("--id")) {
    if (!fs.existsSync(keyFile)) {
      console.error(`找不到私钥：${keyFile}`);
      return 1;
    }
    console.log(idFromPrivateKey(fs.readFileSync(keyFile, "utf8")));
    return 0;
  }

  // 默认：报 manifest 里的 ID，并对私钥做一次一致性核对。
  const key = readManifestKey();
  if (!key) {
    console.error("manifest.json 里没有 key —— 扩展 ID 会随目录路径变化。");
    console.error("生成一个：node scripts/extension-id.js --generate");
    return 1;
  }
  const id = idFromManifestKey(key);
  console.log(`扩展 ID：${id}`);

  if (fs.existsSync(keyFile)) {
    const fromPem = idFromPrivateKey(fs.readFileSync(keyFile, "utf8"));
    if (fromPem !== id) {
      console.error(`✗ 私钥与 manifest.key 不匹配：私钥推出 ${fromPem}`);
      console.error("  说明 manifest 里的公钥不是这把私钥配的，用这把私钥签名会得到另一个 ID。");
      return 1;
    }
    console.log("✓ 私钥与 manifest.key 匹配");
  } else {
    console.log(`（本机没有 ${path.relative(ROOT, keyFile)}，跳过私钥核对）`);
  }
  return 0;
}

module.exports = { idFromManifestKey, idFromPrivateKey, idFromPublicKeyDer, generateKeyPair };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
