import { escapeHTML as esc } from './analysis-view.js';
import { selectDailyPicks } from './daily-picks.js';
import { playerPhotoHTML } from './player-photo.js';
import { pickOddsHTML } from './pick-odds.js';
import { screenPick } from './pick-screening.js';
import { playerPickReasonsHTML } from './player-pick-reasons.js';

const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const date = (value, full = false) => new Date(value).toLocaleDateString('pl-PL', {
  timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', ...(full ? { year: 'numeric' } : {}),
});
const keyOf = row => `${row.event.id}:${row.pick.playerId}:${row.pick.metric}`;
const ids = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const named = value => typeof value === 'string' && value.trim() && value.length <= 500;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const rules = {
  nba: { routes: ['basketball/nba'], metrics: ['PTS', 'AST', 'REB'], scope: 'including_overtime' },
  nhl: { routes: ['hockey/nhl'], metrics: ['S'], scope: 'including_overtime_excluding_shootout' },
  football: { routes: ['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1', 'soccer/usa.1'], metrics: ['SH'], scope: 'regulation_90' },
};
const quoteTime = row => Number.isFinite(Date.parse(row.quote?.observedAt)) ? Date.parse(row.quote.observedAt) : -Infinity;

/** Descriptive cards can exist without a book price, but not without genuine
 * observations bound to the current fixture's sport, team and metric.
 */
function historicalCard(row, options) {
  const { event, pick, oddsData } = row || {}, rule = rules[options.sport];
  const current = typeof options.now === 'number' ? options.now : options.now == null ? Date.now() : Date.parse(options.now);
  const start = Date.parse(event?.date);
  if (!rule || !Number.isFinite(current) || event?.sport !== options.sport || !rule.routes.includes(event.route)
    || event.state !== 'pre' || !timestamp(event.date) || start <= current || start - current > 2 * 86400000
    || typeof event.id !== 'string' || !event.id.startsWith(`${event.route}:`) || !/^\d{4,14}$/.test(event.id.slice(event.route.length + 1))
    || !ids(event.homeId) || !ids(event.awayId) || event.homeId === event.awayId || !named(event.home) || !named(event.away)
    || pick?.kind !== 'player' || pick.market !== 'player_prop' || !ids(pick.playerId) || !ids(pick.teamId)
    || ![event.homeId, event.awayId].includes(pick.teamId) || !rule.metrics.includes(pick.metric) || pick.scope !== rule.scope
    || !named(pick.playerName) || !named(pick.statement || pick.label) || !['over', 'under'].includes(pick.direction)
    || !Number.isFinite(pick.line) || pick.line <= 0 || pick.line > 1000 || pick.line % 1 !== 0.5
    || !Number.isInteger(pick.sample) || pick.sample < 8 || pick.sample > 10 || !Number.isInteger(pick.hits)
    || !Array.isArray(pick.observations) || pick.observations.length !== pick.sample) return null;
  const seen = new Set();
  let hits = 0;
  for (const observation of pick.observations) {
    if (typeof observation?.matchId !== 'string' || !observation.matchId.startsWith(`${event.route}:`)
      || !/^\d{4,14}$/.test(observation.matchId.slice(event.route.length + 1)) || observation.matchId === event.id || seen.has(observation.matchId)
      || !timestamp(observation.date) || Date.parse(observation.date) >= Math.min(current, start)
      || !Number.isInteger(observation.value) || observation.value < 0 || observation.value > 1000) return null;
    seen.add(observation.matchId);
    if (pick.direction === 'under' ? observation.value < pick.line : observation.value > pick.line) hits++;
  }
  if (hits !== pick.hits || hits < Math.ceil(pick.sample * 0.7)) return null;
  const screened = screenPick(pick, event, { ...options, oddsData, now: current });
  return { ...row, quote: screened.eligible ? screened.quote : null, analysisOnly: !screened.eligible };
}

/** Current, already-qualified player observations with an exactly matched
 * price. The cards describe past results and never assign future confidence.
 */
export function playerFormCardsHTML(rows, options = {}) {
  const { limit = 4 } = options;
  if (!Array.isArray(rows) || !Number.isInteger(limit) || limit < 1 || limit > (options.analysis === true ? 12 : 4)) return '';
  const unique = new Map(), conflicts = new Set();
  for (const row of rows.slice(0, 1000)) {
    if (row?.pick?.kind !== 'player' || typeof row.pick.playerName !== 'string' || !row.pick.playerName.trim()) continue;
    const qualified = options.analysis === true ? historicalCard(row, options) : selectDailyPicks([row], { ...options, limit: 1 })[0];
    if (!qualified) continue;
    const observations = [...qualified.pick.observations].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.matchId.localeCompare(b.matchId));
    const key = `${keyOf(qualified)}:${qualified.pick.direction}:${qualified.pick.line}`;
    const signature = JSON.stringify(observations.map(({ matchId, date: at, value }) => [matchId, at, value]));
    const previous = unique.get(key);
    if (previous && previous.signature !== signature) conflicts.add(key);
    else if (!previous || quoteTime(qualified) > quoteTime(previous)) unique.set(key, { ...qualified, observations, signature, key });
  }
  const ranked = [...unique.values()].filter(row => !conflicts.has(row.key)).sort((a, b) =>
    b.pick.hits / b.pick.sample - a.pick.hits / a.pick.sample || b.pick.sample - a.pick.sample
    || Date.parse(a.event.date) - Date.parse(b.event.date) || a.key.localeCompare(b.key));
  const cards = [], fixtures = new Map(), athletes = new Set();
  function add(row) {
    if (!row || cards.length === limit) return false;
    const key = keyOf(row), count = fixtures.get(row.event.id) || 0;
    if (athletes.has(key) || count >= 2) return false;
    athletes.add(key); fixtures.set(row.event.id, count + 1); cards.push(row);
    return true;
  }
  if (options.analysis === true) for (const metric of rules[options.sport]?.metrics || []) {
    add(ranked.find(row => row.pick.metric === metric && !athletes.has(keyOf(row)) && (fixtures.get(row.event.id) || 0) < 2));
  }
  for (const row of ranked) add(row);
  if (!cards.length) return '';
  return `<div class="player-form-cards">${cards.map(({ event, pick, oddsData, observations, analysisOnly }) => {
    const values = observations.map(row => row.value), sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const recent = values.slice(0, 5), last5 = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const kickoff = new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<article class="player-form-card" data-player-form-card${analysisOnly ? ' data-analysis-only="true"' : ''} data-player-id="${esc(pick.playerId)}" data-metric="${esc(pick.metric)}" data-fixture-id="${esc(event.id)}">
      <p class="pfc-fixture">${esc(event.home)} — ${esc(event.away)}</p><p class="pfc-time">${esc(event.league || '')} · ${esc(kickoff)}</p>
      ${options.analysis === true ? '<p class="pfc-analysis-label">Linia do analizy — historia, nie rekomendacja</p>' : ''}
      <div class="pfc-heading"><div class="player-identity">${playerPhotoHTML({ id: pick.playerId, name: pick.playerName, headshot: pick.headshot }, event.sport)}<h3>${esc(pick.statement || pick.label)}</h3></div>${analysisOnly ? '<span class="pfc-no-price">Brak kursu spełniającego filtr</span>' : pickOddsHTML(oddsData, event, pick, { now: options.now ?? Date.now() })}</div>
      <p class="pfc-latest">Ostatni dostępny występ z tą statystyką: <b>${esc(date(observations[0].date, true))}</b></p>
      <div class="pfc-stats"><span>Średnia <b>${decimal(average)}</b></span><span>Mediana <b>${decimal(median)}</b></span><span>Ostatnie 5 <b>${decimal(last5)}</b></span></div>
      ${['nba', 'nhl'].includes(event.sport) ? playerPickReasonsHTML(pick, event, { now: options.now ?? Date.now(), compact: true }) : ''}
      <p class="pfc-history-label">Ostatnie występy · od najnowszego</p>
      <div class="pfc-observations" role="list" aria-label="${esc(`${pick.label || pick.metric}: ostatnie występy od najnowszego`)}">${observations.map(row => {
        const hit = pick.direction === 'under' ? row.value < pick.line : row.value > pick.line;
        return `<span class="pfc-observation ${hit ? 'is-hit' : 'is-miss'}" role="listitem" data-match-id="${esc(row.matchId)}" data-date="${esc(row.date)}" data-value="${row.value}" title="${esc(`${date(row.date, true)}: ${row.value}`)}"><span class="pfc-date">${esc(date(row.date))}</span><b class="pfc-value">${row.value}</b></span>`;
      }).join('')}</div>
      <div class="pfc-footer"><p>${pick.hits} z ${pick.sample} wcześniejszych występów zgodnych z kierunkiem. To historia, bez potwierdzonej skuteczności prognozy.</p><button type="button" data-bet-id="${esc(event.id)}">Szczegóły zawodnika i meczu</button></div>
    </article>`;
  }).join('')}</div>`;
}
