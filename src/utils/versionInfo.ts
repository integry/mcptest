// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '9aad9fbe40fa496c9d94a3615b2c1f5f9e310dd7',
  commitDate: '2025-09-06T16:52:00+02:00',
  shortHash: '9aad9fb'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
