const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
const glyphs = { r:'車', n:'馬', b:'象', a:'士', k:'將', c:'砲', p:'卒', R:'俥', N:'傌', B:'相', A:'仕', K:'帥', C:'炮', P:'兵' };
const pieceNames = { r:'Xe', n:'Mã', b:'Tượng', a:'Sĩ', k:'Tướng', c:'Pháo', p:'Tốt' };
const modeCopy = {
  engine: ['PHÂN TÍCH TRỰC TIẾP', 'Engine gợi ý nước đi', null],
  moves: ['DỮ LIỆU KHAI CUỘC', 'Các nước đã biết từ kho CDB', 'queryall'],
  score: ['ĐIỂM KHO CDB', 'Điểm đánh giá do CDB trả về', 'queryscore'],
  line: ['BIẾN KHO CDB', 'Đường biến do CDB ghi nhận', 'querypv']
};
let mode = 'engine';
let flipped = false;
let position = { ranks: [], turn: 'w' };
let selectedSquare = null;
let selectedMoves = [];
let moveHistory = [];
let gameOver = false;
let analysisSuggestion = null;
let isComputerGame = false;
let playerSide = 'w';
let computerThinking = false;
const evaluationCache = new Map();
let engineQueue = Promise.resolve();
let enginePromise = null;
let engineInstance = null;
let engineReady = false;
const $ = (selector) => document.querySelector(selector);

const ENGINE_VERSION = '1.1.12';
const ENGINE_BASE = `/vendor/fairy-stockfish/${ENGINE_VERSION}`;

function loadEngineScript() {
  if (window.Stockfish) return Promise.resolve();
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${ENGINE_BASE}/stockfish.js`;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Không tải được engine. Hãy kiểm tra kết nối mạng hoặc thử lại.'));
    document.head.append(script);
  }).catch((error) => { enginePromise = null; throw error; });
  return enginePromise;
}

function waitForEngineLine(engine, predicate, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.removeMessageListener(listener);
      reject(new Error('Engine phản hồi quá lâu. Hãy thử phân tích lại.'));
    }, timeoutMs);
    const listener = (line) => {
      if (!predicate(line)) return;
      clearTimeout(timer);
      engine.removeMessageListener(listener);
      resolve(line);
    };
    engine.addMessageListener(listener);
  });
}

async function getEngine() {
  if (engineInstance && engineReady) return engineInstance;
  $('#engineStatus').textContent = 'Đang tải Fairy-Stockfish…';
  if (typeof SharedArrayBuffer !== 'function' || !window.crossOriginIsolated) {
    throw new Error('Trình duyệt chưa bật chế độ bộ nhớ cần cho engine. Hãy khởi động lại server rồi mở bằng http://localhost:3000.');
  }
  await loadEngineScript();
  if (!engineInstance) {
    const response = await fetch(`${ENGINE_BASE}/stockfish.wasm`);
    if (!response.ok) throw new Error('Không tải được tệp engine WebAssembly.');
    engineInstance = await window.Stockfish({ wasmBinary: await response.arrayBuffer() });
    engineInstance.addMessageListener((line) => {
      if (line === 'uciok') engineReady = true;
    });
    const ready = waitForEngineLine(engineInstance, (line) => line === 'uciok');
    engineInstance.postMessage('uci');
    await ready;
    const optionsReady = waitForEngineLine(engineInstance, (line) => line === 'readyok');
    engineInstance.postMessage('setoption name UCI_Variant value xiangqi');
    engineInstance.postMessage('setoption name Threads value 1');
    engineInstance.postMessage('setoption name MultiPV value 3');
    engineInstance.postMessage('isready');
    await optionsReady;
  }
  $('#engineStatus').textContent = 'Sẵn sàng · chạy trên máy bạn';
  return engineInstance;
}

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

function isRed(piece) { return piece !== '' && piece === piece.toUpperCase(); }
function inBounds(row, col) { return row >= 0 && row < 10 && col >= 0 && col < 9; }
function cloneBoard(board) { return board.map((row) => [...row]); }
function findGeneral(board, red) {
  const king = red ? 'K' : 'k';
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    if (board[row][col] === king) return [row, col];
  }
  return null;
}

function pseudoMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const red = isRed(piece);
  const type = piece.toLowerCase();
  const moves = [];
  const add = (toRow, toCol) => {
    if (!inBounds(toRow, toCol)) return true;
    const target = board[toRow][toCol];
    if (!target) { moves.push([toRow, toCol]); return false; }
    if (isRed(target) !== red) moves.push([toRow, toCol]);
    return true;
  };

  if (type === 'r' || type === 'c') {
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      let screened = false;
      for (let r = row + dr, c = col + dc; inBounds(r, c); r += dr, c += dc) {
        const target = board[r][c];
        if (type === 'r') {
          if (add(r, c)) break;
        } else if (!screened) {
          if (target) screened = true;
          else moves.push([r, c]);
        } else if (target) {
          if (isRed(target) !== red) moves.push([r, c]);
          break;
        }
      }
    }
  } else if (type === 'n') {
    const jumps = [
      [2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],
      [1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1]
    ];
    for (const [dr, dc, legR, legC] of jumps) {
      if (inBounds(row + legR, col + legC) && !board[row + legR][col + legC]) add(row + dr, col + dc);
    }
  } else if (type === 'b') {
    for (const [dr, dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
      const toRow = row + dr;
      if ((red && toRow < 5) || (!red && toRow > 4)) continue;
      const toCol = col + dc;
      if (inBounds(toRow, toCol) && !board[row + dr / 2][col + dc / 2]) add(toRow, toCol);
    }
  } else if (type === 'a') {
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const r = row + dr, c = col + dc;
      if (c >= 3 && c <= 5 && (red ? r >= 7 : r <= 2)) add(r, c);
    }
  } else if (type === 'k') {
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const r = row + dr, c = col + dc;
      if (c >= 3 && c <= 5 && (red ? r >= 7 : r <= 2)) add(r, c);
    }
    for (const direction of [-1, 1]) {
      for (let r = row + direction; inBounds(r, col); r += direction) {
        if (board[r][col]) {
          if (board[r][col] === (red ? 'k' : 'K')) moves.push([r, col]);
          break;
        }
      }
    }
  } else if (type === 'p') {
    const forward = red ? -1 : 1;
    add(row + forward, col);
    const crossedRiver = red ? row <= 4 : row >= 5;
    if (crossedRiver) {
      add(row, col - 1);
      add(row, col + 1);
    }
  }
  return moves;
}

function isSquareAttacked(board, row, col, byRed) {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const piece = board[r][c];
    if (piece && isRed(piece) === byRed && pseudoMoves(board, r, c).some(([toRow, toCol]) => toRow === row && toCol === col)) return true;
  }
  return false;
}

function legalMoves(row, col) {
  const piece = position.ranks[row][col];
  if (!piece || isRed(piece) !== (position.turn === 'w')) return [];
  const ownKing = findGeneral(position.ranks, isRed(piece));
  if (!ownKing) return [];
  return pseudoMoves(position.ranks, row, col).filter(([toRow, toCol]) => {
    const target = position.ranks[toRow][toCol];
    if (target && target.toLowerCase() === 'k') return false;
    const next = cloneBoard(position.ranks);
    next[toRow][toCol] = next[row][col];
    next[row][col] = '';
    const king = findGeneral(next, isRed(piece));
    return king && !isSquareAttacked(next, king[0], king[1], !isRed(piece));
  });
}

function buildFen() {
  const placement = position.ranks.map((rank) => {
    let empty = 0, row = '';
    for (const piece of rank) {
      if (!piece) empty++;
      else { if (empty) row += empty; row += piece; empty = 0; }
    }
    if (empty) row += empty;
    return row;
  }).join('/');
  return `${placement} ${position.turn}`;
}

function buildFenFor(snapshot) {
  const placement = snapshot.ranks.map((rank) => {
    let empty = 0, row = '';
    for (const piece of rank) {
      if (!piece) empty++;
      else { if (empty) row += empty; row += piece; empty = 0; }
    }
    if (empty) row += empty;
    return row;
  }).join('/');
  return `${placement} ${snapshot.turn}`;
}

function squareLabel(row, col) { return `hàng ${row + 1}, cột ${col + 1}`; }
function pieceName(piece) { return pieceNames[piece.toLowerCase()] || 'Quân'; }

function refreshStatus() {
  const redToMove = position.turn === 'w';
  const king = findGeneral(position.ranks, redToMove);
  const inCheck = king && isSquareAttacked(position.ranks, king[0], king[1], !redToMove);
  let available = false;
  if (king) {
    outer: for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
      const piece = position.ranks[row][col];
      if (piece && isRed(piece) === redToMove && legalMoves(row, col).length) { available = true; break outer; }
    }
  }
  gameOver = !king || !available;
  $('#turnLabel').textContent = redToMove ? 'Đỏ đi' : 'Đen đi';
  $('.turn-dot').style.background = redToMove ? 'var(--red)' : '#383a34';
  $('#gameStatus').textContent = !king
    ? 'FEN này thiếu Tướng nên chỉ dùng để tra cứu.'
    : !available
      ? `${redToMove ? 'Đỏ' : 'Đen'} hết nước đi${inCheck ? ' — chiếu bí.' : '.'}`
      : inCheck ? `${redToMove ? 'Đỏ' : 'Đen'} đang bị chiếu.` : 'Chọn quân của bên đang đi.';
  $('#moveCount').textContent = `Nước ${Math.floor(moveHistory.length / 2) + 1}`;
  $('#undoBtn').disabled = moveHistory.length === 0;
  $('#playerSide').disabled = isComputerGame;
  $('#playComputerBtn').textContent = isComputerGame ? 'Dừng chơi với máy' : 'Chơi với máy';
}

function renderHistory() {
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  empty.hidden = moveHistory.length > 0;
  list.hidden = moveHistory.length === 0;
  list.innerHTML = [...moveHistory].reverse().map((move, index) => {
    const number = moveHistory.length - index;
    const side = move.red ? 'Đỏ' : 'Đen';
    return `<li><span class="history-number">${String(number).padStart(2, '0')}</span><span class="history-side ${move.red ? 'red' : 'black'}">${side}</span><span class="history-move">${move.name}: ${squareLabel(...move.from)} → ${squareLabel(...move.to)}</span><span class="history-grade" title="Đánh giá tương đối bằng Fairy-Stockfish">${escapeHtml(move.grade || 'Đang chấm…')}</span>${move.captured ? `<span class="history-capture">Ăn ${pieceName(move.captured)}</span>` : ''}</li>`;
  }).join('');
  refreshStatus();
}

function drawBoard() {
  const canvas = $('#boardCanvas');
  const lines = [];
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="9"/>`);
    else {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="4"/>`);
      lines.push(`<line x1="${x}" y1="5" x2="${x}" y2="9"/>`);
    }
  }
  for (let y = 0; y <= 9; y++) lines.push(`<line x1="0" y1="${y}" x2="8" y2="${y}"/>`);
  lines.push('<rect class="border" x="0" y="0" width="8" height="9"/>');
  lines.push('<rect x="3" y="0" width="2" height="2"/><rect x="3" y="7" width="2" height="2"/>');
  if (analysisSuggestion) {
    const [fromRow, fromCol] = analysisSuggestion.from;
    const [toRow, toCol] = analysisSuggestion.to;
    const x1 = flipped ? 8 - fromCol : fromCol;
    const y1 = flipped ? 9 - fromRow : fromRow;
    const x2 = flipped ? 8 - toCol : toCol;
    const y2 = flipped ? 9 - toRow : toRow;
    lines.push('<defs><marker id="analysisArrowHead" markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z"/></marker></defs>');
    lines.push(`<line class="analysis-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#analysisArrowHead)"/>`);
  }
  const svg = `<svg class="board-svg" viewBox="-0.35 -0.35 8.7 9.7" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
  const squares = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const row = flipped ? 9 - y : y;
    const col = flipped ? 8 - x : x;
    const piece = position.ranks[row]?.[col] || '';
    const selected = selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;
    const destination = selectedMoves.find(([toRow, toCol]) => toRow === row && toCol === col);
    const classes = ['piece-cell'];
    if (selected) classes.push('selected');
    if (destination) classes.push('legal-target', piece ? 'capture-target' : '');
    const sideLabel = piece ? `${isRed(piece) ? 'Đỏ' : 'Đen'} ${pieceName(piece)}` : 'Ô trống';
    squares.push(`<button type="button" class="${classes.filter(Boolean).join(' ')}" data-row="${row}" data-col="${col}" aria-label="${sideLabel}, ${squareLabel(row, col)}">${piece ? `<span class="piece ${isRed(piece) ? '' : 'black'}" aria-hidden="true">${glyphs[piece]}</span>` : ''}</button>`);
  }
  canvas.innerHTML = svg + `<div class="pieces">${squares.join('')}</div>`;
  const fileOrder = Array.from({ length: 9 }, (_, index) => String.fromCharCode(97 + index));
  const rankOrder = Array.from({ length: 10 }, (_, index) => String(index + 1));
  $('#fileLabels').innerHTML = (flipped ? fileOrder.reverse() : fileOrder).map((label) => `<span>${label}</span>`).join('');
  $('#rankLabels').innerHTML = (flipped ? rankOrder.reverse() : rankOrder).map((label) => `<span>${label}</span>`).join('');
  refreshStatus();
}

function setFen(fen) {
  isComputerGame = false;
  computerThinking = false;
  position = parseFen(fen);
  moveHistory = [];
  selectedSquare = null;
  selectedMoves = [];
  analysisSuggestion = null;
  evaluationCache.clear();
  $('#fenInput').value = fen.trim();
  drawBoard();
  renderHistory();
}

function makeMove(from, to) {
  const [row, col] = from, [toRow, toCol] = to;
  const piece = position.ranks[row][col];
  const captured = position.ranks[toRow][toCol];
  const before = { ranks: cloneBoard(position.ranks), turn: position.turn };
  const beforeFen = buildFenFor(before);
  const record = { id: crypto.randomUUID(), before, beforeFen, from, to, piece, captured, red: isRed(piece), name: pieceName(piece), grade: 'Đang chấm…' };
  moveHistory.push(record);
  position.ranks[toRow][toCol] = piece;
  position.ranks[row][col] = '';
  position.turn = position.turn === 'w' ? 'b' : 'w';
  selectedSquare = null;
  selectedMoves = [];
  analysisSuggestion = null;
  $('#fenInput').value = buildFen();
  drawBoard();
  renderHistory();
  void gradeMove(record, buildFen());
  if (isComputerGame && position.turn !== playerSide) void playComputerTurn();
}

function handleSquareClick(row, col) {
  if (gameOver || computerThinking || (isComputerGame && position.turn !== playerSide)) return;
  const piece = position.ranks[row][col];
  if (selectedSquare) {
    if (selectedMoves.some(([r, c]) => r === row && c === col)) {
      makeMove(selectedSquare, [row, col]);
      return;
    }
    if (piece && isRed(piece) === (position.turn === 'w')) {
      selectedSquare = [row, col];
      selectedMoves = legalMoves(row, col);
    } else {
      selectedSquare = null;
      selectedMoves = [];
    }
  } else if (piece && isRed(piece) === (position.turn === 'w')) {
    selectedSquare = [row, col];
    selectedMoves = legalMoves(row, col);
  }
  drawBoard();
}

function undoMove() {
  if (!moveHistory.length) return;
  let removeCount = 1;
  if (isComputerGame && moveHistory.at(-1)?.red !== (playerSide === 'w') && moveHistory.length > 1) removeCount = 2;
  let last;
  for (let index = 0; index < removeCount; index++) last = moveHistory.pop() || last;
  if (!last) return;
  position = last.before;
  selectedSquare = null;
  selectedMoves = [];
  $('#fenInput').value = buildFen();
  drawBoard();
  renderHistory();
}

function showEmpty(message, error = false) {
  const box = $('#results');
  box.className = 'results empty';
  box.innerHTML = `<span class="empty-glyph">${error ? '!' : '象'}</span><span>${message}</span>`;
}

function parseMoves(raw) {
  if (!raw || ['unknown', 'checkmate', 'stalemate', 'nobestmove'].includes(raw)) return [];
  return raw.split('|').filter(Boolean).map(parseCdbFields);
}

function parseCdbFields(entry) {
  return Object.fromEntries(String(entry).split(',').map((value) => {
    const index = value.indexOf(':');
    return index < 0 ? [value.trim(), ''] : [value.slice(0, index).trim(), value.slice(index + 1).trim()];
  }));
}

function cdbMoveLabel(uci, board = position.ranks) {
  const move = parseUciMove(uci);
  if (!move) return uci || '—';
  const piece = board[move.from[0]]?.[move.from[1]];
  const coords = ([row, col]) => `${String.fromCharCode(97 + col)}${9 - row}`;
  return `${piece ? pieceName(piece) : 'Quân'} ${coords(move.from)}–${coords(move.to)}`;
}

function renderCdbMoves(raw) {
  const moves = parseMoves(raw);
  if (!moves.length) return false;
  const results = $('#results');
  results.className = 'results';
  results.innerHTML = moves.slice(0, 12).map((move, index) => {
    const moveCode = String(move.move || '').replace(/^move:/, '');
    const details = [
      move.score ? `Điểm ${move.score}` : '',
      move.rank ? `Hạng ${move.rank}` : '',
      move.winrate ? `Thắng ${move.winrate}%` : '',
      move.note || ''
    ].filter(Boolean).join(' · ') || 'Đã ghi nhận trong CDB';
    return `<div class="move-result" ${parseUciMove(moveCode) ? `data-uci="${escapeHtml(moveCode)}" role="button" tabindex="0" title="Bấm để chỉ nước này trên bàn cờ"` : ''}><span class="rank">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(cdbMoveLabel(moveCode))}</strong><span>${escapeHtml(details)}</span></div>`;
  }).join('');
  results.querySelectorAll('[data-uci]').forEach((item) => {
    const pointMove = () => {
      analysisSuggestion = parseUciMove(item.dataset.uci);
      drawBoard();
    };
    item.addEventListener('click', pointMove);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pointMove(); }
    });
  });
  return true;
}

function renderCdbScore(raw) {
  if (!raw || raw === 'unknown') return false;
  const match = /(?:^|,)\s*eval:([^,|]+)/i.exec(raw);
  if (!match) return false;
  const score = match[1].trim();
  const numeric = Number(score);
  const display = Number.isFinite(numeric) ? `${numeric > 0 ? '+' : ''}${numeric}` : score;
  $('#results').className = 'results';
  $('#results').innerHTML = `<div class="cdb-score"><span class="section-kicker">ĐIỂM CDB</span><strong>${escapeHtml(display)}</strong><p>Điểm dương có lợi cho bên đang đi theo cách đánh giá của CDB. Đây là điểm kho dữ liệu, không phải phần trăm thắng hay điểm Fairy-Stockfish.</p></div>`;
  return true;
}

function renderCdbPv(raw) {
  if (!raw || raw === 'unknown') return false;
  const fields = parseCdbFields(raw);
  const pvValue = fields.pv || '';
  const pv = pvValue.split(/[|\s]+/).filter((move) => parseUciMove(move));
  if (!pv.length) return false;
  const facts = [fields.score ? `Điểm ${fields.score}` : '', fields.depth ? `độ sâu ${fields.depth}` : ''].filter(Boolean).join(' · ');
  $('#results').className = 'results';
  $('#results').innerHTML = `<div class="cdb-pv"><span class="section-kicker">BIẾN CDB${facts ? ` · ${escapeHtml(facts)}` : ''}</span><p>${escapeHtml(formatPrincipalVariation(pv, position.ranks, position.turn))}</p><small>Bấm một nước trong biến để chỉ nước đó trên bàn cờ.</small><div class="cdb-pv-moves">${pv.map((uci, index) => `<button type="button" class="cdb-pv-move" data-uci="${escapeHtml(uci)}">${index + 1}. ${escapeHtml(cdbMoveLabel(uci))}</button>`).join('')}</div></div>`;
  $('#results').querySelectorAll('[data-uci]').forEach((item) => item.addEventListener('click', () => {
    analysisSuggestion = parseUciMove(item.dataset.uci);
    drawBoard();
  }));
  return true;
}

async function analyze() {
  const button = $('#analyzeBtn');
  if (mode === 'engine') return analyzeWithEngine(button);
  button.disabled = true;
  button.textContent = 'Đang truy vấn CDB…';
  $('#sourcePill').textContent = 'CDB';
  $('#hint').textContent = 'Đang tra cứu dữ liệu các ván cờ đã ghi nhận…';
  showEmpty('Đang lấy dữ liệu từ kho cờ…');
  try {
    const response = await fetch('/api/cdb', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: modeCopy[mode][2], board: buildFen() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Truy vấn không thành công.');
    const raw = data.result;
    const results = $('#results');
    const rendered = mode === 'moves' ? renderCdbMoves(raw) : mode === 'score' ? renderCdbScore(raw) : renderCdbPv(raw);
    if (!rendered) {
      const message = raw === 'unknown'
        ? 'CDB chưa có dữ liệu cho thế cờ này.'
        : ['checkmate', 'stalemate'].includes(raw)
          ? `CDB báo thế cờ ${raw === 'checkmate' ? 'chiếu bí' : 'hòa bí'}.`
          : raw === 'invalid board'
            ? 'CDB không chấp nhận FEN này. Hãy tải lại vị trí FEN hợp lệ.'
            : `CDB chưa trả dữ liệu theo định dạng dự kiến${raw ? `: ${raw}` : '.'}`;
      showEmpty(message);
    }
    $('#hint').textContent = mode === 'moves'
      ? 'Đây là dữ liệu các nước đã có trong CDB; bấm một nước để chỉ nó trên bàn cờ.'
      : mode === 'score'
        ? 'Điểm dương nghĩa là bên đang đi có lợi theo đánh giá của CDB.'
        : 'Biến và độ sâu do CDB trả về; bấm một nước trong biến để chỉ nó trên bàn cờ.';
  } catch (error) {
    showEmpty(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = mode === 'engine' ? '<span>⌕</span> Phân tích bằng engine' : '<span>⌕</span> Tra cứu CDB';
  }
}

function parseEngineInfo(line) {
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/) || [];
  return score && pv.length ? { depth, multipv, unit: score[1], value: Number(score[2]), pv } : null;
}

function queueEngineTask(task) {
  const pending = engineQueue.then(task, task);
  engineQueue = pending.catch(() => {});
  return pending;
}

function searchEngine(fen, depth, multipv = 1) {
  return queueEngineTask(async () => {
    const engine = await getEngine();
    const ready = waitForEngineLine(engine, (line) => line === 'readyok');
    engine.postMessage(`setoption name MultiPV value ${multipv}`);
    engine.postMessage(`position fen ${fen} 0 1`);
    engine.postMessage('isready');
    await ready;
    return new Promise((resolve, reject) => {
      const lines = new Map();
      const timer = setTimeout(() => {
        engine.postMessage('stop');
        engine.removeMessageListener(listener);
        reject(new Error('Engine phản hồi quá lâu.'));
      }, 90000);
      const listener = (line) => {
        if (line.startsWith('info ')) {
          const info = parseEngineInfo(line);
          if (info && info.depth >= (lines.get(info.multipv)?.depth || 0)) lines.set(info.multipv, info);
        }
        if (line.startsWith('bestmove ')) {
          clearTimeout(timer);
          engine.removeMessageListener(listener);
          resolve({ bestMove: line.split(/\s+/)[1], lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) });
        }
      };
      engine.addMessageListener(listener);
      engine.postMessage(`go depth ${depth}`);
    });
  });
}

function scoreToRed(info, fen) {
  if (!info) return null;
  const sideToMove = fen.trim().split(/\s+/)[1] || 'w';
  let score = info.unit === 'mate'
    ? Math.sign(info.value || 1) * (100000 - Math.min(Math.abs(info.value), 999) * 100)
    : info.value;
  if (sideToMove === 'b') score = -score;
  return score;
}

function moveGrade(delta) {
  if (delta <= -300) return 'Sai lầm lớn';
  if (delta <= -150) return 'Sai lầm';
  if (delta <= -70) return 'Chưa chính xác';
  if (delta >= 120) return 'Nước rất tốt';
  if (delta >= 45) return 'Nước tốt';
  return 'Ổn';
}

async function evaluateFen(fen) {
  if (evaluationCache.has(fen)) return evaluationCache.get(fen);
  const result = await searchEngine(fen, 8, 1);
  const score = scoreToRed(result.lines[0], fen);
  if (score === null) throw new Error('Engine chưa chấm được thế cờ này.');
  evaluationCache.set(fen, score);
  return score;
}

async function gradeMove(record, afterFen) {
  try {
    const [beforeScore, afterScore] = await Promise.all([evaluateFen(record.beforeFen), evaluateFen(afterFen)]);
    const gainForMover = (afterScore - beforeScore) * (record.red ? 1 : -1);
    record.grade = `${moveGrade(gainForMover)} · ${gainForMover >= 0 ? '+' : ''}${(gainForMover / 100).toFixed(1)}`;
  } catch {
    record.grade = 'Chưa chấm được';
  }
  if (moveHistory.some((move) => move.id === record.id)) renderHistory();
}

async function playComputerTurn() {
  if (!isComputerGame || gameOver || position.turn === playerSide || computerThinking) return;
  computerThinking = true;
  $('#gameStatus').textContent = 'Máy đang suy nghĩ…';
  const fen = buildFen();
  try {
    const result = await searchEngine(fen, 10, 1);
    if (!isComputerGame || buildFen() !== fen || !result.bestMove || result.bestMove === '(none)') return;
    const move = parseUciMove(result.bestMove);
    if (!move) throw new Error('Máy trả về nước đi không đọc được.');
    const piece = position.ranks[move.from[0]]?.[move.from[1]];
    if (!piece || isRed(piece) !== (position.turn === 'w') || !legalMoves(...move.from).some(([row, col]) => row === move.to[0] && col === move.to[1])) {
      throw new Error('Nước máy đề xuất không hợp lệ trong thế cờ hiện tại.');
    }
    makeMove(move.from, move.to);
  } catch (error) {
    $('#gameStatus').textContent = `Không đi được nước máy: ${error.message}`;
  } finally {
    computerThinking = false;
    if (isComputerGame && position.turn === playerSide && !gameOver) $('#gameStatus').textContent = 'Đến lượt bạn.';
  }
}

function parseUciMove(uci) {
  const match = /^([a-i])([0-9])([a-i])([0-9])$/.exec(uci || '');
  if (!match) return null;
  const file = (letter) => letter.charCodeAt(0) - 97;
  return { from: [9 - Number(match[2]), file(match[1])], to: [9 - Number(match[4]), file(match[3])] };
}

function explainEngineMove(uci, board, turn) {
  const move = parseUciMove(uci);
  if (!move) return { label: uci, clue: '' };
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const piece = board[fromRow]?.[fromCol];
  const captured = board[toRow]?.[toCol];
  const name = piece ? pieceName(piece) : 'Quân';
  const square = ([row, col]) => `${String.fromCharCode(97 + col)}${9 - row}`;
  const next = cloneBoard(board);
  next[toRow][toCol] = piece;
  next[fromRow][fromCol] = '';
  const enemyKing = findGeneral(next, !isRed(piece));
  const givesCheck = enemyKing && isSquareAttacked(next, enemyKing[0], enemyKing[1], isRed(piece));
  const clues = [];
  if (captured) clues.push(`ăn ${pieceName(captured)}`);
  if (givesCheck) clues.push('chiếu Tướng');
  const clue = clues.length
    ? `${name} ${square(move.from)} → ${square(move.to)}: ${clues.join(', ')}.`
    : `${name} ${square(move.from)} → ${square(move.to)}.`;
  return { label: `${name} ${square(move.from)}–${square(move.to)}`, clue };
}

function formatPrincipalVariation(pv, sourceBoard, startingTurn) {
  const board = cloneBoard(sourceBoard);
  let turn = startingTurn;
  return pv.map((uci, ply) => {
    const move = parseUciMove(uci);
    if (!move) return `${ply + 1}. ${uci}`;
    const described = explainEngineMove(uci, board, turn);
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    board[toRow][toCol] = board[fromRow][fromCol];
    board[fromRow][fromCol] = '';
    turn = turn === 'w' ? 'b' : 'w';
    return `${ply + 1}. ${described.label}`;
  }).join('  ·  ');
}

function scoreText(info) {
  if (info.unit === 'mate') return `mate ${info.value > 0 ? '+' : ''}${info.value} · engine dự báo chiếu bí`;
  return `${info.value > 0 ? '+' : ''}${(info.value / 100).toFixed(2)} điểm engine`;
}

async function analyzeWithEngine(button) {
  button.disabled = true;
  button.textContent = 'Đang khởi động engine…';
  $('#sourcePill').textContent = 'FAIRY-STOCKFISH';
  $('#hint').textContent = 'Engine đã được đóng gói cùng app; phân tích chạy trên máy và không cần tải engine từ Internet.';
  showEmpty('Đang khởi động engine trên máy bạn…');
  try {
    const fen = buildFen();
    button.textContent = 'Engine đang phân tích…';
    $('#hint').textContent = 'Engine đang tìm các phương án. Bạn có thể đọc biến chính để xem phản ứng của cả hai bên.';
    const result = await searchEngine(fen, 12, 3);
    if (buildFen() !== fen) throw new Error('Thế cờ đã đổi trong lúc phân tích; hãy phân tích lại vị trí mới.');
    if (!result.bestMove || result.bestMove === '(none)' || !result.lines.length) {
      showEmpty('Engine không tìm thấy nước đi. Hãy kiểm tra lại vị trí FEN.', true);
      return;
    }
    const results = $('#results');
    results.className = 'results engine-results';
    const best = result.lines[0];
    const first = explainEngineMove(result.bestMove, position.ranks, position.turn);
    const bestMove = parseUciMove(result.bestMove);
    analysisSuggestion = bestMove;
    drawBoard();
    results.innerHTML = `<div class="engine-best"><span class="section-kicker">NƯỚC TỐT NHẤT · ĐỘ SÂU ${best.depth}</span><strong>${escapeHtml(first.label)}</strong><small>${escapeHtml(scoreText(best))}</small><p>${escapeHtml(first.clue)} ${first.clue.includes('ăn ') || first.clue.includes('chiếu') ? 'Hãy xem các phản ứng trong biến bên dưới trước khi kết luận nước này có lợi.' : 'Tự thử tìm quân hoặc ô mà nước này đang gây sức ép; engine cho biết lựa chọn mạnh, còn biến giúp bạn kiểm tra ý tưởng.'}</p><button class="text-button try-engine-move" type="button">Thử nước này trên bàn cờ ↗</button></div><div class="engine-lines">${result.lines.map((info, index) => {
      const moveText = formatPrincipalVariation(info.pv, position.ranks, position.turn);
      return `<div class="engine-line"><div class="engine-line-head"><span>Phương án ${index + 1}</span><b>${escapeHtml(scoreText(info))}</b></div><p>${escapeHtml(moveText)}</p></div>`;
    }).join('')}</div>`;
    $('#hint').textContent = 'Điểm số dùng thang riêng của engine; các phương án là biến dự kiến, không phải lời giải thích chắc chắn cho mọi ý đồ chiến thuật.';
    results.querySelector('.try-engine-move')?.addEventListener('click', () => {
      const piece = bestMove && position.ranks[bestMove.from[0]]?.[bestMove.from[1]];
      if (!bestMove || !piece || isRed(piece) !== (position.turn === 'w')) return;
      if (!legalMoves(...bestMove.from).some(([row, col]) => row === bestMove.to[0] && col === bestMove.to[1])) return;
      makeMove(bestMove.from, bestMove.to);
      $('#hint').textContent = 'Bạn đã thử nước engine gợi ý. Phân tích lại để xem cách đối phương có thể đáp trả.';
    });
  } catch (error) {
    $('#engineStatus').textContent = 'Chưa kết nối được engine';
    showEmpty(`${error.message} Có thể dùng các tab CDB trong lúc này.`, true);
  } finally {
    button.disabled = false;
    button.innerHTML = mode === 'engine' ? '<span>⌕</span> Phân tích bằng engine' : '<span>⌕</span> Tra cứu CDB';
  }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }

$('#boardCanvas').addEventListener('click', (event) => {
  const square = event.target.closest('.piece-cell');
  if (square) handleSquareClick(Number(square.dataset.row), Number(square.dataset.col));
});
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.tab.active')?.classList.remove('active');
  button.classList.add('active');
  mode = button.dataset.mode;
  $('#analysisTitle').textContent = modeCopy[mode][1];
  $('#resultKicker').textContent = modeCopy[mode][0];
  $('#sourcePill').textContent = mode === 'engine' ? 'FAIRY-STOCKFISH' : 'CDB';
  $('#hint').textContent = mode === 'engine' ? 'Engine phân tích trực tiếp vị trí hiện tại trên trình duyệt của bạn.' : 'Tra cứu cơ sở dữ liệu Cờ Tướng Cloud Database.';
  $('#analyzeBtn').innerHTML = mode === 'engine' ? '<span>⌕</span> Phân tích bằng engine' : '<span>⌕</span> Tra cứu CDB';
  showEmpty(mode === 'engine' ? 'Bấm “Phân tích bằng engine” để bắt đầu.' : 'Bấm “Tra cứu CDB” để lấy dữ liệu.');
}));
$('#analyzeBtn').addEventListener('click', analyze);
$('#flipBtn').addEventListener('click', () => { flipped = !flipped; drawBoard(); });
$('#undoBtn').addEventListener('click', undoMove);
$('#playComputerBtn').addEventListener('click', () => {
  if (isComputerGame) {
    isComputerGame = false;
    computerThinking = false;
    refreshStatus();
    $('#gameStatus').textContent = 'Đã dừng chơi với máy. Bạn có thể đi cả hai bên.';
    return;
  }
  try {
    setFen(START_FEN);
    playerSide = $('#playerSide').value;
    isComputerGame = true;
    $('#hint').textContent = `Bạn cầm quân ${playerSide === 'w' ? 'Đỏ' : 'Đen'}; Fairy-Stockfish sẽ đi bên còn lại.`;
    $('#gameStatus').textContent = 'Ván mới với máy đã bắt đầu.';
    refreshStatus();
    if (position.turn !== playerSide) void playComputerTurn();
  } catch (error) {
    showEmpty(error.message, true);
  }
});
$('#loadFenBtn').addEventListener('click', () => {
  try { setFen($('#fenInput').value); showEmpty('Đã tải vị trí. Chọn quân để bắt đầu ván.'); }
  catch (error) { showEmpty(error.message, true); }
});
$('#resetBtn').addEventListener('click', () => {
  isComputerGame = false;
  computerThinking = false;
  setFen(START_FEN);
  mode = 'engine';
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  $('#analysisTitle').textContent = modeCopy.engine[1];
  $('#resultKicker').textContent = modeCopy.engine[0];
  $('#sourcePill').textContent = 'FAIRY-STOCKFISH';
  $('#hint').textContent = 'Engine phân tích trực tiếp vị trí hiện tại trên trình duyệt của bạn.';
  $('#analyzeBtn').innerHTML = '<span>⌕</span> Phân tích bằng engine';
  showEmpty('Bấm “Phân tích bằng engine” để bắt đầu.');
});
try { setFen(START_FEN); showEmpty('Bấm “Phân tích bằng engine” để bắt đầu.'); } catch (error) { showEmpty(error.message, true); }
