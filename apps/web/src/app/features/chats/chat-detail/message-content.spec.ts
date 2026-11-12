import { splitContent } from './message-content';

describe('splitContent', () => {
  it('leaves a message without code as the one piece of text it is', () => {
    expect(splitContent('Two lines\nof prose.')).toEqual([
      { kind: 'text', text: 'Two lines\nof prose.' },
    ]);
  });

  it('separates a fenced block from the prose around it', () => {
    expect(splitContent('Before.\n\n```ts\nconst a = 1;\n```\n\nAfter.')).toEqual([
      { kind: 'text', text: 'Before.' },
      { kind: 'code', text: 'const a = 1;', language: 'ts', closed: true },
      { kind: 'text', text: 'After.' },
    ]);
  });

  it('keeps the whitespace inside a block exactly', () => {
    const [block] = splitContent('```\n  indented\n\n\tand tabbed\n```');

    expect(block).toEqual({
      kind: 'code',
      text: '  indented\n\n\tand tabbed',
      language: null,
      closed: true,
    });
  });

  it('treats a block that has not closed yet as code, which is what a streaming turn holds', () => {
    expect(splitContent('Here:\n```py\nprint(1)')).toEqual([
      { kind: 'text', text: 'Here:' },
      { kind: 'code', text: 'print(1)', language: 'py', closed: false },
    ]);
  });

  it('does not close a block on a shorter fence inside it', () => {
    const [block] = splitContent('````md\n```ts\nx\n```\n````');

    expect(block).toMatchObject({ kind: 'code', text: '```ts\nx\n```', closed: true });
  });

  it('returns nothing for an empty message', () => {
    expect(splitContent('')).toEqual([]);
  });
});
