// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'a9794d5b098e2bea0d653a191c9a46e457a28291',
  commitDate: '2025-09-05T15:26:19Z',
  shortHash: 'a9794d5'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
