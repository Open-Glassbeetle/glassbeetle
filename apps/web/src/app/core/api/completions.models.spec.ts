import { parseSseBuffer } from './completions.models';

describe('parseSseBuffer', () => {
  it('parses every complete event and keeps their order', () => {
    const { events, rest } = parseSseBuffer(
      'event: message_start\ndata: {"messageId":"m1","chatId":"c1","sequence":2,"agentId":"a1"}\n\n' +
        'event: token\ndata: {"messageId":"m1","text":"Hel"}\n\n',
    );

    expect(events.map((event) => event.type)).toEqual(['message_start', 'token']);
    expect(events[1]).toEqual({ type: 'token', data: { messageId: 'm1', text: 'Hel' } });
    expect(rest).toBe('');
  });

  it('hands back an event that arrived in halves instead of parsing half of it', () => {
    const first = parseSseBuffer('event: token\ndata: {"messageId":"m1","te');

    expect(first.events).toEqual([]);

    const second = parseSseBuffer(first.rest + 'xt":"lo"}\n\n');

    expect(second.events).toEqual([{ type: 'token', data: { messageId: 'm1', text: 'lo' } }]);
  });

  it('keeps the done sentinel as the string it is', () => {
    const { events } = parseSseBuffer('event: done\ndata: [DONE]\n\n');

    expect(events).toEqual([{ type: 'done', data: '[DONE]' }]);
  });

  it('accepts CRLF line endings', () => {
    const { events } = parseSseBuffer(
      'event: token\r\ndata: {"messageId":"m1","text":"a"}\r\n\r\n',
    );

    expect(events).toHaveLength(1);
  });
});
