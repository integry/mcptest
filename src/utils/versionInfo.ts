// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c4fa9e8c5af5bdeb16a57897eb736649ae210901',
  commitDate: '2026-08-13T04:34:34+01:00',
  shortHash: 'c4fa9e8'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
