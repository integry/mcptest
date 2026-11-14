// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'bff7fc74a09d467597bb486f2c91bef75afb2581',
  commitDate: '2026-11-12T13:23:31+00:00',
  shortHash: 'bff7fc7'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
