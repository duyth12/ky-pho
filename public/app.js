const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
const glyphs = { r:'車', n:'馬', b:'象', a:'士', k:'將', c:'砲', p:'卒', R:'俥', N:'傌', B:'相', A:'仕', K:'帥', C:'炮', P:'兵' };
const modeCopy = {
  moves: ['GỢI Ý NƯỚC ĐI', 'Các nước đã biết từ kho CDB', 'queryall'],
  score: ['ĐIỂM THẾ CỜ', 'Điểm đánh giá do CDB trả về', 'queryscore'],
  line: ['BIẾN PHÂN TÍCH', 'Đường biến chính do CDB ghi nhận', 'querypv']
};
let mode = 'moves';
let flipped = false;
let position = { ranks: [], turn: 'w' };
const $ = (s) => document.querySelector(s);

function parseFen(fen) {
  const [placement, turn = 'w'] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  if (rows.length !== 10) throw new Error('FEN cần có đúng 10 hàng quân.');
  const ranks = rows.map((row) => {
    const cells = [];
    for (const char of row) {
      if (/^[1-9]$/.test(char)) for (let i = 0; i < Number(char); i++) cells.push('');
      else if (glyphs[char]) cells.push(char);
      else throw new Error(`Ký tự FEN không hợp lệ: ${char}`);
    }
    if (cells.length !== 9) throw new Error('Mỗi hàng FEN phải có đúng 9 cột.');
    return cells;
  });
  if (!['w', 'b'].includes(turn)) throw new Error('Lượt đi phải là w hoặc b.');
  return { ranks, turn };
}

function drawBoard() {
  const canvas = $('#boardCanvas');
  const lines = [];
  for (let x = 0; x < 9; x++) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="9"/>`);
  for (let y = 0; y <= 9; y++) lines.push(`<line x1="0" y1="${y}" x2="8" y2="${y}"/>`);
  lines.push('<rect class="border" x="0" y="0" width="8" height="9"/>');
  lines.push('<rect x="3" y="0" width="2" height="2"/><rect x="3" y="7" width="2" height="2"/>');
  lines.push('<text x="1.15" y="4.58">楚 河</text><text x="5.25" y="4.58">漢 界</text>');
  const svg = `<svg class="board-svg" viewBox="-0.35 -0.35 8.7 9.7" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
  const squares = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const rank = flipped ? 9 - y : y;
    const file = flipped ? 8 - x : x;
    const piece = position.ranks[rank]?.[file] || '';
    squares.push(`<div class="piece-cell">${piece ? `<span class="piece ${piece === piece.toLowerCase() ? 'black' : ''}" title="${piece}">${glyphs[piece]}</span>` : ''}</div>`);
  }
  canvas.innerHTML = svg + `<div class="pieces">${squares.join('')}</div>`;
  $('#turnLabel').textContent = position.turn === 'w' ? 'Đỏ đi' : 'Đen đi';
  $('.turn-dot').style.background = position.turn === 'w' ? 'var(--red)' : '#383a34';
}

function setFen(fen) {
  position = parseFen(fen);
  $('#fenInput').value = fen.trim();
  drawBoard();
}

function showEmpty(message, error = false) {
  const box = $('#results');
  box.className = 'results empty';
  box.innerHTML = `<span class="empty-glyph">${error ? '!' : '象'}</span><span>${message}</span>`;
}

function parseMoves(raw) {
  if (!raw || ['unknown', 'checkmate', 'stalemate', 'nobestmove'].includes(raw)) return [];
  return raw.split('|').filter(Boolean).map((entry) => {
    const fields = Object.fromEntries(entry.split(',').map((v) => {
      const i = v.indexOf(':'); return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i + 1)];
    }));
    return fields;
  });
}

async function analyze() {
  const button = $('#analyzeBtn');
  button.disabled = true;
  button.textContent = 'Đang truy vấn CDB…';
  showEmpty('Đang lấy dữ liệu từ kho cờ…');
  try {
    const response = await fetch('/api/cdb', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: modeCopy[mode][2], board: $('#fenInput').value.trim() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Truy vấn không thành công.');
    const raw = data.result;
    const results = $('#results');
    if (mode === 'moves') {
      const moves = parseMoves(raw);
      if (!moves.length) return showEmpty(raw === 'unknown' ? 'CDB chưa có dữ liệu cho thế cờ này.' : `CDB trả về: ${raw || 'chưa có dữ liệu'}`);
      results.className = 'results';
      results.innerHTML = moves.slice(0, 12).map((m, i) => `<div class="move-result"><span class="rank">${String(i + 1).padStart(2, '0')}</span><strong>${m.move || '—'}</strong><span>${m.score ? `Điểm ${m.score}` : m.winrate ? `Thắng ${m.winrate}%` : m.rank ? `Hạng ${m.rank}` : 'Đã ghi nhận'}</span></div>`).join('');
    } else {
      results.className = 'results';
      results.innerHTML = `<div class="raw-result">${escapeHtml(raw || 'CDB chưa có dữ liệu cho thế cờ này.')}</div>`;
    }
  } catch (error) {
    showEmpty(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>⌕</span> Phân tích thế cờ';
  }
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.tab.active')?.classList.remove('active');
  button.classList.add('active');
  mode = button.dataset.mode;
  $('#analysisTitle').textContent = modeCopy[mode][1];
  $('#resultKicker').textContent = modeCopy[mode][0];
  showEmpty('Chọn “Phân tích thế cờ” để tra cứu.');
}));
$('#analyzeBtn').addEventListener('click', analyze);
$('#flipBtn').addEventListener('click', () => { flipped = !flipped; drawBoard(); });
$('#loadFenBtn').addEventListener('click', () => { try { setFen($('#fenInput').value); showEmpty('Đã tải vị trí. Chọn chế độ phân tích để tra cứu.'); } catch (error) { showEmpty(error.message, true); } });
$('#resetBtn').addEventListener('click', () => { setFen(START_FEN); mode = 'moves'; document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode)); $('#analysisTitle').textContent = modeCopy.moves[1]; $('#resultKicker').textContent = modeCopy.moves[0]; showEmpty('Chọn một chế độ để tra cứu thế cờ hiện tại.'); });
try { setFen(START_FEN); } catch (error) { showEmpty(error.message, true); }
