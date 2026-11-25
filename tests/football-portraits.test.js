import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { footballPortraitFor } from '../public/football-portraits.js';
import { playerPhotoHTML, playerPhotoURL } from '../public/player-photo.js';
import { verifiedPlayerPhoto } from '../src/server/player-photo.js';

const ids = ['362150', '231050', '227765', '253989'];

test('football portrait catalog binds source-provided images to independently matched identities', async () => {
  const evidence = JSON.parse(await readFile(new URL('../docs/football-portraits-sources.json', import.meta.url), 'utf8'));
  const accepted = evidence.records.filter(record => !record.excluded);
  assert.equal(accepted.length, ids.length);
  for (const id of ids) {
    const portrait = footballPortraitFor(id);
    const record = accepted.find(record => record.espn.id === id);
    assert.ok(Object.isFrozen(portrait));
    assert.equal(portrait.name, record.espn.name);
    assert.equal(portrait.name, record.sportsDB.name);
    assert.equal(portrait.birthDate, record.espn.born);
    assert.equal(portrait.birthDate, record.sportsDB.born);
    assert.equal(portrait.team, record.espn.team);
    assert.equal(portrait.team, record.sportsDB.team);
    assert.equal(portrait.providerPlayerId, record.sportsDB.id);
    assert.equal(portrait.photoURL, record.sportsDB.cutoutURL || record.sportsDB.thumbURL);
    assert.equal(new URL(portrait.photoURL).hostname, 'r2.thesportsdb.com');
    assert.equal(portrait.sourceURL, record.sportsDB.sourceURL);
    assert.equal(portrait.identitySourceURL, record.espn.sourceURL);
    assert.equal(record.imageCheck.status, 200);
    assert.match(record.imageCheck.contentType, /^image\//);
    assert.ok(Number.isFinite(Date.parse(portrait.checkedAt)));
  }
  for (const record of evidence.records.filter(record => record.excluded)) assert.equal(footballPortraitFor(record.espn.id), null);
  for (const id of [undefined, null, '', 'constructor', '__proto__', '362150/other', '999999999999999999']) assert.equal(footballPortraitFor(id), null);
});

test('both photo validators accept only the exact catalog image for the exact football athlete', () => {
  const portrait = footballPortraitFor('362150');
  for (const validate of [playerPhotoURL, verifiedPlayerPhoto]) {
    assert.equal(validate(portrait.photoURL, '362150', 'football'), portrait.photoURL);
    for (const value of [footballPortraitFor('231050').photoURL, 'https://r2.thesportsdb.com/images/media/player/cutout/arbitrary.png',
      portrait.photoURL.replace('https:', 'http:'), portrait.photoURL.replace('r2.thesportsdb.com', 'r2.thesportsdb.com.evil.test'),
      portrait.photoURL.replace('r2.thesportsdb.com', 'user:pass@r2.thesportsdb.com'), `${portrait.photoURL}?redirect=evil`, `${portrait.photoURL}#fragment`,
      ` ${portrait.photoURL}`, 'javascript:alert(1)']) assert.equal(validate(value, '362150', 'football'), null);
    assert.equal(validate(portrait.photoURL, '231050', 'football'), null);
    assert.equal(validate(portrait.photoURL, '362150', 'nba'), null);
    assert.equal(validate(portrait.photoURL, '362150', 'nhl'), null);
  }
});

test('server fills missing football portraits from the catalog without replacing explicit invalid images', () => {
  const photo = footballPortraitFor('362150').photoURL;
  for (const missing of [undefined, null, '', {}, { href: null }]) assert.equal(verifiedPlayerPhoto(missing, '362150', 'football'), photo);
  assert.equal(verifiedPlayerPhoto({ href: photo }, '362150', 'football'), photo);
  assert.equal(verifiedPlayerPhoto('https://example.com/yamal.png', '362150', 'football'), null);
  for (const sport of ['nba', 'nhl', 'cs2']) assert.equal(verifiedPlayerPhoto(null, '362150', sport), null);
  assert.equal(verifiedPlayerPhoto(null, '999999', 'football'), null);
  const espn = 'https://a.espncdn.com/i/headshots/soccer/players/full/362150.png';
  assert.equal(verifiedPlayerPhoto({ href: espn }, '362150', 'football'), espn);
});

test('football portrait fallback keeps accessible markup, escaped names and visible provider credit', () => {
  const portrait = footballPortraitFor('362150');
  const html = playerPhotoHTML({ id: '362150', name: 'Lamine <Yamal> "10"' }, 'football');
  assert.ok(html.includes(`src="${portrait.photoURL}"`));
  assert.match(html, /alt="Zdjęcie: Lamine &lt;Yamal&gt; &quot;10&quot;"/);
  assert.match(html, /width="64" height="64" loading="lazy" decoding="async"/);
  assert.match(html, /class="player-photo-credit" href="https:\/\/www.thesportsdb.com"/);
  assert.match(html, /aria-label="Źródło zdjęcia: TheSportsDB">TheSportsDB<\/a>/);
  assert.ok(!html.includes('onerror='));
  const unknown = playerPhotoHTML({ id: '999999', name: 'No Portrait' }, 'football');
  assert.ok(!unknown.includes('<img'));
  assert.match(unknown, /Brak zdjęcia: No Portrait/);
  const invalid = playerPhotoHTML({ id: '362150', name: 'Yamal', headshot: footballPortraitFor('231050').photoURL }, 'football');
  assert.ok(!invalid.includes('<img'));
  assert.ok(!invalid.includes('player-photo-credit'));
});
