#!/usr/bin/env node
/**
 * 本地静态预览服务器（仅用于本地演示 / 截图 / 冒烟验证，生产用 nginx）
 *
 * - 静态资源：frontend/dist
 * - SPA fallback：未知路径回落到 index.html（本项目用 hash 路由，fallback 主要给 /prime.html 之外的直链用）
 * - 反向代理：/api、/media、/uploads、/socket.io → 后端 127.0.0.1:3000（同源，避免 CORS，也方便 headless 截图）
 * - /__prime/* → scripts/ 目录（演示登录引导页，不随前端产物发布）
 *
 * 用法：node scripts/serve-web.mjs [--port 4173] [--root frontend/dist] [--api http://127.0.0.1:3000]
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(arg('port', process.env.PREVIEW_PORT ?? 4173));
const root = resolve(projectRoot, arg('root', 'frontend/dist'));
const apiTarget = new URL(arg('api', process.env.PREVIEW_API ?? 'http://127.0.0.1:3000'));
const primeRoot = join(projectRoot, 'scripts');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
};

function sendFile(res, filePath, status = 200) {
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(500);
    res.end('read error');
  });
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  stream.pipe(res);
}

function safeJoin(base, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(base, clean);
  return filePath.startsWith(base) ? filePath : null;
}

function proxy(req, res) {
  const target = new URL(req.url, apiTarget);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 502, message: `后端未启动或不可达：${error.message}` }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  if (
    url.startsWith('/api') ||
    url.startsWith('/media') ||
    url.startsWith('/uploads') ||
    url.startsWith('/socket.io')
  ) {
    proxy(req, res);
    return;
  }

  if (url.startsWith('/__prime/')) {
    const filePath = safeJoin(primeRoot, url.replace('/__prime/', ''));
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const filePath = safeJoin(root, url);
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const indexFile = join(root, 'index.html');
  if (existsSync(indexFile)) {
    sendFile(res, indexFile);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('frontend/dist 不存在，请先执行 npm run build');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${port}  root=${root}  api=${apiTarget.origin}`);
});
