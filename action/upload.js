const fs = require("fs").promises;
const path = require("path");
const record = require("./record.js");
const segment = require("./segment.js");
const connect = require("./connect.js");

async function upload(data) {
  console.log("upload: video uploaded!!", data);
  if (typeof data === "string") data = JSON.parse(data);

  const { meta, data: payload } = data;
  if (!meta?.name) throw new Error("upload: missing meta.name");

  const base64 = payload.split(";base64,").pop();
  const source = "data/" + meta.name;

  await fs.writeFile(source, base64, { encoding: "base64" });
  console.log("upload: file written to", source);

  if (meta.type?.includes("video")) {
    return await uploadVideo(source, meta);
  } else {
    await record({ key: source, source, ...meta });
    return { segments: 1 };
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

module.exports = upload;
