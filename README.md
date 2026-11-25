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

This is a local two-side board, not a computer opponent. Game history is kept in the current browser session and is not saved after a refresh.

## CDB lookup

The app calls CDB through the same-origin Node server route `/api/cdb` over HTTPS. It provides known moves, an evaluation score, and a principal variation when CDB has data for the position. CDB can return `unknown` when it has no stored result for the current position.

## Engine analysis

Choose **Engine** and click **Phân tích bằng engine**. Fairy-Stockfish NNUE WebAssembly v1.1.12 is bundled under `public/vendor/fairy-stockfish/`, so the engine is ready when the app files are downloaded; first use does not need a CDN or Internet connection. It analyzes the current position in the browser at depth 12 with up to three principal variations. The board position stays on the user's machine.

The engine is distributed under GPL-3.0. The license and authors list are included beside the engine files. Upstream source: <https://github.com/fairy-stockfish/fairy-stockfish.wasm>. The displayed engine score is its own evaluation scale, not a win probability or a human explanation of every tactical idea. The variations are intended to help the learner inspect possible replies.

## Next milestones

1. Add position-aware explanations that identify threats, loose pieces, checks, and tactical motifs from engine variations.
2. Add guided hint levels so learners can request a clue before seeing the best move.
3. Add saved games, puzzles, and a structured lessons path with progress tracking.
