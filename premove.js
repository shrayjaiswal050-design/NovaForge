import { applyMove, uciToMove } from './chess.js';

export function previewPremoveState(state, queue, inputColor) {
  if (!state || !Array.isArray(queue) || inputColor === null || inputColor === undefined) return state;
  let preview = { ...state, board: state.board.slice(), turn: inputColor };
  for (const planned of queue) {
    const move = uciToMove(preview, planned?.uci);
    if (!move) break;
    preview = applyMove(preview, move);
    preview.turn = inputColor;
  }
  return preview;
}

export function resolvePremove(state, queue) {
  if (!Array.isArray(queue) || !queue.length) return { move: null, queue: [], stale: false };
  const [planned, ...remaining] = queue;
  const move = uciToMove(state, planned?.uci);
  if (!move) return { move: null, queue: [], stale: true };
  return { move, queue: remaining, stale: false };
}
