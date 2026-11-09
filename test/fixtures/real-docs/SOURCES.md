# Real fetched docs for the host corpus

Each `.txt` is the text the skill's own `refreshPages` wrote for that page id (`htmlToText` of the live page).
The checker joins them with `joinPages`, which collapses each page's whitespace to one line.
No page here was written by hand. Retrieved (UTC):

| id | url | retrievedAt | sha256 of the text as fetched |
|---|---|---|---|
| manifest | https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/ | 2026-11-09T18:25:40.781Z | 57a122d2dbe4ec42fb432110b52a0784b5ddc9868e98bd3fc3b519a3b08d609b |
| webview | https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element | 2026-11-09T18:25:40.781Z | d42ab36138a9144ba12e2fdbb56ab1a72d639a8f813c41c9ad74a7ebaccea6f5 |
| interfaces | https://developer.adobe.com/uxp/guides/explanation/fundamentals/user-interfaces/ | 2026-11-09T18:25:40.781Z | 9661f8685d127c90ac47678880e1b32058cc79ea7173d53106ade8c406b3b8ed |
| entrypoints | https://developer.adobe.com/uxp/guides/explanation/concepts/panels-and-commands/ | 2026-11-09T18:25:40.781Z | a9b29f3f63b593c68531b14cdd094cc60b95a31793b774e7bdb199f7fe901106 |
| migration | https://developer.adobe.com/uxp/migration-center/ | 2026-11-09T18:25:40.781Z | cea09780ce45d3d23b2bdfd7147a5e5f98b20cc025f3dd33f5c81d4858740bc9 |
| known-issues | https://developer.adobe.com/uxp/uxp-api/known-issues | 2026-11-09T18:25:40.781Z | 5ffa3a300175ea6b25ba8bbd783d24bdffa1c9d88b0ccd156319ce5b03beaf36 |
| unsupported-elements | https://developer.adobe.com/uxp/uxp-api/reference-html/general/unsupported-elements | 2026-11-09T18:25:40.781Z | 96fd9cbe2174240545778ac6740e866c5a4730c6662bb3fd65e738085fd9cee9 |
| unsupported-attributes | https://developer.adobe.com/uxp/uxp-api/reference-html/general/unsupported-attributes | 2026-11-09T18:25:40.781Z | a52791a31358e55ae1d1b5821f0ce205b315edbb90df2ed456d379ce0a120669 |
| css-styles | https://developer.adobe.com/uxp/uxp-api/reference-css/styles/ | 2026-11-09T18:25:40.781Z | 5dc6136e9994a505132303ac36176078e6be8fa538f0cdf8f7f87e6f1a9ef4db |
| css-styling | https://developer.adobe.com/uxp/guides/how-to/recipes/css-styling/ | 2026-11-09T18:25:40.781Z | 87fef44c40ef08288c53dd141d8219bf2c48be10613da97471e3f5a91eeee89f |
| spectrum-widgets | https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/ | 2026-11-09T18:25:40.781Z | 974a8581f46cc586ed8312fc365ed48d069db5c873accefa4aa50e9817198127 |
| spectrum-faq | https://developer.adobe.com/uxp/uxp-api/reference-spectrum/faqs/ | 2026-11-09T18:25:40.781Z | 2493fd762d70c960ce8670b20a34786d2fb3da8d1cf41a85ebbaac80a69181b0 |
| spectrum-sp-heading | https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/typography/sp-heading | 2026-11-09T18:25:40.781Z | e050fa53c12caa4e8f205970bb9aa930ca57ca66566616a23b8c6ce1fc0f1148 |
| spectrum-sp-body | https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/typography/sp-body | 2026-11-09T18:25:40.781Z | b22dfd52b83cc4b3be696984fc4857b3e2f058c99cc1bd6c81d1e0b4f1bfb65d |
| spectrum-sp-button | https://developer.adobe.com/uxp/uxp-api/reference-spectrum/spectrum-uxp-widgets/user-interface/sp-button | 2026-11-09T18:25:40.781Z | c87483c3d966c55caf4924972bbead4a2b4faaafe9e920db842c4cb254df7bed |
| photoshop.document | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document | 2026-11-09T18:25:40.781Z | 6e552b839d7edd72037ec749323cd64e5953a71377a3778bc8f0424e6e9f4642 |
| photoshop.layer | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer | 2026-11-09T18:25:40.781Z | 5bf00abef3e8cb586ddb7966c7ef9733fa6b9a85ad24eacefe7801451c70aed3 |
| photoshop.executeAsModal | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal | 2026-11-09T18:25:40.781Z | 0b466b22dc4423f9633eec112815b95d37fbf1cabbf80fc8cf310eb2139e7954 |
| photoshop.action | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction | 2026-11-09T18:25:40.781Z | 16d5e4429f53730587924c4b67ee0d29cd152deba9a641eb744307faf2261b02 |
| photoshop.changelog | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/changelog/ | 2026-11-09T18:25:40.781Z | 9f3db78b5e1449e1c6189277f64b80c6fd06e9db7f5159a4fb2ccc94b2dac4fc |
| premiere.introduction | https://developer.adobe.com/premiere-pro/uxp/introduction/ | 2026-11-09T15:59:46.236Z | a7045a8a31f1db8bba4375c1adc3eb4072394910d9fdbe81f43021a4b3f61123 |
| premiere.reference | https://developer.adobe.com/premiere-pro/uxp/ppro_reference/ | 2026-11-09T15:59:46.236Z | 45303ac353ed35beecca009e8072ecf9737a2fe89125d18ce8cc23456f92e8e6 |
| premiere.project | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project | 2026-11-09T15:59:46.236Z | f36cb3a29bdd85c63936380d2893bd03ce9016720c83a533f440e12e3b33d5a1 |
| premiere.sequence | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence | 2026-11-09T15:59:46.236Z | 5e60c637c1cc3061983e1a7df7ee59aad95727ecfe5fc4a29f76a63f9217117d |
| premiere.videotrack | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videotrack | 2026-11-09T15:59:46.236Z | 004587372fc86e6c5c66ae9d33aaafbf87d1d2a64a4291037d78c2baa6550682 |
| premiere.videocliptrackitem | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem | 2026-11-09T15:59:46.236Z | 293d23ec61a60ef1f937b172192b529359b4f8867cc1316e4f9e605f0c0931d8 |
| premiere.ticktime | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/ticktime | 2026-11-09T15:59:46.236Z | e2c986892f9103c1c5cda51320211e6561ab0ea78985d60f6a0f388d69f87364 |
| premiere.constants | https://developer.adobe.com/premiere-pro/uxp/ppro-reference/constants/ | 2026-11-09T15:59:46.236Z | 8dd6e3f48c278f70499b9a922649b9e04aa69dc99093083a9fc8e12e3438847c |
| photoshop.app | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/photoshop | 2026-11-09T18:53:18.881Z | e3cedcf8dedfbea80beee9850f1fd0c9e52171d7c2a8dbf513c4fbfe7a20ea39 |
| photoshop.core | https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopcore | 2026-11-09T18:53:18.881Z | 05e3d0b396d2f7776e4808024c16fc0132345b453a1f706c161d7e6a645de948 |
