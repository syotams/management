import { extractMentions } from './mentions.util';

describe('extractMentions', () => {
  it('returns unique lowercased names in order', () => {
    expect(extractMentions('Hey @Alice and @bob_1, ping @alice again')).toEqual(['alice', 'bob_1']);
  });

  it('handles mentions at the start, after punctuation and newlines', () => {
    expect(extractMentions('@carol: see (@dave-x)\n@erin.')).toEqual(['carol', 'dave-x', 'erin']);
  });

  it('ignores emails, double @ and names shorter than 3 chars', () => {
    expect(extractMentions('mail alice@example.com @@bob @al')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });
});
