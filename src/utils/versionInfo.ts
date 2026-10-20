// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6bee0f3744c9a6c7f191ee91f2b6386d52376878',
  commitDate: '2026-10-20T17:39:30+03:00',
  shortHash: '6bee0f3'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
