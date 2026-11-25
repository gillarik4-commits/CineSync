import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileBrowser from './FileBrowser';

const listing = (path, entries, parent = '/') => ({
  path,
  parent,
  kind: 'video',
  entries,
  places: [{ label: 'Home', path: '/home/me' }]
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const dir = new URL(url, 'http://x').searchParams.get('dir');
      const body =
        dir === '/home/me/Movies'
          ? listing('/home/me/Movies', [{ name: 'Film.mkv', path: '/home/me/Movies/Film.mkv', type: 'file', size: 1048576 }], '/home/me')
          : listing('/home/me', [
              { name: 'Movies', path: '/home/me/Movies', type: 'dir' },
              { name: 'Other.mp4', path: '/home/me/Other.mp4', type: 'file', size: 10 }
            ]);
      return { ok: true, status: 200, json: async () => body };
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

test('navigates into a folder and picks a file', async () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<FileBrowser open kind="video" onPick={onPick} onClose={onClose} />);

  await user.click(await screen.findByRole('option', { name: /Movies/ }));
  await user.click(await screen.findByRole('option', { name: /Film\.mkv/ }));

  expect(onPick).toHaveBeenCalledWith('/home/me/Movies/Film.mkv');
  expect(onClose).toHaveBeenCalled();
  expect(localStorage.getItem('cinesync_browse_dir_video')).toBe('/home/me/Movies');
});

test('filters the current folder', async () => {
  const user = userEvent.setup();
  render(<FileBrowser open kind="video" onPick={() => {}} onClose={() => {}} />);
  await screen.findByRole('option', { name: /Other\.mp4/ });
  await user.type(screen.getByLabelText('Filter this folder'), 'mov');
  await waitFor(() => expect(screen.queryByRole('option', { name: /Other\.mp4/ })).toBeNull());
  expect(screen.getByRole('option', { name: /Movies/ })).toBeTruthy();
});

test('shows a readable error when browsing is refused', async () => {
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: async () => ({ error: 'File browsing is only available on the host machine' })
  });
  render(<FileBrowser open kind="video" onPick={() => {}} onClose={() => {}} />);
  expect(await screen.findByText(/only available on the host machine/)).toBeTruthy();
});
