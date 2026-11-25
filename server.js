import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const isolationHeaders = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless'
};

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
    const fen = typeof board === 'string' ? board.trim().split(/\s+/) : [];
    const rows = fen[0]?.split('/') || [];
    const validPlacement = rows.length === 10 && rows.every((row) => {
      let files = 0;
      for (const char of row) {
        if (/^[1-9]$/.test(char)) files += Number(char);
        else if (/^[rnbakcpRNBAKCP]$/.test(char)) files++;
        else return false;
      }
      return files === 9;
    });
    if (!allowed.has(action) || typeof board !== 'string' || board.length > 300 || fen.length !== 2 || !['w', 'b'].includes(fen[1]) || !validPlacement) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Vị trí FEN không hợp lệ. Hãy nạp lại vị trí rồi thử lại.' }));
      return;
    }

    let text = '';
    let lastError;
    for (const endpoint of ['https://www.chessdb.cn/chessdb.php', 'https://chessdb.cn/chessdb.php', 'http://www.chessdb.cn/chessdb.php']) {
      const url = new URL(endpoint);
      url.searchParams.set('action', action);
      url.searchParams.set('board', `${rows.join('/')} ${fen[1]}`);
      url.searchParams.set('learn', '0');
      try {
        const response = await fetch(url, {
          headers: { accept: 'text/plain, text/html;q=0.9, */*;q=0.8', 'user-agent': 'KyPhoStudy/0.1' },
          signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) throw new Error(`CDB returned HTTP ${response.status}`);
        text = (await response.text()).trim();
        if (!text) throw new Error('CDB trả về dữ liệu rỗng');
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    res.writeHead(200, { ...isolationHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ action, result: text }));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    const message = error.name === 'TimeoutError'
      ? 'CDB request timed out'
      : error.message.startsWith('CDB returned HTTP ')
        ? `CDB đang từ chối truy vấn (HTTP). Thử lại sau ít phút. (${error.message})`
        : 'Could not reach Xiangqi Cloud Database';
    res.end(JSON.stringify({ error: message }));
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
    const headers = { ...isolationHeaders, 'content-type': mime[extname(file)] || 'application/octet-stream' };
    if (pathname.startsWith('/vendor/fairy-stockfish/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Xiangqi Lab running at http://localhost:${port}`));
