// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'f887b7f101d8ee515dfab10510e17fa168409847',
  commitDate: '2026-10-25T00:29:08+03:00',
  shortHash: 'f887b7f'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
