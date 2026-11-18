import { escapeHTML as esc } from './analysis-view.js';

const stageLabels = { calibration: 'Kalibracja', selection: 'Wybór', test: 'Test' };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pl-PL') : '—';
const healthLabels = { fresh: 'aktualny', stale: 'starszy niż 12 godzin', missing: 'brak raportu', invalid: 'nieprawidłowa data' };

export function readinessHTML(data, sport = 'nba', league = 'all') {
  const entry = data?.sports?.[sport];
  if (!entry) return '<section class="readiness-panel"><h3>Stan walidacji</h3><p>Brak raportu tej dyscypliny. Prognozy pozostają wstrzymane.</p></section>';
  const rows = (entry.leagues || []).filter(row => league === 'all' || row.league === league);
  const sources = [['history', 'Raport historyczny'], ['forward', 'Obserwacje przedmeczowe']].map(([key, label]) => {
    const source = data.sources?.[key];
    return `<span>${label}: ${esc(healthLabels[source?.status] || 'brak raportu')} • ${esc(date(source?.generatedAt))}${source?.fallback ? ' • dane rezerwowe wdrożenia' : ''}.</span>`;
  }).join('<br>');
  const blockers = [...new Set([...(entry.blockers || []), ...rows.flatMap(row => row.blockers || [])])];
  return `<section class="readiness-panel"><h3>Stan walidacji i aktualność danych</h3><p class="small">${sources}</p>
    ${rows.length ? `<div class="scroll"><table><thead><tr><th>Liga</th><th>Etap</th>${Object.values(stageLabels).map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.phaseLabel)}</td>${Object.keys(stageLabels).map(stage => { const value = row.stages?.[stage]; return `<td>${value ? `${value.settled}/${value.target}<br><small>Zapisane: ${value.recorded}, oczekujące: ${value.pending}, unieważnione: ${value.void}</small>` : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="small">Brak zarejestrowanej próby dla tego wyboru.</p>'}
    ${blockers.length ? `<ul class="small">${blockers.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}
    ${[...new Set(rows.map(row => row.nextStep))].map(step => `<p class="small">${esc(step)}</p>`).join('')}
    <p class="small">${esc(data.note)}</p><details><summary class="small">Ciągłość eksperymentu</summary><p class="small">Rejestracja: ${esc(date(data.protocol?.registeredAt))}. Status raportu protokołu: ${esc(data.protocol?.status || 'missing')}. ${esc(data.protocol?.note)}</p></details></section>`;
}
