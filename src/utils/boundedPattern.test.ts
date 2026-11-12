import { describe, expect, it } from 'vitest';
import { matchesBoundedPattern } from './boundedPattern';

describe('matchesBoundedPattern', () => {
  it('agrees with native RegExp on the supported subset', () => {
    const patterns = [
      '^meth', 'od$', '^method$', 'th', '^x-', '^[a-z]+$', '^[^A-Z]*$', '^req_\\d{2,3}$', '^(?:get|post)_', 'a|b',
      '^(a|bc)*$', '^.$', '^\\w+\\s?\\W?$', '^[\\d-]+$', '^[a-]$', '^\\u0041\\x42\\u{43}$', '^\\.\\*$', '^a{0}$',
      '^(a?){3}$', '^()*$', '^[]$', '^[^]$', 'é$', '^\\p{L}', '^(?=a)', '\\bfoo', '(a)\\1', '^a+?b*?$', '^😀.$',
    ];
    const inputs = ['', 'a', 'method', 'methods', 'xmethod', 'x-test', 'req_12', 'req_1234', 'get_x', 'bcbca', 'b',
      'abc', 'foo bar', '12-3', '-', 'ABC', '.*', 'aaa', 'café', 'aab', '😀x', '\n'];
    let compared = 0;
    for (const pattern of patterns) {
      for (const input of inputs) {
        const bounded = matchesBoundedPattern(pattern, input);
        if (bounded === undefined) continue;
        compared += 1;
        expect([pattern, input, bounded]).toEqual([pattern, input, new RegExp(pattern, 'u').test(input)]);
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('declines syntax outside the subset and invalid patterns instead of guessing', () => {
    for (const pattern of ['^\\p{L}', '^(?=a)', '(?<!a)b', '\\bfoo', '(a)\\1', '(?<name>a)', '\\cA', '[', 'a{', '(?i)a']) {
      expect([pattern, matchesBoundedPattern(pattern, 'a')]).toEqual([pattern, undefined]);
    }
  });

  it('declines patterns and inputs past the size limits', () => {
    expect(matchesBoundedPattern('a'.repeat(600), 'a')).toBeUndefined();
    expect(matchesBoundedPattern('^a{5000}$', 'a')).toBeUndefined();
    expect(matchesBoundedPattern('^a', 'a'.repeat(2000))).toBeUndefined();
  });

  it('bounds compilation of repeated empty groups, which allocate no states', () => {
    const started = Date.now();
    for (const pattern of [
      '(?:){1000000000}', '(){1000000000}', '(?:){1000000000,}', '(?:){0,1000000000}',
      '(?:(?:){100000}){100000}', '(?:|){1000000000}', '(?:a?){0}(?:){1000000000}',
    ]) {
      expect([pattern, matchesBoundedPattern(pattern, 'method')]).toEqual([pattern, undefined]);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('still compiles small repetitions of empty groups and large bounded ones', () => {
    expect(matchesBoundedPattern('^(?:){3}method$', 'method')).toBe(true);
    expect(matchesBoundedPattern('^a{1,900}$', 'a'.repeat(900))).toBe(true);
    expect(matchesBoundedPattern('^a{1,900}$', 'a'.repeat(901))).toBe(false);
  });

  it('evaluates catastrophic-backtracking patterns in linear time', () => {
    const started = Date.now();
    for (const pattern of ['^(a+)+$', '^(a|a)*$', '^(a*)*b$', '^(?:a|aa)+$', '^(\\w+\\s?)*$']) {
      expect(matchesBoundedPattern(pattern, `${'a'.repeat(1000)}!`)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
