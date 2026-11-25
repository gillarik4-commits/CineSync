const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const VENDORS = { '0x8086': 'Intel GPU', '0x1002': 'AMD GPU', '0x10de': 'NVIDIA GPU' };

function renderNode() {
  try {
    const node = fs.readdirSync('/dev/dri').filter((n) => n.startsWith('renderD')).sort()[0];
    return node ? path.join('/dev/dri', node) : null;
  } catch {
    return null;
  }
}

/** "Intel GPU" etc. from the render node's PCI vendor id, or a generic label. */
function gpuLabel(device) {
  try {
    const vendor = fs.readFileSync(`/sys/class/drm/${path.basename(device)}/device/vendor`, 'utf8').trim();
    return VENDORS[vendor] || 'GPU';
  } catch {
    return 'GPU';
  }
}

let detection = null;

/**
 * Can this machine encode H.264 on the GPU (VA-API: Intel and AMD on Linux)?
 * Proves it with a tiny test encode rather than trusting driver listings.
 * Resolves to { type: 'vaapi', device, label } or null. Checked once and cached.
 */
function detectHardwareEncoder() {
  if (detection) return detection;
  detection = new Promise((resolve) => {
    const device = renderNode();
    if (!device) return resolve(null);
    execFile(
      'ffmpeg',
      [
        '-hide_banner', '-v', 'error',
        '-vaapi_device', device,
        '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=0.3',
        '-vf', 'format=nv12,hwupload',
        '-c:v', 'h264_vaapi',
        '-f', 'null', '-'
      ],
      { timeout: 10000 },
      (err) => resolve(err ? null : { type: 'vaapi', device, label: gpuLabel(device) })
    );
  });
  return detection;
}

function resetDetection() {
  detection = null;
}

module.exports = { detectHardwareEncoder, resetDetection };
