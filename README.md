# Kỳ Phổ — Xiangqi study room

Small starter web app for exploring Xiangqi positions with the Xiangqi Cloud Database (CDB).

## Run locally

Requires Node.js 20 or newer. No package install is needed.

```sh
npm start
```

Then open `http://localhost:3000`.

## Current scope

- Shows the initial Xiangqi position and can load a position in CDB FEN notation.
- Calls CDB through a same-origin Node server route, avoiding browser cross-origin and HTTPS-to-HTTP restrictions.
- Provides tabs for known moves, position score, and analysis line.
- Keeps the CDB connection in the server so the UI can later use an engine/database adapter without changing the board screen.

This is an analysis prototype, not yet a complete game. It does not validate legal moves, save accounts or games, import PGN, or include an Xiangqi engine. CDB provides data for positions it knows; it is not a user-owned game database.

## Suggested next milestones

1. Add a rules-aware Xiangqi board and move history.
2. Import/export common Xiangqi game notation and review each position in a game.
3. Add persistent storage for user games and saved analysis.
4. Add an optional local or hosted engine for positions without CDB data.
5. Add puzzles, lessons, and play modes as separate sections.
