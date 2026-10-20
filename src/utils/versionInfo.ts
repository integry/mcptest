// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'e19789e83bf34eb662ca5b0962c4e05c0d80810e',
  commitDate: '2026-10-20T10:07:12+00:00',
  shortHash: 'e19789e'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
