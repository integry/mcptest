// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'a231c4886c0d8aabd666bb7a1f0a97fc8422cbbb',
  commitDate: '2025-08-30T12:33:57+02:00',
  shortHash: 'a231c48'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
