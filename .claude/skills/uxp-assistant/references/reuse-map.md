# Reuse map

`semantic-inspected` means this implementation read the source. `prior` means an earlier audit named the file and this tree copied the shell. `excluded` means the file was not brought over.

| Source | Status | What this tree does |
| --- | --- | --- |
| express-addon-review session, server, dashboard, chrome, cdp, ws | semantic-inspected | Two writers, loopback token, Host and Origin checks, secret not on disk, CDP without the dropped flags, chrome cleanup split from the screenshot |
| express-addon-review listing, marketplace, Pages workflows | excluded | Not part of this skill |
| cep-to-uxp docs page list | semantic-inspected | Ten shared URLs. One success does not make the refresh fresh |
| cep-to-uxp docs.mjs extractDocFacts and mergeDocFacts at b2fa98eb | copied and called | `scripts/lib/cep/docs-facts.mjs`. Runtime and design read these facts. A matching URL list alone is not the reuse |
| cep-to-uxp domains.mjs at b2fa98eb | copied and called | `scripts/lib/cep/domains.mjs`. Origin checks run on assessed source |
| cep-to-uxp scan.mjs collectProcessCalls and processNeedsHybrid at b2fa98eb | copied and called | `scripts/lib/cep/signals.mjs`. A non-opener cep.process can offer hybrid. It does not build the addon |
| cep-to-uxp hosts.mjs WebView floor, bolt.mjs generator, shims, SilentObserver | excluded | Not used as a native floor and not used as a host |
| cep-to-uxp hosts.mjs WebView floor 26.0.0 | excluded | Not used as a native floor |
| cep-to-uxp bolt.mjs tree generator | excluded | Empty folders use create-bolt-uxp |
| cep-to-uxp Premiere SilentObserver and currentColor replacement | excluded | Lossy, not copied |
| create-bolt-uxp 1.3.27 programmatic API | semantic-inspected | Empty-folder installer. React plus Photoshop is the only acceptance slice |
| Uploaded audit and reuse notes | prior | Not a test result and not build scope |
