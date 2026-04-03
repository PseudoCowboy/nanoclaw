import { describe, it, expect } from 'vitest';

import { splitMessage } from './utils.js';

describe('splitMessage', () => {
  it('returns single-element array for short messages', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('returns original text when exactly at limit', () => {
    const text = 'a'.repeat(50);
    expect(splitMessage(text, 50)).toEqual([text]);
  });

  it('splits long message at line boundaries', () => {
    const text = 'line1\nline2\nline3\nline4';
    // maxLength=11 fits "line1\nline2" (11 chars)
    const chunks = splitMessage(text, 11);
    expect(chunks).toEqual(['line1\nline2', 'line3\nline4']);
  });

  it('hard-splits a single line longer than limit', () => {
    const text = 'abcdefghij'; // 10 chars
    const chunks = splitMessage(text, 4);
    expect(chunks).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('handles mixed short and long lines', () => {
    const text = 'short\n' + 'x'.repeat(10) + '\nend';
    const chunks = splitMessage(text, 8);
    // "short" fits, then "x".repeat(10) is too long for same chunk and too long alone
    expect(chunks[0]).toBe('short');
    expect(chunks[1]).toBe('xxxxxxxx');
    expect(chunks[2]).toBe('xx');
    expect(chunks[3]).toBe('end');
  });

  it('handles empty string', () => {
    expect(splitMessage('', 100)).toEqual(['']);
  });

  it('handles newlines only', () => {
    const chunks = splitMessage('\n\n', 100);
    expect(chunks).toEqual(['\n\n']);
  });
});
