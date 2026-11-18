export const SPORTS = ['nba', 'football', 'nhl', 'tennis', 'cs2'];

export function getOnly(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Dozwolona metoda: GET' });
    return false;
  }
  return true;
}

export function scalar(value, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Nieprawidłowe parametry');
  return value;
}

export function parseDate(value) {
  if (!/^\d{8}$/.test(value)) throw new Error('Data musi mieć format RRRRMMDD');
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== iso) throw new Error('Nieprawidłowa data');
  return iso;
}

export function failure(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: message });
}

export function parseTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('Nieprawidłowa data UTC');
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized) throw new Error('Nieprawidłowa data UTC');
  return timestamp;
}
