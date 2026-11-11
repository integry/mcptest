// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c39753df7ddce6af182e25cca822497ffd9840f7',
  commitDate: '2026-11-11T16:23:11+00:00',
  shortHash: 'c39753d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
