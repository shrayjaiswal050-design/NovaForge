import { positionKey, stateFromFEN, moveToUci } from './chess.js';
import { searchBestMove } from './engine.js';

function deserializeRepetitionCounts(value) {
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) return new Map(value.filter((entry) => Array.isArray(entry) && entry.length >= 2));
  if (value && typeof value === 'object') return new Map(Object.entries(value));
  return null;
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'search') return;
  try {
    const state = stateFromFEN(message.fen);
    const repetitionCounts = deserializeRepetitionCounts(message.repetitionCounts);
    if (repetitionCounts) {
      const currentKey = positionKey(state);
      if (!repetitionCounts.has(currentKey)) repetitionCounts.set(currentKey, 1);
      state.positionCounts = repetitionCounts;
    }
    const result = searchBestMove(state, message.limits, (info) => {
      self.postMessage({ type: 'info', requestId: message.requestId, ...info });
    });
    self.postMessage({
      type: 'bestmove',
      requestId: message.requestId,
      move: result.move ? moveToUci(result.move) : null,
      depth: result.depth,
      score: result.score,
      nodes: result.nodes,
      elapsedMs: result.elapsedMs,
      pv: result.pv,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
