// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '24cf97b7eca79172ed0113c19b52559343a03ab7',
  commitDate: '2025-08-25T23:48:12+02:00',
  shortHash: '24cf97b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
