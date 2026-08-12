// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '0d1ffa88c01d3b3586d0842a903946fb7f9b6451',
  commitDate: '2026-08-12T02:05:42+03:00',
  shortHash: '0d1ffa8'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
