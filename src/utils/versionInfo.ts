// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'e621694fab9f06896840656800f00efcf1e42d37',
  commitDate: '2025-08-26T21:52:14+02:00',
  shortHash: 'e621694'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
