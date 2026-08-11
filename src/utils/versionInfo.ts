// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '9f007707ceefcaf482fe051d079df278888781ac',
  commitDate: '2026-08-11T21:16:46+03:00',
  shortHash: '9f00770'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
