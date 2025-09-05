// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '91b3ebe0f2ae0e95165e73b4a6c4aae6a7c3411c',
  commitDate: '2025-09-05T15:04:47+02:00',
  shortHash: '91b3ebe'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
