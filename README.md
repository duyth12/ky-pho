# Kỳ Phổ — Xiangqi study room

A Vietnamese Xiangqi study app for playing through positions, analyzing with Fairy-Stockfish, and looking up known games in the Xiangqi Cloud Database (CDB).

## Run locally

Requires Node.js 20 or newer. The app has no package dependencies.

```sh
npm start
```

Then open `http://localhost:3000`.

## Play through a position

- Select a piece on the board. Its legal destinations are highlighted.
- Select a highlighted square to move. Turns alternate between Red and Black.
- The board checks piece movement, blocked paths, palace and river limits, check, and whether a move leaves your General in check.
- Use **Lùi một nước** to undo the last move, or **Ván mới** to reset.
- Load a CDB FEN position to continue from it. The FEN structure and piece symbols are checked before loading.
- Use **Sao chép FEN** to copy the current board and side to move, or **Chia sẻ vị trí** to copy a link that opens that position in Kỳ Phổ.
- Use **Đổi lượt đi** when studying a position from the other side to move. This starts a fresh analysis history for that position.
- Use **Máy tự đi → Đỏ / Đen** to let Fairy-Stockfish move for either side. Turn on both colors to watch a machine-versus-machine game; turn a side off to take over its moves. The regular **Chơi với máy** control starts a new game where you choose your color.
- Use **↻** to flip the board orientation. File and rank labels move with the board.
- The board shows files `a`–`i` below it and ranks `1`–`10` on the right; the river is left clear so its grid does not run through a label.
- After each move, Fairy-Stockfish estimates how much the move changed the position and labels it (for example, **Nước tốt** or **Sai lầm**). This quick label is an engine estimate, not a human referee's verdict.
- To play the computer, choose whether you want Red or Black, then click **Chơi với máy**. The computer moves automatically for the other side. Click **Dừng chơi với máy** to return to two-side analysis. In a computer game, **Lùi một nước** takes back the last pair when both sides have moved.

Game history is kept in the current browser session and is not saved after a refresh.

## CDB lookup

The three CDB tabs use the same local `/api/cdb` route and send the current Xiangqi FEN to the Cloud Database. The server tries the official HTTPS address and alternate host, then falls back to HTTP if needed. The response distinguishes a network failure from `unknown` (CDB answered, but has no saved data for that position) and an invalid position. The app checks the FEN layout and both Red and Black advisor symbols before sending it.

To use the tabs, start the Node server and click **Tra cứu CDB** from **Nước CDB**, **Điểm CDB**, or **Biến CDB**. The initial position is a useful connection check. CDB coverage varies by position; a returned `unknown` means the request succeeded but the database has no result for that board.

## Engine analysis

Choose **Engine** and click **Phân tích bằng engine**. Fairy-Stockfish NNUE WebAssembly v1.1.12 is bundled under `public/vendor/fairy-stockfish/`, so the engine is ready when the app files are downloaded; first use does not need a CDN or Internet connection. It analyzes the current position in the browser at depth 12 with up to three principal variations. The board position stays on the user's machine.

The best move explanation now separates observable board effects (captures, checks, newly attacked pieces, and whether the moved piece is left under attack) from the engine's projected line and score. After each played move, history also shows the score change from the mover's point of view. These are calculated study cues; the engine's score is its own evaluation scale, not a win probability or a complete human explanation of positional ideas.

The engine is distributed under GPL-3.0. The license and authors list are included beside the engine files. Upstream source: <https://github.com/fairy-stockfish/fairy-stockfish.wasm>.

## Learning roadmap

Next learning features should focus on position-aware explanations (threats, loose pieces, checks, and tactical motifs), guided hint levels, and saved games with puzzles and progress tracking.
