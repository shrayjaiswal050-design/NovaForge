export const DEFAULT_RATING = 1200;
export const DEFAULT_VARIANT = 'standard';
export const DEFAULT_SPEED = 'blitz';

export const RATING_VARIANTS = Object.freeze(['standard', 'chess960']);
export const RATING_SPEEDS = Object.freeze(['bullet', 'blitz', 'rapid']);
export const K_FACTORS = Object.freeze({
  bullet: 40,
  blitz: 32,
  rapid: 24,
});

const TIME_CONTROL_CATEGORIES = Object.freeze({
  '1+0': 'bullet',
  '2+1': 'bullet',
  '3+2': 'blitz',
  '5+3': 'blitz',
  '10+0': 'rapid',
  '15+10': 'rapid',
});

const OBJECT_TIME_CONTROL_CATEGORIES = Object.freeze({
  '60000:0': 'bullet',
  '120000:1000': 'bullet',
  '180000:2000': 'blitz',
  '300000:3000': 'blitz',
  '600000:0': 'rapid',
  '900000:10000': 'rapid',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidSpeed(value) {
  throw new TypeError(`Unsupported speed or time control: ${String(value)}.`);
}

function isVariantCandidate(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return RATING_VARIANTS.includes(normalized);
}

function validateRating(rating, name) {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return rating;
}

export function normalizeSpeed(speed = DEFAULT_SPEED) {
  if (speed === undefined || speed === null) return DEFAULT_SPEED;
  if (isRecord(speed)) return timeControlCategory(speed);
  if (typeof speed !== 'string') return invalidSpeed(speed);

  const normalized = speed.trim().toLowerCase();
  if (RATING_SPEEDS.includes(normalized)) return normalized;
  const timeControl = normalized.replace(/\s+/gu, '');
  if (Object.hasOwn(TIME_CONTROL_CATEGORIES, timeControl)) return TIME_CONTROL_CATEGORIES[timeControl];
  return invalidSpeed(speed);
}

export function timeControlCategory(timeControl = DEFAULT_SPEED) {
  if (timeControl === undefined || timeControl === null) return DEFAULT_SPEED;
  if (typeof timeControl === 'string') {
    const normalized = timeControl.trim().toLowerCase();
    if (RATING_SPEEDS.includes(normalized)) return normalized;
    const compact = normalized.replace(/\s+/gu, '');
    if (Object.hasOwn(TIME_CONTROL_CATEGORIES, compact)) return TIME_CONTROL_CATEGORIES[compact];
    return invalidSpeed(timeControl);
  }
  if (isRecord(timeControl)) {
    if (Object.hasOwn(timeControl, 'speed')) return normalizeSpeed(timeControl.speed);
    if (Object.hasOwn(timeControl, 'category')) return normalizeSpeed(timeControl.category);
    if (Object.hasOwn(timeControl, 'timeControl')) return timeControlCategory(timeControl.timeControl);
    if (Number.isSafeInteger(timeControl.initialMs)
      && timeControl.initialMs >= 0
      && Number.isSafeInteger(timeControl.incrementMs)
      && timeControl.incrementMs >= 0) {
      const key = `${timeControl.initialMs}:${timeControl.incrementMs}`;
      if (Object.hasOwn(OBJECT_TIME_CONTROL_CATEGORIES, key)) return OBJECT_TIME_CONTROL_CATEGORIES[key];

      const estimatedMs = timeControl.initialMs + (timeControl.incrementMs * 40);
      if (estimatedMs < 3 * 60 * 1_000) return 'bullet';
      if (estimatedMs < 10 * 60 * 1_000) return 'blitz';
      return 'rapid';
    }
  }
  return invalidSpeed(timeControl);
}

export function normalizeVariant(variant = DEFAULT_VARIANT) {
  if (variant === undefined || variant === null) return DEFAULT_VARIANT;
  if (typeof variant !== 'string') {
    throw new TypeError(`Unsupported chess variant: ${String(variant)}.`);
  }
  const normalized = variant.trim().toLowerCase();
  if (RATING_VARIANTS.includes(normalized)) return normalized;
  throw new TypeError(`Unsupported chess variant: ${String(variant)}.`);
}

export function ratingCategory(variantOrOptions = DEFAULT_VARIANT, speedOrTimeControl = undefined) {
  let variantInput = DEFAULT_VARIANT;
  let speedInput = DEFAULT_SPEED;

  if (isRecord(variantOrOptions)) {
    variantInput = variantOrOptions.variant ?? DEFAULT_VARIANT;
    if (Object.hasOwn(variantOrOptions, 'speed')) {
      speedInput = variantOrOptions.speed;
    } else if (Object.hasOwn(variantOrOptions, 'timeControl')) {
      speedInput = variantOrOptions.timeControl;
    } else if (Object.hasOwn(variantOrOptions, 'category')) {
      speedInput = variantOrOptions.category;
    } else if (Object.hasOwn(variantOrOptions, 'initialMs') || Object.hasOwn(variantOrOptions, 'incrementMs')) {
      speedInput = variantOrOptions;
    } else if (speedOrTimeControl !== undefined) {
      speedInput = speedOrTimeControl;
    }
  } else if (variantOrOptions === undefined || variantOrOptions === null) {
    speedInput = speedOrTimeControl ?? DEFAULT_SPEED;
  } else if (speedOrTimeControl === undefined && !isVariantCandidate(variantOrOptions)) {
    speedInput = variantOrOptions;
  } else if (isVariantCandidate(speedOrTimeControl) && !isVariantCandidate(variantOrOptions)) {
    variantInput = speedOrTimeControl;
    speedInput = variantOrOptions;
  } else {
    variantInput = variantOrOptions;
    speedInput = speedOrTimeControl ?? DEFAULT_SPEED;
  }

  const variant = normalizeVariant(variantInput);
  const speed = timeControlCategory(speedInput);
  return Object.freeze({
    variant,
    speed,
    key: `${variant}:${speed}`,
  });
}

export function ratingKey(variant = DEFAULT_VARIANT, speedOrTimeControl = undefined) {
  return ratingCategory(variant, speedOrTimeControl).key;
}

export function normalizeResult(result) {
  if (typeof result === 'number') {
    if (result === 1 || result === 0.5 || result === 0) return result;
  }
  if (typeof result === 'boolean') return result ? 1 : 0;
  if (typeof result === 'string') {
    const normalized = result.trim().toLowerCase();
    if (['win', 'won', 'w', '1', '1-0', 'white'].includes(normalized)) return 1;
    if (['draw', 'd', '0.5', '1/2', '1/2-1/2', '½-½'].includes(normalized)) return 0.5;
    if (['loss', 'lose', 'lost', 'l', '0', '0-1', 'black'].includes(normalized)) return 0;
  }
  if (result && typeof result === 'object') {
    if ('result' in result) return normalizeResult(result.result);
    if ('outcome' in result) return normalizeResult(result.outcome);
    if ('score' in result) return normalizeResult(result.score);
    if ('winner' in result) return result.winner === null ? 0.5 : normalizeResult(result.winner);
  }
  throw new TypeError('Result must be a win, draw, or loss.');
}

export function expectedScore(rating, opponentRating) {
  validateRating(rating, 'Rating');
  validateRating(opponentRating, 'Opponent rating');
  return 1 / (1 + (10 ** ((opponentRating - rating) / 400)));
}

export function calculateEloChange(rating, opponentRating, result, speed = DEFAULT_SPEED) {
  const score = normalizeResult(result);
  const category = timeControlCategory(speed);
  return Math.round(K_FACTORS[category] * (score - expectedScore(rating, opponentRating)));
}

export function updateElo(rating, opponentRating, result, speed = DEFAULT_SPEED) {
  validateRating(rating, 'Rating');
  return rating + calculateEloChange(rating, opponentRating, result, speed);
}
