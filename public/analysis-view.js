import { playerPhotoHTML } from './player-photo.js';
import { playerMetricChartHTML } from './player-charts.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = escapeHTML;
const decimal = value => Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
const date = value => new Date(value).toLocaleDateString('pl-PL');
const outcome = { W: 'Z', D: 'R', L: 'P' };

function chips(form) {
  return form.recent?.length ? `<span class="form-strip" aria-label="Ostatnie wyniki: ${form.recent.slice(0, 5).map(r => outcome[r.outcome]).join(', ')}">${form.recent.slice(0, 5).map(row => `<span class="form-result ${esc(row.outcome)}" title="${esc(date(row.date))}: ${esc(row.opponent)} ${row.scoreFor}:${row.scoreAgainst}">${outcome[row.outcome] || '?'}</span>`).join('')}</span>` : '<span class="small">Brak wcześniejszych meczów</span>';
}

export function previewHTML(analysis, event) {
  if (analysis.status === 'unavailable') return `<p class="small">${esc(analysis.notes?.find(note => note.includes('ESPN nie udostępnia')) || 'Brak wcześniejszych wyników tych uczestników w zapisanej historii. Szczegóły pokazują zakres dostępnych danych.')}</p>`;
  const row = (form, label) => `<div class="form-row"><span>${esc(label)}</span><b>${form.wins}Z ${event.sport === 'football' ? `${form.draws}R ` : ''}${form.losses}P</b>${chips(form)}</div>`;
  return `<div class="preview-heading">Forma przed meczem</div>${row(analysis.home, event.home)}${row(analysis.away, event.away)}
    <p class="analysis-text">${esc(analysis.narrative[2] || analysis.narrative.find(line => !line.includes('brak wcześniejszych')) || analysis.narrative[0])}</p>
    <p class="small">Próba: ${analysis.home.sample} / ${analysis.away.sample} wcześniejszych meczów. Z — zwycięstwo, R — remis, P — porażka.</p>`;
}

export function matchDetailHTML(analysis, event) {
  const unit = event.sport === 'nba' ? 'Punkty' : event.sport === 'tennis' ? 'Sety' : 'Gole';
  const side = (form, label) => `<section class="panel"><h3>${esc(label)}</h3>${chips(form)}${form.sample ? `<p><b>${form.wins} zwycięstw${event.sport === 'football' ? `, ${form.draws} remisów` : ''}, ${form.losses} porażek</b> • ostatnie ${form.sample} dostępnych meczów</p>
    <div class="stat-grid"><div><span>${unit} zdobyte / mecz</span><b>${decimal(form.averageFor)}</b></div><div><span>${unit} stracone / mecz</span><b>${decimal(form.averageAgainst)}</b></div><div><span>Średnia różnica</span><b>${decimal(form.averageMargin)}</b></div><div><span>Dni od ostatniego meczu</span><b>${form.restDays ?? '—'}</b></div></div>
    ${event.sport !== 'tennis' ? `<p class="small">W domu: ${form.splits.home.wins}Z/${form.splits.home.sample} meczów • Na wyjeździe: ${form.splits.away.wins}Z/${form.splits.away.sample} meczów</p>` : ''}
    <details><summary>Ostatnie spotkania</summary><div class="scroll"><table><thead><tr><th>Data</th><th>Rywal</th><th>Wynik</th></tr></thead><tbody>${form.recent.map(row => `<tr><td>${esc(date(row.date))}</td><td>${esc(row.opponent)}</td><td>${row.scoreFor}:${row.scoreAgainst} (${outcome[row.outcome] || '?'})</td></tr>`).join('')}</tbody></table></div></details>` : '<p>Brak wcześniejszych meczów w zapisanej historii tej ligi.</p>'}</section>`;
  return `<h3>Analiza porównawcza przed meczem</h3><div class="analysis-takeaways">${analysis.narrative.map(line => `<p>${esc(line)}</p>`).join('')}</div><div class="analysis-sides">${side(analysis.home, event.home)}${side(analysis.away, event.away)}</div>
    <h3>Bezpośrednie spotkania</h3>${analysis.headToHead.sample ? `<p>${analysis.headToHead.sample} dostępnych meczów: ${esc(event.home)} — ${analysis.headToHead.homeWins} zwycięstw; ${esc(event.away)} — ${analysis.headToHead.awayWins}; remisy — ${analysis.headToHead.draws}.</p><div class="scroll"><table><thead><tr><th>Data</th><th>Mecz</th><th>Wynik</th></tr></thead><tbody>${analysis.headToHead.recent.map(row => `<tr><td>${esc(date(row.date))}</td><td>${esc(row.home)} — ${esc(row.away)}</td><td>${row.homeScore}:${row.awayScore}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small">Brak wcześniejszych bezpośrednich spotkań w dostępnej historii.</p>'}
    <p class="small">Stan danych do ${esc(new Date(analysis.cutoff).toLocaleString('pl-PL'))}. ${esc(analysis.source)} • historia zaktualizowana ${esc(analysis.historyUpdatedAt ? new Date(analysis.historyUpdatedAt).toLocaleString('pl-PL') : '—')}.</p><details><summary class="small">Zakres i ograniczenia danych</summary>${analysis.notes.map(note => `<p class="small">${esc(note)}</p>`).join('')}</details>`;
}

export function playerFormHTML(data, name, options = {}) {
  const players = (Array.isArray(data.players) ? data.players : []).filter(p => p && typeof p.id === 'string');
  if (!players.length) return `<section class="panel player-explorer"><h4>${esc(name)}</h4><p class="small">${esc(data.reason || 'Źródło nie udostępniło porównywalnych statystyk zawodników.')}</p></section>`;
  const player = players.find(p => p.id === options.playerId) || players[0];
  if (!Object.keys(player.metrics || {}).length) return `<section class="panel player-explorer"><div class="pe-team">${esc(name)}</div><div class="player-identity">${playerPhotoHTML(player, data.sport)}<h4>${esc(player.name)}</h4></div><p class="small">Brak porównywalnych statystyk tego zawodnika.</p></section>`;
  const preferred = data.sport === 'nba' ? 'PTS' : data.sport === 'nhl' ? 'S' : 'SH';
  const metrics = Object.entries(player.metrics || {}), metricKey = metrics.some(([key]) => key === options.metric) ? options.metric : metrics.some(([key]) => key === preferred) ? preferred : metrics[0][0];
  const metric = player.metrics[metricKey];
  const observations = Array.isArray(metric.observations) ? metric.observations : [];
  const validDates = observations.map(row => row.date).filter(value => Number.isFinite(Date.parse(value))).sort();
  return `<section class="panel player-explorer" data-player-explorer data-team-id="${esc(data.teamId)}" data-event-id="${esc(options.eventId || '')}">
    <div class="pe-team">${esc(name)}</div><div class="pe-controls"><label>Zawodnik<select data-player-inspector>${players.map(p => `<option value="${esc(p.id)}" ${p.id === player.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.games)} występów</option>`).join('')}</select></label><label>Statystyka<select data-player-metric>${metrics.map(([key, value]) => `<option value="${esc(key)}" ${key === metricKey ? 'selected' : ''}>${esc(value.label || key)}</option>`).join('')}</select></label></div>
    <div class="player-identity pe-identity">${playerPhotoHTML(player, data.sport)}<div><h4>${esc(player.name)}</h4><span class="small">${esc(metric.label || metricKey)} · ${esc(metric.sample)} wcześniejszych występów</span></div></div>
    <div class="pe-stats"><div><span>Średnia</span><b>${decimal(metric.average)}</b></div><div><span>Ostatnie 5</span><b>${decimal(metric.last5Average)}</b></div><div><span>Mediana</span><b>${decimal(metric.median)}</b></div></div>
    ${playerMetricChartHTML(metric, { label: `${player.name} — ${metric.label || metricKey}` })}
    <p class="small pe-dates">${validDates.length ? `${esc(date(validDates[0]))} — ${esc(date(validDates.at(-1)))}. ` : ''}Każdy słupek to rzeczywisty występ; brak danych nie jest zerem. Historia nie potwierdza przyszłego składu.</p>
    <details class="pe-table"><summary>Wartości i daty występów</summary><div class="scroll"><table><thead><tr><th>Data</th><th>${esc(metric.label || metricKey)}</th></tr></thead><tbody>${observations.map(row => `<tr><td>${esc(date(row.date))}</td><td>${esc(row.value)}</td></tr>`).join('')}</tbody></table></div></details>
    ${data.errors?.length ? `<details><summary class="small">Dostępność danych</summary><p class="small">${esc(data.errors.join(' '))}</p></details>` : ''}
  </section>`;
}
