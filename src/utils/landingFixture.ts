import { LANDING_FIXTURE } from '../data/publicFixtures';
import type { SuggestedServerSelection } from '../components/SuggestedServersPanel';

/** The connection the landing and suggested-server presets start for mcptest's echo fixture. */
export const LANDING_FIXTURE_SELECTION: SuggestedServerSelection = {
  endpoint: {
    url: LANDING_FIXTURE.url,
    provenance: 'canonical',
    provenanceLabel: 'mcptest.io public test server',
    transport: LANDING_FIXTURE.transport,
  },
  protocolEra: LANDING_FIXTURE.protocolEra,
};
