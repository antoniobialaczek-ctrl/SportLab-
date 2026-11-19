const BAR_COLOR = '#a894ff';
const LINE_COLOR = '#5cdebd';
const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const dateLabel = (value, short = false) => new Date(value).toLocaleDateString('pl-PL', {
  day: '2-digit', month: '2-digit', ...(short ? {} : { year: 'numeric' }), timeZone: 'Europe/Warsaw',
});

function observationTime(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function unavailable(message) {
  return `<p class="pc-unavailable">${esc(message)}</p>`;
}

function verticalMaximum(value) {
  const step = value <= 10 ? 1 : value <= 50 ? 5 : value <= 100 ? 10 : value <= 500 ? 50 : 100;
  return Math.max(step, Math.ceil(value / step) * step);
}

/** Render observed counts only. Invalid or conflicting history is never filled
 * with zero, and a comparison line is not a prediction or a price.
 */
export function playerMetricChartHTML(metric, { line = null, label = 'Wyniki zawodnika', now = Date.now() } = {}) {
  if (!Array.isArray(metric?.observations) || !metric.observations.length) {
    return unavailable('Brak wcześniejszych wyników zawodnika do wykresu.');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return unavailable('Nie można potwierdzić dat wcześniejszych wyników zawodnika.');
  }
  const observations = new Map();
  for (const row of metric.observations) {
    const time = observationTime(row?.date);
    if (typeof row?.matchId !== 'string' || !row.matchId.trim() || time === null || time > now
      || !Number.isInteger(row.value) || row.value < 0 || row.value > 1000) {
      return unavailable('Wcześniejsze wyniki zawodnika są niepełne lub mają nieprawidłowe wartości albo daty. Wykres jest niedostępny.');
    }
    const previous = observations.get(row.matchId);
    if (previous && (previous.time !== time || previous.value !== row.value)) {
      return unavailable('Sprzeczne wyniki tego samego meczu zawodnika. Wykres jest niedostępny.');
    }
    if (!previous) observations.set(row.matchId, { matchId: row.matchId, date: row.date, value: row.value, time });
  }
  const rows = [...observations.values()]
    .sort((a, b) => a.time - b.time || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0)).slice(-10);
  const name = typeof label === 'string' && label.trim() ? label : 'Wyniki zawodnika';
  const reference = typeof line === 'number' && Number.isFinite(line) && line >= 0 && line <= 1000 ? line : null;
  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const maximum = verticalMaximum(Math.max(...rows.map(row => row.value), reference ?? 0));
  const width = 520, height = 190, left = 42, right = 12, top = 26, base = 156;
  const plotWidth = width - left - right, plotHeight = base - top, step = plotWidth / rows.length;
  const barWidth = Math.min(30, step * 0.62);
  const y = value => base - value / maximum * plotHeight;
  const ticks = [0, maximum / 2, maximum].map(value => `<g class="pc-tick"><line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#34435c"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" fill="#a7b8d5" font-size="11">${decimal(value)}</text></g>`).join('');
  const bars = rows.map((row, index) => {
    const center = left + step * (index + 0.5), topY = y(row.value);
    const description = `${dateLabel(row.date)} — ${name}: ${row.value}`;
    return `<g class="pc-observation" data-match-id="${esc(row.matchId)}" data-date="${esc(row.date)}" data-value="${row.value}"><rect class="pc-bar" x="${center - barWidth / 2}" y="${topY}" width="${barWidth}" height="${base - topY}" rx="3" fill="${BAR_COLOR}" aria-label="${esc(description)}"><title>${esc(description)}</title></rect><text class="pc-value" x="${center}" y="${Math.max(15, topY - 6)}" text-anchor="middle" fill="#edf3ff" font-size="12">${row.value}</text><text class="pc-date" x="${center}" y="${base + 20}" text-anchor="middle" fill="#a7b8d5" font-size="11">${esc(dateLabel(row.date, true))}</text></g>`;
  }).join('');
  const meanLine = `<g class="pc-mean"><line x1="${left}" x2="${width - right}" y1="${y(mean)}" y2="${y(mean)}" stroke="${LINE_COLOR}" stroke-width="1.5" aria-label="Średnia: ${decimal(mean)}"><title>Średnia wcześniejszych wyników: ${decimal(mean)}</title></line></g>`;
  const comparison = reference === null ? '' : `<g class="pc-reference"><line x1="${left}" x2="${width - right}" y1="${y(reference)}" y2="${y(reference)}" stroke="${LINE_COLOR}" stroke-width="2" stroke-dasharray="6 4" aria-label="Linia porównania: ${decimal(reference)}"><title>Linia porównania: ${decimal(reference)}</title></line></g>`;
  return `<figure class="pc-chart"><figcaption class="pc-heading"><b>${esc(name)}</b><span>${rows.length} wcześniejszych meczów</span></figcaption><svg class="pc-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(name)}: wcześniejsze wyniki z ${rows.length} meczów, od najstarszego do najnowszego; skala od zera"><title>${esc(name)} — wcześniejsze wyniki zawodnika</title><desc>Każdy słupek przedstawia rzeczywisty wynik zawodnika w jednym wcześniejszym meczu. Dokładne wartości są nad słupkami, a daty pod nimi. Oś pionowa zaczyna się od zera. Ciągła turkusowa linia pokazuje średnią.${reference === null ? '' : ' Przerywana turkusowa linia to linia porównania.'}</desc>${ticks}<line class="pc-baseline" data-zero-baseline="true" x1="${left}" x2="${width - right}" y1="${base}" y2="${base}" stroke="#7d90ae"/>${bars}${meanLine}${comparison}</svg><p class="pc-summary">Średnia: <b>${decimal(mean)}</b>${reference === null ? '' : ` <span class="pc-line-label">· Linia porównania: <b>${decimal(reference)}</b></span>`}</p><p class="pc-method">Wcześniejsze wyniki od najstarszego do najnowszego. Wykres opisuje historię zawodnika.</p></figure>`;
}
