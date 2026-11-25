import { expect, test } from 'vitest';
import { appendMessage, chatModeOrDefault, MAX_MESSAGES } from './messages';

const chat = (username, timestamp, text = 'hi') => ({ kind: 'chat', username, text, timestamp });

test('groups consecutive messages from the same person within 20s', () => {
  let list = [];
  list = appendMessage(list, chat('ana', 1000));
  list = appendMessage(list, chat('ana', 15000));
  list = appendMessage(list, chat('ana', 40000));
  expect(list.map((m) => m.grouped)).toEqual([false, true, false]);
});

test('a different speaker or a system message breaks the group', () => {
  let list = [];
  list = appendMessage(list, chat('ana', 1000));
  list = appendMessage(list, chat('ben', 2000));
  list = appendMessage(list, chat('ben', 3000));
  list = appendMessage(list, { kind: 'system', text: 'cat joined', timestamp: 3500 });
  list = appendMessage(list, chat('ben', 4000));
  expect(list.map((m) => m.grouped)).toEqual([false, false, true, false, false]);
});

test('ids are unique and increasing', () => {
  let list = [];
  for (let i = 0; i < 5; i++) list = appendMessage(list, chat('ana', i));
  const ids = list.map((m) => m.id);
  expect(new Set(ids).size).toBe(5);
  expect([...ids].sort((a, b) => a - b)).toEqual(ids);
});

test(`keeps only the latest ${MAX_MESSAGES} messages`, () => {
  let list = [];
  for (let i = 0; i < MAX_MESSAGES + 10; i++) list = appendMessage(list, chat('ana', i * 60000, String(i)));
  expect(list).toHaveLength(MAX_MESSAGES);
  expect(list[list.length - 1].text).toBe(String(MAX_MESSAGES + 9));
});

test('chatModeOrDefault', () => {
  expect(chatModeOrDefault('panel')).toBe('panel');
  expect(chatModeOrDefault('bogus')).toBe('ambient');
  expect(chatModeOrDefault(null)).toBe('ambient');
});
