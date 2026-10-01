// 公開物（_site）を実際のブラウザで動かす確認。CI（deploy.yml の e2e ジョブ）で実行する。
// usage: node e2e.mjs <base url>   例: http://localhost:8765/exe/
// 画面は JPEG を base64 で「SHOT <名前> <data>」行としてログに出す（成果物を外から取得できない環境向け）。
import { chromium, webkit, devices } from "playwright";
import fs from "fs";

const BASE = process.argv[2] || "http://localhost:8765/exe/";
const results = [];

function storedZip(entries) {
  // 無圧縮 ZIP（CRC32 付き）
  const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), d = Buffer.from(data), c = crc(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(c, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8);
    cd.writeUInt32LE(c, 16); cd.writeUInt32LE(d.length, 20); cd.writeUInt32LE(d.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(h, n, d); central.push(cd, n); off += 30 + n.length + d.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// テスト用アプリ
fs.writeFileSync("/tmp/hellodos.zip", storedZip([["HELLO/HELLO.COM",
  Buffer.concat([Buffer.from([0xba, 0x09, 0x01, 0xb4, 0x09, 0xcd, 0x21, 0xeb, 0xfe]), Buffer.from("HELLO FROM DOS IN THE BROWSER$")])]]));
fs.writeFileSync("/tmp/mvgame.zip", storedZip([
  ["G/Game.exe", "MZ"],
  ["G/www/js/rpg_core.js", "window.CORE='ok';"],
  ["G/www/index.html", "<!doctype html><html><head><meta charset=utf-8></head><body style='margin:0;background:#264'>" +
    "<script src='js/rpg_core.js'></script><h1 style='color:#fff;font:40px sans-serif;padding:40px'>MV OK</h1>" +
    "<script>window.__ok = window.CORE;</script></body></html>"],
]));

async function shot(page, name) {
  const buf = await page.screenshot({ type: "jpeg", quality: 45 });
  console.log("SHOT " + name + " " + buf.toString("base64"));
}

// canvas の中身が「ほぼ単色」ではないか（何か描画されているか）を調べる
async function canvasStats(page) {
  return page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")].filter((c) => c.width > 0 && c.height > 0);
    let best = null;
    for (const c of cs) {
      try {
        const t = document.createElement("canvas");
        t.width = 160; t.height = 120;
        const ctx = t.getContext("2d");
        ctx.drawImage(c, 0, 0, 160, 120);
        const d = ctx.getImageData(0, 0, 160, 120).data;
        const colors = new Set();
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          colors.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
          if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
        }
        const s = { w: c.width, h: c.height, colors: colors.size, lit: Math.round((lit / (160 * 120)) * 100) };
        if (!best || s.colors > best.colors) best = s;
      } catch (e) {}
    }
    return best;
  });
}

async function newPage(browserType, label) {
  // 一時プロファイルの WebKit は OPFS（ファイル保存）を使えないので、毎回新しい保存先つきのプロファイルで開く
  const dir = fs.mkdtempSync("/tmp/e2e-profile-");
  const browser = await browserType.launchPersistentContext(dir, {
    ...(process.env.E2E_CHROMIUM && browserType === chromium ? { executablePath: process.env.E2E_CHROMIUM } : {}),
    ...devices["iPhone 13"], locale: "en-US", ...(browserType === chromium ? { isMobile: false, hasTouch: true } : {}),
  });
  const page = browser.pages()[0] || await browser.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  // Service Worker が制御を始めたあとで読み直す（WebKit では読み直しが取り消されることがあるので数回試す）
  for (let i = 0; ; i++) {
    try {
      await page.goto(BASE);
      await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
      await page.goto(BASE);
      await page.waitForSelector("#pick", { timeout: 30000 });
      break;
    } catch (e) {
      if (i >= 2) throw e;
      await page.waitForTimeout(2000);
    }
  }
  await page.waitForTimeout(1000);
  console.log(label, "OPFS:", await page.evaluate(async () => {
    try { await navigator.storage.getDirectory(); return "ok"; } catch (e) { return "no: " + e.message; }
  }));
  return { browser, page, logs, label };
}

async function addFile(page, path) {
  await page.setInputFiles("#picker", path);
  await page.waitForFunction(() => /Added|Could not/.test(document.querySelector("#add-status").textContent), null, { timeout: 60000 });
  return page.textContent("#add-status");
}

async function testWineDemo(browserType, label) {
  const { browser, page, logs } = await newPage(browserType, label);
  const t0 = Date.now();
  try {
    await Promise.all([page.waitForURL(/engine\/jit\/boxedwine\.html/, { timeout: 120000 }), page.click("#demo")]);
    let stats = null, best = null;
    const rounds = Number(process.env.E2E_WINE_ROUNDS || 40);
    for (let i = 0; i < rounds; i++) { // 既定で最大 10 分
      await page.waitForTimeout(15000);
      stats = await canvasStats(page);
      console.log(label, "wine", Math.round((Date.now() - t0) / 1000) + "s", JSON.stringify(stats));
      if (stats && (!best || stats.colors > best.colors)) best = stats;
      if (i === 3 || i === 8) await shot(page, label + "-wine-" + i);
      // 7-Zip のウインドウ（多色の UI）が出たら完了
      if (stats && stats.colors >= 12 && stats.lit >= 20) { await page.waitForTimeout(5000); break; }
    }
    await shot(page, label + "-wine-final");
    const ok = !!(best && best.colors >= 12);
    results.push([label + " wine 7-Zip demo", ok, JSON.stringify(best), Math.round((Date.now() - t0) / 1000) + "s"]);
    console.log(label, "wine logs:\n" + logs.filter((l) => /rror|fail|Exception|abort|wine|Mounted|Loaded/i.test(l)).slice(-40).join("\n"));
  } catch (e) {
    results.push([label + " wine 7-Zip demo", false, e.message]);
    await shot(page, label + "-wine-error").catch(() => {});
  }
  await browser.close();
}

// 確認アプリ（scripts/probe）：日本語フォルダ・保存・DirectX・日本語フォントなどを Wine 上で試す。
// CI で /tmp/probe.zip を作ってあるときだけ実行。Wine Mono（.NET）は入れていないので NG でよい
async function testProbe(browserType, label) {
  if (!fs.existsSync("/tmp/probe.zip")) return;
  const { browser, page, logs } = await newPage(browserType, label);
  const t0 = Date.now();
  try {
    await addFile(page, "/tmp/probe.zip");
    await Promise.all([page.waitForURL(/engine\/jit\/boxedwine\.html/, { timeout: 120000 }), page.locator("#library button.primary").first().click()]);
    const rounds = Number(process.env.E2E_WINE_ROUNDS || 40);
    for (let i = 0; i < rounds && !logs.some((l) => /PROBE (OK|NG) font Meiryo/.test(l)); i++) await page.waitForTimeout(15000);
    await page.waitForTimeout(5000);
    const lines = logs.filter((l) => l.startsWith("PROBE "));
    console.log(label, "probe:\n" + lines.join("\n"));
    await shot(page, label + "-probe");
    const ng = lines.filter((l) => l.startsWith("PROBE NG") && !/Wine Mono/.test(l));
    results.push([label + " probe (Japanese, saves, DirectX, fonts)", lines.length >= 25 && ng.length === 0,
      ng.join(" / ") || lines.length + " checks", Math.round((Date.now() - t0) / 1000) + "s"]);
  } catch (e) {
    results.push([label + " probe", false, e.message]);
    await shot(page, label + "-probe-error").catch(() => {});
  }
  await browser.close();
}

async function testDos(browserType, label) {
  const { browser, page } = await newPage(browserType, label);
  try {
    await addFile(page, "/tmp/hellodos.zip");
    await Promise.all([page.waitForURL(/dos\.html/), page.locator("#library button.primary").first().click()]);
    await page.waitForTimeout(15000);
    const stats = await canvasStats(page);
    await shot(page, label + "-dos");
    results.push([label + " DOS", !!(stats && stats.colors >= 3), JSON.stringify(stats)]);
  } catch (e) {
    results.push([label + " DOS", false, e.message]);
  }
  await browser.close();
}

async function testMv(browserType, label) {
  const { browser, page } = await newPage(browserType, label);
  try {
    await addFile(page, "/tmp/mvgame.zip");
    await Promise.all([page.waitForURL(/play\//), page.locator("#library button.primary").first().click()]);
    await page.waitForFunction(() => window.__ok === "ok", null, { timeout: 20000 });
    await shot(page, label + "-mv");
    results.push([label + " RPG Maker MV (HTML5)", true, ""]);
  } catch (e) {
    results.push([label + " RPG Maker MV (HTML5)", false, e.message]);
  }
  await browser.close();
}

async function launcherShot(browserType, label) {
  const { browser, page } = await newPage(browserType, label);
  await shot(page, label + "-launcher");
  await browser.close();
}

const wanted = (process.env.E2E_BROWSERS || "webkit,chromium").split(",");
for (const [type, label] of [[webkit, "webkit"], [chromium, "chromium"]].filter(([, l]) => wanted.includes(l))) {
  for (const [name, test] of [["launcher", launcherShot], ["MV", testMv], ["DOS", testDos], ["wine demo", testWineDemo], ["probe", testProbe]]) {
    // 1 つの失敗で残りの確認を止めない
    try { await test(type, label); } catch (e) { results.push([label + " " + name, false, "setup: " + e.message.split("\n")[0]]); }
  }
}

console.log("\n==== E2E RESULTS ====");
for (const r of results) console.log((r[1] ? "PASS" : "FAIL") + "  " + r[0] + "  " + (r.slice(2).join("  ")));
