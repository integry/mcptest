// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'a9a4370d4eee5bca5ac00b8c75a4d71dd0b89c04',
  commitDate: '2025-09-06T23:27:08+02:00',
  shortHash: 'a9a4370'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
