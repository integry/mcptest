// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'da9b2627f62f249356a34c59485024e74eccb544',
  commitDate: '2025-08-19T01:04:50+03:00',
  shortHash: 'da9b262'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
