// Script to set up the initial OAuth client
// Run this after deploying the worker to create the mcptest-client

import { setupClient } from './index.js';

// This would normally be run as a separate script or through Wrangler
// Example: wrangler tail and then call the setupClient function
console.log('To set up the OAuth client, deploy the worker and then run:');
console.log('1. Deploy the worker: npm run deploy');
console.log('2. Set up the client by calling the setupClient function');
console.log('   This can be done through a custom endpoint or Wrangler tail');