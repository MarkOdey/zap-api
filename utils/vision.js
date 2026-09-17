import { RawImage } from '@huggingface/transformers';
import sharp from 'sharp';

import { getPipeline } from './models.js';

// Model loading, caching and disposal are shared — see utils/models.js.
export { dispose } from './models.js';

/** Longest edge fed to the model. Inference cost scales with pixels, and the
 *  library holds 4896px photos, so downscale first and upscale the mask after. */
export const INFERENCE_MAX_DIM = Number(process.env.INFERENCE_MAX_DIM || 1024);

export const MODELS = {
  segmentation: process.env.SEGMENTATION_MODEL || 'Xenova/detr-resnet-50-panoptic',
  detection:    process.env.DETECTION_MODEL    || 'Xenova/owlvit-base-patch32',
};

export const getSegmenter = () => getPipeline('image-segmentation', MODELS.segmentation);
export const getDetector  = () => getPipeline('zero-shot-object-detection', MODELS.detection);

/**
 * Load an image with EXIF orientation applied, since the model and sharp
 * disagree about dimensions otherwise. Returns the full-size sharp pipeline,
 * its true dimensions, and a downscaled RawImage to run inference on.
 */
export async function loadForInference(sourcePath, maxDim = INFERENCE_MAX_DIM) {
  const image = sharp(sourcePath, { failOn: 'none' }).rotate();

  // metadata() reports the stored dimensions, before EXIF rotation is applied.
  // Orientations 5-8 rotate by 90°, so the dimensions the pipeline actually
  // produces are swapped. Getting this wrong makes the mask the wrong shape.
  const meta = await sharp(sourcePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`vision: cannot read dimensions of ${sourcePath}`);
  const swapped = meta.orientation >= 5 && meta.orientation <= 8;
  const width = swapped ? meta.height : meta.width;
  const height = swapped ? meta.width : meta.height;

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const inferWidth = Math.max(1, Math.round(width * scale));
  const inferHeight = Math.max(1, Math.round(height * scale));

  const { data, info } = await image
    .clone()
    .resize(inferWidth, inferHeight, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const raw = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
  return { image, width, height, raw, scale };
}

/**
 * Cut a shape out of an image using a model mask, returning a transparent PNG.
 *
 * The mask arrives at the inference size and is scaled back up. It is joined on
 * as the alpha channel rather than composited: sharp's `dest-in` blend keys off
 * the *alpha* of the overlay, so handing it an opaque greyscale mask silently
 * keeps the whole image.
 */
export async function cutOut(image, mask, width, height) {
  const alpha = await sharp(Buffer.from(mask.data), {
    raw: { width: mask.width, height: mask.height, channels: mask.channels ?? 1 },
  })
    .resize(width, height, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  const rgb = await image.clone().removeAlpha().raw().toBuffer();

  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Output encoding for generated images.
 *
 * Cutouts were written as full-resolution lossless PNG, which is the worst case
 * for photographic content: one 16MP person cutout came out at 15MB — four times
 * larger than the JPEG it was cut from — because a 93%-coverage mask left trim()
 * nothing to crop. Downscaling and WebP takes the same file to 0.17MB.
 *
 * Measured on that file: png 14.97MB, webp q90 0.64MB, and 0.17MB once capped at
 * 2048px. AVIF is smaller again but took 26s to encode, which would dominate the
 * job queue for a marginal win.
 */
export const OUTPUT_MAX_DIM = Number(process.env.OUTPUT_MAX_DIM || 2048);
export const OUTPUT_FORMAT = (process.env.OUTPUT_FORMAT || 'webp').toLowerCase();
export const OUTPUT_QUALITY = Number(process.env.OUTPUT_QUALITY || 90);

/**
 * Encode a generated image: cap its long edge, then compress.
 * @returns {Promise<{buffer: Buffer, ext: string, mime: string, width: number, height: number}>}
 */
export async function encodeDerived(input) {
  let pipe = sharp(input).resize({
    width: OUTPUT_MAX_DIM,
    height: OUTPUT_MAX_DIM,
    fit: 'inside',
    withoutEnlargement: true,
  });

  // alphaQuality 100 keeps cutout edges clean; the colour channels carry the loss.
  pipe = OUTPUT_FORMAT === 'png'
    ? pipe.png({ compressionLevel: 9 })
    : pipe.webp({ quality: OUTPUT_QUALITY, alphaQuality: 100 });

  const { data, info } = await pipe.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    ext: OUTPUT_FORMAT,
    mime: `image/${OUTPUT_FORMAT}`,
    width: info.width,
    height: info.height,
  };
}

/** Fraction of the mask that is set — used to reject empty or whole-image masks. */
export function maskCoverage(mask) {
  const data = mask.data;
  let on = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 127) on++;
  return on / data.length;
}
