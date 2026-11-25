import { escapeHTML as esc } from './analysis-view.js';

const COLORS = { home: '#a894ff', away: '#5cdebd' };
const FOOTBALL_ROUTES = new Set(['soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/pol.1', 'soccer/usa.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/eng.2', 'soccer/ned.1', 'soccer/por.1']);
const decimal = value => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const average = rows => rows.length ? rows.reduce((sum, row) => sum + row.total, 0) / rows.length : null;
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const day = value => new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Warsaw' });

function collect(form, analysis, event, before) {
  const rows = new Map(), rejected = new Set();
  const football = event.sport === 'football';
  const idPattern = event.route === 'soccer/pol.1' ? /^tsdb-\d{4,14}$/ : /^\d{4,14}$/;
  const legacyRegulation = ['soccer/pol.1', 'soccer/usa.1'].includes(event.route);
  for (const row of (Array.isArray(form?.recent) ? form.recent : []).slice(0, 200)) {
    if (typeof row?.id !== 'string' || !row.id.startsWith(`${event.route}:`)
      || !idPattern.test(row.id.slice(event.route.length + 1))
      || row.id === event.id || row.id === analysis.fixtureId
      || row.route != null && row.route !== event.route || !validTime(row.date)
      || Date.parse(row.date) >= before || ![row.scoreFor, row.scoreAgainst].every(value => Number.isInteger(value) && value >= 0 && value <= (football || event.sport === 'nhl' ? 30 : 300))
      || !football && row.scoreFor === row.scoreAgainst
      || football && (row.scoreScope != null && row.scoreScope !== 'regulation_90' || row.regulationOnly === false
        || !legacyRegulation && (row.scoreScope !== 'regulation_90' || row.regulationOnly !== true))) continue;
    const item = { id: row.id, date: row.date, total: row.scoreFor + row.scoreAgainst,
      scoreFor: row.scoreFor, scoreAgainst: row.scoreAgainst, opponent: String(row.opponent || 'Rywal niepodany') };
    const previous = rows.get(item.id);
    if (previous && (Date.parse(previous.date) !== Date.parse(item.date) || previous.scoreFor !== item.scoreFor || previous.scoreAgainst !== item.scoreAgainst)) rejected.add(item.id);
    else rows.set(item.id, item);
  }
  return [...rows.values()].filter(row => !rejected.has(row.id));
}

function figure(rows, side, name, maximum, line, compact, sport = 'nba') {
  const football = sport === 'football', goalSport = football || sport === 'nhl';
  const plural = goalSport ? 'goli' : 'punktów', singular = goalSport ? 'gola' : 'punktu';
  const color = COLORS[side];
  if (!rows.length) return '';
  const width = 440, height = compact ? 108 : 202;
  const left = 39, right = 13, top = compact ? 24 : 27, bottom = compact ? 23 : 28;
  const plotWidth = width - left - right, base = height - bottom, plotHeight = base - top;
  const y = value => base - value / maximum * plotHeight;
  const step = plotWidth / rows.length, barWidth = Math.min(compact ? 24 : 28, step * 0.66);
  const axis = [0, maximum / 2, maximum].map(value => `<g class="chart-tick"><line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#34435c" stroke-width="1"/><text x="${left - 7}" y="${y(value) + 4}" text-anchor="end" fill="#a7b8d5" font-size="${compact ? 13 : 11}">${decimal(value)}</text></g>`).join('');
  const reference = line === null ? '' : `<g class="chart-reference"><line x1="${left}" x2="${width - right}" y1="${y(line)}" y2="${y(line)}" stroke="#ffd37a" stroke-width="2" stroke-dasharray="6 4" aria-label="Linia porównania ${decimal(line)}"><title>Linia porównania: ${decimal(line)} ${singular}</title></line></g>`;
  const bars = rows.map((row, index) => {
    const center = left + step * (index + 0.5), topY = y(row.total);
    const label = `${new Date(row.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}: ${name} — ${row.opponent}, ${row.scoreFor}:${row.scoreAgainst}; suma ${row.total} ${plural}`;
    return `<g class="chart-observation" data-match-id="${esc(row.id)}" data-total="${row.total}" data-date="${esc(row.date)}"><rect x="${center - barWidth / 2}" y="${topY}" width="${barWidth}" height="${base - topY}" rx="3" fill="${color}" aria-label="${esc(label)}"><title>${esc(label)}</title></rect><text x="${center}" y="${Math.max(top - 3, topY - 5)}" text-anchor="middle" fill="#edf3ff" font-size="${compact ? 14 : 12}">${row.total}</text>${!compact || index === 0 || index === rows.length - 1 ? `<text x="${center}" y="${base + 17}" text-anchor="middle" fill="#a7b8d5" font-size="${compact ? 13 : 10}">${esc(day(row.date))}</text>` : ''}</g>`;
  }).join('');
  const mean = average(rows), recentMean = average(rows.slice(-5));
  const goals = goalSport ? `<p class="chart-caption">Gole zdobyte / mecz: <b>${decimal(rows.reduce((sum, row) => sum + row.scoreFor, 0) / rows.length)}</b> • stracone / mecz: <b>${decimal(rows.reduce((sum, row) => sum + row.scoreAgainst, 0) / rows.length)}</b></p>` : '';
  const results = goalSport && !compact ? `<div class="scroll"><table><caption>Ostatnie ${Math.min(5, rows.length)} wyników — od najnowszego</caption><thead><tr><th>Data</th><th>Rywal</th><th>${football ? 'Wynik po 90 minutach' : 'Wynik końcowy'}</th><th>Suma goli</th></tr></thead><tbody>${rows.slice(-5).reverse().map(row => `<tr><td>${esc(day(row.date))}</td><td>${esc(row.opponent)}</td><td>${row.scoreFor}:${row.scoreAgainst}</td><td>${row.total}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<figure class="chart-panel chart-${side}"><figcaption><b>${esc(name)}</b><span>${rows.length} wcześniejszych meczów</span></figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(name)}: sumy ${plural} z ${rows.length} wcześniejszych meczów, od najstarszego do najnowszego; oś od zera"><title>${esc(name)} — historyczne sumy ${plural}</title><desc>Każdy słupek to suma ${plural} obu drużyn w jednym wcześniejszym meczu. Daty znajdują się pod słupkami; dokładny wynik i rywal w opisie słupka. Oś pionowa zaczyna się od zera.</desc>${axis}<line data-zero-baseline="true" x1="${left}" x2="${width - right}" y1="${base}" y2="${base}" stroke="#7d90ae"/>${bars}${reference}</svg><p class="chart-caption">Średnia: <b>${decimal(mean)}</b> • ostatnie ${Math.min(5, rows.length)}: <b>${decimal(recentMean)}</b></p>${goals}${results}</figure>`;
}

/** Descriptive zero-baseline charts. No result at or after the fixture cutoff
 * enters the plot; missing or conflicting results are never invented as zero.
 */
export function matchChartsHTML(analysis, event, { line = null, compact = false } = {}) {
  if (!['nba', 'nhl', 'football'].includes(event?.sport) || event.sport === 'nhl' && event.route !== 'hockey/nhl'
    || event.sport === 'football' && !FOOTBALL_ROUTES.has(event.route)) return '';
  const nhl = event.sport === 'nhl', football = event.sport === 'football', goalSport = nhl || football, plural = goalSport ? 'goli' : 'punktów';
  const cutoff = Date.parse(analysis?.cutoff), start = Date.parse(event?.date);
  const bound = analysis?.sport === event.sport && analysis?.route === event.route
    && (football || event.route === (nhl ? 'hockey/nhl' : 'basketball/nba')) && typeof event.id === 'string' && event.id.startsWith(`${event.route}:`)
    && (!football || analysis.resultScope === 'regulation_90')
    && analysis.home?.id === event.homeId && analysis.away?.id === event.awayId && event.homeId !== event.awayId
    && (!analysis.fixtureId || analysis.fixtureId === event.id) && validTime(analysis.cutoff) && validTime(event.date)
    && Number.isFinite(cutoff) && cutoff <= Date.now() && Number.isFinite(start);
  if (!bound) return compact ? '' : '<section class="match-charts"><p class="chart-caption">Nie można powiązać wykresu z wcześniejszymi wynikami tego meczu.</p></section>';
  const before = Math.min(cutoff, start);
  let home = collect(analysis.home, analysis, event, before), away = collect(analysis.away, analysis, event, before);
  const cross = new Map(home.map(row => [row.id, row]));
  const conflicts = new Set(away.filter(row => cross.has(row.id) && (cross.get(row.id).scoreFor !== row.scoreAgainst
    || cross.get(row.id).scoreAgainst !== row.scoreFor || Date.parse(cross.get(row.id).date) !== Date.parse(row.date))).map(row => row.id));
  const chronological = rows => rows.filter(row => !conflicts.has(row.id)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id)).slice(0, 10).reverse();
  home = chronological(home); away = chronological(away);
  if (!home.length && !away.length) return compact ? '' : '<section class="match-charts"><p class="chart-caption">Brak porównywalnych wcześniejszych wyników do wykresu.</p></section>';
  const reference = typeof line === 'number' && Number.isFinite(line) && line > 0 && line <= (goalSport ? 60 : 600) ? line : null;
  const step = goalSport ? 2 : 50;
  const maximum = Math.max(football ? 6 : nhl ? 10 : 50, Math.ceil(Math.max(...home.map(row => row.total), ...away.map(row => row.total), reference || 0) / step) * step);
  const scope = football ? 'regulation_90' : nhl ? 'including_overtime_shootout' : null;
  return `<section class="match-charts${compact ? ' match-charts-compact' : ''}"${scope ? ` data-score-scope="${scope}"` : ''}><div class="chart-legend"><b>Sumy ${plural} w ostatnich meczach</b>${reference === null ? '' : `<span class="chart-line-label">Linia porównania: <b>${decimal(reference)}</b></span>`}</div><div class="chart-grid">${figure(home, 'home', event.home, maximum, reference, compact, event.sport)}${figure(away, 'away', event.away, maximum, reference, compact, event.sport)}</div><p class="chart-caption chart-method">${football ? 'Wyniki po 90 minutach z doliczonym czasem, bez dogrywki i karnych. ' : nhl ? 'Oficjalne wyniki końcowe z dogrywką i karnymi. Wygrana w serii karnych dodaje jeden gol do wyniku końcowego; nie sumujemy trafień w serii. Nie są to wyniki po 60 minutach. ' : ''}${compact ? 'Od najstarszego do najnowszego meczu; wspólna skala od zera.' : goalSport ? 'Każdy słupek to suma goli obu drużyn w innym wcześniejszym spotkaniu. Wykres opisuje historię; skala zaczyna się od zera.' : 'Każdy słupek to suma punktów obu drużyn w innym wcześniejszym spotkaniu, z wynikiem końcowym i dogrywką. Wykres opisuje historię; drużyny miały różnych rywali. Skala zaczyna się od zera.'}</p></section>`;
}
