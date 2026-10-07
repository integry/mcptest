import type { ComponentProps } from 'react';
import { describe, expectTypeOf, it } from 'vitest';
import type { CatalogProtocolEra } from '../types/catalog';
import type { PreferredCatalogEndpoint } from '../utils/clientSetup';
import {
  SuggestedServersPanel,
  type SuggestedServerSelection,
} from './SuggestedServersPanel';

describe('SuggestedServersPanel callback types', () => {
  it('requires the full preferred endpoint selection', () => {
    type SelectionCallback = ComponentProps<typeof SuggestedServersPanel>['onServerSelect'];
    type Selection = Parameters<SelectionCallback>[0];

    expectTypeOf<Selection>().toEqualTypeOf<SuggestedServerSelection>();
    expectTypeOf<Selection['endpoint']>().toEqualTypeOf<PreferredCatalogEndpoint>();
    expectTypeOf<Selection['protocolEra']>().toEqualTypeOf<CatalogProtocolEra>();
  });
});
