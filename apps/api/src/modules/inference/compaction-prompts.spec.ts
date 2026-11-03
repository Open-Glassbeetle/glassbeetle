import { describe, expect, it } from 'vitest';
import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionUserPrompt,
  formatMessagesForCompaction,
} from './compaction-prompts.js';

describe('compaction-prompts', () => {
  it('exports a non-empty reviewable system prompt', () => {
    expect(COMPACTION_SYSTEM_PROMPT).toBeTruthy();
    expect(COMPACTION_SYSTEM_PROMPT).toContain('conversation summariser');
    expect(COMPACTION_SYSTEM_PROMPT).toContain('Preserve key decisions');
  });

  it('formats conversation messages with sequence, role, and content', () => {
    const formatted = formatMessagesForCompaction([
      { sequence: 1, role: 'user', content: 'What is SQLite?' },
      {
        sequence: 2,
        role: 'assistant',
        content: 'SQLite is an embedded database engine.',
      },
    ]);

    expect(formatted).toContain('[Sequence 1 | user]:\nWhat is SQLite?');
    expect(formatted).toContain(
      '[Sequence 2 | assistant]:\nSQLite is an embedded database engine.',
    );
  });

  it('builds initial prompt when no existing summary is present', () => {
    const prompt = buildCompactionUserPrompt({
      messages: [
        { sequence: 1, role: 'user', content: 'Hello' },
        { sequence: 2, role: 'assistant', content: 'Hi there!' },
      ],
    });

    expect(prompt).toContain('<conversation_turns>');
    expect(prompt).toContain('[Sequence 1 | user]:\nHello');
    expect(prompt).toContain('[Sequence 2 | assistant]:\nHi there!');
    expect(prompt).not.toContain('<prior_summary>');
  });

  it('folds existing summary into prompt when existing summary is present', () => {
    const prompt = buildCompactionUserPrompt({
      existingSummary: 'User previously asked about TypeScript configuration.',
      messages: [
        { sequence: 3, role: 'user', content: 'Now add Vitest.' },
        { sequence: 4, role: 'assistant', content: 'Vitest is configured.' },
      ],
    });

    expect(prompt).toContain('<prior_summary>');
    expect(prompt).toContain(
      'User previously asked about TypeScript configuration.',
    );
    expect(prompt).toContain('<new_turns>');
    expect(prompt).toContain('[Sequence 3 | user]:\nNow add Vitest.');
    expect(prompt).toContain(
      '[Sequence 4 | assistant]:\nVitest is configured.',
    );
    expect(prompt).toContain('produce an updated, cohesive summary');
  });
});
