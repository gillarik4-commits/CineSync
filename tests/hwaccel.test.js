describe('detectHardwareEncoder', () => {
  beforeEach(() => jest.resetModules());

  function load({ nodes, encodeFails = false, vendor = '0x8086' }) {
    jest.doMock('fs', () => ({
      readdirSync: () => {
        if (!nodes) throw new Error('ENOENT');
        return nodes;
      },
      readFileSync: () => `${vendor}\n`
    }));
    const execFile = jest.fn((_cmd, _args, _opts, cb) => cb(encodeFails ? new Error('no va') : null));
    jest.doMock('child_process', () => ({ execFile }));
    return { hw: require('../server/hwaccel'), execFile };
  }

  test('reports a working VA-API GPU with its vendor', async () => {
    const { hw, execFile } = load({ nodes: ['card1', 'renderD128'] });
    await expect(hw.detectHardwareEncoder()).resolves.toEqual({
      type: 'vaapi',
      device: '/dev/dri/renderD128',
      label: 'Intel GPU'
    });
    expect(execFile.mock.calls[0][1]).toEqual(expect.arrayContaining(['-c:v', 'h264_vaapi', '-vaapi_device', '/dev/dri/renderD128']));
  });

  test('null when the test encode fails (e.g. driver missing)', async () => {
    const { hw } = load({ nodes: ['renderD128'], encodeFails: true });
    await expect(hw.detectHardwareEncoder()).resolves.toBeNull();
  });

  test('null when there is no GPU render node', async () => {
    const { hw, execFile } = load({ nodes: null });
    await expect(hw.detectHardwareEncoder()).resolves.toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  test('checks only once', async () => {
    const { hw, execFile } = load({ nodes: ['renderD128'], vendor: '0x1002' });
    await expect(hw.detectHardwareEncoder()).resolves.toMatchObject({ label: 'AMD GPU' });
    await hw.detectHardwareEncoder();
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
