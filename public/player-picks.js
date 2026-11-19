import { escapeHTML as esc } from './analysis-view.js';
import { matchPickQuote, pickOddsHTML } from './pick-odds.js';
import { playerPhotoHTML, playerPhotoURL } from './player-photo.js';

const DAY = 86400000;
const MIN_MATCHES = 8;
const MAX_PICKS = 6;
const RULES = {
  nba: {
    PTS: { label: 'Punkty', unit: 'punktu', lines: [9.5, 14.5, 19.5, 24.5, 29.5] },
    AST: { label: 'Asysty', unit: 'asysty', lines: [2.5, 3.5, 4.5, 5.5, 6.5] },
    REB: { label: 'Zbiórki', unit: 'zbiórki', lines: [3.5, 4.5, 5.5, 6.5, 7.5, 9.5] },
  },
  nhl: { S: { label: 'Strzały na bramkę', unit: 'strzału na bramkę', lines: [1.5, 2.5, 3.5] } },
  football: { SH: { label: 'Strzały', unit: 'strzału', lines: [1.5, 2.5, 3.5] } },
};
const NOTE = 'Linie analityczne i źródłowe służą porównaniu wcześniejszych występów. Przy linii źródłowej pokazujemy odczyt ceny dla tego samego progu; przy analitycznej sprawdź linię w ofercie. Historia nie jest potwierdzonym prawdopodobieństwem ani oceną opłacalności.';
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const validLine = value => Number.isFinite(value) && value > 0 && value <= 1000 && Number.isInteger(value * 2) && value * 2 % 2 === 1;
const currentTime = value => typeof value === 'number' ? value : Date.parse(value);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const output = (status, reason, data, event, picks = []) => ({
  status, reason, picks, teamId: data?.teamId || null,
  teamName: data?.teamId === event?.homeId ? event.home : data?.teamId === event?.awayId ? event.away : null,
  cutoff: data?.cutoff || null, note: NOTE,
});

/** These are transparent historical-statistic screens, not probability models.
 * Every count is recomputed from distinct observations bound to source matches.
 */
function context(data, event, options) {
  const now = currentTime(options.now ?? Date.now()), start = Date.parse(event?.date);
  if (!Number.isFinite(now) || !Number.isFinite(start)) return { error: output('unavailable', 'Nie można potwierdzić terminu meczu.', data, event) };
  if (event.state !== 'pre' || start <= now) return { error: output('closed', 'Typy przedmeczowe są dostępne przed rozpoczęciem spotkania.', data, event) };
  if (start - now > 2 * DAY) return { error: output('unavailable', 'Wskazania zawodników sprawdzamy w ciągu 48 godzin przed meczem.', data, event) };
  if (!RULES[event.sport]) return { error: output('unavailable', 'Dla tej dyscypliny nie ma porównywalnych statystyk zawodników.', data, event) };
  if (event.sport === 'football' && event.route === 'soccer/pol.1' && /^soccer\/pol\.1:tsdb-\d{4,14}$/.test(event.id)
    && [event.homeId, event.awayId].every(id => typeof id === 'string' && /^tsdb-\d{1,14}$/.test(id)) && event.homeId !== event.awayId
    && data?.sport === event.sport && data.route === event.route && [event.homeId, event.awayId].includes(data.teamId)
    && data.source === 'TheSportsDB' && data.status === 'unavailable' && typeof data.reason === 'string'
    && validTime(data.cutoff) && Date.parse(data.cutoff) <= now && Date.parse(data.cutoff) <= start) return { error: output('unavailable', data.reason, data, event) };
  if (typeof event.route !== 'string' || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`)
    || !/^\d{4,14}$/.test(event.id.slice(event.route.length + 1)) || event.homeId === event.awayId
    || ![event.homeId, event.awayId].every(id => typeof id === 'string' && /^\d{1,14}$/.test(id))) {
    return { error: output('unavailable', 'Nie można potwierdzić uczestników spotkania.', data, event) };
  }
  const cutoff = Date.parse(data?.cutoff);
  if (!data || !['available', 'partial'].includes(data.status) || data.sport !== event.sport || data.route !== event.route
    || ![event.homeId, event.awayId].includes(data.teamId) || typeof data.teamId !== 'string'
    || !validTime(data.cutoff) || cutoff > now || cutoff > start || !Array.isArray(data.players)) {
    return { error: output('unavailable', 'Nie można powiązać historii zawodników z tym meczem.', data, event) };
  }
  const matches = new Map();
  const sampled = Array.isArray(data.sampledMatches) ? data.sampledMatches : [];
  for (const match of sampled) {
    if (typeof match?.id !== 'string' || !match.id.startsWith(`${event.route}:`) || !validTime(match.date)
      || Date.parse(match.date) >= cutoff || matches.has(match.id)) {
      return { error: output('unavailable', 'Historia zawiera niespójne oznaczenia wcześniejszych spotkań.', data, event) };
    }
    matches.set(match.id, match);
  }
  const attempted = Array.isArray(data.attemptedMatches) && data.attemptedMatches.length ? data.attemptedMatches : sampled;
  if (attempted.some(match => !validTime(match?.date) || Date.parse(match.date) >= cutoff)) {
    return { error: output('unavailable', 'Historia zawodników przekracza punkt odcięcia meczu.', data, event) };
  }
  const latest = [...attempted].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!latest || !matches.has(latest.id) || now - Date.parse(latest.date) > 7 * DAY) {
    return { error: output('unavailable', 'Potrzebne są statystyki z ostatniego meczu drużyny z ostatnich 7 dni.', data, event) };
  }
  const excluded = new Set(options.excludedPlayerIds || []);
  return { now, cutoff, matches, latest, excluded };
}

function observationsFor(player, metricKey, state) {
  if (!player || typeof player.id !== 'string' || !/^\d{1,14}$/.test(player.id) || typeof player.name !== 'string' || !player.name.trim()
    || state.excluded.has(player.id)) return null;
  const metric = player.metrics?.[metricKey];
  if (!metric || !Array.isArray(metric.observations) || metric.observations.length < MIN_MATCHES || metric.observations.length > 10
    || metric.sample !== metric.observations.length) return null;
  const seen = new Set(), observations = [];
  for (const row of metric.observations) {
    const match = state.matches.get(row?.matchId);
    if (!match || seen.has(row.matchId) || !validTime(row.date) || Date.parse(row.date) !== Date.parse(match.date)
      || !Number.isInteger(row.value) || row.value < 0 || row.value > 1000) return null;
    seen.add(row.matchId); observations.push({ matchId: row.matchId, date: row.date, value: row.value });
  }
  if (!seen.has(state.latest.id)) return null;
  return observations.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function summarizeLine(player, metricKey, line, observations, sport, direction = 'over') {
  const definition = RULES[sport][metricKey], values = observations.map(row => row.value);
  const sample = values.length, hits = values.filter(value => direction === 'under' ? value < line : value > line).length;
  const mean = average(values), middle = median(values), last5 = average(values.slice(0, 5));
  const comparisonWord = direction === 'under' ? 'poniżej' : 'powyżej';
  return {
    playerId: player.id, playerName: player.name, headshot: playerPhotoURL(player.headshot, player.id, sport), metric: metricKey, label: definition.label,
    line, direction, marketLabel: `${direction === 'under' ? 'Poniżej' : 'Powyżej'} ${decimal(line)} ${definition.unit}`,
    statement: `${player.name} — ${comparisonWord} ${decimal(line)} ${definition.unit}`,
    sample, hits, average: mean, median: middle, last5Average: last5, observations,
    qualifies: hits >= Math.ceil(sample * 0.7) && (direction === 'under' ? middle < line && last5 < line : middle > line && last5 > line),
  };
}

/** For comparing a user-supplied half-point line with the same actual history.
 * It returns historical counts even if that line does not pass the screen.
 */
export function evaluatePlayerLine(data, event, playerId, metricKey, line, options = {}) {
  const state = context(data, event, options);
  if (state.error) return state.error;
  const direction = options.direction || 'over';
  if (!RULES[event.sport][metricKey] || !validLine(line) || !['over', 'under'].includes(direction)) return output('unavailable', 'Podaj dodatnią linię połówkową dla dostępnej statystyki.', data, event);
  const matches = data.players.filter(player => player?.id === playerId);
  if (matches.length !== 1) return output('unavailable', 'Nie można jednoznacznie potwierdzić zawodnika.', data, event);
  const observations = observationsFor(matches[0], metricKey, state);
  if (!observations) return output('unavailable', 'Do porównania potrzeba co najmniej 8 występów i udziału w ostatnim meczu drużyny.', data, event);
  const comparison = summarizeLine(matches[0], metricKey, line, observations, event.sport, direction);
  return { ...output('available', null, data, event), comparison };
}

export function buildPlayerPicks(data, event, options = {}) {
  const state = context(data, event, options);
  if (state.error) return state.error;
  const definitions = RULES[event.sport], candidates = [], seenPlayers = new Set(), repeatedPlayers = new Set();
  for (const player of data.players) {
    if (seenPlayers.has(player?.id)) repeatedPlayers.add(player.id);
    else seenPlayers.add(player?.id);
  }
  for (const player of data.players) {
    if (repeatedPlayers.has(player?.id)) continue;
    for (const [metricKey, definition] of Object.entries(definitions)) {
      const observations = observationsFor(player, metricKey, state);
      if (!observations) continue;
      const override = options.lineOverrides?.[`${player.id}:${metricKey}`];
      const scope = event.sport === 'nba' ? 'including_overtime' : event.sport === 'football' ? 'regulation_90' : 'including_overtime_excluding_shootout';
      const descriptor = { kind: 'player', market: 'player_prop', playerId: player.id, teamId: data.teamId, metric: metricKey, direction: 'over', scope };
      const quotes = Array.isArray(options.oddsData?.quotes) ? options.oddsData.quotes.slice(0, 510) : [];
      const sourceLines = [...new Set(quotes.filter(quote => quote?.playerId === player.id && quote.teamId === data.teamId && quote.metric === metricKey
        && validLine(quote.line) && matchPickQuote(options.oddsData, event, { ...descriptor, line: quote.line }, { now: state.now }).status === 'matched').map(quote => quote.line))];
      const select = lines => [...lines].sort((a, b) => b - a).map(line => summarizeLine(player, metricKey, line, observations, event.sport)).find(pick => pick.qualifies);
      const fromSource = override === undefined ? select(sourceLines) : null;
      const selected = fromSource || select(override === undefined ? definition.lines : validLine(override) ? [override] : []);
      if (selected) candidates.push({ ...selected, ...descriptor, lineOrigin: fromSource ? 'source' : override === undefined ? 'analytical' : 'manual',
        priceAvailable: matchPickQuote(options.oddsData, event, { ...descriptor, line: selected.line }, { now: state.now }).status === 'matched' });
    }
  }
  const ranked = candidates.sort((a, b) => Number(b.priceAvailable) - Number(a.priceAvailable) || b.hits / b.sample - a.hits / a.sample || b.sample - a.sample
    || (b.median - b.line) / b.line - (a.median - a.line) / a.line || a.playerName.localeCompare(b.playerName, 'pl'));
  const picks = [], perPlayer = new Map(), selectedKeys = new Set();
  function add(pick) {
    if (!pick || picks.length >= MAX_PICKS || (perPlayer.get(pick.playerId) || 0) >= 2) return false;
    const key = `${pick.playerId}:${pick.metric}`;
    if (selectedKeys.has(key)) return false;
    selectedKeys.add(key); picks.push(pick); perPlayer.set(pick.playerId, (perPlayer.get(pick.playerId) || 0) + 1); return true;
  }
  // Prefer a mix of points, assists and rebounds before filling remaining slots.
  for (const metricKey of Object.keys(definitions)) add(ranked.find(pick => pick.metric === metricKey && (perPlayer.get(pick.playerId) || 0) < 2));
  for (const pick of ranked) add(pick);
  return output(picks.length ? 'available' : 'unavailable', picks.length ? null
    : 'Wskazania pojawią się, gdy zawodnik ma co najmniej 8 występów, zagrał ostatnio, a jego wyniki regularnie przekraczają jedną z analizowanych linii.', data, event, picks);
}

export function playerPicksHTML(data, event, options = {}) {
  const result = buildPlayerPicks(data, event, options);
  const name = result.teamName ? ` — ${esc(result.teamName)}` : '';
  return `<section class="player-picks" data-player-picks-team="${esc(result.teamId || '')}"><h4>Typy na zawodników${name}</h4>${result.picks.length
    ? `${options.showNote === false ? '' : `<p class="small player-picks-note">${esc(result.note)}</p>`}<div class="player-picks-grid">${result.picks.map(pick => `<article class="player-pick"><span class="pill">${esc(pick.label)}</span><div class="pick-title-row"><span class="player-identity">${playerPhotoHTML({ id: pick.playerId, name: pick.playerName, headshot: pick.headshot }, event.sport)}<h4 class="player-pick-market">${esc(pick.statement)}</h4></span>${pickOddsHTML(options.oddsData, event, { ...pick, kind: 'player', market: 'player_prop', teamId: data.teamId, scope: event.sport === 'nba' ? 'including_overtime' : event.sport === 'football' ? 'regulation_90' : 'including_overtime_excluding_shootout' }, options)}</div><p class="small player-line-origin">${pick.lineOrigin === 'source' ? 'Linia z odczytu źródła' : pick.lineOrigin === 'manual' ? 'Twoja linia' : 'Linia analityczna — sprawdź ofertę'}</p><p><b>${pick.hits} z ${pick.sample}</b> wcześniejszych występów powyżej tej linii.</p><div class="player-pick-metrics"><span>Średnia <b>${decimal(pick.average)}</b></span><span>Mediana <b>${decimal(pick.median)}</b></span><span>Ostatnie 5 <b>${decimal(pick.last5Average)}</b></span></div><div class="player-trend" aria-label="Wyniki od najnowszego: ${pick.observations.map(row => row.value).join(', ')}">${pick.observations.map(row => `<span class="${row.value > pick.line ? 'player-trend-hit' : 'player-trend-miss'}" title="${esc(new Date(row.date).toLocaleDateString('pl-PL'))}">${row.value}</span>`).join('')}</div><details class="player-line-details"><summary>Sprawdź własną linię</summary><form class="player-line-form" data-player-line data-player-id="${esc(pick.playerId)}" data-team-id="${esc(result.teamId)}" data-metric="${esc(pick.metric)}"><label>Twoja linia<input type="text" name="line" inputmode="decimal" value="${esc(decimal(pick.line))}" pattern="[0-9]+([,.][0-9]+)?" required title="Podaj linię połówkową, np. 24,5"></label><label>Kierunek<select name="direction"><option value="over">Powyżej</option><option value="under">Poniżej</option></select></label><button type="submit">Porównaj z historią</button><p class="small" data-line-result role="status"></p></form></details></article>`).join('')}</div>`
    : `<p class="small">${esc(result.reason)}</p>`}</section>`;
}
