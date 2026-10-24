// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6cb92788895cf87188a390a3f6e51472e1516136',
  commitDate: '2026-10-24T19:43:34+00:00',
  shortHash: '6cb9278'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
