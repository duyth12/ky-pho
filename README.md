# Kỳ Phổ — Xiangqi study room

A small Vietnamese Xiangqi study app for playing through positions and looking them up in the Xiangqi Cloud Database (CDB).

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

The app calls CDB through the same-origin Node server route `/api/cdb`, which avoids browser cross-origin and HTTPS-to-HTTP restrictions. It provides known moves, position score, and a principal variation when CDB has data for the position.

## Next milestones

1. Add game saving and import/export for common Xiangqi notation.
2. Add an optional local or hosted Xiangqi engine for computer play and positions without CDB data.
3. Add puzzles and guided lessons.
