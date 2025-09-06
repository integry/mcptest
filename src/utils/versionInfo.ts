// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd967221bf9eff0761325472a85240db250ea4cd9',
  commitDate: '2025-09-06T08:44:12Z',
  shortHash: 'd967221'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
