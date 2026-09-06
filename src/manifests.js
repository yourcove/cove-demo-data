import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageOnDate, parseExactDate } from "./dates.js";
import { supportedCountryCodeSet, supportedGenderSet } from "./performer-values.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const manifestDirectory = path.join(root, "manifests");
export const assetDirectory = path.join(root, "assets");
export const entityTypes = ["videos", "images", "audios", "texts", "studios", "performers", "collections", "tags", "galleries"];

export function assetSlug(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

export async function readJson(filename) {
  return JSON.parse(await readFile(path.join(manifestDirectory, filename), "utf8"));
}

function fail(errors) {
  if (errors.length) throw new Error(`Invalid demo manifest:\n- ${errors.join("\n- ")}`);
}

export function galleriesFor(manifest) {
  return manifest.collections.map((collection) => ({
    ...collection,
    videos: manifest.videos.filter((video) => video.collection === collection.name),
  }));
}

export function audiosFor(manifest) {
  const derivatives = manifest.videos.map((video, index) => ({
    ...video.audio,
    code: video.audio?.code ?? `BDP-AUD-${String(index + 1).padStart(2, "0")}`,
    id: index + 1,
    slug: video.slug,
    studio: Object.hasOwn(video.audio ?? {}, "studio") ? video.audio.studio : video.studio,
    output_path: `${video.slug}/score-preview.mp3`,
    cover_output_path: `${video.slug}/score-cover.jpg`,
    video,
    standalone: false,
  }));
  return [...derivatives, ...(manifest.standalone_audios ?? []).map((audio) => ({
    ...audio,
    output_path: `extras/audios/${audio.slug}.mp3`,
    cover_output_path: audio.cover ? `extras/audios/${audio.slug}-cover.jpg` : null,
    standalone: true,
  }))];
}

export function textsFor(manifest) {
  const derivatives = manifest.videos.map((video, index) => ({
    ...video.text,
    code: video.text?.code ?? `BDP-TXT-${String(index + 1).padStart(2, "0")}`,
    id: index + 1,
    slug: video.slug,
    studio: Object.hasOwn(video.text ?? {}, "studio") ? video.text.studio : video.studio,
    output_path: `${video.slug}/production-notes.md`,
    cover_output_path: `${video.slug}/poster.jpg`,
    video,
    standalone: false,
  }));
  return [...derivatives, ...(manifest.standalone_texts ?? []).map((text) => ({
    ...text,
    output_path: `extras/texts/${text.slug}.md`,
    cover_output_path: text.cover ? `extras/texts/${text.slug}-cover.jpg` : null,
    standalone: true,
  }))];
}

export function standaloneGalleriesFor(manifest) {
  return manifest.standalone_galleries ?? [];
}

export function performerPhotosFor(manifest) {
  return manifest.performers.flatMap((performer) => (performer.photos ?? []).map((photo) => ({ ...photo, performer })));
}

const legacyPerformerPhotos = new Map([
  ["1961-04-12-debut-publicity.jpg", { code: "BDP-IMG-26", id: 51 }],
  ["1964-07-18-resort-editorial.jpg", { code: "BDP-IMG-27", id: 52 }],
  ["1967-09-06-on-set-candid.jpg", { code: "BDP-IMG-28", id: 53 }],
  ["1969-11-03-premiere-arrival.jpg", { code: "BDP-IMG-29", id: 54 }],
]);
const canonicalTags = ["1980s", "1990s", "2000s", "2010s", "2020s", "Comedy", "Mystery", "Drama", "Romance", "Caper", "Thriller", "Workplace", "Backstage", "Music", "Generated Artwork"];
function relationshipNames(record, fallback = []) { return record?.performers ?? fallback; }
function distribution(values) { return Object.fromEntries([...new Set(values)].sort((left, right) => left - right).map((value) => [value, values.filter((item) => item === value).length])); }
function samePrefix(values, prefix) { return values.length >= prefix.length && prefix.every((value, index) => values[index] === value); }
function isProjectAsset(value, prefix, extension) {
  const extensions = Array.isArray(extension) ? extension : [extension];
  return typeof value === "string" && value.startsWith(prefix) && extensions.some((suffix) => value.endsWith(suffix)) && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}
function validateAppendIdentities(records, kind, start, errors) {
  const ids = records.map(({ id }) => id).sort((left, right) => left - right);
  const expected = Array.from({ length: records.length }, (_, index) => start + index);
  if (!ids.every((id, index) => id === expected[index])) errors.push(`${kind}: IDs must be the contiguous append-only range starting at ${start}`);
  for (const record of records) {
    const prefix = kind === "galleries" ? "GAL" : kind === "audios" ? "AUD" : "TXT";
    if (record.code !== `BDP-${prefix}-${String(record.id).padStart(2, "0")}`) errors.push(`${record.slug ?? record.code}: ${kind} code must match explicit ID ${record.id}`);
  }
}

export function performerMediaMatrix(manifest) {
  const audioRecords = audiosFor(manifest);
  const textRecords = textsFor(manifest);
  const standaloneGalleries = standaloneGalleriesFor(manifest);
  return manifest.performers.map((performer) => {
    const videos = manifest.videos.filter((video) => video.performers.includes(performer.name));
    const photos = performerPhotosFor(manifest).filter((photo) => relationshipNames(photo, [photo.performer.name]).includes(performer.name));
    const galleryImages = manifest.videos.filter((video) => video.image_performers.includes(performer.name));
    const images = 1 + photos.length + galleryImages.length;
    const galleries = [
      ...galleriesFor(manifest).filter((gallery) => gallery.videos.some((video) => video.image_performers.includes(performer.name))),
      ...standaloneGalleries.filter((gallery) => gallery.performers.includes(performer.name)),
    ];
    const audios = audioRecords.filter((audio) => audio.performers.includes(performer.name));
    const texts = textRecords.filter((text) => text.performers.includes(performer.name));
    const groups = new Set([...videos.map((video) => video.collection), ...photos.flatMap((photo) => photo.collection ?? [])]);
    const studios = new Set([performer.reference_studio, ...videos.map((video) => video.studio), ...audios.map((audio) => audio.studio), ...texts.map((text) => text.studio), ...photos.map((photo) => photo.studio), ...galleries.map((gallery) => Object.hasOwn(gallery, "studio") ? gallery.studio : gallery.videos?.[0]?.studio)].filter(Boolean));
    const tags = new Set([...(performer.tags ?? []), ...(performer.reference_tags ?? []), ...videos.flatMap((video) => video.tags), ...audios.flatMap((audio) => audio.tags), ...texts.flatMap((text) => text.tags), ...photos.flatMap((photo) => photo.tags ?? []), ...galleries.flatMap((gallery) => gallery.tags ?? [])]);
    return { performer: performer.name, videos: videos.length, images, galleries: galleries.length, audios: audios.length, texts: texts.length, groups: groups.size, studios: studios.size, tags: tags.size };
  });
}

export function performerMediaDistributions(manifest) {
  const matrix = performerMediaMatrix(manifest); return Object.fromEntries(["videos", "images", "galleries", "audios", "texts", "groups", "studios", "tags"].map((field) => [field, distribution(matrix.map((row) => row[field]))]));
}

export function tagHierarchy(manifest) {
  const parentsByName = new Map((manifest.tags ?? []).map((name) => [name, []]));
  const childrenByName = new Map((manifest.tags ?? []).map((name) => [name, []]));
  const edges = [];
  const relations = Array.isArray(manifest.tag_hierarchy) ? manifest.tag_hierarchy : [];
  for (const relation of relations) {
    if (relation == null || typeof relation !== "object") continue;
    const children = Array.isArray(relation.children) ? relation.children : [];
    for (const child of children) {
      edges.push({ parent: relation.parent, child });
      if (childrenByName.has(relation.parent)) childrenByName.get(relation.parent).push(child);
      if (parentsByName.has(child)) parentsByName.get(child).push(relation.parent);
    }
  }
  return { parentsByName, childrenByName, edges };
}

export function validateManifest(manifest) {
  const errors = [];
  const derivedCounts = { images: (manifest.performers?.length ?? 0) + performerPhotosFor(manifest).length, audios: audiosFor(manifest).length, texts: textsFor(manifest).length, galleries: manifest.collections.length + standaloneGalleriesFor(manifest).length };
  for (const type of entityTypes) {
    const count = derivedCounts[type] ?? manifest[type]?.length;
    if (manifest.expected_counts?.[type] !== count) errors.push(`${type}: expected ${manifest.expected_counts?.[type]}, found ${count}`);
  }
  const unique = (values, label) => { if (new Set(values).size !== values.length) errors.push(`${label} must be unique`); };
  unique(manifest.studios.map(({ name }) => name), "studio names");
  unique(manifest.performers.map(({ name }) => name), "performer names");
  unique(manifest.performers.map(({ slug }) => slug), "performer slugs");
  unique(manifest.collections.map(({ name }) => name), "collection names");
  unique(manifest.collections.map(({ title, name }) => title ?? name), "collection display titles");
  unique(manifest.tags, "tags");
  if (!samePrefix(manifest.tags, canonicalTags)) errors.push("canonical tags must remain the unchanged first 15 entries");
  if (!Number.isInteger(manifest.canonical_tag_count) || manifest.canonical_tag_count !== canonicalTags.length || manifest.canonical_tag_count > manifest.tags.length) errors.push(`canonical_tag_count must preserve the ${canonicalTags.length} canonical tags`);
  const hierarchy = tagHierarchy(manifest); const hierarchyEdges = hierarchy.edges.map(({ parent, child }) => `${parent}\0${child}`);
  if (!Array.isArray(manifest.tag_hierarchy)) errors.push("tag_hierarchy must be an array");
  for (const relation of Array.isArray(manifest.tag_hierarchy) ? manifest.tag_hierarchy : []) {
    if (relation == null || typeof relation !== "object") { errors.push("tag hierarchy entries must be objects"); continue; }
    if (!manifest.tags.includes(relation.parent)) errors.push(`tag hierarchy: unknown parent tag ${relation.parent}`);
    if (!Array.isArray(relation.children)) { errors.push(`tag hierarchy ${relation.parent}: children must be an array`); continue; }
    for (const child of relation.children) {
      if (!manifest.tags.includes(child)) errors.push(`tag hierarchy: unknown child tag ${child}`);
      if (child === relation.parent) errors.push(`tag hierarchy: ${child} cannot parent itself`);
    }
  }
  if (new Set(hierarchyEdges).size !== hierarchyEdges.length) errors.push("tag hierarchy edges must be unique");
  for (const [name, description] of Object.entries(manifest.tag_descriptions ?? {})) {
    if (!manifest.tags.includes(name)) errors.push(`tag descriptions: unknown tag ${name}`);
    if (typeof description !== "string" || !description.trim()) errors.push(`tag descriptions: ${name} must have a description`);
  }
  const visiting = new Set(); const visited = new Set();
  const visitsCycle = (name) => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    for (const child of hierarchy.childrenByName.get(name) ?? []) if (hierarchy.childrenByName.has(child) && visitsCycle(child)) return true;
    visiting.delete(name); visited.add(name); return false;
  };
  if (manifest.tags.some((name) => visitsCycle(name))) errors.push("tag hierarchy must be acyclic");
  const roots = manifest.tags.filter((name) => (hierarchy.parentsByName.get(name) ?? []).length === 0);
  if (roots.length !== 1 || hierarchy.edges.length !== manifest.tags.length - 1 || manifest.tags.some((name) => name !== roots[0] && hierarchy.parentsByName.get(name)?.length !== 1)) errors.push("tag hierarchy must connect every tag beneath one root");
  unique(manifest.videos.map(({ slug }) => slug), "video slugs");
  const names = {
    studios: new Set(manifest.studios.map(({ name }) => name)),
    performers: new Set(manifest.performers.map(({ name }) => name)),
    collections: new Set(manifest.collections.map(({ name }) => name)),
    tags: new Set(manifest.tags),
  };
  const checkTags = (values, label) => {
    if (!Array.isArray(values)) { errors.push(`${label}: tags must be an array`); return; }
    unique(values, `${label} tags`); for (const tag of values) if (!names.tags.has(tag)) errors.push(`${label}: unknown tag ${tag}`);
  };
  for (const studio of manifest.studios) {
    if (!studio.name || !studio.details) errors.push(`${studio.name}: incomplete studio`);
    if (studio.parent && !names.studios.has(studio.parent)) errors.push(`${studio.name}: unknown parent studio`);
    checkTags(studio.tags ?? [], studio.name);
  }
  for (const collection of manifest.collections) {
    if (!collection.name || !collection.title || !collection.description || !Array.isArray(collection.tags)) errors.push(`${collection.name}: incomplete collection`);
    unique(collection.tags ?? [], `${collection.name} tags`);
    for (const tag of collection.tags ?? []) if (!names.tags.has(tag)) errors.push(`${collection.name}: unknown tag ${tag}`);
    if (collection.studio != null && !names.studios.has(collection.studio)) errors.push(`${collection.name}: unknown studio ${collection.studio}`);
  }
  const performersByName = new Map(manifest.performers.map((performer) => [performer.name, performer]));
  const checkPeople = (values, label, date, requireCareer = false) => {
    if (!Array.isArray(values)) { errors.push(`${label}: performers must be an array`); return; }
    unique(values, `${label} performers`);
    for (const name of values) {
      const performer = performersByName.get(name);
      if (!performer) { errors.push(`${label}: unknown performer ${name}`); continue; }
      try {
        const age = ageOnDate(performer.birth_date, date); if (age < 18 || age > 100) errors.push(`${label}: ${name} has implausible depicted age ${age}`);
        const year = Number(date.slice(0, 4)); if (requireCareer && (year < performer.career_start_year || year > (performer.career_end_year ?? Number.POSITIVE_INFINITY))) errors.push(`${label}: ${name} is outside the authored career range`);
      } catch (error) { errors.push(error.message); }
    }
  };
  const imageCodes = []; const imageIds = [];
  for (const [performerIndex, performer] of manifest.performers.entries()) {
    if (!performer.name || !performer.slug || !performer.details || !performer.birth_date || !performer.country || !performer.gender) errors.push(`${performer.slug}: incomplete performer`);
    if (!supportedCountryCodeSet.has(performer.country)) errors.push(`${performer.slug}: unsupported country ${performer.country}`);
    if (!supportedGenderSet.has(performer.gender)) errors.push(`${performer.slug}: unsupported gender ${performer.gender}`);
    if (!Number.isInteger(performer.career_start_year)) errors.push(`${performer.slug}: career_start_year must be an integer`);
    if (performer.career_end_year != null && (!Number.isInteger(performer.career_end_year) || performer.career_end_year < performer.career_start_year)) errors.push(`${performer.slug}: invalid career_end_year`);
    checkTags(performer.tags ?? [], performer.slug);
    try {
      parseExactDate(performer.birth_date, `${performer.slug} birth_date`);
      if (performer.career_start_year && ageOnDate(performer.birth_date, `${performer.career_start_year}-12-31`) < 18) errors.push(`${performer.slug}: career starts before adulthood`);
    } catch (error) { errors.push(error.message); }
    const referenceCode = performer.reference_code ?? `BDP-IMG-${String(performerIndex + 1).padStart(2, "0")}`; const referenceId = performer.reference_id ?? performerIndex + 1;
    if (referenceCode !== `BDP-IMG-${String(performerIndex + 1).padStart(2, "0")}` || referenceId !== performerIndex + 1) errors.push(`${performer.slug}: canonical reference identity changed`);
    imageCodes.push(referenceCode); imageIds.push(referenceId);
    checkTags(performer.reference_tags ?? [], `${performer.slug} reference`);
    if (performer.reference_studio != null && !names.studios.has(performer.reference_studio)) errors.push(`${performer.slug}: unknown reference studio ${performer.reference_studio}`);
    if (performer.reference_collection != null && !names.collections.has(performer.reference_collection)) errors.push(`${performer.slug}: unknown reference collection ${performer.reference_collection}`);
    if (performer.reference_date != null) { try { parseExactDate(performer.reference_date, `${performer.slug} reference date`); checkPeople([performer.name], `${performer.slug} reference`, performer.reference_date); } catch (error) { errors.push(error.message); } }
    if (performer.portrait_date != null) { try { parseExactDate(performer.portrait_date, `${performer.slug} portrait date`); checkPeople([performer.name], `${performer.slug} portrait`, performer.portrait_date, true); } catch (error) { errors.push(error.message); } }
    const filenames = (performer.photos ?? []).map(({ filename }) => filename);
    unique(filenames, `${performer.slug} photo filenames`);
    for (const photo of performer.photos ?? []) {
      if (!photo.filename?.endsWith(".jpg") || path.basename(photo.filename) !== photo.filename || !photo.title || !photo.details || !/^BDP-IMG-\d{2,}$/.test(photo.code ?? "") || !Number.isInteger(photo.id)) errors.push(`${performer.slug}: incomplete performer photo`);
      const legacy = legacyPerformerPhotos.get(photo.filename);
      if (legacy && (photo.code !== legacy.code || photo.id !== legacy.id)) errors.push(`${performer.slug}/${photo.filename}: canonical photo identity changed`);
      if (!legacy && (Number((photo.code ?? "").split("-").at(-1)) <= 29 || photo.id <= 54)) errors.push(`${performer.slug}/${photo.filename}: new performer photos must append after canonical image identities`);
      imageCodes.push(photo.code); imageIds.push(photo.id);
      checkTags(photo.tags ?? [], `${performer.slug}/${photo.filename}`);
      if (photo.studio != null && !names.studios.has(photo.studio)) errors.push(`${performer.slug}/${photo.filename}: unknown studio ${photo.studio}`);
      if (photo.collection != null && !names.collections.has(photo.collection)) errors.push(`${performer.slug}/${photo.filename}: unknown collection ${photo.collection}`);
      try {
        parseExactDate(photo.date, `${performer.slug}/${photo.filename} date`);
        checkPeople(photo.performers ?? [performer.name], `${performer.slug}/${photo.filename}`, photo.date, true);
      } catch (error) { errors.push(error.message); }
    }
  }
  unique(imageCodes, "performer image codes"); unique(imageIds, "performer image IDs");
  const previewDurations = manifest.videos.map(({ preview_duration_seconds }) => preview_duration_seconds);
  if (previewDurations.some((duration) => !Number.isInteger(duration) || duration < 8 || duration > 20)) errors.push("video preview durations must be whole seconds from 8 through 20");
  if (previewDurations.length >= 10) {
    const frequencies = Object.values(distribution(previewDurations));
    if (new Set(previewDurations).size < 5 || Math.max(...frequencies) > Math.ceil(previewDurations.length / 4)) errors.push("video preview durations must vary without a dominant repeated length");
  }
  for (const video of manifest.videos) {
    if (!video.slug || !video.poster || !video.title || !video.date || !video.details || !video.genre || !video.audio || !video.text || !Array.isArray(video.image_performers)) errors.push(`${video.slug}: incomplete video`);
    if (!names.studios.has(video.studio)) errors.push(`${video.slug}: unknown studio ${video.studio}`);
    if (!names.collections.has(video.collection)) errors.push(`${video.slug}: unknown collection ${video.collection}`);
    try { parseExactDate(video.date, `${video.slug} date`); } catch (error) { errors.push(error.message); }
    checkPeople(video.performers, video.slug, video.date, true); checkTags(video.tags, video.slug);
    checkPeople(video.image_performers, `${video.slug} image`, video.date, true);
    for (const performer of video.image_performers ?? []) if (!video.performers.includes(performer)) errors.push(`${video.slug}: image performer ${performer} is not in the video cast`);
    for (const [kind, record] of [["audio", video.audio], ["text", video.text]]) {
      if (!record?.details) errors.push(`${video.slug}: incomplete ${kind} metadata`);
      const date = record?.date ?? video.date; try { parseExactDate(date, `${video.slug} ${kind} date`); } catch (error) { errors.push(error.message); }
      checkPeople(record?.performers, `${video.slug} ${kind}`, date, kind === "audio"); checkTags(record?.tags, `${video.slug} ${kind}`);
      if (record?.studio != null && !names.studios.has(record.studio)) errors.push(`${video.slug}: unknown ${kind} studio ${record.studio}`);
      if (record?.content != null && typeof record.content !== "string") errors.push(`${video.slug}: ${kind} content must be a string`);
      if (kind === "audio" && record?.source != null && !isProjectAsset(record.source, "assets/production-audio/", [".mp3", ".wav"])) errors.push(`${video.slug}: audio source must be project audio under assets/production-audio`);
      if (kind === "audio" && record?.cover != null && !isProjectAsset(record.cover, "assets/", ".jpg")) errors.push(`${video.slug}: audio cover must be a project JPEG under assets`);
    }
  }
  for (const gallery of galleriesFor(manifest)) if (!gallery.videos.length) errors.push(`${gallery.name}: empty gallery`);

  const standaloneAudios = manifest.standalone_audios ?? [];
  const standaloneTexts = manifest.standalone_texts ?? [];
  const standaloneGalleries = standaloneGalleriesFor(manifest);
  validateAppendIdentities(standaloneAudios, "audios", manifest.videos.length + 1, errors);
  validateAppendIdentities(standaloneTexts, "texts", manifest.videos.length + 1, errors);
  validateAppendIdentities(standaloneGalleries, "galleries", manifest.collections.length + 1, errors);
  unique(audiosFor(manifest).map(({ code }) => code), "audio codes"); unique(audiosFor(manifest).map(({ id }) => id), "audio IDs");
  unique(textsFor(manifest).map(({ code }) => code), "text codes"); unique(textsFor(manifest).map(({ id }) => id), "text IDs");
  unique([...manifest.collections.map((collection, index) => collection.code ?? `BDP-GAL-${String(index + 1).padStart(2, "0")}`), ...standaloneGalleries.map(({ code }) => code)], "gallery codes");
  unique([...manifest.collections.map((_, index) => index + 1), ...standaloneGalleries.map(({ id }) => id)], "gallery IDs");
  const validateStandaloneMedia = (record, kind, requireCareer) => {
    if (!record.slug || !record.code || !Number.isInteger(record.id) || !record.title || !record.date || !record.details || !Object.hasOwn(record, "studio")) errors.push(`${record.slug ?? record.code}: incomplete standalone ${kind}`);
    if (record.studio != null && !names.studios.has(record.studio)) errors.push(`${record.slug}: unknown ${kind} studio ${record.studio}`);
    checkPeople(record.performers, `${record.slug} ${kind}`, record.date, requireCareer); checkTags(record.tags, `${record.slug} ${kind}`);
    try { parseExactDate(record.date, `${record.slug} ${kind} date`); } catch (error) { errors.push(error.message); }
  };
  for (const audio of standaloneAudios) {
    validateStandaloneMedia(audio, "audio", true);
    if (!isProjectAsset(audio.source, "assets/production-audio/", [".mp3", ".wav"])) errors.push(`${audio.slug}: standalone audio source must be project audio under assets/production-audio`);
    if (audio.cover != null && !isProjectAsset(audio.cover, "assets/", ".jpg")) errors.push(`${audio.slug}: standalone audio cover must be a project JPEG under assets`);
  }
  for (const text of standaloneTexts) {
    validateStandaloneMedia(text, "text", false);
    if (typeof text.content !== "string" || !text.content.trim()) errors.push(`${text.slug}: standalone text content is required`);
    if (text.cover != null && !isProjectAsset(text.cover, "assets/", ".jpg")) errors.push(`${text.slug}: standalone text cover must be a project JPEG under assets`);
  }
  const videoSlugs = new Set(manifest.videos.map(({ slug }) => slug)); const knownImageCodes = new Set(imageCodes);
  for (const gallery of standaloneGalleries) {
    if (!gallery.slug || !gallery.code || !Number.isInteger(gallery.id) || !gallery.title || !gallery.date || !gallery.details || !gallery.photographer || !Object.hasOwn(gallery, "studio")) errors.push(`${gallery.slug ?? gallery.code}: incomplete standalone gallery`);
    if (gallery.studio != null && !names.studios.has(gallery.studio)) errors.push(`${gallery.slug}: unknown gallery studio ${gallery.studio}`);
    checkPeople(gallery.performers, `${gallery.slug} gallery`, gallery.date); checkTags(gallery.tags, `${gallery.slug} gallery`);
    try { parseExactDate(gallery.date, `${gallery.slug} gallery date`); } catch (error) { errors.push(error.message); }
    if (!Array.isArray(gallery.image_refs) || !gallery.image_refs.length) errors.push(`${gallery.slug}: standalone gallery image_refs are required`);
    else { unique(gallery.image_refs, `${gallery.slug} gallery image_refs`); for (const code of gallery.image_refs) if (!knownImageCodes.has(code)) errors.push(`${gallery.slug}: unknown image ref ${code}`); }
    if (!Array.isArray(gallery.video_slugs)) errors.push(`${gallery.slug}: gallery video_slugs must be an array`);
    else { unique(gallery.video_slugs, `${gallery.slug} gallery video_slugs`); for (const slug of gallery.video_slugs) if (!videoSlugs.has(slug)) errors.push(`${gallery.slug}: unknown video slug ${slug}`); }
  }
  fail(errors);
  return manifest;
}

export async function loadManifest() {
  return validateManifest(await readJson("manifest.json"));
}

export function expectedIdentityMaps(manifest) {
  const indexed = (values, key, start = 1) => Object.fromEntries(values.map((item, index) => [key(item, index), start + index]));
  const references = Object.fromEntries(manifest.performers.map((performer, index) => [performer.reference_code ?? `BDP-IMG-${String(index + 1).padStart(2, "0")}`, performer.reference_id ?? index + 1]));
  const expectedIds = {
    schema_version: 2,
    built_in_groups: { "Save for Later": 1, "Watch History": 2, "Continue Watching": 3 },
    tags: indexed(manifest.tags, (name) => name),
    studios: indexed(manifest.studios, (studio) => studio.name),
    performers: indexed(manifest.performers, (performer) => performer.name),
    collections: indexed(manifest.collections, (collection) => collection.name, 4),
    videos: indexed(manifest.videos, (video, index) => video.code ?? `BDP-${String(index + 1).padStart(2, "0")}`),
    audios: Object.fromEntries(audiosFor(manifest).map(({ code, id }) => [code, id])),
    texts: Object.fromEntries(textsFor(manifest).map(({ code, id }) => [code, id])),
    images: references,
    galleries: { ...indexed(manifest.collections, (collection, index) => collection.code ?? `BDP-GAL-${String(index + 1).padStart(2, "0")}`), ...Object.fromEntries(standaloneGalleriesFor(manifest).map(({ code, id }) => [code, id])) },
    gallery_images: {},
  };
  let imageId = 26;
  galleriesFor(manifest).forEach((gallery, galleryIndex) => gallery.videos.forEach((video, imageIndex) => {
    const code = gallery.code ?? `BDP-GAL-${String(galleryIndex + 1).padStart(2, "0")}`; expectedIds.gallery_images[`${code}/${String(imageIndex + 1).padStart(2, "0")}-${video.slug}.jpg`] = imageId++;
  }));
  performerPhotosFor(manifest).sort((left, right) => left.id - right.id).forEach((photo) => { expectedIds.images[photo.code] = photo.id; });
  return expectedIds;
}

export async function loadAllManifests() {
  const manifest = await loadManifest();
  return { manifest, galleries: galleriesFor(manifest), expectedIds: expectedIdentityMaps(manifest) };
}
