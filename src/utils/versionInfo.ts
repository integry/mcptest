// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '0242d345abf19d7393c39b132a244470dae365f0',
  commitDate: '2025-09-07T20:40:50+02:00',
  shortHash: '0242d34'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
