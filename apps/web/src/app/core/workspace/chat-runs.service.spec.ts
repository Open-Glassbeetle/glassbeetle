import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type { CompletionEvent } from '../api/completions.models';
import { CompletionsService } from '../api/completions.service';
import { ChatRunsService, type RunOutcome } from './chat-runs.service';

function setup() {
  const streams: Subject<CompletionEvent>[] = [];
  const completions = {
    stream: vi.fn(() => {
      const stream = new Subject<CompletionEvent>();
      streams.push(stream);
      return stream.asObservable();
    }),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: CompletionsService, useValue: completions }],
  });

  const runs = TestBed.inject(ChatRunsService);
  const outcomes: RunOutcome[] = [];
  runs.settled.subscribe((outcome) => outcomes.push(outcome));

  return { runs, completions, streams, outcomes };
}

const START: CompletionEvent = {
  type: 'message_start',
  data: { messageId: 'm1', chatId: 'c1', sequence: 2, agentId: 'a1', agentName: 'Scout' },
};

describe('ChatRunsService', () => {
  it('assembles the turn from the tokens as they arrive', () => {
    const { runs, streams } = setup();

    runs.start('c1');
    streams[0]!.next(START);
    streams[0]!.next({ type: 'thought', data: { messageId: 'm1', thought: 'Considering.' } });
    streams[0]!.next({ type: 'token', data: { messageId: 'm1', text: 'Hel' } });
    streams[0]!.next({ type: 'token', data: { messageId: 'm1', text: 'lo' } });

    const run = runs.runFor('c1');

    expect(run?.status).toBe('running');
    expect(run?.drafts).toEqual([
      {
        messageId: 'm1',
        agentId: 'a1',
        agentName: 'Scout',
        text: 'Hello',
        thought: 'Considering.',
        complete: false,
      },
    ]);
  });

  it('keeps each member’s turn apart in a team run', () => {
    const { runs, streams } = setup();

    runs.start('c1');
    streams[0]!.next(START);
    streams[0]!.next({ type: 'token', data: { messageId: 'm1', text: 'One' } });
    streams[0]!.next({ type: 'message_complete', data: { messageId: 'm1', tokenCount: 1 } });
    streams[0]!.next({
      type: 'message_start',
      data: { messageId: 'm2', chatId: 'c1', sequence: 3, agentId: 'a2', agentName: 'Editor' },
    });
    streams[0]!.next({ type: 'token', data: { messageId: 'm2', text: 'Two' } });

    expect(runs.runFor('c1')?.drafts.map((draft) => [draft.text, draft.complete])).toEqual([
      ['One', true],
      ['Two', false],
    ]);
  });

  it('clears the run and announces it once the stream is done', () => {
    const { runs, streams, outcomes } = setup();

    runs.start('c1');
    streams[0]!.next(START);
    streams[0]!.next({ type: 'done', data: '[DONE]' });

    expect(runs.runFor('c1')).toBeNull();
    expect(outcomes).toEqual([{ chatId: 'c1', result: 'complete' }]);
  });

  it('does not start a second run in a chat that already has one', () => {
    const { runs, completions } = setup();

    runs.start('c1');
    runs.start('c1');

    expect(completions.stream).toHaveBeenCalledTimes(1);
  });

  it('runs two chats at once', () => {
    const { runs, streams } = setup();

    runs.start('c1');
    runs.start('c2');
    streams[1]!.next({ type: 'done', data: '[DONE]' });

    expect(runs.isRunning('c1')).toBe(true);
    expect(runs.isRunning('c2')).toBe(false);
    expect(runs.runningCount()).toBe(1);
  });

  it('keeps a failed run, with its reason, until it is dismissed', () => {
    const { runs, streams, outcomes } = setup();

    runs.start('c1');
    streams[0]!.error(
      new HttpErrorResponse({
        status: 422,
        error: { statusCode: 422, error: 'x', code: 'AGENT_MODEL_MISSING', message: 'No model.' },
      }),
    );

    expect(runs.runFor('c1')).toMatchObject({
      status: 'failed',
      error: { status: 422, code: 'AGENT_MODEL_MISSING', message: 'No model.' },
    });
    expect(outcomes).toEqual([{ chatId: 'c1', result: 'failed' }]);

    runs.dismiss('c1');

    expect(runs.runFor('c1')).toBeNull();
  });

  it('treats an error event on the stream as the failure it reports', () => {
    const { runs, streams } = setup();

    runs.start('c1');
    streams[0]!.next(START);
    streams[0]!.next({ type: 'token', data: { messageId: 'm1', text: 'Half' } });
    streams[0]!.next({ type: 'error', data: { code: 'RATE_LIMITED', message: 'Slow down.' } });
    // The API closes a failed stream with `done`, which must not undo it.
    streams[0]!.next({ type: 'done', data: '[DONE]' });

    const run = runs.runFor('c1');

    expect(run?.status).toBe('failed');
    expect(run?.error?.message).toBe('Slow down.');
    expect(run?.drafts[0]?.text).toBe('Half');
  });

  it('stops a run by closing its stream', () => {
    const { runs, streams, outcomes } = setup();

    runs.start('c1');
    runs.stop('c1');

    expect(streams[0]!.observed).toBe(false);
    expect(runs.runFor('c1')).toBeNull();
    expect(outcomes).toEqual([{ chatId: 'c1', result: 'stopped' }]);
  });

  it('flags a run that finished while another chat was on screen', () => {
    const { runs, streams } = setup();

    runs.view('c2');
    runs.start('c1');
    streams[0]!.next({ type: 'done', data: '[DONE]' });

    expect(runs.unseen().has('c1')).toBe(true);

    runs.view('c1');

    expect(runs.unseen().has('c1')).toBe(false);
  });

  it('does not flag a run that finished in the chat being looked at', () => {
    const { runs, streams } = setup();

    runs.view('c1');
    runs.start('c1');
    streams[0]!.next({ type: 'done', data: '[DONE]' });

    expect(runs.unseen().size).toBe(0);
  });
});
