# Catalog import batch 14

Reviewed November 23, 2026 for issue #722 and tracking item `ff14e799-4a20-42ec-9345-51b2c726d117`. The starting catalog contained 704 servers and included batch 13. The seed type supported `client-directory`, `directoryListings`, and `relevance`.

## Directory coverage

- Claude published 1,205 connector records, including 163 `wf.` records, 912 other `connector.` records, 129 `connector.ant.` records, and one bare ID. 1,013 records carried a remote server URL. Rank uses the full connector list sorted by descending `popularityScore` and the one-based formula `round(100 × (1,205 − rank) / 1,205)`. Quartr ranked 299 and eToro ranked 576. [Claude directory](https://claude.com/connectors)
- ChatGPT returned 14,556 distinct public plugin IDs with their current releases over 173 pages of global search. The 19 category and curated-section queries consumed another 184 pages. Entries in the curated home sections were cross-checked against their public releases. Publisher pages supplied endpoint evidence when a release exposed only a product or setup URL. [ChatGPT directory](https://chatgpt.com/plugins)
- Matching used directory IDs first, followed by normalized primary, browser and alternative URLs, with no date filter. Publisher evidence was used to resolve product variants and confirm existing directory associations. Tenant-specific, demo and one-off personal endpoints were excluded. All 30 selected servers completed anonymous initialization. Some require credentials for account tools.

## Selected servers

Every row passed the repository validator at the exact primary URL. The inventory column gives the retained tool count from anonymous discovery. Quartr, MyDesigns and eToro initialized but did not produce a publishable snapshot because at least one discovery method could not complete. A partial inventory records only the tools retained by the repository’s privacy and size limits.

| Server | Primary endpoint | Directory IDs and pages | Listing evidence | Relevance | MCP version | Tools |
| --- | --- | --- | --- | ---: | --- | ---: |
| Quartr | `https://mcp.quartr.com/mcp` | [connector.ac8e4b2a-1618-4b6f-8756-660eb7583ebe](https://claude.com/marketplace/connectors/quartr)<br>[plugin_asdk_app_69b2bc50b4c0819189d86013d62ecc71](https://chatgpt.com/plugins/plugin_asdk_app_69b2bc50b4c0819189d86013d62ecc71) | [Publisher guide](https://mcp.quartr.com/docs) | 75 | 2026-07-28 | Unavailable |
| Easy-Peasy.AI | `https://easy-peasy.ai/mcp` | [plugin_asdk_app_6a7335210b048191acbc18b77c0cb47a](https://chatgpt.com/plugins/plugin_asdk_app_6a7335210b048191acbc18b77c0cb47a) | [Publisher guide](https://easy-peasy.ai/mcp) | 70 | 2025-11-25 | 13 partial |
| Fiveable for AP Students | `https://fiveable.me/api/mcp` | [plugin_asdk_app_6a98be9cb08c819184453651a6e0188e](https://chatgpt.com/plugins/plugin_asdk_app_6a98be9cb08c819184453651a6e0188e) | [Publisher guide](https://fiveable.me/llms.txt) | 65 | 2026-07-28 | 36 partial |
| Fiveable for AP Teachers | `https://fiveable.me/api/mcp/teacher` | [plugin_asdk_app_6abae8bb48808191bd2fd1522c67abc7](https://chatgpt.com/plugins/plugin_asdk_app_6abae8bb48808191bd2fd1522c67abc7) | [Publisher guide](https://fiveable.me/llms.txt) | 65 | 2026-07-28 | 49 partial |
| LuxAlgo | `https://mcp.luxalgo.com/mcp` | [plugin_asdk_app_6ac8c9fde3848191b1033fe8824a0e82](https://chatgpt.com/plugins/plugin_asdk_app_6ac8c9fde3848191b1033fe8824a0e82) | [Publisher guide](https://www.luxalgo.com/mcp/) | 65 | 2026-07-28 | 19 partial |
| MyDesigns | `https://mcp.mydesigns.io/mcp` | [plugin_asdk_app_6aeb8bd1ff008191976b3c163c42cdb5](https://chatgpt.com/plugins/plugin_asdk_app_6aeb8bd1ff008191976b3c163c42cdb5) | [Publisher guide](https://mydesigns.io/llms.txt) | 65 | 2026-07-28 | Unavailable |
| Retell AI | `https://mcp.retellai.com/` | [plugin_asdk_app_695b101534508191a313998a4a5badc0](https://chatgpt.com/plugins/plugin_asdk_app_695b101534508191a313998a4a5badc0) | [Publisher guide](https://docs.retellai.com/get-started/mcp-server) | 60 | 2025-11-25 | 3 |
| eToro | `https://mcp-readonly.public-api.etoro.com/` | [connector.b173ac5f-4342-42f5-b3a6-b0750f4565d3](https://claude.com/marketplace/connectors/etoro-connector) | Claude directory | 52 | 2026-07-28 | Unavailable |
| Aperiodic | `https://aperiodic.io/mcp` | [plugin_asdk_app_6af18fffeccc8191a3e54cc816df3c63](https://chatgpt.com/plugins/plugin_asdk_app_6af18fffeccc8191a3e54cc816df3c63) | [Publisher guide](https://aperiodic.io/llms.txt) | 50 | 2025-11-25 | 8 partial |
| ArchLang | `https://mcp.archlang.uk/mcp` | [plugin_asdk_app_6acf8381cca08191bfb3eb7305fb6970](https://chatgpt.com/plugins/plugin_asdk_app_6acf8381cca08191bfb3eb7305fb6970) | [Publisher guide](https://archlang.uk/llms.txt) | 50 | 2025-11-25 | 13 partial |
| Bettyapp | `https://bettyapp.org/mcp` | [plugin_asdk_app_6af28f5a983081919ea5ccd4399e344b](https://chatgpt.com/plugins/plugin_asdk_app_6af28f5a983081919ea5ccd4399e344b)<br>[plugin_asdk_app_6af2de60f470819191ec6f6162a2bff7](https://chatgpt.com/plugins/plugin_asdk_app_6af2de60f470819191ec6f6162a2bff7) | [Publisher guide](https://bettyapp.org/llms.txt) | 50 | 2026-07-28 | 9 partial |
| Cooper Email | `https://cooperemail.com/mcp` | [plugin_asdk_app_6a9c72b1e468819190e4d653372612fc](https://chatgpt.com/plugins/plugin_asdk_app_6a9c72b1e468819190e4d653372612fc) | [Publisher guide](https://cooperemail.com/llms.txt) | 50 | 2026-07-28 | 25 partial |
| CoworkingView | `https://mcp.coworkingview.com/mcp` | [plugin_asdk_app_6ad14456c9b08191ae12fc187f1f3afa](https://chatgpt.com/plugins/plugin_asdk_app_6ad14456c9b08191ae12fc187f1f3afa) | [Publisher guide](https://coworkingview.com/llms.txt) | 50 | 2025-11-25 | 10 partial |
| CueScout | `https://mcp.cuescout.com/mcp` | [plugin_asdk_app_6abe30ec3cec819198b2efaf9a3a2a5a](https://chatgpt.com/plugins/plugin_asdk_app_6abe30ec3cec819198b2efaf9a3a2a5a) | [Publisher guide](https://cuescout.com/llms.txt) | 50 | 2025-11-25 | 14 |
| Domainee | `https://mcp.domainee.dev/mcp` | [plugin_asdk_app_6a8b0b9fb1dc81918ddf0a6ae72d49ec](https://chatgpt.com/plugins/plugin_asdk_app_6a8b0b9fb1dc81918ddf0a6ae72d49ec) | [Publisher guide](https://domainee.dev/llms.txt) | 50 | 2025-11-25 | 18 partial |
| Echo UI | `https://mcp.echo-ui.com/mcp` | [plugin_asdk_app_6acf038ad1d0819195d18068c127b032](https://chatgpt.com/plugins/plugin_asdk_app_6acf038ad1d0819195d18068c127b032) | [Publisher guide](https://echo-ui.com/docs/mcp) | 50 | 2025-11-25 | 10 |
| eSIM Grab | `https://esimgrab.com/mcp` | [plugin_asdk_app_6adfbb8be15c8191980b25806fca6e13](https://chatgpt.com/plugins/plugin_asdk_app_6adfbb8be15c8191980b25806fca6e13) | [Publisher guide](https://esimgrab.com/llms.txt) | 50 | 2025-11-25 | 4 partial |
| FreeTTS | `https://mcp.freetts.org/mcp` | [plugin_asdk_app_6abd9462d6b48191ab5129ad2317744b](https://chatgpt.com/plugins/plugin_asdk_app_6abd9462d6b48191ab5129ad2317744b) | [Publisher guide](https://freetts.org/llms.txt) | 50 | 2025-11-25 | 9 partial |
| HaitiDocs | `https://mcp.haitidocs.org/` | [plugin_asdk_app_6a1cd1bb8a3081918181372ca4bdb60e](https://chatgpt.com/plugins/plugin_asdk_app_6a1cd1bb8a3081918181372ca4bdb60e) | [Publisher guide](https://www.haitidocs.org/connect/) | 50 | 2025-11-25 | 11 partial |
| Pesquisa de leis (KivoHub) | `https://leis.kivohub.ai/mcp` | [plugin_asdk_app_6aecbe7daf208191952cdf377cc8cb51](https://chatgpt.com/plugins/plugin_asdk_app_6aecbe7daf208191952cdf377cc8cb51) | [Publisher guide](https://kivohub.ai/llms.txt) | 50 | 2025-11-25 | 3 |
| Leal | `https://mcp.getleal.com/mcp` | [plugin_asdk_app_6ac02474d3488191852d70cb47dcf237](https://chatgpt.com/plugins/plugin_asdk_app_6ac02474d3488191852d70cb47dcf237) | [Publisher guide](https://www.getleal.com/llms.txt) | 50 | 2026-07-28 | 15 partial |
| Online-Druck.biz | `https://mcp.online-druck.biz/` | [plugin_asdk_app_6aec26af704081919c930c62aa3bca3d](https://chatgpt.com/plugins/plugin_asdk_app_6aec26af704081919c930c62aa3bca3d) | [Publisher guide](https://www.online-druck.biz/llms.txt) | 50 | 2026-07-28 | 8 partial |
| PackIndex | `https://opnplatform.com/api/mcp` | [plugin_asdk_app_6acb3bb72f6c81918291e980a78390c5](https://chatgpt.com/plugins/plugin_asdk_app_6acb3bb72f6c81918291e980a78390c5) | [Publisher guide](https://opnplatform.com/llms.txt) | 50 | 2026-07-28 | 26 |
| Parse | `https://agent.parse.gl/mcp` | [plugin_asdk_app_6ac016287b4c8191a726a16a82478779](https://chatgpt.com/plugins/plugin_asdk_app_6ac016287b4c8191a726a16a82478779) | [Publisher guide](https://parse.gl/llms.txt) | 50 | 2025-11-25 | 6 partial |
| Pexafy Stock Photos | `https://mcp.pexafy.com/mcp` | [plugin_asdk_app_6a837089eb1c8191b29a0d126a54f770](https://chatgpt.com/plugins/plugin_asdk_app_6a837089eb1c8191b29a0d126a54f770) | [Publisher guide](https://pexafy.com/llms.txt) | 50 | 2025-11-25 | 5 partial |
| Postbox Services | `https://mcp.postboxservices.com/mcp` | [plugin_asdk_app_6aecf2f5e6dc8191acc60f34ea006120](https://chatgpt.com/plugins/plugin_asdk_app_6aecf2f5e6dc8191acc60f34ea006120) | [Publisher guide](https://postboxservices.com/llms.txt) | 50 | 2025-11-25 | 12 partial |
| Production List | `https://api.productionlist.com/mcp` | [plugin_asdk_app_6aa84d1005048191be745ad71a78f9f8](https://chatgpt.com/plugins/plugin_asdk_app_6aa84d1005048191be745ad71a78f9f8) | [Publisher guide](https://www.productionlist.com/plugin) | 50 | 2025-11-25 | 5 |
| Sparkl | `https://sparkl.gg/mcp` | [plugin_asdk_app_6af5c76215e881919b15e11c53d599bd](https://chatgpt.com/plugins/plugin_asdk_app_6af5c76215e881919b15e11c53d599bd) | [Publisher guide](https://sparkl.gg/llms.txt) | 50 | 2025-06-18 | 6 partial |
| Subnano Browse | `https://mcp.subnano.ai/mcp` | [plugin_asdk_app_6acefeb819e48191aa76c6c9edb51d4c](https://chatgpt.com/plugins/plugin_asdk_app_6acefeb819e48191aa76c6c9edb51d4c) | [Publisher guide](https://subnano.ai/llms.txt) | 50 | 2025-11-25 | 9 partial |
| Supplemental EU Food Law | `https://mcp.supplemental.pl/mcp` | [plugin_asdk_app_6aec3300f49081918f325dc3a83455f9](https://chatgpt.com/plugins/plugin_asdk_app_6aec3300f49081918f325dc3a83455f9) | [Publisher guide](https://supplemental.pl/llms.txt) | 50 | 2026-07-28 | 8 partial |

ChatGPT-only scores default to 50. The higher scores reflect publisher-reported product adoption.

- Easy-Peasy.AI scored 70 for reported use by more than 2 million people. [Publisher adoption report](https://easy-peasy.ai/blog/trust-and-security-easy-peasy-ais-commitment-to-certifications-and-compliance)
- Both Fiveable connectors scored 65. Fiveable reports 68,476 scored free-response answers across 18 subjects as well as student and classroom adoption. Its student and teacher apps expose distinct tools on separate endpoints. [Fiveable press data](https://fiveable.me/press)
- LuxAlgo scored 65 for reporting more than 100,000 paying traders. [LuxAlgo adoption](https://www.luxalgo.com/about/)
- MyDesigns scored 65 for reporting more than 200,000 creators. [MyDesigns adoption](https://mydesigns.io/about-us)
- Retell AI scored 60 for reporting more than 4,000 businesses. [Retell AI customers](https://www.retellai.com/customers)

The LuxAlgo Claude custom connector at `https://claude.mcp.luxalgo.com/mcp` initialized anonymously. The Production List member endpoint at `https://api.productionlist.com/mcp/members` returned HTTP 401 with an OAuth challenge. The publishers mention Claude listings for Production List and HaitiDocs, but their listing IDs could not be confirmed in the full Claude directory data. [LuxAlgo setup](https://www.luxalgo.com/mcp/), [Production List setup](https://www.productionlist.com/plugin), [HaitiDocs setup](https://www.haitidocs.org/connect/)

## Report corrections and existing matches

- Repostit kept its publisher source and gained the ChatGPT listing at relevance 50. The exact `/mcp/v1.1` endpoint returned HTTP 401. Claude has no verified listing ID. [ChatGPT listing](https://chatgpt.com/plugins/plugin_asdk_app_6aa2dbd3da6481918f64012ddfdaf405), [Repostit ChatGPT guide](https://app.repostit.io/chatgpt-connector.html), [Repostit endpoint guide](https://app.repostit.io/claude-connector.html)
- Bright Data kept relevance 60 and its publisher OAuth source. Both `https://mcp.brightdata.com/mcp` and the narrower ChatGPT alternative `https://mcp.brightdata.com/mcp/directory` returned HTTP 401. [ChatGPT listing](https://chatgpt.com/plugins/plugin_asdk_app_6af42cb82db48191880491bbe636ca25), [Bright Data guide](https://brightdata.com/blog/ai/codex-and-chatgpt-with-bright-data)
- CoinGecko App kept both directory IDs and uses its browser guide as publisher provenance. The same address initialized as `coingecko-mcp-app`. [CoinGecko browser guide](https://mcp.coingecko.com/mcp)
- FlickDirect Connect scored 60 using its audience figures. Its existing publisher guide documents the anonymous endpoint. [Audience figures](https://flickdirect.com/about-flickdirect/flickdirect-media-kit.aspx?mix=raw), [FlickDirect setup](https://flickdirect.com/connect.aspx)
- upcoach scored 55. Its shared endpoint serves administrators of individual upcoach workspaces and returned HTTP 401. [upcoach use cases](https://upcoach.com/use-cases), [upcoach endpoint guide](https://upcoach.com/help/settings-and-account/connect-ai-tools-with-mcp)
- Wachete scored 50 using its mobile app adoption. Its publisher FAQ documents the endpoint, which returned HTTP 401. [Wachete app](https://play.google.com/store/apps/details?id=com.wachete.client), [Wachete FAQ](https://www.wachete.com/faq)
- Xverum scored 45 for documented production deployments. The live validator completed initialization, and account tools require OAuth. [Xverum deployments](https://www.xverum.com/), [Xverum endpoint guide](https://www.xverum.com/llms.txt)
- FFmpeg API gained publisher provenance. Its endpoint returned HTTP 401. Relevance remains unset pending adoption evidence. [FFmpeg API endpoint guide](https://mcp.ffmpeg-api.com/)

The existing US and EU Amplitude endpoints, Lusha, AllTrails, Financial Modeling Prep and LetsBot gained ChatGPT attribution and kept their prior scores and provenance.

| Catalog entry | Added ChatGPT listing | Verification |
| --- | --- | --- |
| Amplitude | [US](https://chatgpt.com/plugins/plugin_connector_690e2dabf430819196f8b3701ec838ec), [EU](https://chatgpt.com/plugins/plugin_asdk_app_6a32f6911e788191a7826866848ba5c0) | [Both regional endpoints](https://amplitude.com/docs/amplitude-ai/amplitude-mcp) |
| Lusha | [Lusha](https://chatgpt.com/plugins/plugin_asdk_app_69e5f69b54d8819185e1638e73c15e3b) | [Shared MCP endpoint and ChatGPT support](https://www.lusha.com/llms.txt) |
| AllTrails | [AllTrails](https://chatgpt.com/plugins/plugin_asdk_app_68f1afc5a6008191a701eaaab428816c) | Release website matched the normalized endpoint and named the same trail-search service. [Claude endpoint](https://claude.com/marketplace/connectors/alltrails) |
| Financial Modeling Prep | [FMP](https://chatgpt.com/plugins/plugin_asdk_app_69aa0adb8df081918832f2a84cb57adf) | Release website matched the normalized endpoint and named the same market-data service. [FMP setup](https://site.financialmodelingprep.com/developer/docs/mcp-server) |
| LetsBot | [LetsBot](https://chatgpt.com/plugins/plugin_asdk_app_694d5d79a9c481918305d9446a0f0d21) | [Publisher names the ChatGPT app and shared endpoint](https://letsbot.net/llms.txt) |

## Carry forward

These investigated candidates returned HTTP 401 and remain eligible for a later batch. The anonymous-initialization cohort filled batch 14.

| Server | ChatGPT listing | Exact primary endpoint | Publisher evidence | Detail |
| --- | --- | --- | --- | --- |
| Semgrep AppSec Platform | [plugin_asdk_app_6aee327d76f481918497c9cc2e76986b](https://chatgpt.com/plugins/plugin_asdk_app_6aee327d76f481918497c9cc2e76986b) | `https://semgrep.dev/api/mcp` | [Guide](https://docs.semgrep.dev/mcp/authentication) | Restricted endpoint `https://semgrep.dev/api/mcp/read-only` also returned 401. Relevance 50. Separate from `mcp.semgrep.ai`. |
| CharGen | [plugin_asdk_app_6ad71b9b2abc8191a0e60a367ee070ab](https://chatgpt.com/plugins/plugin_asdk_app_6ad71b9b2abc8191a0e60a367ee070ab) | `https://api.char-gen.com/mcp` | [Guide](https://char-gen.com/llms.txt) |  |
| Hoplix Print on Demand | [plugin_asdk_app_6ae382a60cc481919c5be7ad7a25ff7f](https://chatgpt.com/plugins/plugin_asdk_app_6ae382a60cc481919c5be7ad7a25ff7f) | `https://api.hoplix.com/mcp` | [Guide](https://hoplix.com/en/mcp-integration) |  |
| PyAI | [plugin_asdk_app_6aa0c7069ae08191b0b072967652e640](https://chatgpt.com/plugins/plugin_asdk_app_6aa0c7069ae08191b0b072967652e640) | `https://api.pyai.com/mcp` | [Guide](https://pyai.com/mcp) |  |
| Signal8 | [plugin_asdk_app_6aeede6fca4c8191ab60dc88d9a45514](https://chatgpt.com/plugins/plugin_asdk_app_6aeede6fca4c8191ab60dc88d9a45514) | `https://mcp.signal8.ai/mcp` | [Guide](https://signal8.ai/llms.txt) |  |
| TenderLead | [plugin_asdk_app_6a931892b2748191a2fcc64789c66933](https://chatgpt.com/plugins/plugin_asdk_app_6a931892b2748191a2fcc64789c66933) | `https://tenderlead.co.uk/mcp` | [Guide](https://tenderlead.co.uk/llms.txt) |  |
| Vokolla Press Release Agent | [plugin_asdk_app_6ad2fea4448c8191b9e66fae6f078f83](https://chatgpt.com/plugins/plugin_asdk_app_6ad2fea4448c8191b9e66fae6f078f83) | `https://vokolla.com/api/mcp` | [Guide](https://vokolla.com/llms.txt) | Standard endpoint returned 401. |

Zillow and Crypto.com answered initialization, but their capability payloads failed the canonical inventory check. The exact endpoints remain out of the batch pending a successful validator run. [Zillow listing](https://claude.com/marketplace/connectors/zillow), [Crypto.com listing](https://claude.com/marketplace/connectors/crypto-com)

## Validation

- The final full sweep reported 730 of 734 servers online. Airbyte, Padlet, Tripadvisor and Wolfram were the four existing endpoints classified as unknown in that run.
- The committed snapshots use targeted observations for all 30 new endpoints and the eight report corrections. There are 27 new schema-valid anonymous inventories, including 21 with partial tool lists. CoinGecko App refreshed its inventory timestamp. The other 283 existing inventories compare equal to the starting catalog.
- All 30 new listings have local generated-monogram assets with recorded provenance. Logo and inventory checks, typecheck, build, and internal-link checks passed. The build produced 734 server profiles. The test suite passed 5,495 tests, with 28 skipped.
