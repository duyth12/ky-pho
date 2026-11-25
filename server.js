import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

async function handleCdb(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request too large' }));
      return;
    }
  }

  try {
    const { action, board } = JSON.parse(raw || '{}');
    const allowed = new Set(['queryall', 'querybest', 'queryscore', 'querypv']);
    if (!allowed.has(action) || typeof board !== 'string' || board.length > 300 || !/^[rnbakcpRNBKCP1-9/w ]+$/.test(board)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid action or board' }));
      return;
    }

    const url = new URL('http://www.chessdb.cn/chessdb.php');
    url.searchParams.set('action', action);
    url.searchParams.set('board', board);
    url.searchParams.set('learn', '0');
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const text = await response.text();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ action, result: text.trim() }));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error.name === 'TimeoutError' ? 'CDB request timed out' : 'Could not reach Xiangqi Cloud Database' }));
  }
}

const server = createServer(async (req, res) => {
  if (req.url === '/api/cdb') return handleCdb(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Xiangqi Lab running at http://localhost:${port}`));
