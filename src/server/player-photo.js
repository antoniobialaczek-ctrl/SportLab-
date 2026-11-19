const SPORTS = { nba: 'nba', nhl: 'nhl', football: 'soccer' };

/** A provider image is accepted only when its path identifies this athlete.
 * Missing portraits stay missing; do not guess another player's image.
 */
export function verifiedPlayerPhoto(value, playerId, sport) {
  const pathSport = SPORTS[sport], id = String(playerId || '');
  const source = typeof value === 'string' ? value : value?.href;
  if (!pathSport || !/^\d{1,14}$/.test(id) || typeof source !== 'string' || source.length > 300) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== 'a.espncdn.com' || url.port || url.username || url.password || url.search || url.hash
      || url.pathname !== `/i/headshots/${pathSport}/players/full/${id}.png`) return null;
    return url.href;
  } catch { return null; }
}
