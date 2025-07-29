// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '779027ef01dd9c67d7324ccc887f557ed6c1de8b',
  commitDate: '2025-07-23T16:57:56+03:00',
  shortHash: '779027e'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};