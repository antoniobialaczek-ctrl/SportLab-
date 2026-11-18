const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** No API keys or paid endpoint. Each retry has its own abort controller. */
export async function fetchJSON(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000, retries = 2, retryDelayMs = 250, sleepImpl = sleep } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'site.api.espn.com') throw new Error('Niedozwolony host źródła danych');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' }, redirect: 'error' });
      if (!response.ok) {
        const error = new Error(`Źródło zwróciło HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        const error = new Error('Nieprawidłowy JSON źródła');
        error.retryable = false;
        throw error;
      }
      return data;
    } catch (error) {
      if (attempt === retries || error.retryable === false || error instanceof SyntaxError) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleepImpl(Math.min(2000, retryDelayMs * 2 ** attempt));
  }
}

export async function mapConcurrent(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Nieprawidłowa równoległość');
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const ownIndex = index++;
      results[ownIndex] = await mapper(items[ownIndex], ownIndex);
    }
  }));
  return results;
}
