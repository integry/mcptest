// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '4acfeef2447b0cb35e5d16b8ebd87e1ce475b11e',
  commitDate: '2025-08-06T14:11:34+02:00',
  shortHash: '4acfeef'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
