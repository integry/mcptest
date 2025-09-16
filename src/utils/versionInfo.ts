// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '09cb3fecd14e159603b5a094eaca75e8123b2d21',
  commitDate: '2025-09-13T00:39:03+03:00',
  shortHash: '09cb3fe'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
