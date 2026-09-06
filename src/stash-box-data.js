import { open, stat } from "node:fs/promises";
import path from "node:path";
import { loadManifest, root } from "./manifests.js";

const oshashChunkSize = 64 * 1024;
const uint64Mask = 0xffffffffffffffffn;

export function slugify(value) {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export async function calculateOshash(filename) {
  const { size } = await stat(filename);
  if (size < oshashChunkSize * 2) {
    throw new Error(`Cannot calculate OSHASH for ${filename}: file must be at least ${oshashChunkSize * 2} bytes`);
  }

  const first = Buffer.allocUnsafe(oshashChunkSize);
  const last = Buffer.allocUnsafe(oshashChunkSize);
  const handle = await open(filename, "r");
  try {
    await handle.read(first, 0, first.length, 0);
    await handle.read(last, 0, last.length, size - last.length);
  } finally {
    await handle.close();
  }

  let hash = BigInt(size);
  for (const chunk of [first, last]) {
    for (let offset = 0; offset < chunk.length; offset += 8) {
      hash = (hash + chunk.readBigUInt64LE(offset)) & uint64Mask;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

async function requireFile(filename, label) {
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`Missing ${label}: ${filename}. Run \`npm run build\` first or provide --library.`);
  }
}

function assetUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
}

function assertUniqueIds(items, label) {
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new Error(`${label} generated duplicate stable IDs`);
  }
}

export async function createStashBoxData(options = {}) {
  const library = path.resolve(options.library ?? path.join(root, "output", "library"));
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:9998";
  const manifest = options.manifest ?? await loadManifest();
  const assets = new Map();

  const performers = [];
  for (const performer of manifest.performers) {
    const pathname = `/assets/performers/${encodeURIComponent(performer.slug)}/portrait.jpg`;
    const filename = path.join(library, "performers", performer.slug, "portrait.jpg");
    await requireFile(filename, `performer portrait for ${performer.name}`);
    assets.set(pathname, filename);
    performers.push({
      id: `performer-${performer.slug}`,
      name: performer.name,
      disambiguation: performer.disambiguation ?? "",
      aliases: [],
      gender: ({ Male: "MALE", Female: "FEMALE", TransgenderMale: "TRANSGENDER_MALE", TransgenderFemale: "TRANSGENDER_FEMALE", NonBinary: "NON_BINARY", Intersex: "INTERSEX" })[performer.gender],
      deleted: false,
      merged_into_id: null,
      urls: [],
      images: [{ url: assetUrl(baseUrl, pathname) }],
      birth_date: performer.birth_date,
      death_date: null,
      ethnicity: null,
      country: performer.country,
      eye_color: null,
      hair_color: null,
      height: null,
      measurements: null,
      breast_type: null,
      career_start_year: performer.career_start_year ?? null,
      career_end_year: performer.career_end_year ?? null,
      tattoos: [],
      piercings: [],
    });
  }

  const tags = manifest.tags.map((name) => ({
    id: `tag-${slugify(name)}`,
    name,
    description: "A fictional demo catalog topic",
    aliases: [],
  }));
  const studios = manifest.studios.map(({ name }) => ({
    id: `studio-${slugify(name)}`,
    name,
    aliases: [],
    urls: [],
    images: [],
    parent: null,
  }));

  const performersByName = new Map(performers.map((item) => [item.name, item]));
  const tagsByName = new Map(tags.map((item) => [item.name, item]));
  const studiosByName = new Map(studios.map((item) => [item.name, item]));
  for (const studioInput of manifest.studios) {
    if (studioInput.parent) studiosByName.get(studioInput.name).parent = studiosByName.get(studioInput.parent);
  }

  const scenes = [];
  for (const [offset, video] of manifest.videos.entries()) {
    const filename = path.join(library, video.slug, `${video.slug}.mp4`);
    const posterPathname = `/assets/videos/${encodeURIComponent(video.slug)}/poster.jpg`;
    const posterFilename = path.join(library, video.slug, "poster.jpg");
    await requireFile(filename, `video for ${video.title}`);
    await requireFile(posterFilename, `poster for ${video.title}`);
    assets.set(posterPathname, posterFilename);
    scenes.push({
      id: `scene-${video.slug}`,
      title: video.title,
      code: `BDP-${String(offset + 1).padStart(2, "0")}`,
      details: video.details,
      director: video.director ?? null,
      duration: video.preview_duration_seconds,
      date: video.date,
      urls: [],
      images: [{ url: assetUrl(baseUrl, posterPathname) }],
      studio: studiosByName.get(video.studio),
      tags: video.tags.map((name) => tagsByName.get(name)),
      performers: video.performers.map((name) => ({ performer: performersByName.get(name) })),
      fingerprints: [{ algorithm: "OSHASH", hash: await calculateOshash(filename), duration: video.preview_duration_seconds }],
    });
  }

  for (const [items, label] of [[performers, "performers"], [tags, "tags"], [studios, "studios"], [scenes, "scenes"]]) {
    assertUniqueIds(items, label);
  }

  return { assets, performers, scenes, studios, tags };
}
