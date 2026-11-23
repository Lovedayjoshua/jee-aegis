/**
 * Captures a scaled JPEG frame from an HTMLVideoElement.
 * Targets 1024x576 (16:9) or 768x768 max bounds for ultra-fast 1 FPS streaming.
 */
export function captureScaledJpegFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth = 1024,
  maxHeight = 576,
  quality = 0.78
): string | null {
  if (
    !video ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    return null;
  }

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;

  // Keep square-ish feeds within 768x768, widescreen feeds within 1024x576
  const boundW = srcW / srcH <= 1.25 ? 768 : maxWidth;
  const boundH = srcW / srcH <= 1.25 ? 768 : maxHeight;
  const scale = Math.min(1, boundW / srcW, boundH / srcH);

  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, targetW, targetH);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const commaIdx = dataUrl.indexOf(",");
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
}
