// EXE Launcher service worker
//  - games/<name>.zip : ランチャーが Cache Storage に保存したゲームZIPを返す
//  - fs/boxedwine.zip : 分割配信された Wine ファイルシステムを結合して返す（初回のみDL、以後キャッシュ）
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

// 分割ファイルを順に取得して 1 本のストリームとして流す（受け取り側で進み具合を表示できる）。
// 通信が途中で切れたら、その分割ファイルの受け取り済みの位置から Range 指定で取り直す（最大 3 回）
function partsStream(manifest) {
  let index = 0;
  let reader = null;
  let partName = null;
  let partGot = 0;
  let retries = 0;
  let resume = false;
  let total = 0;

  async function openPart(from) {
    const headers = from > 0 ? { Range: "bytes=" + from + "-" } : {};
    const res = await fetch(new URL("fs/" + partName, self.registration.scope).href, { headers, cache: "no-store" });
    if (from > 0 && res.status !== 206) throw new Error("part " + partName + " range " + res.status);
    if (!res.ok) throw new Error("part " + partName + " " + res.status);
    reader = res.body.getReader();
  }

  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        try {
          if (resume) {
            await openPart(partGot);
            resume = false;
          }
          if (!reader) {
            if (index >= manifest.parts.length) {
              if (total !== manifest.size) controller.error(new Error("size mismatch " + total));
              else controller.close();
              return;
            }
            partName = manifest.parts[index++];
            partGot = 0;
            retries = 0;
            await openPart(0);
          }
          const { done, value } = await reader.read();
          if (done) {
            reader = null;
            continue;
          }
          partGot += value.byteLength;
          total += value.byteLength;
          controller.enqueue(value);
          return;
        } catch (e) {
          if (!partName || retries >= 3) {
            controller.error(e);
            return;
          }
          retries++;
          reader = null;
          resume = true;
          await new Promise((r) => setTimeout(r, 1000 * retries));
        }
      }
    },
    cancel() {
      if (reader) reader.cancel();
    },
  });
}

let filling = null;

async function serveFilesystem() {
  const manifestUrl = new URL("fs/parts.json", self.registration.scope).href;
  const manifest = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
  const cacheName = FS_CACHE_PREFIX + manifest.sha256.slice(0, 16);
  const key = new URL("fs/boxedwine.zip", self.registration.scope).href;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (hit) return hit;

  // 古い版のファイルシステムキャッシュを削除
  for (const name of await caches.keys()) {
    if (name.startsWith(FS_CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
  }

  const headers = { "Content-Type": "application/zip", "Content-Length": String(manifest.size) };
  const stream = partsStream(manifest);
  if (filling) return new Response(stream, { headers }); // キャッシュ書き込みは進行中の 1 本に任せる
  const [forClient, forCache] = stream.tee();
  filling = cache
    .put(key, new Response(forCache, { headers }))
    .catch(() => {})
    .finally(() => {
      filling = null;
    });
  return new Response(forClient, { headers });
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
    if (filling) await filling;
    post({ type: "fs-ready" });
  } catch (e) {
    post({ type: "fs-error", message: e.message });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "prefetch-fs") event.waitUntil(prefetch(event.source));
});
