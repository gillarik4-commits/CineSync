import { expect, test } from 'vitest';
import { actionText, pausedByText, pushToast, typingText } from './presence';

test('actionText describes what someone did', () => {
  expect(actionText({ action: 'PAUSE', by: 'Priya' })).toBe('Priya paused');
  expect(actionText({ action: 'PLAY', by: 'Priya' })).toBe('Priya resumed');
  expect(actionText({ action: 'SEEK', by: 'Sam', currentTime: 3730 })).toBe('Sam jumped to 1:02:10');
  expect(actionText({ action: 'PAUSE', by: null })).toBe('Someone paused');
  expect(actionText({ action: 'WHATEVER', by: 'x' })).toBeNull();
});

test('typingText reads naturally for any number of people', () => {
  expect(typingText([])).toBe('');
  expect(typingText(['Priya'])).toBe('Priya is typing');
  expect(typingText(['Priya', 'Sam'])).toBe('Priya and Sam are typing');
  expect(typingText(['Priya', 'Sam', 'Ana'])).toBe('Priya, Sam and Ana are typing');
  expect(typingText(['a', 'b', 'c', 'd'])).toBe('4 people are typing');
  expect(typingText(['Priya', 'Priya'])).toBe('Priya is typing');
});

test('pausedByText', () => {
  expect(pausedByText({ action: 'PAUSE', by: 'Priya' }, 'Eric')).toBe('Paused by Priya');
  expect(pausedByText({ action: 'PAUSE', by: null }, 'Eric')).toBe('You paused');
  expect(pausedByText({ action: 'PAUSE', by: 'Eric' }, 'Eric')).toBe('You paused');
  expect(pausedByText(null, 'Eric')).toBe('Paused');
  expect(pausedByText({ action: 'PLAY', by: 'Priya' }, 'Eric')).toBe('Paused');
});

test('pushToast merges rapid repeats from the same person and caps the stack', () => {
  let list = [];
  list = pushToast(list, { id: 1, key: 'Sam:seek', text: 'Sam jumped to 0:10' }, 1000);
  list = pushToast(list, { id: 2, key: 'Sam:seek', text: 'Sam jumped to 0:20' }, 2000);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: 1, text: 'Sam jumped to 0:20', at: 2000 });

  // Too late to merge → a new toast
  list = pushToast(list, { id: 3, key: 'Sam:seek', text: 'Sam jumped to 0:30' }, 6000);
  expect(list).toHaveLength(2);

  list = pushToast(list, { id: 4, key: 'a', text: 'a' }, 6100);
  list = pushToast(list, { id: 5, key: 'b', text: 'b' }, 6200);
  expect(list.map((t) => t.id)).toEqual([3, 4, 5]);
});
