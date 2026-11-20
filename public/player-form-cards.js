import { escapeHTML as esc } from './analysis-view.js';
import { selectDailyPicks } from './daily-picks.js';
import { playerPhotoHTML } from './player-photo.js';
import { pickOddsHTML } from './pick-odds.js';

const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const date = (value, full = false) => new Date(value).toLocaleDateString('pl-PL', {
  timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', ...(full ? { year: 'numeric' } : {}),
});
const keyOf = row => `${row.event.id}:${row.pick.playerId}:${row.pick.metric}`;

/** Current, already-qualified player observations with an exactly matched
 * price. The cards describe past results and never assign future confidence.
 */
export function playerFormCardsHTML(rows, options = {}) {
  const { limit = 4 } = options;
  if (!Array.isArray(rows) || !Number.isInteger(limit) || limit < 1 || limit > 4) return '';
  const unique = new Map(), conflicts = new Set();
  for (const row of rows.slice(0, 1000)) {
    if (row?.pick?.kind !== 'player' || typeof row.pick.playerName !== 'string' || !row.pick.playerName.trim()) continue;
    const [qualified] = selectDailyPicks([row], { ...options, limit: 1 });
    if (!qualified) continue;
    const observations = [...qualified.pick.observations].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.matchId.localeCompare(b.matchId));
    const key = `${keyOf(qualified)}:${qualified.pick.direction}:${qualified.pick.line}`;
    const signature = JSON.stringify(observations.map(({ matchId, date: at, value }) => [matchId, at, value]));
    const previous = unique.get(key);
    if (previous && previous.signature !== signature) conflicts.add(key);
    else if (!previous || Date.parse(qualified.quote.observedAt) > Date.parse(previous.quote.observedAt)) unique.set(key, { ...qualified, observations, signature, key });
  }
  const ranked = [...unique.values()].filter(row => !conflicts.has(row.key)).sort((a, b) =>
    b.pick.hits / b.pick.sample - a.pick.hits / a.pick.sample || b.pick.sample - a.pick.sample
    || Date.parse(a.event.date) - Date.parse(b.event.date) || a.key.localeCompare(b.key));
  const cards = [], fixtures = new Map(), athletes = new Set();
  for (const row of ranked) {
    const key = keyOf(row), count = fixtures.get(row.event.id) || 0;
    if (athletes.has(key) || count >= 2) continue;
    athletes.add(key); fixtures.set(row.event.id, count + 1); cards.push(row);
    if (cards.length === limit) break;
  }
  if (!cards.length) return '';
  return `<div class="player-form-cards">${cards.map(({ event, pick, oddsData, observations }) => {
    const values = observations.map(row => row.value), sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const recent = values.slice(0, 5), last5 = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const kickoff = new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<article class="player-form-card" data-player-form-card data-player-id="${esc(pick.playerId)}" data-metric="${esc(pick.metric)}" data-fixture-id="${esc(event.id)}">
      <p class="pfc-fixture">${esc(event.home)} — ${esc(event.away)}</p><p class="pfc-time">${esc(event.league || '')} · ${esc(kickoff)}</p>
      <div class="pfc-heading"><div class="player-identity">${playerPhotoHTML({ id: pick.playerId, name: pick.playerName, headshot: pick.headshot }, event.sport)}<h3>${esc(pick.statement || pick.label)}</h3></div>${pickOddsHTML(oddsData, event, pick, { now: options.now ?? Date.now() })}</div>
      <p class="pfc-latest">Ostatni dostępny występ z tą statystyką: <b>${esc(date(observations[0].date, true))}</b></p>
      <div class="pfc-stats"><span>Średnia <b>${decimal(average)}</b></span><span>Mediana <b>${decimal(median)}</b></span><span>Ostatnie 5 <b>${decimal(last5)}</b></span></div>
      <p class="pfc-history-label">Ostatnie występy · od najnowszego</p>
      <div class="pfc-observations" role="list" aria-label="${esc(`${pick.label || pick.metric}: ostatnie występy od najnowszego`)}">${observations.map(row => {
        const hit = pick.direction === 'under' ? row.value < pick.line : row.value > pick.line;
        return `<span class="pfc-observation ${hit ? 'is-hit' : 'is-miss'}" role="listitem" data-match-id="${esc(row.matchId)}" data-date="${esc(row.date)}" data-value="${row.value}" title="${esc(`${date(row.date, true)}: ${row.value}`)}"><span class="pfc-date">${esc(date(row.date))}</span><b class="pfc-value">${row.value}</b></span>`;
      }).join('')}</div>
      <div class="pfc-footer"><p>${pick.hits} z ${pick.sample} wcześniejszych występów zgodnych z kierunkiem. To historia, bez potwierdzonej skuteczności prognozy.</p><button type="button" data-bet-id="${esc(event.id)}">Szczegóły zawodnika i meczu</button></div>
    </article>`;
  }).join('')}</div>`;
}
