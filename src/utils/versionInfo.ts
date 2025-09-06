// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'b98c713e34373d76691a84fdc71dfbbeb229c8e5',
  commitDate: '2025-09-06T15:08:59Z',
  shortHash: 'b98c713'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
