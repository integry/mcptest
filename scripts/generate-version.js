#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitInfo() {
  try {
    const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const commitDate = execSync('git show -s --format=%aI HEAD', { encoding: 'utf-8' }).trim();
    
    return {
      commitHash,
      shortHash,
      commitDate
    };
  } catch (error) {
    console.error('Error getting git information:', error.message);
    // Return default values if git is not available
    return {
      commitHash: 'unknown',
      shortHash: 'unknown',
      commitDate: new Date().toISOString()
    };
  }
}

function generateVersionFile() {
  const gitInfo = getGitInfo();
  
  const content = `// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '${gitInfo.commitHash}',
  commitDate: '${gitInfo.commitDate}',
  shortHash: '${gitInfo.shortHash}'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return \`https://github.com/integry/mcptest/commit/\${commitHash}\`;
};
`;

  const outputPath = path.join(__dirname, '..', 'src', 'utils', 'versionInfo.ts');
  
  // Ensure the directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log('Version information generated successfully:');
  console.log(`  Commit Hash: ${gitInfo.commitHash}`);
  console.log(`  Short Hash: ${gitInfo.shortHash}`);
  console.log(`  Commit Date: ${gitInfo.commitDate}`);
}

// Run the script
generateVersionFile();