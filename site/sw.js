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

let fsPromise = null;

async function assembleFilesystem() {
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

  const blobs = [];
  for (const part of manifest.parts) {
    const res = await fetch(new URL("fs/" + part, self.registration.scope).href);
    if (!res.ok) throw new Error("part " + part + " " + res.status);
    blobs.push(await res.blob());
  }
  const blob = new Blob(blobs, { type: "application/zip" });
  if (blob.size !== manifest.size) throw new Error("size mismatch " + blob.size);
  await cache.put(
    key,
    new Response(blob, { headers: { "Content-Type": "application/zip", "Content-Length": String(blob.size) } })
  );
  return cache.match(key);
}

async function serveFilesystem() {
  if (!fsPromise) {
    fsPromise = assembleFilesystem().finally(() => {
      fsPromise = null;
    });
  }
  const res = await fsPromise;
  return res.clone();
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

self.addEventListener("message", (event) => {
  if (event.data === "prefetch-fs") {
    event.waitUntil(
      serveFilesystem()
        .then(() => event.source && event.source.postMessage({ type: "fs-ready" }))
        .catch((e) => event.source && event.source.postMessage({ type: "fs-error", message: e.message }))
    );
  }
});
