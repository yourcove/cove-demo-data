import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { writeVideo } from "../src/build.js";
import { loadManifest, validateManifest } from "../src/manifests.js";
import { calculateOshash } from "../src/stash-box-data.js";

const execute = promisify(execFile);
const mutate = (manifest, action) => { const copy = structuredClone(manifest); action(copy); return copy; };

test("video art previews use explicit, plausibly varied short durations", async () => {
  const manifest = await loadManifest(); const durations = manifest.videos.map(({ preview_duration_seconds }) => preview_duration_seconds);
  assert.equal(durations.every((duration) => Number.isInteger(duration) && duration >= 8 && duration <= 20), true);
  assert.ok(new Set(durations).size >= 5);
  assert.ok(Math.max(...Object.values(Object.groupBy(durations, String)).map(({ length }) => length)) <= Math.ceil(durations.length / 4));
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { delete copy.videos[0].preview_duration_seconds; })), /preview durations must be whole seconds/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { for (const video of copy.videos) video.preview_duration_seconds = 12; })), /must vary without a dominant repeated length/);
});

test("a short built video art preview is OSHASH-compatible with its authored duration and a silent AAC track", async () => {
  const manifest = await loadManifest(); const index = manifest.videos.findIndex(({ slug }) => slug === "dangerously-overdressed"); const video = manifest.videos[index]; const target = await mkdtemp(path.join(os.tmpdir(), "cove-video-preview-"));
  await writeVideo(target, video, index);
  const filename = path.join(target, video.slug, `${video.slug}.mp4`);
  assert.ok((await stat(filename)).size >= 128 * 1024); assert.match(await calculateOshash(filename), /^[0-9a-f]{16}$/);
  const probe = JSON.parse((await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name", "-of", "json", filename])).stdout);
  assert.ok(Math.abs(Number(probe.format.duration) - video.preview_duration_seconds) < 0.1);
  assert.deepEqual(probe.streams.map(({ codec_type }) => codec_type).sort(), ["audio", "video"]);
  assert.equal(probe.streams.find(({ codec_type }) => codec_type === "audio").codec_name, "aac");
  const volume = (await execute("ffmpeg", ["-hide_banner", "-i", filename, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])).stderr;
  const maximum = volume.match(/max_volume:\s+(-?\d+(?:\.\d+)?) dB/); assert.ok(maximum, volume); assert.ok(Number(maximum[1]) <= -90, maximum[0]);
  const metadata = JSON.parse(await readFile(path.join(target, video.slug, "metadata.json"), "utf8")); assert.equal(metadata.art_preview, true); assert.match(metadata.preview_notice, /not feature-film footage/i);
  assert.match(await readFile(path.join(target, video.slug, `${video.slug}.vtt`), "utf8"), new RegExp(`00:00:${String(video.preview_duration_seconds - 1).padStart(2, "0")}\\.500`));
});
