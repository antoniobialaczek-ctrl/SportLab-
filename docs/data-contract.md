# SportLab internal data contract

Existing UI and /api/scores, /api/details, /api/model remain supported. Node ESM, no runtime dependencies, no paid services.

Historical event (one completed match, not tournament):
```
{ id, sourceEventId, sport, league, route, season,
  startTime, resultAvailableAt, availabilityBasis,
  homeId, awayId, home, away, homeScore, awayScore, neutralSite,
  status: 'completed', source: { provider: 'ESPN', url, fetchedAt } }
```
Dates are ISO UTC. IDs are stable strings; id is route + ':' + sourceEventId. league is route's last segment (eng.1, nba, nhl, atp, wta). Scores are finite nonnegative numbers. No draws in NBA/NHL/tennis; football has three outcomes. Tennis scores denote sets and must represent a completed individual match. Do not use tournaments, cancelled/retired/walkover matches, records, rankings, odds, current roster or current stats as historical features. Without a verified completion timestamp, resultAvailableAt is startTime + 24 hours and availabilityBasis is 'conservative-24h'; this is an explicit approximation, not a certified historical snapshot. source.fetchedAt records actual collection time.

Storage: data/history/{sport}.json is {schemaVersion:1, updatedAt, events:[], errors:[]}. Stable upsert by id. Reject conflicting participants, malformed dates/results, duplicate IDs. Ingestion stages before atomic writes. Never substitute synthetic records on source failure.

Model interface: src/models/index.js exports evaluateSport(sport, events, options?) and predictFixture(fixture, history, report, options?). evaluateSport returns one serializable sport report with status/reason, modelVersion, sport, metrics, calibration, sample counts and provenance. Models stay isolated by league and sport. All updates require resultAvailableAt < fixture.startTime. Chronological training/calibration/untouched final test. Do not report training accuracy as test accuracy. Publication must be blocked without adequate independent validation, sufficient sample, freshness and credible availability provenance. Unknown/unsupported sport returns unavailable, no fabricated numbers.

Report: data/reports/models.json is {schemaVersion:1, generatedAt, sports:{nba,football,nhl,tennis,cs2}}. api/model may map this into legacy results plus explicit per-sport status. API must never expose raw model probabilities as verified forecasts. UI remains explicit about withheld forecasts.

New analysis may use the normalized history for descriptive team/individual form and retain existing ESPN boxscore details. Historical aggregates must declare cutoff/sample/source; match-day current stats are descriptive and never fed back into old forecasts.
