// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'ac12f792714fe43f212cdfbd47a2d4f34aa12c98',
  commitDate: '2025-08-25T11:32:27+03:00',
  shortHash: 'ac12f79'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
