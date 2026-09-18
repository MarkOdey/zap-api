import fs from 'fs/promises';
import path from 'path';
import record from './record.js';
import segment from './segment.js';
import connect from './connect.js';

async function upload(data) {
  console.log("upload: receiving", typeof data === "string" ? "(json)" : data?.meta?.name);
  if (typeof data === "string") data = JSON.parse(data);

  const { meta, data: payload } = data;
  if (!meta?.name) throw new Error("upload: missing meta.name");

  const source = path.join(process.env.DATA_DIR || "./data", path.basename(meta.name));

  await writePayload(source, payload);
  console.log("upload: file written to", source);

  if (meta.type?.includes("video")) {
    return await uploadVideo(source, meta);
  } else {
    await record({ key: source, source, ...meta });
    return { segments: 1 };
  }
}

/**
 * Write an uploaded payload.
 *
 * The file picker sends a data URL (FileReader.readAsDataURL); the text box sends
 * the text itself. Treating both as base64 meant typed text was base64-*decoded*
 * into a few bytes of binary — "Hello there" became 7 unreadable bytes — which then
 * rendered as garbage in the text player.
 */
export async function writePayload(source, payload) {
  if (typeof payload !== "string") throw new Error("upload: payload must be a string");

  if (!payload.startsWith("data:")) {
    // Plain text straight from the text box.
    await fs.writeFile(source, payload, "utf8");
    return;
  }

  const comma = payload.indexOf(",");
  if (comma === -1) throw new Error("upload: malformed data URL");

  const header = payload.slice(0, comma);
  const body = payload.slice(comma + 1);

  if (header.includes(";base64")) {
    await fs.writeFile(source, body, { encoding: "base64" });
  } else {
    // data:text/plain,Hello%20there — percent-encoded, not base64.
    await fs.writeFile(source, decodeURIComponent(body), "utf8");
  }
}

async function uploadVideo(source, meta) {
  const segments = await segment(source);
  console.log("upload: segmented into", segments.length, "parts");

  const keys = [];
  for (const seg of segments) {
    await record({
      key: seg,
      source: seg,
      name: path.basename(seg),
      type: "video/mp4",
    });
    keys.push(seg);
  }

  for (let i = 0; i < keys.length - 1; i++) {
    await connect({
      from: keys[i],
      to: keys[i + 1],
      type: "sequence",
      weight: 1.0,
    });
  }

  await fs.unlink(source);
  console.log("upload: original removed", source);
  return { segments: keys.length };
}

export default upload;