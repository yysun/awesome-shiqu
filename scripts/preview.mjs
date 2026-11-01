import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const port = Number(value('--port') || process.env.PORT || 4173);
const host = value('--host') || '127.0.0.1';
if (args.includes('--help')) { console.log('先运行 pnpm build，再运行 pnpm preview [--port 4173] [--host 127.0.0.1]。'); process.exit(0); }
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('端口必须是 1–65535 的整数。');
try { await stat(resolve(root, 'index.html')); } catch { console.error('未找到构建结果，请先运行 pnpm build。'); process.exit(1); }
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const server = createServer(async (request, response) => {
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405, { Allow:'GET, HEAD' }).end(); return; }
  try {
    const parsed = new URL(request.url, 'http://localhost'), decoded = decodeURIComponent(parsed.pathname);
    if (decoded.includes('\0') || decoded.includes('\\')) throw Error('Invalid path');
    let file = resolve(root, '.' + decoded);
    if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const real = await realpath(file);
    if (!real.startsWith(root + sep)) throw Error('Invalid path');
    const content = await readFile(real);
    response.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':content.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); response.end('没有找到这个页面。'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Local: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close());
