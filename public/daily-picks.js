import { escapeHTML as esc } from './analysis-view.js';
import { screenPick } from './pick-screening.js';
import { pickOddsHTML } from './pick-odds.js';

const DAY = 86400000;
const time = value => typeof value === 'number' ? value : Date.parse(value);
const validCount = value => Number.isInteger(value) && value >= 0;
const named = value => typeof value === 'string' && value.trim() && value.length <= 500;
const observedTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const pickKey = pick => JSON.stringify(['kind', 'market', 'side', 'direction', 'scope', 'line', 'teamId', 'playerId', 'metric'].map(key => pick[key] ?? null));
const counts = side => side && Number.isInteger(side.sample) && side.sample >= 8 && side.sample <= 10
  && validCount(side.hits) && side.hits <= side.sample;

function historicalEvidence(pick, event, before) {
  if (pick.kind === 'player') {
    if (!counts(pick) || !Array.isArray(pick.observations) || pick.observations.length !== pick.sample
      || !['over', 'under'].includes(pick.direction) || !Number.isFinite(pick.line)) return null;
    const seen = new Set();
    let hits = 0;
    for (const observation of pick.observations) {
      if (typeof observation?.matchId !== 'string' || !observation.matchId.startsWith(`${event.route}:`)
        || !/^\d{4,14}$/.test(observation.matchId.slice(event.route.length + 1))
        || observation.matchId === event.id || seen.has(observation.matchId)
        || !observedTime(observation.date) || Date.parse(observation.date) >= before
        || !Number.isInteger(observation.value) || observation.value < 0 || observation.value > 1000) return null;
      seen.add(observation.matchId);
      if (pick.direction === 'under' ? observation.value < pick.line : observation.value > pick.line) hits++;
    }
    if (hits !== pick.hits || hits < Math.ceil(pick.sample * 0.7)) return null;
    return { fraction: hits / pick.sample, sample: pick.sample,
      signature: `${hits}/${pick.sample}`, rationale: `${hits} z ${pick.sample} wcześniejszych występów zgodnych z kierunkiem.` };
  }
  if (!['result', 'total'].includes(pick.kind) || !counts(pick.support?.home) || !counts(pick.support?.away)) return null;
  const { home, away } = pick.support;
  return { fraction: Math.min(home.hits / home.sample, away.hits / away.sample), sample: Math.min(home.sample, away.sample),
    signature: `${home.hits}/${home.sample}:${away.hits}/${away.sample}`,
    rationale: `${event.home}: ${home.hits}/${home.sample}; ${event.away}: ${away.hits}/${away.sample} wcześniejszych wyników zgodnych z kierunkiem.` };
}

/** Select a short descriptive list from already-qualified candidates. Sorting
 * uses historical counts, never a claimed win probability or expected return.
 * The caller supplies the selected day's feed; full actual dates stay visible.
 */
export function selectDailyPicks(rows, { sport, minOdds = 1.5, band = 'all', now = Date.now(), limit = 5 } = {}) {
  const current = time(now);
  if (!Array.isArray(rows) || !Number.isFinite(current) || !Number.isInteger(limit) || limit < 1 || limit > 5) return [];
  const unique = new Map(), conflicts = new Set();
  for (const row of rows.slice(0, 1000)) {
    const { event, pick, oddsData } = row || {};
    const start = Date.parse(event?.date);
    if (!event || event.sport !== sport || event.state !== 'pre' || !Number.isFinite(start)
      || start <= current || start - current > 2 * DAY || !named(event.home) || !named(event.away)
      || !pick || !named(pick.statement || pick.label)) continue;
    const evidence = historicalEvidence(pick, event, Math.min(current, start));
    if (!evidence) continue;
    const screened = screenPick(pick, event, { oddsData, minOdds, band, now: current });
    if (!screened.eligible) continue;
    const key = `${event.id}:${pickKey(pick)}`;
    const item = { ...row, quote: screened.quote, priceBand: screened.band, rationale: evidence.rationale, evidence, key };
    const previous = unique.get(key);
    if (previous && previous.evidence.signature !== evidence.signature) conflicts.add(key);
    else if (!previous || Date.parse(item.quote.observedAt) > Date.parse(previous.quote.observedAt)
      || item.quote.observedAt === previous.quote.observedAt && String(item.quote.provider).localeCompare(String(previous.quote.provider)) < 0) unique.set(key, item);
  }
  const ranked = [...unique.values()].filter(row => !conflicts.has(row.key)).sort((a, b) =>
    b.evidence.fraction - a.evidence.fraction || b.evidence.sample - a.evidence.sample
    || Date.parse(a.event.date) - Date.parse(b.event.date) || a.key.localeCompare(b.key));
  const fixtures = new Set(), selected = [];
  for (const { evidence, key, ...row } of ranked) {
    if (fixtures.has(row.event.id)) continue;
    fixtures.add(row.event.id); selected.push(row);
    if (selected.length === limit) break;
  }
  return selected;
}

export function dailyPicksHTML(rows, options = {}) {
  const selected = selectDailyPicks(rows, options);
  if (!selected.length) return '<p class="daily-picks-empty">Brak typów spełniających warunki danych i wybrany filtr kursu. Statystyki meczów pozostają dostępne w szczegółach.</p>';
  return `<ol class="daily-picks-list">${selected.map(({ event, pick, oddsData, rationale }) => {
    const date = new Date(event.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<li class="daily-pick" data-daily-fixture="${esc(event.id)}"><div class="daily-pick-main"><p class="daily-pick-fixture">${esc(event.home)} — ${esc(event.away)}</p><p class="daily-pick-time">${esc(event.league || '')} · ${esc(date)}</p><h3>${esc(pick.statement || pick.label)}</h3><p class="daily-pick-reason">${esc(rationale)}</p></div><div class="daily-pick-action">${pickOddsHTML(oddsData, event, pick, { now: options.now ?? Date.now() })}<button type="button" data-bet-id="${esc(event.id)}">Szczegóły</button></div></li>`;
  }).join('')}</ol><p class="small daily-picks-method">Kolejność wynika ze zgodności wcześniejszych wyników. To opis historii, bez potwierdzonej skuteczności prognoz; jedna pozycja na mecz.</p>`;
}
