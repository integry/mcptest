// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '2e44c8be33273e8be426fb2e08065355a9b11a26',
  commitDate: '2025-08-02T16:01:32+02:00',
  shortHash: '2e44c8b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
