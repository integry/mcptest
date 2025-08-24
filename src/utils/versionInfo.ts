// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '2b58a1e35849011f65d324155076e1b167599b7d',
  commitDate: '2025-08-24T11:48:06+02:00',
  shortHash: '2b58a1e'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
