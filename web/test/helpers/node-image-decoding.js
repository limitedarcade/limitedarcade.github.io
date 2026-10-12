// Decode embedded PNGs for glTF asset tests in Node, without a browser/GPU.
// The returned pixels come from the actual GLB image bytes via Sharp.
import sharp from 'sharp';

export function enableNodeImageDecoding() {
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap ??= async blob => {
    const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer()))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height, close() {} };
  };
}
