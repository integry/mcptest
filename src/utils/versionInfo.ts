// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'e8a5382e7515019e7ba83568ad1523507cf74d45',
  commitDate: '2026-07-14T12:50:49Z',
  shortHash: 'e8a5382'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
