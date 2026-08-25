(() => {
'use strict';
// Papa Parse cannot structured-clone callback functions such as beforeFirstChunk
// into a Web Worker. The VT-X CSV format has a 3-line preamble before the real
// CSV header, so strip that preamble at Blob level before the worker receives it.
if (!window.Papa || window.Papa.__xgrrWorkerSafe) return;

const originalParse = window.Papa.parse.bind(window.Papa);
const encoder = new TextEncoder();

async function stripThreeLinePreamble(blob) {
  // 64 KiB is intentionally generous; the metadata/header area is tiny in
  // VT-X exports, while this avoids reading the full inspection file on UI thread.
  const head = await blob.slice(0, Math.min(blob.size, 65536)).text();
  let pos = 0;
  for (let i = 0; i < 3; i++) {
    const nl = head.indexOf('\n', pos);
    if (nl < 0) throw new Error('CSV header not found after the expected 3-line metadata preamble.');
    pos = nl + 1;
  }
  // String indices are UTF-16 offsets, not byte offsets. Convert the prefix back
  // to UTF-8 bytes so Blob.slice() stays correct even when metadata is non-ASCII.
  const byteOffset = encoder.encode(head.slice(0, pos)).length;
  return blob.slice(byteOffset, blob.size, blob.type || 'text/csv');
}

window.Papa.parse = function xgrrWorkerSafeParse(input, config) {
  const cfg = config || {};
  const needsSafePreamble =
    typeof Blob !== 'undefined' && input instanceof Blob &&
    cfg.worker === true && typeof cfg.beforeFirstChunk === 'function';

  if (!needsSafePreamble) return originalParse(input, cfg);

  const safeConfig = { ...cfg };
  delete safeConfig.beforeFirstChunk;

  // Start asynchronously; callers already rely on complete/error callbacks, so
  // their surrounding Promise remains pending until the real worker finishes.
  stripThreeLinePreamble(input)
    .then(cleanBlob => originalParse(cleanBlob, safeConfig))
    .catch(err => {
      if (typeof safeConfig.error === 'function') safeConfig.error(err);
      else setTimeout(() => { throw err; }, 0);
    });

  return undefined;
};

window.Papa.__xgrrWorkerSafe = true;
})();
