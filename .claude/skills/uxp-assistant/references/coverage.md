# Coverage

Shared pages are the ten cep-to-uxp URLs plus the Spectrum UXP widget overview, the FAQ, and the sp-heading, sp-body, and sp-button pages. On 8 Nov 2026 the overview said those controls need no special library. The FAQ said they are not built atop Web Components and that an import makes UXP use the SWC variation. The three widget pages say Since: UXP v4.1. That line is not a Photoshop host floor. Photoshop document, layer, executeAsModal, and changelog pages are fetched when the host is Photoshop or the goal names those APIs.

A page is fresh only when that fetch succeeds. A failure leaves the previous file and is stale, or failed when there was no file.

A live refresh on 8 Nov 2026 returned all 14 requested pages fresh. The Layer page lists `name` as a read/write string at 22.5, described as "Name of the layer." The Document page lists `activeLayers` as read/write at 22.5, described as "The selected layers in the document." with a parenthetical `(26.9)`. The executeAsModal page says the modal state was introduced with `apiVersion` 2, and its options table lists `commandName` as required at 23.0. The `suspendHistory` section on that page describes the call and does not place a separate numeric minimum beside it. The shared manifest page shows `minVersion` as a required string and uses the placeholder `HOST_VERSION`. It does not state a numeric host floor and it does not mention `apiVersion`. The known-issues page says "CSS transitions and animations are not supported." and "text-transform is not supported".

The Bolt starter Photoshop `minVersion` is 24.2.0. When that is newer than the proven API floor, the starter value stays. The WebView floor 26.0.0 is not applied.

The Document page also lists `title` as a read string at 22.5, described as "Document title". `commandName` is read when the property name and the version are on separate lines. The table header "Name" is not the layer `name` property.

A camelCase API that is absent from the first fetched pages is looked up in the official AdobeDocs class tree for that host. Premiere `importFiles` is on the Project class page, not on the short Premiere API index. A miss stays `unknown` and pauses. It does not become a permanent refusal.

Missing text stays unknown. This file is not a host pass.
