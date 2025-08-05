// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '7e3028526c33ad9b1b25af15e0ecb11e416cc904',
  commitDate: '2025-08-05T12:06:08+02:00',
  shortHash: '7e30285'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
