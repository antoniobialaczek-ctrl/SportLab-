import { playerPhotoHTML } from './player-photo.js';

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

export function playerFormHTML(data, name) {
  const players = Array.isArray(data.players) ? data.players : [];
  const regulars = players.filter(player => player.games >= 5);
  const shorter = players.filter(player => !(player.games >= 5));
  const table = rows => `<div class="scroll"><table><thead><tr><th>Zawodnik</th><th>Średnia / mediana / ostatnie 5</th><th>Występy</th></tr></thead><tbody>${rows.map(player => `<tr><td><span class="player-identity">${playerPhotoHTML(player, data.sport)}<span>${esc(player.name)}</span></span></td><td>${Object.values(player.metrics || {}).map(metric => `<div><b>${esc(metric.label)}: ${decimal(metric.average)}</b><br><span class="small">Mediana ${decimal(metric.median)} • ostatnie 5: ${decimal(metric.last5Average)}${metric.sample !== player.games ? ` • dane z ${esc(metric.sample)} występów` : ''}</span></div>`).join('')}</td><td>${esc(player.games)}</td></tr>`).join('')}</tbody></table></div>`;
  const dates = (data.sampledMatches || []).filter(row => Number.isFinite(Date.parse(row.date))).map(row => esc(date(row.date)));
  return `<section class="panel"><h4>${esc(name)}</h4>${players.length ? `<p class="small">Statystyki z ${esc(data.successfulMatches)} z ${esc(data.requestedMatches)} ostatnich dostępnych meczów drużyny. Każdy zawodnik ma własną liczbę występów.</p>${regulars.length ? table(regulars) : '<p class="small">Nie ma jeszcze zawodników z co najmniej 5 dostępnymi występami w tym zestawie.</p>'}${shorter.length ? `<details><summary>Pozostałe dostępne występy (${shorter.length})</summary><p class="small">Krótsze historie, poniżej 5 występów.</p>${table(shorter)}</details>` : ''}${dates.length ? `<details><summary class="small">Daty analizowanych meczów</summary><p class="small">${dates.join(', ')}.</p></details>` : ''}` : `<p class="small">${esc(data.reason || 'Źródło nie udostępniło porównywalnych statystyk zawodników.')}</p>`}${data.errors?.length ? `<details><summary class="small">Dostępność danych</summary><p class="small">${esc(data.errors.join(' '))}</p></details>` : ''}</section>`;
}
