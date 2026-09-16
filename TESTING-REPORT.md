# Reliability Verification

## YouTube Startup Follow-up (2026-09-16)

- Reproduced an ordering defect: adding the first YouTube song issued player
  commands while its container was still hidden. The playback hook now reveals
  the container before issuing commands, including inside the original gesture.
- Platform sync reads the immediately updated queue reference. Enabling audio
  on a listener no longer sends two consecutive YouTube play/seek requests.
- Added host/late-listener coverage for startup visibility, delayed player
  readiness, blocked autoplay, one local enable request, and both listeners
  receiving the next queued video without host pause/play recovery.
- Production build passed. All 40 room/source desktop/mobile scenarios passed
  with no failures, skips, or flaky retries. The saved report is
  `test-results/youtube-followup.json`; touched-code editor diagnostics passed.
- Unmocked local smoke check: the real IFrame API loaded and accepted video
  requests. One sample was unavailable; another exposed the local autoplay
  fallback but did not sustain media playback after a recovery tap. The native
  player remained buffering. This is not a passing live-playback verification.
- YouTube tests use a controlled IFrame API mock, not audible live-provider
  playback. A listener may need to tap Enable audio or Play YouTube audio on
  their own device; a host gesture cannot grant another browser permission.
  Physical phone and live YouTube checks remain outstanding. Background YouTube
  restrictions are unchanged, and these changes have not been deployed.

## Background Queue Follow-up (2026-09-16)

- Reproduced a direct-audio queue transition failure with the document marked
  hidden: the next source loaded but did not play. Separate socket listeners
  could call play before loading the new source, cancelling that play request.
  The recovery timer skipped hidden pages, leaving playback silent until return.
- Source selection and playback sync now run in order in the same callback.
  Queue events update an immediate reference so source selection does not wait
  for React to render the new queue. Personal listener pause remains respected.
- Added a regression using two uploaded WAV files, a real media-ended event,
  and real Socket.IO sync. It checks that the next source changes and its audio
  position advances without a foreground event.
- Validation: production build passed; all 38 room/source Chromium desktop and
  mobile scenarios and all 19 backend/unit/integration tests passed. No editor
  diagnostics in the touched code.
- Visibility is simulated. Physical phone locking, browser/OS suspension,
  live provider streams, and Bluetooth output still require device testing.
  Embedded YouTube background restrictions remain unchanged. Local changes
  have not been deployed to the hosted app.

## Phone Playback Follow-up (2026-09-15)

- Reported device: Samsung Galaxy S24, website in a phone browser, apparently
  YouTube playback. A physical phone lock test was not available.
- Reproduced a missing YouTube mount when the IFrame API was already loaded.
  The player now belongs to the room, has a visible viewport and native
  controls, and is destroyed on leaving. Re-entry creates a fresh player.
- Queued playback is cancelled by pause/leave. Delayed readiness uses the same
  checked playback path as normal starts. Autoplay blocking exposes a local
  gesture control; player errors remain visible until an explicit retry.
  Buffering no longer triggers repeated seek/play commands.
- Direct-audio lock-screen Play/Pause acts locally before the socket response.
  Listeners without room permission can pause/resume their own audio without
  changing the host's playback. Seek buttons read the live audio position,
  not a foreground-only React update. Interrupted autoplay exposes Resume audio.
- Final production client build passed. All 36 room/source browser scenarios
  passed across Chromium desktop/mobile, as did all 19 backend/unit/integration
  tests. Editor diagnostics and desktop/mobile recovery layout checks passed.
  The two-listener assertion now accounts for time between position samples
  without widening its 1.5-second drift limit.
- YouTube tests use a controlled IFrame API mock. Hidden-page and lock-screen
  tests simulate visibility and Media Session actions; they do not simulate OS
  suspension or certify audible live-provider playback. Live YouTube and actual
  S24 lock/unlock playback remain manual checks.
- Embedded YouTube is foreground playback, not a background-audio service.
  Phone browsers/provider rules can stop it when locked. Use uploaded or
  available direct-audio tracks for lock-screen listening; browser/OS limits
  still apply. No silent-audio keepalive or video-audio extraction was added.
- This update is local only. The hosted site has not been deployed or verified.

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
- Live YouTube playback, HLS recovery, microphone/WebRTC,
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