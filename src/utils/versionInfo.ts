// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '2b68d7a80f36b35c445845b03b83d21d0cb41bd0',
  commitDate: '2025-09-07T20:49:49+02:00',
  shortHash: '2b68d7a'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
