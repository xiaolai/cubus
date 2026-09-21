// src/letterbox.ts
function letterboxOf(width, height, imgsz) {
  const scale = imgsz / Math.max(width, height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  return {
    scale,
    newW,
    newH,
    padX: Math.floor((imgsz - newW) / 2),
    padY: Math.floor((imgsz - newH) / 2)
  };
}
var IMG_SIZE = 640;
var PAD = 114 / 255;
function preprocess(frame, imgsz = IMG_SIZE) {
  const { src, w, h } = validatedFrame(frame, imgsz);
  const { scale, newW, newH, padX, padY } = letterboxOf(w, h, imgsz);
  const plane = imgsz * imgsz;
  const out = new Float32Array(3 * plane).fill(PAD);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    const oy = y + padY;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = oy * imgsz + (x + padX);
      for (let ch = 0; ch < 3; ch++) {
        const p00 = src[(y0 * w + x0) * 4 + ch];
        const p01 = src[(y0 * w + x1) * 4 + ch];
        const p10 = src[(y1 * w + x0) * 4 + ch];
        const p11 = src[(y1 * w + x1) * 4 + ch];
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        out[ch * plane + o] = (top + (bot - top) * fy) / 255;
      }
    }
  }
  return { data: out, imgsz };
}
function validatedFrame(frame, imgsz) {
  const { data: src, width: w, height: h } = frame;
  if (!Number.isInteger(imgsz) || imgsz <= 0) {
    throw new Error(`preprocess: imgsz ${imgsz} is not a positive whole number of pixels`);
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`preprocess: a frame of ${w}x${h} is not an image`);
  }
  if (src.length !== w * h * 4) {
    throw new Error(
      `preprocess: a ${w}x${h} RGBA frame is ${w * h * 4} bytes, but this one holds ${src.length}`
    );
  }
  return { src, w, h };
}

// view/letterbox-protocol.ts
function handleLetterboxRequest(request) {
  const pre = preprocess(request.frame, IMG_SIZE);
  return { id: request.id, data: pre.data, imgsz: pre.imgsz, frame: request.frame };
}

// view/letterbox-worker.ts
var canvas = null;
var context = null;
function pixelsOf(bitmap) {
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!context) throw new Error("letterbox worker: no 2D context");
  context.drawImage(bitmap, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width: image.width, height: image.height };
}
var message = (err) => err instanceof Error ? err.message : String(err);
self.addEventListener("message", (ev) => {
  const { id, bitmap } = ev.data;
  try {
    let frame;
    try {
      frame = pixelsOf(bitmap);
    } catch (err) {
      const failure = { id, error: message(err), fatal: true };
      self.postMessage(failure);
      return;
    }
    let reply;
    try {
      reply = handleLetterboxRequest({ id, frame });
    } catch (err) {
      const failure = { id, error: message(err) };
      self.postMessage(failure);
      return;
    }
    try {
      self.postMessage(reply, { transfer: [reply.data.buffer, reply.frame.data.buffer] });
    } catch (err) {
      const failure = { id, error: message(err), fatal: true };
      self.postMessage(failure);
    }
  } finally {
    bitmap.close();
  }
});
