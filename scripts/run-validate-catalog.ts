import validator from './validate-catalog.js';

validator.main().catch((error: unknown) => {
  console.error(
    'Catalog validation failed:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
