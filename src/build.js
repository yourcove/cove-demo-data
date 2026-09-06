#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, appendFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import archiver from "archiver";
import { assetDirectory, assetSlug, galleriesFor, loadManifest, manifestDirectory, root } from "./manifests.js";

const stableDate = new Date("2020-01-01T00:00:00Z");
const recognizedDatasets = new Set(["Barely Dressed Pictures Fictional Archive", "Earth Science and Human Spaceflight Archive"]);

export async function exists(filename) { try { await access(filename); return true; } catch { return false; } }

export async function digest(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function imageDimensions(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filename], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      const [width, height] = output.trim().split(",").map(Number);
      if (code || !Number.isInteger(width) || !Number.isInteger(height)) reject(new Error(`Could not read poster dimensions for ${filename}: ${error.trim() || "missing image dimensions"}`));
      else resolve({ width, height });
    });
  });
}

export async function validatePosterDimensions(manifest, posterDirectory = path.join(assetDirectory, "posters")) {
  for (const video of manifest.videos) {
    const filename = path.join(posterDirectory, video.poster);
    const { width, height } = await imageDimensions(filename);
    if (width * 9 !== height * 16) throw new Error(`Movie poster ${video.poster} must be 16:9; found ${width}x${height}`);
  }
}

async function deterministicZip(filename, entries) {
  await mkdir(path.dirname(filename), { recursive: true });
  await new Promise((resolve, reject) => {
    const output = createWriteStream(filename);
    const archive = archiver("zip", { zlib: { level: 9 }, forceLocalTime: false });
    output.once("close", resolve); output.once("error", reject); archive.once("error", reject); archive.pipe(output);
    for (const entry of entries) archive.append(entry.data ?? createReadStream(entry.path), { name: entry.name, date: stableDate, mode: 0o644 });
    archive.finalize();
  });
}

function escapePdf(value) { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }

async function writePdf(filename, title, subject) {
  const lines = [title, "", subject, "", "Fictional production record generated for the Cove demo dataset."];
  const commands = ["BT", "/F1 18 Tf", "72 720 Td"];
  lines.forEach((line, index) => commands.push(index ? "0 -28 Td" : "", `(${escapePdf(line)}) Tj`)); commands.push("ET");
  const stream = commands.filter(Boolean).join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(filename, pdf);
}

export async function performerPhotoSetSources(performer) {
  const sources = (performer.photos ?? []).map(photo => path.join("assets", "performer-photo-sets", performer.slug, photo.filename));
  for (const source of sources) if (!await exists(path.join(root, source))) throw new Error(`Missing declared performer photo: ${source}`);
  return sources;
}

export async function writePerformer(target, performer) {
  const directory = path.join(target, "performers", performer.slug); await mkdir(directory, { recursive: true });
  const source = path.join(assetDirectory, "performers", `${performer.slug}.jpg`);
  const portraitSource = path.join(assetDirectory, "performer-portraits", `${performer.slug}.jpg`);
  await cp(source, path.join(directory, "reference.jpg"));
  const photos = await performerPhotoSetSources(performer);
  if (photos.length) {
    const photoDirectory = path.join(directory, "photos"); await mkdir(photoDirectory, { recursive: true });
    for (const photo of photos) await cp(path.join(root, photo), path.join(photoDirectory, path.basename(photo)));
  }
  const hasPortrait = await exists(portraitSource);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", hasPortrait ? portraitSource : source, "-vf", hasPortrait ? "scale=800:800:force_original_aspect_ratio=increase,crop=800:800" : "crop=ih:ih:(iw-ih)/2:0,scale=800:800", "-q:v", "4", "-map_metadata", "-1", path.join(directory, "portrait.jpg")]);
  await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(performer, null, 2)}\n`);
  await writeFile(path.join(directory, "about.txt"), `${performer.name}\n\n${performer.details}\n\nThis character and artwork are fictional and AI-generated.\n`);
}

async function writeStudio(target, studio) {
  const slug = assetSlug(studio.name);
  const directory = path.join(target, "studios", slug); await mkdir(directory, { recursive: true });
  await cp(path.join(assetDirectory, "studio-logos", `${slug}.jpg`), path.join(directory, "logo.jpg"));
}

async function writeAudioSource(source, target) {
  const filename = path.join(root, source);
  if (path.extname(source).toLowerCase() === ".mp3") await cp(filename, target);
  else await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", filename, "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", target]);
}

export function videoArtworkSource(video) {
  return path.join(assetDirectory, "posters", video.poster);
}

export async function ensureMinimumMp4Size(filename, minimumSize = 128 * 1024) {
  const { size } = await stat(filename); if (size >= minimumSize) return size;
  const atomSize = Math.max(8, minimumSize - size); const freeAtom = Buffer.alloc(atomSize);
  freeAtom.writeUInt32BE(atomSize, 0); freeAtom.write("free", 4, "ascii"); await appendFile(filename, freeAtom);
  return size + atomSize;
}

export async function writeVideo(target, video, index) {
  const directory = path.join(target, video.slug); await mkdir(directory, { recursive: true });
  const visual = videoArtworkSource(video);
  await cp(visual, path.join(directory, "poster.jpg"));
  const fit = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x18131f";
  const duration = video.preview_duration_seconds;
  const frequency = String(180 + index * 13);
  const videoFilename = path.join(directory, `${video.slug}.mp4`);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", visual, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-t", String(duration), "-vf", fit, "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-map_metadata", "-1", "-movflags", "+faststart", videoFilename]);
  await ensureMinimumMp4Size(videoFilename);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", visual, "-vf", fit, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", path.join(directory, "still-01.jpg")]);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", visual, "-vf", `${fit},eq=brightness=0.035:saturation=0.9`, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", path.join(directory, "still-02.jpg")]);
  if (video.audio.source) await writeAudioSource(video.audio.source, path.join(directory, "score-preview.mp3"));
  else await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=30`, "-af", "volume=0.12", "-c:a", "libmp3lame", "-b:a", "96k", "-map_metadata", "-1", path.join(directory, "score-preview.mp3")]);
  if (video.audio.cover) await cp(path.join(root, video.audio.cover), path.join(directory, "score-cover.jpg"));
  else await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", visual, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=1`, "-filter_complex", "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=4:1,drawbox=color=black@0.48:t=fill[bg];[1:a]showwavespic=s=1040x220:colors=0xffd166[wave];[bg][wave]overlay=(W-w)/2:(H-h)/2", "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", path.join(directory, "score-cover.jpg")]);
  const metadata = { ...video, code: `BDP-${String(index + 1).padStart(2, "0")}`, fictional: true, artwork: "AI-generated", art_preview: true, preview_notice: "Silent poster-based art preview; not feature-film footage." };
  await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(path.join(directory, "production-notes.md"), `# ${video.text.title ?? video.title + ": Production Notes"}\n\n${video.text.content ?? video.text.details}\n\n**Document subjects:** ${video.text.performers.join(", ")}\n\n**Production:** ${video.date} · ${video.studio}\n\nThis document and its subjects are fictional.\n`);
  const captionEnd = `00:00:${String(duration - 1).padStart(2, "0")}`;
  await writeFile(path.join(directory, `${video.slug}.srt`), `1\n00:00:00,000 --> ${captionEnd},500\n${video.title} — silent art preview\n`);
  await writeFile(path.join(directory, `${video.slug}.vtt`), `WEBVTT\n\n00:00.000 --> ${captionEnd}.500\n${video.title} — silent art preview\n`);
  await writeFile(path.join(directory, "cast.csv"), `performer,role\n${video.performers.map((name) => `"${name}","Cast"`).join("\n")}\n`);
  await writePdf(path.join(directory, "production-brief.pdf"), video.title, `${video.genre} from ${video.studio}.`);
  if (index % 5 === 0) await deterministicZip(path.join(directory, "Press Kit.zip"), [{ name: "metadata.json", path: path.join(directory, "metadata.json") }, { name: "cast.csv", path: path.join(directory, "cast.csv") }]);
}

async function writeStandaloneMedia(target, manifest) {
  for (const audio of manifest.standalone_audios ?? []) {
    const directory = path.join(target, "extras", "audios"); await mkdir(directory, { recursive: true });
    await writeAudioSource(audio.source, path.join(directory, `${audio.slug}.mp3`));
    if (audio.cover) await cp(path.join(root, audio.cover), path.join(directory, `${audio.slug}-cover.jpg`));
  }
  for (const text of manifest.standalone_texts ?? []) {
    const directory = path.join(target, "extras", "texts"); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${text.slug}.md`), `${text.content.trim()}\n`);
    if (text.cover) await cp(path.join(root, text.cover), path.join(directory, `${text.slug}-cover.jpg`));
  }
}

async function writeGallery(target, gallery) {
  const entries = gallery.videos.map((video, index) => ({ name: `${String(index + 1).padStart(2, "0")}-${video.slug}.jpg`, path: path.join(assetDirectory, "posters", video.poster) }));
  entries.push({ name: "metadata.json", data: `${JSON.stringify({ title: gallery.title ?? gallery.name, archive_key: gallery.decade, release_dates: gallery.videos.map(video => video.date), films: gallery.videos.map(({ title }) => title), fictional: true }, null, 2)}\n` });
  await deterministicZip(path.join(target, "galleries", `${gallery.decade} - Feature Posters.zip`), entries);
}

async function walk(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isDirectory()) results.push(...await walk(filename)); else results.push(filename); }
  return results;
}

export async function validateDistinctAssets(library, manifest) {
  const posters = new Set(); const covers = new Set(); const audioAndTextArtwork = new Set(); const studioLogos = new Set(); const performerArtwork = new Set();
  for (const performer of manifest.performers ?? []) {
    for (const asset of ["reference.jpg", "portrait.jpg", ...(performer.photos ?? []).map(photo => `photos/${photo.filename}`)]) performerArtwork.add(await digest(path.join(library, "performers", performer.slug, asset)));
    const canonical = path.join(assetDirectory, "performers", `${performer.slug}.jpg`);
    if (await digest(path.join(library, "performers", performer.slug, "reference.jpg")) !== await digest(canonical)) throw new Error(`Character reference must retain canonical source: ${performer.slug}`);
  }
  for (const video of manifest.videos) {
    posters.add(await digest(path.join(library, video.slug, "poster.jpg")));
    const cover = await digest(path.join(library, video.slug, "score-cover.jpg")); covers.add(cover); audioAndTextArtwork.add(cover);
  }
  for (const audio of manifest.standalone_audios ?? []) if (audio.cover) { const cover = await digest(path.join(library, "extras", "audios", `${audio.slug}-cover.jpg`)); covers.add(cover); audioAndTextArtwork.add(cover); }
  for (const text of manifest.standalone_texts ?? []) if (text.cover) audioAndTextArtwork.add(await digest(path.join(library, "extras", "texts", `${text.slug}-cover.jpg`)));
  for (const studio of manifest.studios) studioLogos.add(await digest(path.join(library, "studios", assetSlug(studio.name), "logo.jpg")));
  if (posters.size !== manifest.videos.length) throw new Error("Movie posters must be unique");
  if (covers.size !== manifest.videos.length + (manifest.standalone_audios ?? []).filter(({ cover }) => cover).length) throw new Error("Audio covers must be unique");
  if (studioLogos.size !== manifest.studios.length) throw new Error("Studio logos must be unique");
  if ([...studioLogos].some((hash) => posters.has(hash) || audioAndTextArtwork.has(hash) || performerArtwork.has(hash))) throw new Error("Studio logos must not reuse movie, audio or performer artwork");
}

export async function sourceArtworkInventory(manifest) {
  const sources = manifest.performers.map((performer) => path.join("assets", "performers", `${performer.slug}.jpg`));
  sources.push(...(manifest.studios ?? []).map((studio) => path.join("assets", "studio-logos", `${assetSlug(studio.name)}.jpg`)));
  for (const performer of manifest.performers) {
    const portrait = path.join("assets", "performer-portraits", `${performer.slug}.jpg`);
    if (await exists(path.join(root, portrait))) sources.push(portrait);
    sources.push(...await performerPhotoSetSources(performer));
  }
  for (const video of manifest.videos) {
    sources.push(path.join("assets", "posters", video.poster));
    if (video.audio.source) sources.push(video.audio.source);
    if (video.audio.cover) sources.push(video.audio.cover);
  }
  for (const audio of manifest.standalone_audios ?? []) { sources.push(audio.source); if (audio.cover) sources.push(audio.cover); }
  for (const text of manifest.standalone_texts ?? []) if (text.cover) sources.push(text.cover);
  return Object.fromEntries(await Promise.all([...new Set(sources)].sort().map(async (relative) => [relative, await digest(path.join(root, relative))])));
}

export async function build({ output }) {
  const manifest = await loadManifest(); await validatePosterDimensions(manifest); await mkdir(path.dirname(output), { recursive: true });
  if (await exists(output) && (await readdir(output)).length) {
    try { const marker = JSON.parse(await readFile(path.join(output, ".cove-demo-dataset"), "utf8")); if (!recognizedDatasets.has(marker.name)) throw new Error(); }
    catch { throw new Error(`Refusing to replace non-demo output directory: ${output}`); }
  }
  const target = await mkdtemp(path.join(path.dirname(output), `.${path.basename(output)}-staging-`));
  try {
    await writeFile(path.join(target, ".cove-demo-dataset"), `${JSON.stringify({ name: manifest.name, schema_version: manifest.schema_version, source_artwork_sha256: await sourceArtworkInventory(manifest) })}\n`);
    for (const performer of manifest.performers) await writePerformer(target, performer);
    for (const studio of manifest.studios) await writeStudio(target, studio);
    for (const [index, video] of manifest.videos.entries()) await writeVideo(target, video, index);
    await writeStandaloneMedia(target, manifest);
    for (const gallery of galleriesFor(manifest)) await writeGallery(target, gallery);
    await validateDistinctAssets(target, manifest);
    await cp(path.join(manifestDirectory, "manifest.json"), path.join(target, "manifest.json"));
    const inventory = [];
    for (const filename of (await walk(target)).sort()) if (![".cove-demo-dataset", "checksums.sha256", "manifest.json"].includes(path.basename(filename))) inventory.push(`${await digest(filename)}  ${path.relative(target, filename)}`);
    await writeFile(path.join(target, "checksums.sha256"), `${inventory.join("\n")}\n`);
    const previous = `${output}.previous-${Date.now()}`; if (await exists(output)) await rename(output, previous);
    try { await rename(target, output); } catch (error) { if (await exists(previous)) await rename(previous, output); throw error; }
    if (await exists(previous)) await rm(previous, { recursive: true, force: true });
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}

function argumentsFrom(argv) {
  const options = { output: path.join(root, "output", "library") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.output = path.resolve(argv[++index]);
    else if (argv[index] === "--cache") index += 1;
    else if (argv[index] !== "--skip-metadata-verification") throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) build(argumentsFrom(process.argv.slice(2))).then(() => console.log("Demo dataset build completed.")).catch((error) => { console.error(error); process.exitCode = 1; });
