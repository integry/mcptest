import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BADGE_DEFINITIONS, BADGE_VARIANTS, renderBadgeSvg } from '../src/utils/badges';

// Regenerates the static badge assets in public/badge/ from src/utils/badges.ts.
const outputDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'badge');
fs.mkdirSync(outputDirectory, { recursive: true });
for (const variant of BADGE_VARIANTS) {
  fs.writeFileSync(path.join(outputDirectory, `${BADGE_DEFINITIONS[variant].file}.svg`), renderBadgeSvg(variant));
}
console.log(`Wrote ${BADGE_VARIANTS.length} badges to public/badge/.`);
