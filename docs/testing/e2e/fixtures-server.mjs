/**
 * Fixture 静态文件服务器 —— 零依赖，纯 Node 内置模块。
 *
 * Playwright 通过 webServer 配置启动，将 docs/testing/e2e/fixtures/ 目录
 * 通过 HTTP 提供。这解决了 Chrome 扩展 content script 无法注入 file://
 * 页面的限制 —— <all_urls> 天然覆盖 http://localhost。
 *
 * 用法：node docs/testing/e2e/fixtures-server.mjs
 * 端口：process.env.PORT ?? 4173
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve(req, res) {
  // 仅允许 GET
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // 去掉 query string
  const pathname = req.url.split('?')[0];

  // 安全：拒绝路径穿越（正常化后必须在 FIXTURES_DIR 内）
  const filePath = normalize(resolve(FIXTURES_DIR, pathname === '/' ? 'basic.html' : pathname.slice(1)));
  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);

  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
  res.end(body);
}

const server = createServer(serve);
server.listen(PORT, () => {
  // Playwright webServer 通过此输出来验证服务器已就绪
  console.log(`Fixture server listening on http://localhost:${PORT}`);
});

// 优雅关闭
function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
