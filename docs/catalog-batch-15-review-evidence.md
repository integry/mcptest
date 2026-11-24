# Catalog import batch 15

Reviewed November 23, 2026 for issue #724 and tracking item `ff14e799-4a20-42ec-9345-51b2c726d117`. Reviewed master `dda4bbb6c469c7e8a603b4007ed5235cd7629832` contained 734 catalog entries. The 30 additions bring the total to 764.

## Claude relevance

[Claude’s public marketplace](https://claude.com/marketplace/connectors-plugins) returned 1,206 connector records at 11:03 UTC. The [snapshot](catalog-batch-15-claude-snapshot.tsv) preserves every ID and its `popularityScore` in the order of the connector array embedded in the page’s Next.js payload. The source HTML had SHA-256 `b68d71934a5def7ded83c11402276fdeb9e1fda7f9f0a4840eccb7cc4d5f7999`.

| ID group | Records | Numeric scores |
| --- | ---: | ---: |
| `wf.` | 163 | 163 |
| `connector.` excluding `connector.ant.` | 913 | 910 |
| `connector.ant.` | 129 | 129 |
| Bare IDs | 1 | 0 |
| Total | 1,206 | 1,202 |

The page count includes four null scores, so the ranked denominator is 1,202, as reported in the issue. The batch 14 review recorded 1,205 total records. In the current snapshot, 370 existing catalog entries have exactly one ranked Claude listing. Of these, 331 needed a score change and 39 already agreed with the calculation. Apify’s listing has a null score, and Windsor.ai has multiple ranked Claude listings. Both retain their existing relevance.

| Catalog entry | Popularity score | One-based rank | Relevance |
| --- | ---: | ---: | ---: |
| Microsoft 365 | 22,898 | 6 | 100 |
| Supabase | 20,425 | 17 | 99 |
| Miro | 20,354 | 18 | 99 |
| Mobbin | 18,228 | 78 | 94 |
| OpusClip | 17,640 | 97 | 92 |

Save the reviewed master version of `src/data/serverCatalog.json` as `/tmp/before-catalog.json` and run this from the repository root to reproduce the reconciliation. ECMAScript’s stable sort preserves snapshot order for ties.

```js
const fs = require('node:fs');
const input = fs.readFileSync('docs/catalog-batch-15-claude-snapshot.tsv', 'utf8');
const ranked = input.trimEnd().split('\n').slice(1)
  .map(row => row.split('\t'))
  .map(([id, score]) => ({ id, score: JSON.parse(score) }))
  .filter(({ score }) => typeof score === 'number')
  .sort((a, b) => b.score - a.score);
const rankById = new Map(ranked.map(({ id }, index) => [id, index + 1]));
const catalog = require('/tmp/before-catalog.json');
const current = new Map(require('./src/data/serverCatalog.json').map(entry => [entry.id, entry]));
let eligible = 0;
let changed = 0;
for (const entry of catalog) {
  const matchedRanks = (entry.directoryListings ?? [])
    .filter(listing => listing.directory === 'claude' && rankById.has(listing.id))
    .map(listing => rankById.get(listing.id));
  if (matchedRanks.length !== 1) continue;
  const relevance = Math.round(100 * (ranked.length - matchedRanks[0]) / ranked.length);
  eligible++;
  if (entry.relevance !== relevance) changed++;
  if (current.get(entry.id).relevance !== relevance) throw new Error(entry.id);
}
console.log({ ranked: ranked.length, eligible, changed });
// { ranked: 1202, eligible: 370, changed: 331 }
```

## Intake and endpoint checks

All 30 ChatGPT release records were `LISTED` and matched both the full listing ID and exact primary URL. They are available anonymously at `/backend-anon/ps/plugins/<id>`. Duplicate checks compared ChatGPT IDs first, then normalized primary, browser and alternative endpoints against the existing catalog and the other additions. All 30 publisher guides returned HTTP 200. Replo’s guide prints the slashless form, and the public release specifies the trailing slash. The published release and publisher guide together identify the same server. [Replo guide](https://replo.app/llms.txt)

All 30 primaries negotiated Streamable HTTP without credentials and produced a canonical inventory. The catalog validator normally tries the slashless form first. The same validator’s direct Streamable HTTP probe was used on the exact Replo and MentorCruise URLs with redirects disabled, and the stored inventories for those entries came from those probes. Discovery was limited to initialization and advertised inventory methods. Partial sections reflect the catalog’s redaction and size limits.

| Server | ChatGPT listing | Publisher guide | MCP version | Tools retained / observed |
| --- | --- | --- | --- | ---: |
| Whatjobs | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a34f8f6261c8191aac9bc8d7db3502f) | [Guide](https://mcp.whatjobs.com/llms.txt) | 2026-07-28 | 8 / 8 (partial) |
| Baely Hair Ingredient Checker | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6accb766c4d88191999ec09c727f870b) | [Guide](https://app.hairqare.co/llms.txt) | 2025-11-25 | 1 / 1 (partial) |
| Replo | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a70d49bbd808191856702565c3be463) | [Guide](https://replo.app/llms.txt) | 2026-07-28 | 35 / 135 (partial) |
| MentorCruise | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a28f1ae232c819195f8a8faec6c255c) | [Guide](https://mentorcruise.com/llms.txt) | 2025-11-25 | 26 / 26 (partial) |
| Nonica | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6aa02132f74c8191a3df331aee3b67ce) | [Guide](https://mcp.nonica.io/) | 2026-07-28 | 3 / 3 |
| Atmy | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ae19a8f94f481919ad3506d37dee39c) | [Guide](https://atmy.ai/llms.txt) | 2025-06-18 | 12 / 12 (partial) |
| CertArc | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ac10753370881918540799af4b9e5d7) | [Guide](https://certarc.com/llms.txt) | 2025-11-25 | 12 / 12 (partial) |
| Clypmint: AI Video Editor | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6aca4a8f3c848191b662e96a004679b4) | [Guide](https://clypmint.com/llms.txt) | 2025-11-25 | 41 / 63 (partial) |
| Compute Screener | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6adcdd33bba881918ad84bcacbf45668) | [Guide](https://computescreener.com/llms.txt) | 2025-11-25 | 14 / 14 (partial) |
| Daydream | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ada33e71edc8191a47e362e40f5aba0) | [Guide](https://gen.daydream.live/llms.txt) | 2025-06-18 | 6 / 6 (partial) |
| DrUrls | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ae4cb7240388191b3906d56adc59406) | [Guide](https://drurls.com/llms.txt) | 2025-06-18 | 11 / 11 (partial) |
| EbooksDepository | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a96b4a1dfa881918fefec36f091c64c) | [Guide](https://ebooksdepository.com/llms.txt) | 2026-07-28 | 2 / 2 |
| Email Spam Tester | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6abcfdcb833c8191a0ced9bc150dc3a2) | [Guide](https://email-spam-tester.com/llms.txt) | 2026-07-28 | 4 / 4 (partial) |
| Equation.io | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6abeeccb394081918a1bc17f2c72b341) | [Guide](https://equation.io/llms.txt) | 2025-06-18 | 3 / 3 (partial) |
| Escudo Compara | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6af9d6ed0dc4819199eda01323659ab8) | [Guide](https://escudocompara.com/llms.txt) | 2025-11-25 | 6 / 6 |
| Evlek | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ace708623a881919ff48f01f180cc12) | [Guide](https://evlek.app/llms.txt) | 2026-07-28 | 8 / 8 (partial) |
| FactoGraph | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ad8c5f51cbc8191bfc3002cbb8b0967) | [Guide](https://factograph.app/llms.txt) | 2025-11-25 | 7 / 7 (partial) |
| GCC Car Deals | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ab81fce0cb48191b7b908c8ffef1583) | [Guide](https://gcccardeals.com/llms.txt) | 2026-07-28 | 5 / 5 (partial) |
| Globestudio | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ac545c64d148191b3a72b4a5c5dd293) | [Guide](https://globestudio.app/llms.txt) | 2026-07-28 | 6 / 6 (partial) |
| GraphChinese | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6acb2144de88819195415843e7b2f12e) | [Guide](https://graphchinese.com/llms.txt) | 2025-11-25 | 10 / 10 |
| Handymade | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ac2bcc82b608191baed5a77fa7c3df7) | [Guide](https://handymade.store/llms.txt) | 2026-07-28 | 5 / 5 (partial) |
| Hangeul Fonts | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6acfde44aa6c8191b3168267eae087fb) | [Guide](https://hangulfont.munteok.com/llms.txt) | 2025-11-25 | 7 / 7 |
| KaiCalls | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a39991eaf2c8191b140983518666545) | [Guide](https://www.kaicalls.com/llms.txt) | 2025-06-18 | 35 / 213 (partial) |
| LegalScout | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a878ecf07688191adaa18fde65ca1c6) | [Guide](https://legalscout.net/llms.txt) | 2025-06-18 | 5 / 5 |
| Linked Word | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6a83b9972a208191af33dfc98d091c78) | [Guide](https://www.linkedword.com/llms.txt) | 2026-07-28 | 10 / 10 (partial) |
| Music Tutor | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ad13b8888588191803c74b2ecadd441) | [Guide](https://musictutor.app/llms.txt) | 2026-07-28 | 11 / 11 (partial) |
| PatchDesign.AI | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ad01622d3108191b097c9766f2c6c38) | [Guide](https://patchdesign.ai/llms.txt) | 2025-06-18 | 5 / 5 (partial) |
| PrintMap | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ad226ad9e7881918bdcfc73c3b3ba72) | [Guide](https://printm.app/llms.txt) | 2025-11-25 | 3 / 3 (partial) |
| ThemeSniffer | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6ac9bca799288191879d0c198d8c8a92) | [Guide](https://themesniffer.com/llms.txt) | 2025-06-18 | 4 / 4 (partial) |
| Ultimaps Map Maker | [Listing](https://chatgpt.com/plugins/plugin_asdk_app_6adb80f4204c8191ae0c0a0ea6b4784d) | [Guide](https://ultimaps.com/mcp/) | 2026-07-28 | 3 / 3 (partial) |

- OAuth metadata was advertised by Replo, MentorCruise, CertArc, Clypmint, Daydream, DrUrls and KaiCalls. Their account actions may require credentials even though discovery succeeded. Daydream also documents a bearer API key and KaiCalls documents scoped API keys. [Daydream guide](https://gen.daydream.live/llms.txt), [KaiCalls guide](https://www.kaicalls.com/llms.txt)
- Nonica’s complete hosted inventory consists of `how_to_install`, `what_tools_are_included` and `where_to_download`. Reading or editing models requires the local Revit plug-in. [Nonica endpoint guide](https://mcp.nonica.io/)
- Ultimaps has a verified ChatGPT directory entry. Its Claude instructions describe adding the endpoint as a custom connector. [Ultimaps setup](https://ultimaps.com/mcp/)
- All 30 new entries use local generated monograms with retrieval dates and license notes. The asset validator checked their provenance and file format.

The higher ChatGPT scores use publisher-reported product adoption. The other 25 entries use the batch default of 50.

- Whatjobs (70) reports over 400,000 active users. [Whatjobs FAQ](https://www.whatjobs.com/faq)
- Hairqare reports over 250,000 participants in its challenge, supporting the Baely score of 65. [Hairqare](https://hairqare.co/challenge-me)
- Replo (65) reports over 100,000 businesses and publishes brand examples. [Replo brands](https://www.replo.app/partners/brands)
- MentorCruise (60) reports more than 50,000 mentees since 2018. [MentorCruise employers](https://mentorcruise.com/teams/info/)
- Nonica (60) reports use by more than 40,000 Revit professionals. [Nonica](https://nonica.io/)

## Existing entries and exceptions

- MailTester scores 55 using the publisher’s reported activity of over 12,000 lists cleaned in the week shown at review. The exact endpoint still initializes anonymously and returned nine tools, including descriptions of the shared trial. An optional bearer API key gives a private quota and access to account tools. [MailTester adoption](https://mailtester.com/), [MCP guide](https://mailtester.com/llms.txt)
- Folklore scores 50 based on the publisher’s documented deployment at CellGenetics and retains its endpoint guide. The exact endpoint returned 11 public tools. [Helena partners](https://www.helena.bio/partners), [Folklore endpoint guide](https://folklore.helena.bio/integrations/mcp)
- MaCalculatrice scores 50 and uses the publisher guide for provenance. The exact endpoint negotiated anonymously and returned a partial tool inventory. [MaCalculatrice](https://macalculatriceenligne.com/), [MCP guide](https://macalculatriceenligne.com/mcp/)
- Less Meeting uses the publisher guide for provenance and remains unscored. The exact primary returned HTTP 401 with an OAuth challenge. [Less Meeting MCP guide](https://lessmeeting.com/features/mcp-server/)
- Crypto.com (`https://mcp.crypto.com/market-data/mcp`) and Zillow (`https://mcp.zillow.com/api/v2`) answered initialization without redirects. Both exact probes failed with `Capability inventory contains unsafe or non-canonical fields.` They remain deferred. [Crypto.com directory listing](https://claude.com/marketplace/connectors/crypto-com), [Zillow directory listing](https://claude.com/marketplace/connectors/zillow)
- Credential-gated Semgrep and OKX remain deferred from this anonymous batch.

## Repository checks

- The capability importer verified all 341 stored inventories. The 30 new inventories and their validation records name the exact primary URLs.
- The asset validator checked all 764 logo files and provenance records. Typecheck and build passed, and the build generated 764 server profiles. The internal link checker passed.
- The full test suite passed with two workers and a 20-second test timeout, with 5,495 tests passed and 28 skipped.
