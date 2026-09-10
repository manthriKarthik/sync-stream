# Reliability Verification

## Scope

Verified on 2026-09-10 using local Chromium desktop and mobile emulation,
generated WAV audio, real Socket.IO connections, browser offline mode, and
controlled media-request failures. This is not a guarantee of zero defects.

## Fixed And Reproduced

- A short browser interruption sought forward by about a second when playback
  resumed. The regression failed before the fix. Automatic resume and unchanged
  snapshots now tolerate small drift up to 2.5 seconds instead of seeking at
  0.75 seconds. Explicit user seeks still apply immediately.
- Internet loss could leave controls looking connected until the socket
  heartbeat expired. Browser offline/online events now update connection state
  immediately and initiate reconnection when connectivity returns.
- Shared controls now remain disabled until room membership is restored.
  Playback, seeking, permissions, chat, uploads, and queue additions cannot
  intentionally enqueue stale offline actions. Chat drafts remain editable.
- Rejoining after missing a host pause did not receive a playback snapshot.
  Rejoin now sends paused as well as playing state, with snapshot semantics.
- Native audio left in an error state after a failed request stayed silent.
  A fresh playback snapshot reloads the failed resource before resuming.
- Leaving while disconnected clears the local session without buffering a
  leave command; reconnection does not silently rejoin that room.

## Automated Results

- Production client build: passed.
- Backend/unit/integration suite: 18 passed.
- Browser suite: 34 scenarios verified across desktop and mobile. The broad run
  passed 33; the remaining mobile test assumed a desktop volume slider. After
  changing it to test the existing mobile mute flag, its focused rerun passed.
- Editor diagnostics: no errors in the touched code.

Coverage includes create/join/leave, invalid input, keyboard submission,
uploads and invalid files, actual HTML audio playback, seeking, pause, queue
removal, multi-listener synchronization, chat, DJ permissions, host handoff,
foreground refresh, simulated app interruption, buffered offline playback,
offline chat drafts, local volume/mute, reconnection after missed pause/track
changes, failed media reload, duplicate-member checks, provider-search races
and errors, artist images, responsive layout, branding, and reduced motion.

## Live Search Check

Query: `night`, through the local server on the verification date.

| Provider | Result |
| --- | --- |
| Audius | HTTP 200, 10 results |
| Saavn | HTTP 200, 15 results |
| SoundCloud | HTTP 200, 20 results |
| YouTube | HTTP 502, upstream search unavailable |

Search success does not verify playable media, catalog availability, account
authorization, or audible playback. YouTube search remains an outstanding
provider-integration defect: the server logged `ytInitialData not found`, then
the fallback parser failed reading `browseId`. The UI reports the error instead
of empty results. A provider integration update is still needed.

## Remaining Device And Network Checks

- Test real Android Chrome and iOS Safari while switching apps, locking the
  screen, accepting a phone call, using battery saver, and changing Bluetooth
  output. Emulation does not reproduce operating-system media suspension.
- Disconnect Wi-Fi/mobile data both with and without buffered media. Buffered
  native audio can continue; unbuffered streaming requires connectivity.
  Long interruptions may require seeking to catch up with the room.
- Physical network loss without an OS offline event still relies on transport
  error/heartbeat detection; browser connectivity detection is not infallible.
- Spotify Premium/OAuth, live YouTube playback, HLS recovery, microphone/WebRTC,
  and cross-device Bluetooth timing require authenticated/provider/device tests.
- Server restarts discard in-memory rooms. Server-restart recovery, very long
  outages, media stalls without an error event, and load/soak testing are not
  covered by this run.
- Persistent user IDs are not authentication. This test pass does not certify
  the app for hostile public deployment; existing authentication, rate-limit,
  and upload-retention limitations remain.

## Repeat

```sh
npm test
npm run build
npm run test:e2e
node scripts/check-providers.mjs http://localhost:3001
```

Use a fresh backend process after server changes. Set `SONIN_TEST_PORT` to an
unused port to prevent Playwright from reusing an outdated running server.
Deploy the updated client and server together; local tests do not update a
hosted deployment.