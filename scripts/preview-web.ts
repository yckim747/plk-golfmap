// 웹 빌드 결과(out/)를 실제 배포와 같은 하위 경로로 띄워 확인한다. 사용: npm run build:web && npm run preview:web
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'out');
const basePath = '/golfmap';
const port = Number(process.env.PORT ?? 4000);
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

if (!existsSync(root)) { console.error('out/ 폴더가 없습니다. 먼저 npm run build:web을 실행하세요.'); process.exit(1); }

createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? '/').split('?')[0]);
  if (url === '/') { response.writeHead(302, { Location: `${basePath}/` }).end(); return; }
  if (!url.startsWith(`${basePath}/`) && url !== basePath) { response.writeHead(404).end('Not found'); return; }
  let file = path.join(root, url.slice(basePath.length));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  const found = existsSync(file);
  if (!found) file = path.join(root, '404.html');
  const type = types[path.extname(file)];
  response.writeHead(found ? 200 : 404, { 'Content-Type': type ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}).listen(port, () => console.log(`미리보기: http://localhost:${port}${basePath}/  (Kakao JS SDK 도메인에 http://localhost:${port} 등록 필요)`));
