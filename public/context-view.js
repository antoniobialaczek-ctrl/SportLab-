import { escapeHTML as esc } from './analysis-view.js';

const decimal = value => Number.isFinite(value) ? value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pl-PL') : '—';

export function contextHTML(analysis, event) {
  const context = analysis?.context;
  if (!context?.home || !context?.away) return '<section class="panel match-context"><h3>Kontekst spotkania</h3><p class="small">Dodatkowy kontekst jest chwilowo niedostępny.</p></section>';
  function side(data, name) {
    const opposition = data.opposition;
    return `<section class="panel"><h4>${esc(name)}</h4><p>Znane zakończone mecze w ostatnich 7 / 14 dniach: <b>${data.schedule.matchesLast7Days} / ${data.schedule.matchesLast14Days}</b>.</p><p>Godziny od początku ostatniego znanego meczu: <b>${decimal(data.schedule.hoursFromLatestStart)}</b>.</p><h4>Siła wcześniejszych rywali</h4>${opposition.status === 'available' ? `<p>Średni historyczny udział zwycięstw rywali: <b>${decimal(opposition.averageWinShare * 100)}%</b>. To opis ich wcześniejszych bilansów, nie szansa wygrania tego spotkania.</p><p class="small">Dostępny bilans dla ${opposition.matchedGames} z ${opposition.consideredGames} rywali; łącznie ${opposition.priorMatches} wcześniejszych wyników (próby mogą się nakładać).</p><details><summary>Bilanse rywali przed wcześniejszymi meczami</summary><div class="scroll"><table><thead><tr><th>Mecz</th><th>Rywal</th><th>Wcześniejszy bilans</th></tr></thead><tbody>${opposition.details.map(row => `<tr><td>${esc(date(row.date))}</td><td>${esc(row.opponent)}</td><td>${row.sample ? `${row.wins}Z / ${row.draws}R / ${row.losses}P (${row.sample} meczów)` : 'Brak wcześniejszej próby'}</td></tr>`).join('')}</tbody></table></div></details>` : '<p class="small">Brak wcześniejszych bilansów rywali w zapisanej historii.</p>'}</section>`;
  }
  return `<section class="match-context"><h3>Kontekst spotkania</h3><div class="analysis-sides">${side(context.home, event.home)}${side(context.away, event.away)}</div>${event.sport === 'tennis' ? `<section class="panel"><h4>Nawierzchnia</h4><p class="small">${esc(context.tennisSurface?.reason || 'Brak zweryfikowanej historii nawierzchni.')}</p></section>` : ''}<p class="small">Stan do ${esc(date(context.asOf))} • ${esc(context.source)}.</p><details><summary class="small">Jak odczytywać kontekst?</summary>${context.notes.map(note => `<p class="small">${esc(note)}</p>`).join('')}</details></section>`;
}

export function availabilityHTML(details, event, { now = Date.now() } = {}) {
  const availability = details?.availability;
  const start = Date.parse(event?.date), fetched = Date.parse(availability?.fetchedAt);
  const heading = '<h3>Składy i kontuzje</h3>';
  if (event?.state !== 'pre' || !Number.isFinite(start) || start <= now || fetched >= start) {
    return `<section class="panel match-availability">${heading}<p class="small">To mecz rozpoczęty lub archiwalny. Bieżące raporty kontuzji i składy pobrane teraz nie potwierdzają wiedzy dostępnej przed jego rozpoczęciem.</p></section>`;
  }
  const ids = availability?.teams?.map(team => team.id) || [];
  const bound = availability?.identityVerified === true && availability.eventId === event.sourceEventId
    && Number.isFinite(fetched) && fetched <= now + 60000
    && Math.abs(Date.parse(availability.startTime) - start) <= 60000
    && ids.length === 2 && new Set(ids).size === 2 && ids.includes(event.homeId) && ids.includes(event.awayId)
    && (!availability.state || availability.state === 'pre');
  if (!bound) return `<section class="panel match-availability">${heading}<p class="small">Źródło nie potwierdziło danych dla uczestników i terminu tego spotkania. Nie wyciągamy wniosków o zdrowiu ani składzie.</p></section>`;
  const teams = [event.homeId, event.awayId].map(id => availability.teams.find(team => team.id === id));
  return `<section class="match-availability">${heading}<p class="small">Raport źródła w chwili pobrania; brak wpisu nie oznacza zdolności do gry. Nie mamy odrębnego potwierdzenia składu.</p><div class="analysis-sides">${teams.map(team => `<section class="panel"><h4>${esc(team.name)}</h4><h4>Raport kontuzji</h4>${team.injuries.items.length ? `<ul>${team.injuries.items.map(player => `<li>${esc(player.name)} — ${esc(player.status)}${player.updatedAt ? ` <span class="small">(${esc(date(player.updatedAt))})</span>` : ''}</li>`).join('')}</ul>` : '<p class="small">Źródło nie podało raportu kontuzji dla tej drużyny. To nie potwierdza pełnej dostępności zawodników.</p>'}<h4>Skład wyjściowy</h4>${team.lineup.players.length ? `<p class="small">${esc(team.lineup.note)}</p><ul>${team.lineup.players.map(player => `<li>${esc(player.name)}${player.position ? ` (${esc(player.position)})` : ''}</li>`).join('')}</ul>` : `<p class="small">${esc(team.lineup.note)}</p>`}</section>`).join('')}</div><p class="small">${esc(availability.source)} • pobrano ${esc(date(availability.fetchedAt))}.</p></section>`;
}
