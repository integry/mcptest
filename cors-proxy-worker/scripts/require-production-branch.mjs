const expectedBranch = 'master';
const workersCi = process.env.WORKERS_CI;
const branch = process.env.WORKERS_CI_BRANCH;

if (workersCi !== '1' || branch !== expectedBranch) {
  console.error(
    `Refusing production Worker deployment: expected Cloudflare Workers Builds branch ${expectedBranch}, received ${branch ?? 'unset'}.`,
  );
  process.exit(1);
}
