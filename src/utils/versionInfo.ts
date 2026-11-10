// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '3483e13a276ef32cae13fe39b6af364a29d90135',
  commitDate: '2026-11-10T07:05:17+01:00',
  shortHash: '3483e13'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
