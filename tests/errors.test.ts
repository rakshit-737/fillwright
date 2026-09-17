import { describe, expect, it, vi } from 'vitest';
import {
  describeError,
  looksTechnical,
  unsupportedPageCode,
  userMessage,
  USER_ERRORS,
} from '@/utils/errors';
import { codeForFailure } from '@/background/router';
import { request } from '@/content/transport';
import { chromeMock } from './setup';

describe('user-facing errors', () => {
  it('never passes technical text through', () => {
    for (const raw of [
      'Could not establish connection. Receiving end does not exist.',
      "TypeError: Cannot read properties of undefined (reading 'x')",
      'Unsupported message: ui:get-state',
      'Failed to fetch',
    ]) {
      expect(looksTechnical(raw)).toBe(true);
      expect(describeError(undefined, raw).message).toBe(USER_ERRORS.EHANDLER!.message);
    }
  });

  it('keeps friendly handler text for codes it does not know', () => {
    expect(describeError('EBADPASS', 'That passphrase does not match.').message).toBe(
      'That passphrase does not match.',
    );
  });

  it('says the form was untouched only on a web page, and only when true', () => {
    expect(describeError('EWORKER', undefined, true).message).toMatch(
      /Nothing on the form was changed/,
    );
    expect(describeError('EWORKER').message).not.toMatch(/form/);
    expect(describeError('EQUOTA', undefined, true).message).not.toMatch(/Nothing on the form/);
  });

  it('offers exactly one next step for every code', () => {
    for (const [code, entry] of Object.entries(USER_ERRORS)) {
      expect(entry.message, code).toMatch(/\.$/);
      if (entry.action !== 'none') expect(entry.actionLabel, code).not.toBe('');
    }
  });

  it('maps transport failures to one message', () => {
    expect(userMessage('ETIMEOUT', 'Fillwright timed out after 15s')).toBe(
      USER_ERRORS.EWORKER!.message,
    );
    expect(userMessage('ESEND', 'Could not establish connection')).toBe(
      USER_ERRORS.EWORKER!.message,
    );
  });

  it('recognises pages Fillwright cannot work on', () => {
    expect(unsupportedPageCode('chrome://extensions')).toBe('ECHROMEPAGE');
    expect(unsupportedPageCode('chrome-extension://abc/options.html')).toBe('ECHROMEPAGE');
    expect(unsupportedPageCode('file:///C:/cv.html')).toBe('EFILE');
    expect(unsupportedPageCode('https://chromewebstore.google.com/detail/x')).toBe('ESTORE');
    expect(unsupportedPageCode('https://chrome.google.com/webstore/detail/x')).toBe('ESTORE');
    expect(unsupportedPageCode('https://example.com/forms/app.pdf')).toBe('EPDF');
    expect(unsupportedPageCode('https://jobs.example.com/apply')).toBeNull();
    expect(unsupportedPageCode('not a url')).toBe('ECHROMEPAGE');
  });

  it('classifies thrown storage and vault failures', () => {
    expect(codeForFailure(Object.assign(new Error('x'), { code: 'ELOCKED' }))).toBe('ELOCKED');
    expect(codeForFailure(new DOMException('full', 'QuotaExceededError'))).toBe('EQUOTA');
    expect(codeForFailure(new Error('Encountered full disk quota'))).toBe('EQUOTA');
    expect(codeForFailure(new TypeError('boom'))).toBe('EHANDLER');
  });
});

describe('content transport', () => {
  it('retries once when the worker was asleep', async () => {
    chromeMock.runtime.sendMessage
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({ ok: true, data: 42 } as never);
    const reply = await request<number>({ type: 'content:get-progress' });
    expect(reply).toEqual({ ok: true, data: 42 });
  });

  it('gives up after the retry with a code, never a throw', async () => {
    chromeMock.runtime.sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
    const reply = await request({ type: 'content:get-progress' });
    expect(reply).toEqual({ ok: false, code: 'EWORKER', error: '' });
    chromeMock.runtime.sendMessage.mockReset();
    chromeMock.runtime.sendMessage.mockImplementation(
      vi.fn(async () => ({ ok: true, data: null })),
    );
  });

  it('does not retry into a replaced extension', async () => {
    const send = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    chromeMock.runtime.sendMessage.mockImplementation(send as never);
    const reply = await request({ type: 'content:get-progress' });
    expect(reply.ok).toBe(false);
    expect(!reply.ok && reply.code).toBe('EINVALIDATED');
    expect(send).toHaveBeenCalledTimes(1);
    chromeMock.runtime.sendMessage.mockImplementation(
      vi.fn(async () => ({ ok: true, data: null })),
    );
  });
});
