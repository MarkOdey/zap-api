const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

async function segment(sourcePath, segmentDuration = 30) {
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  const dir = path.dirname(sourcePath);
  const pattern = path.join(dir, `${base}_seg_%03d.mp4`);

  console.log("Segmenting video:", sourcePath);

  await new Promise((resolve, reject) => {
    const cmd = spawn("ffmpeg", [
      "-i",
      sourcePath,
      "-c",
      "copy",
      "-f",
      "segment",
      "-segment_time",
      String(segmentDuration),
      "-reset_timestamps",
      "1",
      "-y",
      pattern,
    ]);

    cmd.stderr.on("data", (d) => console.log("ffmpeg:", String(d).trim()));
    cmd.on("error", reject);
    cmd.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`ffmpeg segment exited with code ${code}`));
      else resolve();
    });
  });

  const prefix = `${base}_seg_`;
  const entries = await fs.readdir(dir);
  const segments = entries
    .filter((f) => f.startsWith(prefix) && f.endsWith(".mp4"))
    .sort()
    .map((f) => path.join(dir, f));

  if (segments.length === 0) {
    throw new Error(
      `segment: ffmpeg produced no output segments for ${sourcePath}`
    );
  }

  return segments;
}

module.exports = segment;
