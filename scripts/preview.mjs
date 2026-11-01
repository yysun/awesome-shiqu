// Preview the current build's local catalogue without changing published configuration.
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

export function createPreviewServer(root = ROOT) {
  return createServer(async (request, response) => {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405, { Allow:'GET, HEAD' }).end(); return; }
    try {
      const parsed = new URL(request.url, 'http://localhost'), decoded = decodeURIComponent(parsed.pathname);
      if (decoded.includes('\0') || decoded.includes('\\')) throw Error('Invalid path');
      let file = resolve(root, '.' + decoded);
      if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const real = await realpath(file);
      if (!real.startsWith(root + sep)) throw Error('Invalid path');
      let content = await readFile(real);
      if (file === resolve(root, 'config.json')) {
        try {
          const config = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(content));
          if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('config.json 必须是对象。');
          content = Buffer.from(JSON.stringify({...config, preferRemoteCatalog:false}) + '\n');
        } catch (error) {
          console.error(`预览配置无效：${error.message}`);
          response.writeHead(500, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' }).end('预览配置无效，请检查构建中的 config.json。');
          return;
        }
      }
      response.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':content.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); response.end('没有找到这个页面。'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const port = Number(value('--port') || process.env.PORT || 4173);
  const host = value('--host') || '127.0.0.1';
  if (args.includes('--help')) { console.log('先运行 pnpm build，再运行 pnpm preview [--port 4173] [--host 127.0.0.1]。\n预览使用本次构建的本地目录，不读取远程 GitHub 目录。'); process.exit(0); }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('端口必须是 1–65535 的整数。');
  try { await stat(resolve(ROOT, 'index.html')); } catch { console.error('未找到构建结果，请先运行 pnpm build。'); process.exit(1); }
  const server = createPreviewServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Local: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close());
}
