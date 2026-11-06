export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read the capture."));
    image.src = dataUrl;
  });
}

/**
 * Crop a captured tab image to a CSS-pixel rectangle. The scale is derived
 * from the captured image's natural size, which accounts for both DPR and
 * browser zoom.
 */
export async function cropDataUrl(dataUrl, rect) {
  const image = await loadImage(dataUrl);
  const scaleX = image.naturalWidth / rect.viewportWidth;
  const scaleY = image.naturalHeight / rect.viewportHeight;
  const width = Math.max(1, Math.round(rect.width * scaleX));
  const height = Math.max(1, Math.round(rect.height * scaleY));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to crop the capture.");
  }

  context.drawImage(
    image,
    rect.x * scaleX,
    rect.y * scaleY,
    rect.width * scaleX,
    rect.height * scaleY,
    0,
    0,
    width,
    height,
  );

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    mimeType: "image/png",
    capturedAt: new Date().toISOString(),
    viewport: { width: rect.viewportWidth, height: rect.viewportHeight },
    devicePixelRatio: rect.dpr,
  };
}

export function fullPageFrameCount(
  totalHeight,
  viewportHeight,
  maxFrames = 40,
) {
  const frameCount = Math.max(
    1,
    Math.ceil(totalHeight / Math.max(1, viewportHeight)),
  );

  return {
    frameCount,
    exceedsLimit: frameCount > maxFrames,
    maxFrames,
  };
}

export async function stitchFrames(frames, metrics) {
  const first = await loadImage(frames[0].dataUrl);
  const scaleX = first.naturalWidth / metrics.viewportWidth;
  const scaleY = first.naturalHeight / metrics.viewportHeight;
  const width = Math.round(metrics.viewportWidth * scaleX);
  const height = Math.round(metrics.totalHeight * scaleY);

  if (width > 32000 || height > 32000) {
    throw new Error(
      "The stitched image would exceed the browser canvas limit.",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to stitch the capture.");
  }

  for (const frame of frames) {
    const image = await loadImage(frame.dataUrl);
    const drawY = Math.round(frame.scrollY * scaleY);
    context.drawImage(image, 0, drawY, width, image.naturalHeight);
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    mimeType: "image/png",
    capturedAt: new Date().toISOString(),
    viewport: { width: metrics.viewportWidth, height: metrics.viewportHeight },
    devicePixelRatio: metrics.dpr,
    mode: "full_page",
  };
}
