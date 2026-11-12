/** A run of a message's content: prose, or a fenced block of code. */
export type ContentSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'code';
      readonly text: string;
      /** The info string after the opening fence, when there is one. */
      readonly language: string | null;
      /** False while the closing fence has not arrived, as in a streaming turn. */
      readonly closed: boolean;
    };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*).*$/;

/**
 * Splits a message into prose and fenced code blocks.
 *
 * An agent's answer is mostly Markdown, and the part of Markdown that matters
 * in a tool like this is the code: it has to keep its whitespace, scroll
 * rather than wrap, and be copyable on its own. So only fences are recognised
 * and everything else is left as the text it is — which also means nothing a
 * model writes is ever interpreted as markup.
 *
 * A fence with no closing line runs to the end of the message. That is what a
 * half-streamed block looks like, and treating it as code from the moment it
 * opens stops the turn from reflowing when the fence finally closes.
 */
export function splitContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let text: string[] = [];
  let code: string[] | null = null;
  let fence = '';
  let language: string | null = null;

  const flushText = (): void => {
    // Blank lines around a block are spacing the layout already provides.
    const joined = text.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined) {
      segments.push({ kind: 'text', text: joined });
    }
    text = [];
  };

  for (const line of content.split('\n')) {
    const match = FENCE.exec(line);

    if (code === null) {
      if (match) {
        flushText();
        code = [];
        fence = match[1]!;
        language = match[2] || null;
      } else {
        text.push(line);
      }
      continue;
    }

    // A block closes on a fence of the same character, at least as long, with
    // nothing after it — a shorter one inside is part of the code.
    if (match && match[1]![0] === fence[0] && match[1]!.length >= fence.length && !match[2]) {
      segments.push({ kind: 'code', text: code.join('\n'), language, closed: true });
      code = null;
      continue;
    }

    code.push(line);
  }

  if (code !== null) {
    segments.push({ kind: 'code', text: code.join('\n'), language, closed: false });
  } else {
    flushText();
  }

  return segments;
}
