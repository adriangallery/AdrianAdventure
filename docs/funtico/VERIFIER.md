# ZEROadventure — Triage: events and server checks (for the Funtico Verifier)

This note describes what the ZEROadventure client sends about a **Triage** practice run and what our own server checks
before a result reaches Funtico. It covers formats and behaviour only.

## 1. Flow of a run (live mode)

1. The client asks our server to open a run: `POST /save-api/funtico/run/start` (same origin as the game), with the
   same `Authorization: Bearer <game token>` the SDK uses. The server answers with a `runId` and a `seed`.
2. The client builds the run from that seed (9 stations: find a detail in a scene, identify a symptom, answer a
   "relapse" question). Nothing of the run is shown before the run clock starts (`t = 0`).
3. During the run, every accepted tap is recorded locally and, in parallel, reported with `RecordEvent_Client`
   (section 2). Reporting never blocks the game: events are queued and handed to the SDK outside the tap handler.
4. At the end the client calls `CompletePractice` with `RunId = runId` and `GameEvents` (section 3). Our relay
   validates the run, recomputes the score and forwards `{ Score, RunId, GameEvents }` to Funtico, signed with the
   game key. The score sent by the client is ignored.

## 2. `RecordEvent_Client` events (format version 1)

One compact JSON object per string, in order:

| Event | Shape | Notes |
|---|---|---|
| run start | `{"ev":"start","v":1,"run":"<runId>","cat":"<catalog id>","n":9,"dur":180000}` | `dur` = run length in ms |
| tap | `{"t":<ms>,"est":<station>,"obj":"<target id>","x":<num>,"y":<num>,"ok":1\|0}` | see below |
| run end | `{"ev":"end","t":<ms>,"score":<int>,"hits":<int>,"misses":<int>,"done":1\|0}` | `done` = all stations closed |

Tap fields:
- `t`: integer milliseconds since the run clock started (`t = 0`), strictly increasing.
- `est`: station index (0-based). `obj`: id of the station's target.
- `x`, `y`: tap position as a percentage (0–100, two decimals) of the scene image. For "relapse" stations
  (multiple choice) `x` is the chosen option index and `y` is `0`.
- `ok`: `1` if the client counted it as correct, `0` if not. Informative only: the server recomputes it.

Taps the server would reject anyway (too soon after the previous tap or after the station opened) are not recorded
by the client.

## 3. `GameEvents` of `CompletePractice`

An array of strings. The first one is a header; then one string per tap, in order:

```json
["{\"triage\":1,\"catalog\":\"1:b57a5e29d8fa\"}",
 "{\"t\":1840,\"est\":0,\"obj\":\"<target id>\",\"x\":41.27,\"y\":63.5}",
 "..."]
```

- Header: exactly the keys `triage` (format version, `1`) and `catalog` (content version the run was built with).
- Taps: exactly the keys `t`, `est`, `obj`, `x`, `y` (same meaning as in section 2; no `ok`). Any other key, a
  missing header or too many taps makes the server reject the submission.
- `RunId` must be the `runId` returned by `run/start`.

## 4. What our server checks (high level)

Before forwarding a result, the relay:

- **Session ownership and single use:** the run must have been opened by the same player (identified through
  Funtico from the request token) and is closed on its first verdict, accepted or not. Resubmissions, other players'
  runs and unknown runs are rejected.
- **Run window:** the result must arrive within the run's time window; late submissions are rejected.
- **Content version:** the header must match the content version the run was opened with.
- **Timing:** tap times must be increasing, within the run length, not ahead of the real time elapsed on the server
  since the run was opened, and compatible with human reaction times.
- **Order and targets:** taps must follow the station order and name the right target; a station only counts as
  solved if the tap falls inside the target area of that run (recomputed on the server from its own copy of the run).
- **Score:** recomputed on the server from the taps with the same rules as the client. That score is the one sent to
  Funtico.
- **Review flags:** runs with suspicious patterns are flagged in our logs for manual review; flags do not reject a run.

Rejections answer with a stable error code (for example `run_closed`, `run_expired`, `bad_events`,
`hit_out_of_bounds`, `taps_too_fast`) and never reach Funtico.

## 5. Practice (simulated) mode

With `?mock=1`, or without a Funtico token, the game runs fully offline: local seed, results and events kept in
memory and local storage, and no request to Funtico or to our relay.
