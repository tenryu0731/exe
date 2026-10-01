// EXE Launcher service worker
//  - games/<name>.zip : ランチャーが Cache Storage に保存したゲームZIPを返す
//  - fs/boxedwine.zip : 分割配信された Wine ファイルシステムを結合して返す（分割ファイルごとに保存し、中断しても続きから取得）
//  - 同一オリジンの応答に COOP/COEP を付与し cross-origin isolation を有効化（AudioWorklet 用）

const GAME_CACHE = "exe-games-v1";
const ENGINE64_CACHE = "exe-engine64-v1";

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request.url);
  if (res.ok) await cache.put(request.url, res.clone());
  return res;
}
const FS_CACHE_PREFIX = "exe-fs-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const scopePath = new URL(self.registration.scope).pathname;

function withIsolation(response) {
  if (!response || response.status === 0 || response.type === "opaque") return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveGame(request) {
  const cache = await caches.open(GAME_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  return new Response("game not found", { status: 404 });
}

// Wine ファイルシステムは 45MB ごとの分割ファイルで配信する。分割ファイルは取得できたものから 1 つずつ
// Cache Storage に保存するので、途中で失敗・中断しても次回は続きから取得する（最初からやり直さない）。
// 通信が切れたら受け取り済みの位置から Range 指定で取り直す（1 ファイルあたり最大 6 回）。
const PART_SIZE = 45 * 1048576;
const COMPLETE_KEY = "fs/complete";
const partJobs = new Map(); // 取得中の分割ファイル → Promise<Blob>（同時要求で二重に取得しない）

async function fsManifest() {
  const manifest = await (await fetch(new URL("fs/parts.json", self.registration.scope).href, { cache: "no-cache" })).json();
  const cacheName = FS_CACHE_PREFIX + manifest.sha256.slice(0, 16);
  for (const name of await caches.keys()) {
    if (name.startsWith(FS_CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
  }
  return { manifest, cache: await caches.open(cacheName) };
}

function partUrl(name) {
  return new URL("fs/" + name, self.registration.scope).href;
}

function expectedPartSize(manifest, i) {
  return i < manifest.parts.length - 1 ? PART_SIZE : manifest.size - PART_SIZE * (manifest.parts.length - 1);
}

// 分割ファイルを 1 つ取得して保存する。受け取った断片は onChunk で順に渡す
async function downloadPart(cache, manifest, i, onChunk) {
  const name = manifest.parts[i];
  const want = expectedPartSize(manifest, i);
  const chunks = [];
  let got = 0;
  let tries = 0;
  while (got < want) {
    try {
      const res = await fetch(partUrl(name), { headers: got ? { Range: "bytes=" + got + "-" } : {}, cache: "no-store" });
      if (!res.ok) throw new Error("part " + name + " " + res.status);
      let skip = got && res.status !== 206 ? got : 0; // Range が無視されたら受け取り済みの分を読み飛ばす
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let v = value;
        if (skip) {
          if (v.byteLength <= skip) { skip -= v.byteLength; continue; }
          v = v.subarray(skip);
          skip = 0;
        }
        chunks.push(v);
        got += v.byteLength;
        if (onChunk) onChunk(v);
      }
      if (got !== want) throw new Error("part " + name + " size " + got + " / " + want);
    } catch (e) {
      if (got > want || ++tries > 6) throw e;
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** tries)));
    }
  }
  const blob = new Blob(chunks);
  await cache.put(partUrl(name), new Response(blob, { headers: { "Content-Length": String(want) } }));
  return blob;
}

async function cachedPart(cache, manifest, i) {
  const hit = await cache.match(partUrl(manifest.parts[i]));
  if (!hit) return null;
  const blob = await hit.blob();
  return blob.size === expectedPartSize(manifest, i) ? blob : null;
}

async function serveFilesystem() {
  const { manifest, cache } = await fsManifest();
  const headers = { "Content-Type": "application/zip", "Content-Length": String(manifest.size) };
  const scope = self.registration.scope;
  // 以前の版が丸ごと保存したもの
  const whole = await cache.match(scope + "fs/boxedwine.zip");
  if (whole) return whole;
  if (await cache.match(scope + COMPLETE_KEY)) {
    const blobs = [];
    for (let i = 0; i < manifest.parts.length; i++) blobs.push(await cachedPart(cache, manifest, i));
    if (blobs.every(Boolean)) return new Response(new Blob(blobs, { type: "application/zip" }), { headers });
    await cache.delete(scope + COMPLETE_KEY);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let i = 0; i < manifest.parts.length; i++) {
          let blob = await cachedPart(cache, manifest, i);
          if (!blob) {
            const name = manifest.parts[i];
            if (partJobs.has(name)) {
              blob = await partJobs.get(name);
            } else {
              const job = downloadPart(cache, manifest, i, (v) => controller.enqueue(v));
              partJobs.set(name, job);
              try { await job; } finally { partJobs.delete(name); }
              continue; // 断片は受け取りながら渡し済み
            }
          }
          const reader = blob.stream().getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        await cache.put(scope + COMPLETE_KEY, new Response("ok"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, { headers });
}

// ---------- HTML5 ゲーム（RPGツクールMV/MZ）の配信 ----------
const HTML5_CACHE = "exe-html5-v1";
const indexMemo = new Map();

function canonUrl(id, rel) {
  return self.registration.scope + "play/" + encodeURIComponent(id) + "/" +
    rel.split("/").map(encodeURIComponent).join("/");
}

async function loadIndex(cache, id) {
  if (!indexMemo.has(id)) {
    indexMemo.set(id, (async () => {
      const res = await cache.match(self.registration.scope + "play/" + encodeURIComponent(id) + "/.exe-index.json");
      return res ? res.json() : {};
    })());
  }
  return indexMemo.get(id);
}

// ゲーム内のパス → 保存済みのパス。Windows 由来の大文字小文字違い、
// iPhone で要求される .m4a が無い場合の .ogg 代替も吸収する
async function resolvePlayPath(cache, id, rel) {
  if (await cache.match(canonUrl(id, rel))) return rel;
  const index = await loadIndex(cache, id);
  const candidates = [rel];
  if (/\.m4a$/i.test(rel)) candidates.push(rel.replace(/\.m4a$/i, ".ogg"));
  if (/\.rpgmvm$/i.test(rel)) candidates.push(rel.replace(/\.rpgmvm$/i, ".rpgmvo"));
  for (const c of candidates) {
    const hit = index[c.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

function injectIntoIndex(html, id) {
  const ns = JSON.stringify("exe:" + id + ":");
  const tag =
    "<script>(function(){var p=" + ns + ";var s=Storage.prototype;" +
    "var g=s.getItem,t=s.setItem,r=s.removeItem;" +
    "s.getItem=function(k){return g.call(this,p+k)};" +
    "s.setItem=function(k,v){return t.call(this,p+k,v)};" +
    "s.removeItem=function(k){return r.call(this,p+k)};" +
    "})();</script><script src=\"../../play-audio.js\"></script><script src=\"../../play-pad.js\"></script>";
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

async function servePlay(request, id, rawRel) {
  const cache = await caches.open(HTML5_CACHE);
  let rel = rawRel.split("/").map((seg) => {
    try { return decodeURIComponent(seg); } catch (e) { return seg; }
  }).join("/").normalize("NFC");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const found = await resolvePlayPath(cache, id, rel);
  if (!found) return new Response("not found: " + rel, { status: 404 });
  const res = await cache.match(canonUrl(id, found));
  const type = res.headers.get("Content-Type") || "application/octet-stream";

  if (found.toLowerCase() === "index.html") {
    const html = injectIntoIndex(await res.text(), id);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // 動画・音声要素は Range 要求に 206 で応える必要がある
  const range = request.headers.get("Range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const blob = await res.blob();
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : blob.size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, blob.size - Number(m[2])); end = blob.size - 1; }
    end = Math.min(end, blob.size - 1);
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": "bytes " + start + "-" + end + "/" + blob.size,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      },
    });
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  const rel = url.pathname.slice(scopePath.length);

  if (rel.startsWith("play/")) {
    const slash = rel.indexOf("/", 5);
    const id = decodeURIComponent(slash < 0 ? rel.slice(5) : rel.slice(5, slash));
    const rest = slash < 0 ? "" : rel.slice(slash + 1);
    event.respondWith(servePlay(event.request, id, rest).then(withIsolation));
    return;
  }
  if (rel.startsWith("games/")) {
    event.respondWith(serveGame(event.request).then(withIsolation));
    return;
  }
  if (rel === "fs/boxedwine.zip") {
    event.respondWith(
      serveFilesystem()
        .then(withIsolation)
        .catch((e) => new Response("filesystem error: " + e.message, { status: 502 }))
    );
    return;
  }
  if (event.request.method !== "GET") return;
  // 64bit エンジンの rootfs 分割ファイルと wasm は変わらないので、一度取得したら Cache Storage から返す
  if (/^engine\/64\/.*(\.part\d+|\.wasm)$/.test(rel)) {
    event.respondWith(cacheFirst(event.request, ENGINE64_CACHE).then(withIsolation));
    return;
  }
  event.respondWith(fetch(event.request).then(withIsolation));
});

// ランチャーの「事前ダウンロード」：最後まで読み切ってキャッシュさせ、進み具合を返す
async function prefetch(client) {
  const post = (msg) => client && client.postMessage(msg);
  try {
    const res = await serveFilesystem();
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    let done = 0;
    let last = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      done += r.value.byteLength;
      if (done - last >= 2 * 1048576) {
        last = done;
        post({ type: "fs-progress", done, total });
      }
    }
    post({ type: "fs-ready" });
  } catch (e) {
    post({ type: "fs-error", message: e.message });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "prefetch-fs") event.waitUntil(prefetch(event.source));
});
