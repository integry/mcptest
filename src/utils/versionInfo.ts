// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '26c1e7967284a6b2d19f844786a08d5dd6bf0f8f',
  commitDate: '2026-07-14T12:35:02Z',
  shortHash: '26c1e79'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
