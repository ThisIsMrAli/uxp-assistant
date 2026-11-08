# Coverage

Shared pages are the ten cep-to-uxp URLs. Photoshop document, layer, executeAsModal, and changelog pages are fetched when the host is Photoshop or the goal names those APIs.

A page is fresh only when that fetch succeeds. A failure leaves the previous file and is stale, or failed when there was no file.

A live refresh on 8 Nov 2026 returned all 14 requested pages fresh. The Layer page lists `name` as a read/write string at 22.5, described as "Name of the layer." The Document page lists `activeLayers` as read/write at 22.5, described as "The selected layers in the document." with a parenthetical `(26.9)`. The executeAsModal page says the modal state was introduced with `apiVersion` 2, and its options table lists `commandName` as required at 23.0. The `suspendHistory` section on that page describes the call and does not place a separate numeric minimum beside it. The shared manifest page shows `minVersion` as a required string and uses the placeholder `HOST_VERSION`. It does not state a numeric host floor and it does not mention `apiVersion`. The known-issues page says "CSS transitions and animations are not supported." and "text-transform is not supported".

The Bolt starter Photoshop `minVersion` is 24.2.0. When that is newer than the proven API floor, the starter value stays. The WebView floor 26.0.0 is not applied.

Missing text stays unknown. This file is not a host pass.
