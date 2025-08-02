// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'ecfa601f4967cc73bb62e562db7db7d9bdd790d6',
  commitDate: '2025-07-31T22:59:34+03:00',
  shortHash: 'ecfa601'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
