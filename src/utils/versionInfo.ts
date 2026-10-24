// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '0ffb9f0781f007989b88e81e324ab2cb559fe20b',
  commitDate: '2026-10-24T13:27:57+03:00',
  shortHash: '0ffb9f0'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
