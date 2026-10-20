export function isStaticDemoMode(locationLike = globalThis.location) {
  const hostname = typeof locationLike?.hostname === 'string'
    ? locationLike.hostname.toLowerCase()
    : '';
  if (hostname.endsWith('.github.io')) return true;

  const search = typeof locationLike?.search === 'string' ? locationLike.search : '';
  try {
    return new URLSearchParams(search).get('static') === '1';
  } catch {
    return false;
  }
}
