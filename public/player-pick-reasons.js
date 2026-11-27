import { escapeHTML as esc } from './analysis-view.js';

const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Recompute only observed facts for the exact athlete line. Playing-time
 * comparisons use the same matches and never stand in for a minutes forecast.
 */
export function buildPlayerPickReasons(pick, event, options = {}) {
  const unavailable = { status: 'unavailable', reasons: [], counterevidence: [], stats: null };
  const now = options.now == null ? Date.now() : typeof options.now === 'number' ? options.now : Date.parse(options.now);
  const start = Date.parse(event?.date);
  if (event?.sport !== 'nba' || event.route !== 'basketball/nba' || event.state !== 'pre' || !stamp(event.date)
    || !Number.isFinite(now) || start <= now || start - now > 2 * 86400000
    || !['PTS', 'AST', 'REB'].includes(pick?.metric) || !['over', 'under'].includes(pick.direction)
    || pick.scope != null && pick.scope !== 'including_overtime'
    || !Number.isFinite(pick.line) || pick.line <= 0 || pick.line > 1000 || pick.line % 1 !== 0.5
    || !Array.isArray(pick.observations) || pick.observations.length < 8 || pick.observations.length > 10
    || pick.sample !== pick.observations.length) return unavailable;
  const seen = new Set(), observations = [];
  for (const row of pick.observations) {
    if (!row || typeof row.matchId !== 'string' || !/^basketball\/nba:\d{4,14}$/.test(row.matchId)
      || row.matchId === event.id || seen.has(row.matchId) || !stamp(row.date) || Date.parse(row.date) >= Math.min(now, start)
      || !Number.isInteger(row.value) || row.value < 0 || row.value > 1000) return unavailable;
    seen.add(row.matchId); observations.push(row);
  }
  observations.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.matchId.localeCompare(b.matchId));
  const over = pick.direction === 'over', hit = value => over ? value > pick.line : value < pick.line;
  const values = observations.map(row => row.value), sorted = [...values].sort((a, b) => a - b), sample = values.length;
  const hits = values.filter(hit).length, recent = values.slice(0, 5), recentHits = recent.filter(hit).length;
  if (pick.hits != null && pick.hits !== hits) return unavailable;
  const median = sample % 2 ? sorted[Math.floor(sample / 2)] : (sorted[sample / 2 - 1] + sorted[sample / 2]) / 2;
  const last5Average = mean(recent), margin = over ? median - pick.line : pick.line - median;
  const supported = hits >= Math.ceil(sample * 0.7) && margin > 0 && (over ? last5Average > pick.line : last5Average < pick.line);
  const word = over ? 'powyżej' : 'poniżej';
  const reasons = [
    `${hits}/${sample} wcześniejszych występów ${word} linii ${decimal(pick.line)}; w ostatnich ${recent.length}: ${recentHits}/${recent.length}.`,
    `Mediana: ${decimal(median)}, linia: ${decimal(pick.line)}${margin > 0 ? ` — różnica ${decimal(margin)} w kierunku typu` : ''}. Średnia ostatnich ${recent.length}: ${decimal(last5Average)}.`,
  ];
  const counterevidence = [`Wynik przeciwny kierunkowi: ${sample - hits}/${sample}. Zakres obserwowanych wyników: ${sorted[0]}–${sorted.at(-1)}.${!hit(values[0]) ? ' Ostatni występ był przeciwny temu kierunkowi.' : ''}`];
  let minutes = null;
  const minuteRows = pick.minutes?.observations;
  if (Array.isArray(minuteRows) && minuteRows.length === sample) {
    const minuteMap = new Map();
    for (const row of minuteRows) {
      if (!row || minuteMap.has(row.matchId) || !seen.has(row.matchId) || !stamp(row.date)
        || !Number.isFinite(row.value) || row.value <= 0 || row.value > 80
        || Date.parse(row.date) !== Date.parse(observations.find(item => item.matchId === row.matchId)?.date)) { minuteMap.clear(); break; }
      minuteMap.set(row.matchId, row.value);
    }
    if (minuteMap.size === sample) {
      const times = observations.map(row => minuteMap.get(row.matchId));
      minutes = { sample, average: mean(times), last5Average: mean(times.slice(0, 5)) };
      reasons.push(`W tych samych ${sample} meczach: średnio ${decimal(minutes.average)} min gry, ostatnie ${recent.length}: ${decimal(minutes.last5Average)} min.`);
      counterevidence.push('To historyczne minuty. Czas gry i rola w najbliższym meczu nie są potwierdzone przez ten licznik.');
    }
  }
  if (!minutes) counterevidence.push('Brak pełnych minut z tych samych występów. Nie zakładamy stałego czasu gry ani nie wyliczamy korekty na rywala.');
  return { status: 'available', supported, reasons, counterevidence,
    stats: { sample, hits, recentSample: recent.length, recentHits, average: mean(values), median, last5Average,
      minimum: sorted[0], maximum: sorted.at(-1), latestDate: observations[0].date, latestValue: values[0], minutes } };
}

export function playerPickReasonsHTML(pick, event, options = {}) {
  const result = buildPlayerPickReasons(pick, event, options);
  if (result.status !== 'available') return '';
  return `<section class="pfc-reason player-pick-reasons" data-player-reasons><p class="small"><b>${result.supported ? 'Co wspiera typ?' : 'Co pokazuje historia?'}</b></p><ul class="small">${result.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul><p class="small"><b>Co może przeszkodzić?</b></p><ul class="small">${result.counterevidence.slice(0, options.compact === false ? 2 : 1).map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></section>`;
}
