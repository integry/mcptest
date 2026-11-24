# S4 review evidence for PR #714

I compared the parsed `catalogCapabilities.json` files at the PR base `a227a841551c13905bf8530e5656fe36eb8f4c38` and review head `df4d615b845eb155bd3ed2517ce1641b9e78581b`. The comparison matches the directory audit. [Base capability file](https://github.com/integry/mcptest/blob/a227a841551c13905bf8530e5656fe36eb8f4c38/src/data/catalogCapabilities.json) · [Head capability file](https://github.com/integry/mcptest/blob/df4d615b845eb155bd3ed2517ce1641b9e78581b/src/data/catalogCapabilities.json)

| Result | Count or detail |
| --- | --- |
| Base records | 204 |
| Head records | 230 |
| Added | 26 |
| Removed | 0 |
| Changed | 1 |
| Existing records with identical parsed values | 203 |
| Head inventories passing the repository schema validator | 230 of 230. Every snapshot ID also exists in the head catalog. |

**Added server IDs** — `84asana`, `bestsaaswebdesigns`, `cerulean`, `commonplace`, `dopamine-club`, `fiperly`, `honestdog`, `horizon-pet-waste-solutions`, `infobip-deep-research`, `jotscout`, `keikibu`, `lalafly`, `lissa-soundscapes`, `magic-hour-ai`, `manchester-tonight`, `mckee-homes`, `omniseal`, `pika`, `pokeka`, `quarterwise-1099-tax-planner`, `ratedwithai`, `reversiwise`, `scanmalware`, `sommeliers-window`, `statz-nfl`, `toronto-taxi-app`.

**Changed existing record** — `travel-vibes` changed only in `observedAt`, from `2026-11-21T18:12:49.484Z` to `2026-11-22T00:24:11.404Z`. Every other field, including the nested capability data and provenance, compared equal.

The head catalog adds 29 servers. The three without committed snapshots are Triple Whale (`triple-whale`), IXA.RO (`ixa-ro`), and Software Notion (`software-notion`). The committed validation log records an HTTP 401 OAuth challenge on Triple Whale’s primary and successful unauthenticated initialization for IXA.RO and Software Notion. The directory audit separately reported HTTP 404 from IXA.RO’s `resources/list`, `resources/templates/list`, and `prompts/list`, and from Software Notion’s `prompts/list`. The committed files confirm the snapshots are absent. The method-level responses come from the prior audit. [Head validation log](https://github.com/integry/mcptest/blob/df4d615b845eb155bd3ed2517ce1641b9e78581b/src/data/catalogValidation.json)

<details>
<summary>Reproduce the parsed comparison and schema validation</summary>

Run this from the repository root at the review head with the repository’s npm dependencies installed. It reads both pinned revisions via `git show` and calls the same `validateCapabilityInventory` function used by `import-catalog-capabilities -- --all` for every head record. Object member order and JSON formatting have no effect on the comparison. Array order is preserved. The script makes no network calls and leaves the catalog files untouched.

```bash
set -eu
review_script=$(mktemp .review-714-capabilities.XXXXXX.ts)
trap 'unlink "$review_script"' EXIT
cat > "$review_script" <<'TS'
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { validateCapabilityInventory } from './src/utils/capabilityInventory';

const baseRef = 'a227a841551c13905bf8530e5656fe36eb8f4c38';
const headRef = 'df4d615b845eb155bd3ed2517ce1641b9e78581b';
const read = (ref: string, file: string) => JSON.parse(execFileSync(
  'git', ['show', `${ref}:src/data/${file}.json`],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
));
const base = read(baseRef, 'catalogCapabilities');
const head = read(headRef, 'catalogCapabilities');
const baseIds = Object.keys(base).sort();
const headIds = Object.keys(head).sort();
const added = headIds.filter((id) => !Object.hasOwn(base, id));
const removed = baseIds.filter((id) => !Object.hasOwn(head, id));
const changed = baseIds.filter((id) => Object.hasOwn(head, id)
  && !isDeepStrictEqual(base[id], head[id])).map((id) => {
  const fields = [...new Set([...Object.keys(base[id]), ...Object.keys(head[id])])].sort();
  return { id, fields: fields.filter((field) => !isDeepStrictEqual(base[id][field], head[id][field]))
    .map((field) => ({ field, before: base[id][field], after: head[id][field] })) };
});

const baseCatalog = new Set(read(baseRef, 'serverCatalog').map(({ id }) => id));
const headCatalog = new Set<string>(read(headRef, 'serverCatalog').map(({ id }) => id));
const newCatalogIds = [...headCatalog].filter((id) => !baseCatalog.has(id)).sort();
const orphaned = headIds.filter((id) => !headCatalog.has(id));
if (orphaned.length) throw new Error(`Unknown head catalog IDs: ${orphaned.join(', ')}`);
for (const id of headIds) {
  try {
    validateCapabilityInventory(head[id]);
  } catch (error) {
    throw new Error(`Invalid inventory for ${id}`, { cause: error });
  }
}

console.log(JSON.stringify({
  baseInventoryCount: baseIds.length,
  headInventoryCount: headIds.length,
  added, removed, changed,
  unchanged: baseIds.length - removed.length - changed.length,
  newCatalogCount: newCatalogIds.length,
  newCatalogIdsWithoutSnapshots: newCatalogIds.filter((id) => !Object.hasOwn(head, id)),
  validatedHeadInventoryCount: headIds.length,
}, null, 2));
TS
./node_modules/.bin/vite-node "$review_script"
```

</details>

<details>
<summary>Complete batch specification from issue #713</summary>

The specification below is from the original issue. The later PR instruction corrected the Super.com ChatGPT ID to `plugin_asdk_app_6ae0fdc442288191b9f9e6ad52ab2f3b`. [Issue #713](https://github.com/integry/mcptest/issues/713) · [Super.com correction](https://github.com/integry/mcptest/commit/799e215)

```text
Import public-directory MCP servers, batch 11

Implement the next internal catalog batch in src/data/serverCatalog.json following docs/catalog-submissions.md, under tracking TODO ff14e799-4a20-42ec-9345-51b2c726d117. Verify master supports client-directory, directoryListings and relevance before importing. Match by directory ID first, then normalized primary, browser and alternative URLs. Preserve publisher and mcp-registry provenance and existing listings. Use the repository's per-entry validation for authentication, capabilities, snapshots and final acceptance. Report accepted entries and any exclusions with the validator evidence. Anonymous discovery alone does not establish anonymous tool use. Exclude community-submission attribution.

For every row below, expand a bare hex ID to plugin_asdk_app_<hex>; Datadog supplies its full ID verbatim. Each ID supplies directory "chatgpt" and URL https://chatgpt.com/plugins/<full ID>.

30 candidates in priority order. Columns are name | ChatGPT ID suffix | primary | publisher documentation. Where the fourth field is present use listingSource kind publisher at that URL. Where absent use kind client-directory at the listing URL unless publisher endpoint documentation is found. Set Triple Whale to 70 and each other new entry to 50.

Triple Whale|6a7c7cfea0348191bacb17dbe8f98c5e|https://mcp.triplewhale.com/v1/mcp|https://kb.triplewhale.com/en/articles/15656798-triple-whale-mcp
4dayweek.io Jobs|6acea461fc248191ac87cb21588ec3f5|https://4dayweek.io/api/mcp|https://4dayweek.io/mcp
84asana|6aa54086f8d88191826606dd2b2ad935|https://84asana.com/mcp
BestSaaSWebDesigns|6ae47a407fa481919d71cdcb58c93e5f|https://mcp.bestsaaswebdesigns.com/mcp|https://bestsaaswebdesigns.com/mcp
Cerulean|6ae815f0554c8191b62d432751bf4372|https://ceruleanjobs.com/api/mcp|https://ceruleanjobs.com/about/assistants/
Commonplace|6abe9fd5ee4481919e30f5a1bcf8ac5d|https://trycommonplace.com/mcp|https://trycommonplace.com/llms.txt
Dopamine Club|6abcfe2cea4c8191a7149cdd0277764b|https://research.dopamine.club/mcp|https://research.dopamine.club/
Fiperly|6ae79c9e2ae48191ab46c21413dc376e|https://www.fiperly.de/mcp.php|https://www.fiperly.de/llms.txt
HonestDog|6abeca8a331481919fe8263f6a3ed3da|https://server.honestdog.de/api/v1/mcp|https://www.honestdog.de/en/ai-assistants
Horizon Pet Waste Solutions|6abdb87fa1f48191afe475cb62fa2a4a|https://www.horizonpetwastesolutions.com/mcp|https://www.horizonpetwastesolutions.com/llms.txt
Infobip Deep Research|6ad71b5ece088191810b4d7cafcfd505|https://mcp.infobip.com/deep-research|https://www.infobip.com/docs/mcp/using-mcp
IXA.RO|6acf1e1dd0d48191be593ffba433c710|https://ixa.ro/mcp|https://ixa.ro/conecteaza-ai
JotScout|6abefee4cff8819190affdb473af8285|https://app.jotscout.com/api/mcp
Keikibu|6aba9b267ba48191864d2468929303a4|https://mcp.keikibu.com/mcp
Lalafly|6ad575734f1481918b89611c1f604999|https://lalafly.com.br/mcp
Lissa Soundscapes|6aeca2142b2c819180d9d57e3bc1cdea|https://mcp.lissa.app/mcp|https://lissa.app/assistants/
Magic Hour AI|6abd6b5b6494819188475d7f1ff8204c|https://mcp.magichour.ai/|https://magichour.ai/mcp
Manchester Tonight|6ad7e25fcab081919144be89c06ea0fe|https://manchestertonight.co.uk/mcp|https://manchestertonight.co.uk/llms.txt
McKee Homes|6ad12c9a50b481919ef1933c75da3504|https://public-mcp.mckeehomes.com/mcp
OmniSeal|6ac967c212dc8191909e27345da43e0e|https://api.purecipher.com/mcp|https://github.com/PureCipher/omniseal-mcp
Pika|6ac466ba11f4819191ee609ea667f124|https://mcp.pika.art/mcp|https://pika.art/mcp
Pokeka|6a54bd377acc8191ab61241cccd56979|https://pokeka.xyz/mcp|https://pokeka.xyz/llms.txt
QuarterWise 1099 Tax Planner|6ac101e47a848191b3e4c78618f006da|https://self-employment-tax.zovo.one/mcp|https://self-employment-tax.zovo.one/
RatedWithAI|6abfdf41cb1081918dc742c63d201c65|https://ratedwithai.com/api/mcp|https://ratedwithai.com/mcp
ReversiWise|6adaf46003848191a5fe5bef71e044fc|https://reversiwise.com/mcp
ScanMalware|6ac75bbd39c08191ae95c30ac42638e0|https://mcp.scanmalware.com/mcp|https://scanmalware.com/llms.txt
Software Notion|6ad2a38549dc8191b93f193c90ec8ba8|https://mcp.software-notion.de/mcp|https://software-notion.de/mcp
Sommelier’s Window|6ac1d3b0e3448191b67890f2caa6baff|https://sommelierswindow.com/api/mcp|https://sommelierswindow.com/llms.txt
Statz NFL|6af795c530cc8191836fc285fc59cdc3|https://statz.ai/nfl/mcp|https://statz.ai/llms.txt
Toronto Taxi App|6ae6404f3d8881918f6d07e0ea42376d|https://mcp.torontotaxi.app/mcp|https://torontotaxi.app/ai-assistants

Also record Triple Whale's Claude listing connector.f73ecf42-9171-4f79-9bfa-47470e9d1740 at https://claude.com/marketplace/connectors/triple-whale (Claude rank 364/1202). Its documented primary returned 401. Add https://mcp.triplewhale.com/chatgpt as an alternative and document its anonymous discovery of 45 tools. Infobip Deep Research is a distinct search/fetch server on a shared host. OmniSeal's neutral endpoint exposed the same four tools as ?platform=claude; document the publisher's file-schema selector. Lalafly requires account linking for live searches (https://lalafly.com.br/chatgpt).

Append the following ChatGPT listings to existing entries. Set missing relevance to 50 for dashthis through webeyez inclusive. Preserve all other existing scores.

dashthis 6a7e00f905a88191a46f1d211beeafd0
eorscope 6ac93310eea48191ab6bddb2fc29655d
fairvalid 6ae4b05013b08191a2f3931f995c1e21
feedhive 6ac737f80b248191b554eb90c797f5c5
g2x 6ace7db2bebc8191861593750406577b
geckoboard 6abd2443376c8191b4df5cd4278edfcf
grigora 6ac1eac07330819190d78d932577f577
hasdata 6ac7858900fc81919c8aa4b677d8a058
mailfloss 6ad9f7581a748191be8505e92451386c
neverapply 6ad367588ad48191a8cef98c0923639f
octolens 6ac6463da37c81918003c7aeb947001d
salesql 6ac4ce9073e08191aa02d1b4e543dad7
tasarim 6abcdf9dfab48191bed449fc85242f65
teamhood 6acf6f763e748191836c19595e7082ec
telerivet 6ac053561b208191b998689eac1f47e2
webeyez 6a9ce4b830448191bbcf4ad7e628cc12
ambiguous 6a97beba62e081919b408aea013b8f3d
athenahq 6a4da6c4bcfc81919397faceada2af69
autosheet 6aa196d5c8488191a3de00c74c9534ac
bajaj-finance 6abe4fa17aa08191a0b49e5ed5da3845
basecamp 6ad2ba38b4b881918ade182cd41e4b71
better-stack 6aa02bd506908191bbf12fc2ec2f3161
bird 6ac74d2aa37481918759cbb0ea8aa6c6
bitly 6a7a1365168c819196278bb6f899d66a
carta 6aedc472641c8191b9877c920be8c0cd
citellm 6ac41dc3ab3c81918fd029677b417183
clerk 6ae4e34683b08191933207035aa0d3ac
datadog plugins_6afc7a4f98608191a585034f8cf5e618
etherscan 6a9a645c20f4819187369704eae1f1ec
fly-sprites 6a8485b5beac8191954e37241acffe6d
framer 6ac3c5787b388191a9fad3e356d1bd3f
fullstory 6a9a1ebb11fc81919ef2aa7231b9b068
fundraise-up-for-donors 6ac77804ed7481919a21591add1e5842
gorgias 6ac6d6b117c48191b4bf735f974961a8
greptile 6aa1d974007c81918c528b5cfd500c55
incident-io 6ac3f2cb2b608191b91136b4cf737358
lightbringer 6a43e4284a708191b2b6b4540a53e1f9
logrocket 6ae240c75d048191bc45ee5344c3bb5a
mapbox 6a2c0bf33cb48191884d842b15ad3c20
moda 6ada7bec545881919206a8cf89db59f8
mollie 6a906843cab08191875b1054ea7b609a
plain 6aec88addd3c8191bc0daa4b3fff3a4c
polar 6ad6024a138c81919e7359f405c01404
prisma 6ab4ed5292d48191bc192893c8c83045
product-hunt 6af3cf4a66f88191a85850f12e044517
slicktrip 6aac1ad35c2c8191aab2c1c75ad20a89
squarespace 6ae234d433788191b0f03f5fc5ac1577
strand-ai 6ac6ccf216388191b8e128395ccac53e
super-com 6ae0fdc462288191b9f9e6ad52ab2f3b
surveymonkey 6af33350f81481918ff0cd6e26d6f485
tineo 6a1f5aa83f888191845b774bd2957f6c
windsor-ai 6ac899b4b9b08191927a056f38e793c9
zip 6ae1224debf881918425f00de10c059c

Use the exact HasData ?apis= URL from https://chatgpt.com/backend-anon/ps/plugins/plugin_asdk_app_6ac7858900fc81919c8aa4b677d8a058 as an alternative, noting restricted API selection (68 tools versus 88 on primary). Copy the exact directory selector URLs from the corresponding release records for Carta Investors (?app=investors), Datadog (?toolsets=chatgpt) and Polar (?codemode=false) into alternatives; retain neutral primaries and note that comparison of authenticated capabilities remains unverified.

Append these 25 ChatGPT listings to travel-vibes along with their corresponding alternatives https://gpt.travelvibes.ai/mcp/v5/<variant>/mcp. Keep relevance 50. Each row gives variant and ID suffix. All returned the same server name and four tool names as primary.

flight-101 6a3e6f8666948191bbb4af07bb4a7f0a
hotel-101 6a3e6ff9a3c881918eb30084199a39ec
ar 6af271c93fec8191bdb6d0e5096a7c2b
az 6af274f1188c8191b3b96b0215c6cd70
cs 6af26f0e1c408191bd8e06226c8f3efe
de 6ae11747f254819193c639ec9c573b1d
el 6af27350646c81919c8cc48c6d3ed826
es 6ae1158612848191ac2ac574bd7018b1
fi 6af2727d5b648191ac2502b822a5ebfe
fr 6ae116e8ce8481919d1f1ae4fb4e60db
he 6af26f70b7c88191872b48562f568690
hr 6af274b0e4ec819190699ae9f9a67150
it 6ae11cfdc2f88191b398168a4fa80432
ja 6af272f61664819197edab003a1a7f2d
ko 6af26d1a35b881918086822fa9fb36df
nb 6af26ec0587c8191ae2cca5ca6a0c26a
nl 6af26d9fef608191bfa2f18493454231
pl 6af271679aa88191803c8687d50329cc
pt 6ae114eb60c48191a1a125307b070a8c
ro 6af2741f36108191a3801fb6418f0a0c
ru 6ae11806bacc8191bf548006c9d59523
sv 6af270a145cc8191a6d5c19b559e4a31
tr 6af270feff908191bb950566816f6cd2
uk 6af27468aa2c819193785146a2e5aec3
zh 6ae118c874188191aae8710188eb516e

Set five previously unset relevance scores using publisher platform adoption evidence:
- Keywords Everywhere 65. Over one million extension users (https://keywordseverywhere.com/product-news.html); endpoint documentation https://mcp.keywordseverywhere.com/docs.
- GameAnalytics Documentation 60. Over 100,000 studios (https://www.gameanalytics.com/faq). Use publisher source https://docs.gameanalytics.com/ai-tools/documentation-mcp/; Claude ID remains unverified.
- getAbstract 60. General Electric customer use https://www.getabstract.com/en/customerstories/general-electric.
- Tapcart 55. https://www.tapcart.com/case-studies/naked-harvest and endpoint documentation https://dev.tapcart.com/docs/mcp-server.
- Unlayer 55. Enterprise adoption https://unlayer.com/enterprise.

Preserve scores already supported by evidence. Leave Hookr and HookRadar separate. Lower-ranked Community Funding NZ belongs to a later batch.
```

</details>
