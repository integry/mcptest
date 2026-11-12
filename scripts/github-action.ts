import { runGitHubAction } from '../src/cli/githubAction';

process.exitCode = await runGitHubAction();
