// EXE Launcher service worker
//  - games/<name>.zip : ランチャーが Cache Storage に保存したゲームZIPを返す
//  - fs/boxedwine.zip : 分割配信された Wine ファイルシステムを結合して返す（初回のみDL、以後キャッシュ）
//  - 同一オリジンの応答に COOP/COEP を付与し cross-origin isolation を有効化（AudioWorklet 用）

const GAME_CACHE = "exe-games-v1";
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

// 分割ファイルを順に取得して 1 本のストリームとして流す（受け取り側で進み具合を表示できる）
function partsStream(manifest) {
  let index = 0;
  let reader = null;
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (index >= manifest.parts.length) {
            if (total !== manifest.size) controller.error(new Error("size mismatch " + total));
            else controller.close();
            return;
          }
          const part = manifest.parts[index++];
          const res = await fetch(new URL("fs/" + part, self.registration.scope).href);
          if (!res.ok) {
            controller.error(new Error("part " + part + " " + res.status));
            return;
          }
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        total += value.byteLength;
        controller.enqueue(value);
        return;
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  const rel = url.pathname.slice(scopePath.length);

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
