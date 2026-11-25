/** Source-supplied portraits, checked against ESPN name, birth date and club.
 * This small catalog makes no API requests. Unverified identities keep initials.
 * Evidence and availability checks: docs/football-portraits-sources.json.
 */
const portraits = Object.freeze(Object.fromEntries([
  {
    "playerId": "362150",
    "name": "Lamine Yamal",
    "birthDate": "2007-07-13",
    "team": "Barcelona",
    "teamId": "83",
    "league": "soccer/esp.1",
    "provider": "TheSportsDB",
    "providerPlayerId": "34219490",
    "photoURL": "https://r2.thesportsdb.com/images/media/player/cutout/m9n4ja1761512633.png",
    "sourceURL": "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=Lamine_Yamal",
    "identitySourceURL": "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/83/roster",
    "creditURL": "https://www.thesportsdb.com",
    "checkedAt": "2026-11-25T13:34:17.163Z"
  },
  {
    "playerId": "231050",
    "name": "Raphinha",
    "birthDate": "1996-12-14",
    "team": "Barcelona",
    "teamId": "83",
    "league": "soccer/esp.1",
    "provider": "TheSportsDB",
    "providerPlayerId": "34163304",
    "photoURL": "https://r2.thesportsdb.com/images/media/player/cutout/w94spe1726510018.png",
    "sourceURL": "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=Raphinha",
    "identitySourceURL": "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/83/roster",
    "creditURL": "https://www.thesportsdb.com",
    "checkedAt": "2026-11-25T13:34:23.284Z"
  },
  {
    "playerId": "227765",
    "name": "Dani Olmo",
    "birthDate": "1998-05-07",
    "team": "Barcelona",
    "teamId": "83",
    "league": "soccer/esp.1",
    "provider": "TheSportsDB",
    "providerPlayerId": "34168363",
    "photoURL": "https://r2.thesportsdb.com/images/media/player/cutout/s9hzoh1725611346.png",
    "sourceURL": "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=Dani_Olmo",
    "identitySourceURL": "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/83/roster",
    "creditURL": "https://www.thesportsdb.com",
    "checkedAt": "2026-11-25T13:34:41.594Z"
  },
  {
    "playerId": "253989",
    "name": "Erling Haaland",
    "birthDate": "2000-07-21",
    "team": "Manchester City",
    "teamId": "382",
    "league": "soccer/eng.1",
    "provider": "TheSportsDB",
    "providerPlayerId": "34169116",
    "photoURL": "https://r2.thesportsdb.com/images/media/player/cutout/e8cart1789115621.png",
    "sourceURL": "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=Erling_Haaland",
    "identitySourceURL": "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/382/roster",
    "creditURL": "https://www.thesportsdb.com",
    "checkedAt": "2026-11-25T13:34:47.673Z"
  }
].map(portrait => [portrait.playerId, Object.freeze(portrait)])));

export function footballPortraitFor(playerId) {
  const id = String(playerId ?? '');
  return /^\d{1,14}$/.test(id) ? portraits[id] ?? null : null;
}
