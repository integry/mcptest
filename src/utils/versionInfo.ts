// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6bea13164d5028a65c63ec9423a5f7df17b07a43',
  commitDate: '2025-09-07T14:48:56+03:00',
  shortHash: '6bea131'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
