import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_DIRECTORIES,
  CONNECTOR_DIRECTORY_REQUIREMENTS,
  CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON,
  MULTIPLEXED_OPERATIONS_ADVISORY,
  type DirectoryRequirementSource,
} from './connectorDirectoryRequirements';
import { AUTOMATED_DIRECTORY_CHECK_IDS } from '../utils/connectorDirectoryPreflight';

/** Hosts of each vendor's own documentation. Community sources never qualify. */
const OFFICIAL_HOSTS: Record<string, readonly string[]> = {
  claude: ['claude.com', 'support.claude.com'],
  chatgpt: ['developers.openai.com'],
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const expectReviewedSource = (source: DirectoryRequirementSource, hosts: readonly string[]) => {
  const url = new URL(source.url);
  expect(url.protocol).toBe('https:');
  expect(hosts).toContain(url.hostname);
  expect(source.title.trim()).not.toBe('');
  expect(source.reviewedOn).toMatch(ISO_DATE);
  expect(Number.isNaN(Date.parse(source.reviewedOn))).toBe(false);
  expect(source.reviewedOn <= CONNECTOR_DIRECTORY_REQUIREMENTS_REVIEWED_ON).toBe(true);
};

describe('connector directory requirements', () => {
  it('cites an official source URL and review date for every requirement', () => {
    expect(CONNECTOR_DIRECTORY_REQUIREMENTS.length).toBeGreaterThan(0);
    for (const requirement of CONNECTOR_DIRECTORY_REQUIREMENTS) {
      expectReviewedSource(requirement.source, OFFICIAL_HOSTS[requirement.directory]);
      expect(requirement.requirement.trim(), requirement.id).not.toBe('');
      expect(requirement.id.startsWith(`${requirement.directory}.`), requirement.id).toBe(true);
    }
  });

  it('uses unique ids and covers both directories with automatic and manual items', () => {
    const ids = CONNECTOR_DIRECTORY_REQUIREMENTS.map((requirement) => requirement.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const directory of Object.keys(CONNECTOR_DIRECTORIES)) {
      const items = CONNECTOR_DIRECTORY_REQUIREMENTS.filter((requirement) => requirement.directory === directory);
      expect(items.some((item) => item.check === 'automatic'), directory).toBe(true);
      expect(items.some((item) => item.check === 'manual'), directory).toBe(true);
    }
  });

  it('has an evaluator for exactly the automatic requirements', () => {
    const automatic = CONNECTOR_DIRECTORY_REQUIREMENTS
      .filter((requirement) => requirement.check === 'automatic')
      .map((requirement) => requirement.id);
    expect([...AUTOMATED_DIRECTORY_CHECK_IDS].sort()).toEqual([...automatic].sort());
  });

  it('keeps manual items for what an endpoint cannot show', () => {
    const manual = CONNECTOR_DIRECTORY_REQUIREMENTS
      .filter((requirement) => requirement.check === 'manual')
      .map((requirement) => requirement.id);
    expect(manual).toEqual(expect.arrayContaining([
      'claude.listing-materials',
      'claude.test-account',
      'chatgpt.privacy-policy',
      'chatgpt.test-credentials',
      'chatgpt.ui-frame-domains',
    ]));
  });

  it('derives the multiplexing advisory from official statements of both vendors', () => {
    const hosts = MULTIPLEXED_OPERATIONS_ADVISORY.sources.map((source) => new URL(source.url).hostname);
    expect(hosts).toEqual(expect.arrayContaining(['claude.com', 'developers.openai.com']));
    for (const source of MULTIPLEXED_OPERATIONS_ADVISORY.sources) {
      expectReviewedSource(source, [...OFFICIAL_HOSTS.claude, ...OFFICIAL_HOSTS.chatgpt]);
    }
  });

  it('links each directory to its official submission page', () => {
    expect(new URL(CONNECTOR_DIRECTORIES.claude.submissionUrl).hostname).toBe('claude.com');
    expect(new URL(CONNECTOR_DIRECTORIES.chatgpt.submissionUrl).hostname).toBe('developers.openai.com');
  });
});
