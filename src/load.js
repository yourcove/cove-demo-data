#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { spawn } from "node:child_process";
import { digest, exists, sourceArtworkInventory } from "./build.js";
import { assetSlug, audiosFor, galleriesFor, loadAllManifests, performerPhotosFor, readJson, root, standaloneGalleriesFor, tagHierarchy, textsFor } from "./manifests.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const entityCode = (kind, index) => `BDP-${kind ? `${kind}-` : ""}${String(index + 1).padStart(2, "0")}`;
const same = (left, right) => isDeepStrictEqual(left, right);

export class CoveApi {
  constructor(baseUrl, token) { const base = baseUrl.replace(/\/$/, ""); this.baseUrl = base.endsWith("/api") ? base : `${base}/api`; this.token = token; }
  async request(method, endpoint, payload) { const response = await fetch(`${this.baseUrl}${endpoint}`, { method, headers: { accept: "application/json", authorization: `Bearer ${this.token}`, ...(payload === undefined ? {} : { "content-type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) }); if (!response.ok) throw new Error(`Cove API ${method} ${endpoint} failed (${response.status}): ${await response.text()}`); const text = await response.text(); return text ? JSON.parse(text) : {}; }
  async listAll(endpoint) { const items = []; let page = 1; const separator = endpoint.includes("?") ? "&" : "?"; while (true) { const response = await this.request("GET", `${endpoint}${separator}page=${page}&perPage=250`); items.push(...response.items); if (items.length >= response.totalCount) return items; page += 1; } }
  async uploadImage(endpoint, filename) { const form = new FormData(); form.append("file", new Blob([await readFile(filename)], { type: "image/jpeg" }), path.basename(filename)); const response = await fetch(`${this.baseUrl}${endpoint}`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body: form }); if (!response.ok) throw new Error(`Cove image upload ${endpoint} failed (${response.status}): ${await response.text()}`); }
}

export async function authenticate(baseUrl, username, password) { const base = baseUrl.replace(/\/$/, ""); const api = base.endsWith("/api") ? base : `${base}/api`; const status = await (await fetch(`${api}/auth/bootstrap-status`)).json(); const response = await fetch(`${api}${status.ownerExists ? "/auth/login" : "/auth/bootstrap-owner"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error(`Cove authentication failed (${response.status}): ${await response.text()}`); return (await response.json()).token; }

async function createMissing(api, endpoint, records, key, payload) { const existing = new Map((await api.listAll(endpoint)).map((item) => [key(item), item.id])); const result = {}; for (const record of records) { const name = key(record); if (!existing.has(name)) existing.set(name, (await api.request("POST", endpoint, payload(record))).id); result[name] = existing.get(name); } return result; }
async function createCollections(api, collections, ids) { const existing = new Map((await api.listAll("/groups")).map((item) => [item.name, item.id])); const result = {}; for (const collection of collections) { const displayName = collection.title ?? collection.name; let id = existing.get(displayName) ?? existing.get(collection.name); if (id == null) id = (await api.request("POST", "/groups", collectionPayload(collection, ids))).id; result[collection.name] = id; } return result; }
export function isOwnedVideo(video, slug) { return video.remoteIds?.some((remote) => remote.endpoint === "cove-demo" && remote.remoteId === slug) ?? false; }

export async function identityMaps(api, manifest) {
  const [groups, audios, texts, galleries, images, tags, studios, performers, videos] = await Promise.all(["groups", "audios", "texts", "galleries", "images", "tags", "studios", "performers", "videos"].map((type) => api.listAll(`/${type}`)));
  const index = (items, key, kind) => {
    const values = new Map(); const unmatched = new Map();
    for (const item of items) {
      const value = item[key];
      if (value == null || value === "") unmatched.set(`${kind}:${item.id}`, item.id);
      else if (values.has(value)) unmatched.set(`duplicate:${kind}:${value}:${item.id}`, item.id);
      else values.set(value, item.id);
    }
    return { values: Object.fromEntries(values), unmatched: Object.fromEntries(unmatched) };
  };
  const collectionAliases = new Map((manifest?.collections ?? []).flatMap((collection) => [[collection.name, collection.name], [collection.title ?? collection.name, collection.name]]));
  const collectionItems = groups.map((group) => collectionAliases.has(group.name) ? { ...group, canonicalName: collectionAliases.get(group.name) } : { ...group, canonicalName: group.name });
  const indexed = {
    collections: index(collectionItems, "canonicalName", "group"), audios: index(audios, "code", "audio"), texts: index(texts, "code", "text"),
    galleries: index(galleries, "code", "gallery"), tags: index(tags, "name", "tag"), studios: index(studios, "name", "studio"),
    performers: index(performers, "name", "performer"), videos: index(videos, "code", "video"), images: index(images.filter((item) => item.code), "code", "image"),
  };
  const galleryCodes = new Map(galleries.filter((item) => item.code).map((item) => [item.id, item.code])); const galleryImages = {}; const unmatchedImages = { ...indexed.images.unmatched }; const uncodedImages = {};
  for (const image of images.filter((item) => !item.code)) {
    if (image.galleryIds?.length === 1 && image.files?.length === 1 && galleryCodes.has(image.galleryIds[0])) {
      const key = `${galleryCodes.get(image.galleryIds[0])}/${image.files[0].basename}`;
      if (Object.hasOwn(galleryImages, key)) unmatchedImages[`duplicate:${key}:${image.id}`] = image.id; else galleryImages[key] = image.id;
    } else { unmatchedImages[`image:${image.id}`] = image.id; uncodedImages[image.id] = (image.files ?? []).map((file) => path.resolve(file.path)).sort(); }
  }
  const uncodedFiles = (items) => Object.fromEntries(items.filter((item) => !item.code).map((item) => [item.id, (item.files ?? []).map((file) => path.resolve(file.path)).sort()]));
  return {
    tags: indexed.tags.values, studios: indexed.studios.values, performers: indexed.performers.values, collections: indexed.collections.values,
    videos: indexed.videos.values, audios: indexed.audios.values, texts: indexed.texts.values, images: indexed.images.values,
    galleries: indexed.galleries.values, gallery_images: galleryImages, unmatched_collections: indexed.collections.unmatched,
    unmatched_tags: indexed.tags.unmatched, unmatched_studios: indexed.studios.unmatched, unmatched_performers: indexed.performers.unmatched,
    unmatched_videos: indexed.videos.unmatched, unmatched_audios: indexed.audios.unmatched, unmatched_texts: indexed.texts.unmatched,
    unmatched_galleries: indexed.galleries.unmatched, unmatched_images: unmatchedImages, uncoded_images: uncodedImages,
    uncoded_audios: uncodedFiles(audios), uncoded_texts: uncodedFiles(texts),
  };
}

export function validateIdentitySnapshot(actual, expected, allowFresh) { const empty = (object) => !Object.keys(object).length; const entityKeys = ["tags", "studios", "performers", "videos", "audios", "texts", "images", "galleries", "gallery_images"]; const unmatchedKeys = Object.keys(actual).filter((key) => key.startsWith("unmatched_")); const fresh = entityKeys.every((key) => empty(actual[key])) && unmatchedKeys.every((key) => empty(actual[key])) && same(actual.collections, expected.built_in_groups); if (fresh && allowFresh) return actual; const canonical = entityKeys.every((key) => same(actual[key], expected[key])) && same(actual.collections, { ...expected.built_in_groups, ...expected.collections }) && unmatchedKeys.every((key) => empty(actual[key])); if (!canonical) throw new Error(`Cove must be ${allowFresh ? "fresh or canonical" : "canonical"}; refusing to mutate noncanonical data`); return actual; }
export async function validateIdentityContract(api, expected, allowFresh, manifest) { return validateIdentitySnapshot(await identityMaps(api, manifest), expected, allowFresh); }

export async function verifyFreshSequences(databaseUrl) { if (!databaseUrl) throw new Error("--database-url is required for a deterministic first load"); const checks = [["videos", 1, false], ["audios", 1, false], ["text_documents", 1, false], ["images", 1, false], ["galleries", 1, false], ["studios", 1, false], ["performers", 1, false], ["tags", 1, false], ["groups", 3, true], ["files", 1, false], ["folders", 1, false], ["group_items", 1, false]]; const conditions = checks.map(([table, value, called]) => `(select last_value = ${value} and is_called = ${called} from "${table}_Id_seq")`).join(" and "); await new Promise((resolve, reject) => { const child = spawn("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command", `do $cove$ begin if not (${conditions}) then raise exception 'non-fresh identity sequences'; end if; end $cove$;`, databaseUrl], { stdio: ["ignore", "ignore", "pipe"] }); let error = ""; child.stderr.on("data", (chunk) => { error += chunk; }); child.once("error", reject); child.once("exit", (status) => status === 0 ? resolve() : reject(new Error(`Database identity sequences are not fresh: ${error.trim()}`))); }); }
async function verifyNextIdentitySequence(databaseUrl, table, expectedId, purpose) { if (!databaseUrl) throw new Error(`--database-url is required to ${purpose}`); const condition = `(select (is_called and last_value = ${expectedId - 1}) or (not is_called and last_value = ${expectedId}) from "${table}_Id_seq")`; await new Promise((resolve, reject) => { const child = spawn("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command", `do $cove$ begin if not (${condition}) then raise exception 'unexpected next ${table} identity'; end if; end $cove$;`, databaseUrl], { stdio: ["ignore", "ignore", "pipe"] }); let error = ""; child.stderr.on("data", (chunk) => { error += chunk; }); child.once("error", reject); child.once("exit", (status) => status === 0 ? resolve() : reject(new Error(`Database ${table.slice(0, -1)} identity sequence cannot safely create ${table.slice(0, -1)} ${expectedId}: ${error.trim()}`))); }); }
export async function verifyNextImageSequence(databaseUrl, expectedId) { return verifyNextIdentitySequence(databaseUrl, "images", expectedId, "extend canonical performer photos safely"); }
export async function verifyNextTagSequence(databaseUrl, expectedId) { return verifyNextIdentitySequence(databaseUrl, "tags", expectedId, "extend canonical tags safely"); }
export async function verifyNextAudioSequence(databaseUrl, expectedId) { return verifyNextIdentitySequence(databaseUrl, "audios", expectedId, "extend canonical standalone audio safely"); }
export async function verifyNextTextSequence(databaseUrl, expectedId) { return verifyNextIdentitySequence(databaseUrl, "text_documents", expectedId, "extend canonical standalone text safely"); }
export async function verifyNextGallerySequence(databaseUrl, expectedId) { return verifyNextIdentitySequence(databaseUrl, "galleries", expectedId, "extend canonical standalone galleries safely"); }

export function expectedBundlePaths(manifest) { const paths = new Set(); galleriesFor(manifest).forEach((gallery) => paths.add(`galleries/${gallery.decade} - Feature Posters.zip`)); manifest.performers.forEach((performer) => { ["portrait.jpg", "reference.jpg", "metadata.json", "about.txt"].forEach((name) => paths.add(`performers/${performer.slug}/${name}`)); for (const photo of performer.photos ?? []) paths.add(`performers/${performer.slug}/photos/${photo.filename}`); }); manifest.studios.forEach((studio) => paths.add(`studios/${assetSlug(studio.name)}/logo.jpg`)); manifest.videos.forEach((video, index) => { const names = [`${video.slug}.mp4`, "poster.jpg", "still-01.jpg", "still-02.jpg", "score-preview.mp3", "score-cover.jpg", "metadata.json", "production-notes.md", `${video.slug}.srt`, `${video.slug}.vtt`, "cast.csv", "production-brief.pdf"]; if (index % 5 === 0) names.push("Press Kit.zip"); names.forEach((name) => paths.add(`${video.slug}/${name}`)); }); for (const audio of manifest.standalone_audios ?? []) { paths.add(`extras/audios/${audio.slug}.mp3`); if (audio.cover) paths.add(`extras/audios/${audio.slug}-cover.jpg`); } for (const text of manifest.standalone_texts ?? []) { paths.add(`extras/texts/${text.slug}.md`); if (text.cover) paths.add(`extras/texts/${text.slug}-cover.jpg`); } return paths; }
export async function validateBuiltArtwork(library, manifest) { const marker = JSON.parse(await readFile(path.join(library, ".cove-demo-dataset"), "utf8")); if (!same(marker.source_artwork_sha256, await sourceArtworkInventory(manifest))) throw new Error("Built demo artwork is stale; run npm run build"); }
export async function validateBundle(library) { for (const filename of ["manifest.json", "checksums.sha256", ".cove-demo-dataset"]) if (!await exists(path.join(library, filename))) throw new Error(`Bundle is incomplete: missing ${filename}`); const { manifest } = await loadAllManifests(); if (!same(JSON.parse(await readFile(path.join(library, "manifest.json"), "utf8")), await readJson("manifest.json"))) throw new Error("Built manifest does not match tracked manifest"); const seen = new Set(); for (const line of (await readFile(path.join(library, "checksums.sha256"), "utf8")).trim().split("\n")) { const delimiter = line.indexOf("  "); if (delimiter !== 64) throw new Error(`Malformed checksum line: ${line}`); const expected = line.slice(0, delimiter); const relative = line.slice(delimiter + 2); seen.add(relative); const filename = path.resolve(library, relative); if (!filename.startsWith(`${path.resolve(library)}${path.sep}`) || !await exists(filename) || await digest(filename) !== expected) throw new Error(`Bundle checksum mismatch: ${relative}`); } if (!same([...seen].sort(), [...expectedBundlePaths(manifest)].sort())) throw new Error("Bundle checksum inventory is incomplete or unexpected"); await validateBuiltArtwork(library, manifest); }

export async function withLibraryScanning(api, library, action) {
  const original = await api.request("GET", "/system/config"); const configured = structuredClone(original); const resolved = path.resolve(library); const paths = [...(configured.covePaths ?? [])]; const index = paths.findIndex((item) => path.resolve(item.path) === resolved); const enabled = { ...(index < 0 ? {} : paths[index]), path: resolved, excludeVideo: false, excludeImage: false, excludeAudio: false, excludeText: false };
  if (index < 0) paths.push(enabled); else paths[index] = enabled; configured.covePaths = paths;
  try { await api.request("PUT", "/system/config", configured); return await action(); }
  finally { await api.request("PUT", "/system/config", original); }
}
function entityImageUploads(library, manifest, ids) {
  const posterFor = (predicate) => path.join(library, (manifest.videos.find(predicate) ?? manifest.videos[0]).slug, "poster.jpg");
  const imageForTag = (tag) => {
    const video = manifest.videos.find((item) => item.tags.includes(tag));
    if (video) return path.join(library, video.slug, "poster.jpg");
    const performer = manifest.performers.find((item) => item.favorite === true && item.tags?.includes(tag)) ?? manifest.performers.find((item) => item.tags?.includes(tag));
    return performer ? path.join(library, "performers", performer.slug, "portrait.jpg") : posterFor(() => false);
  };
  return [
    ...manifest.performers.map((performer) => ({ endpoint: `/performers/${ids.performers[performer.name]}/image`, filename: path.join(library, "performers", performer.slug, "portrait.jpg") })),
    ...manifest.studios.map((studio) => ({ endpoint: `/studios/${ids.studios[studio.name]}/image`, filename: path.join(library, "studios", assetSlug(studio.name), "logo.jpg") })),
    ...manifest.collections.map((collection) => ({ endpoint: `/groups/${ids.collections[collection.name]}/image/front`, filename: posterFor((video) => video.collection === collection.name) })),
    ...manifest.tags.map((tag) => ({ endpoint: `/tags/${ids.tags[tag]}/image`, filename: imageForTag(tag) })),
  ];
}
export function managedImageUploads(library, manifest, ids) {
  return [
    ...entityImageUploads(library, manifest, ids),
    ...manifest.videos.flatMap((video, index) => [
      { endpoint: `/videos/${ids.videos[videoCode(video, index)]}/image`, filename: path.join(library, video.slug, "poster.jpg") },
      { endpoint: `/audios/${ids.audios[audioCode(video, index)]}/image`, filename: path.join(library, video.slug, "score-cover.jpg") },
      { endpoint: `/texts/${ids.texts[textCode(video, index)]}/image`, filename: path.join(library, video.slug, "poster.jpg") },
    ]),
    ...audiosFor(manifest).filter((audio) => audio.standalone && audio.cover_output_path).map((audio) => ({ endpoint: `/audios/${ids.audios[audio.code]}/image`, filename: path.join(library, audio.cover_output_path) })),
    ...textsFor(manifest).filter((text) => text.standalone && text.cover_output_path).map((text) => ({ endpoint: `/texts/${ids.texts[text.code]}/image`, filename: path.join(library, text.cover_output_path) })),
  ];
}
function relationIds(names, values, label) { return (names ?? []).map((name) => { const id = values[name]; if (id == null) throw new Error(`Missing ${label} identity for ${name}`); return id; }); }
function videoCode(video, index) { return video.code ?? entityCode("", index); }
function audioCode(video, index) { return video.audio?.code ?? entityCode("AUD", index); }
function textCode(video, index) { return video.text?.code ?? entityCode("TXT", index); }
function galleryCode(gallery, index) { return gallery.code ?? entityCode("GAL", index); }
function referenceCode(performer, index) { return performer.reference_code ?? entityCode("IMG", index); }

export function performerPayload(performer, ids) {
  const disambiguation = performer.disambiguation ?? "";
  return {
    name: performer.name, disambiguation, details: performer.details,
    birthdate: performer.birth_date, country: performer.country, gender: performer.gender,
    careerStart: performer.career_start_year ? String(performer.career_start_year) : null,
    careerEnd: performer.career_end_year ? String(performer.career_end_year) : null,
    organized: true, urls: performer.urls ?? [], aliases: performer.aliases ?? [],
    tagIds: relationIds(performer.tags ?? [], ids.tags, "tag"),
    ...(performer.favorite == null ? {} : { favorite: performer.favorite }),
    clearFields: [...(disambiguation ? [] : ["disambiguation"]), ...(performer.career_end_year ? [] : ["careerEnd"])],
  };
}

export function studioPayload(studio, ids) {
  return { name: studio.name, parentId: studio.parent ? ids.studios[studio.parent] : null, details: studio.details, organized: true, urls: studio.urls ?? [], aliases: studio.aliases ?? [], tagIds: relationIds(studio.tags ?? [], ids.tags, "tag"), clearFields: studio.parent ? [] : ["parentId"] };
}

export function videoPayload(video, index, ids) {
  return {
    title: video.title, code: videoCode(video, index), details: `${video.details}\n\nDemo media: a ${video.preview_duration_seconds}-second silent poster-based art preview, not feature-film footage.`, date: video.date, organized: true,
    studioId: ids.studios[video.studio], director: video.director ?? "", captions: video.captions ?? `${video.title}. ${video.genre}.`,
    urls: video.urls ?? [], tagIds: relationIds(video.tags, ids.tags, "tag"), performerIds: relationIds(video.performers, ids.performers, "performer"),
    galleryIds: [], groups: [{ groupId: ids.collections[video.collection], videoIndex: index }],
    remoteIds: [{ endpoint: "cove-demo", remoteId: video.slug }],
  };
}

export function collectionPayload(collection, ids) {
  return { name: collection.title ?? collection.name, description: collection.description, urls: collection.urls ?? [], tagIds: relationIds(collection.tags ?? [collection.decade], ids.tags, "tag"), allowedHostTypes: ["video"], showInVideoLists: true };
}

function derivativePayload(kind, video, index, ids) {
  const record = video[kind]; const isAudio = kind === "audio";
  if (!record) throw new Error(`${video.slug}: explicit ${kind} metadata is required`);
  const studio = Object.hasOwn(record, "studio") ? record.studio : video.studio;
  return {
    title: record.title ?? `${video.title}: ${isAudio ? "Production Audio" : "Production Notes"}`,
    code: isAudio ? audioCode(video, index) : textCode(video, index),
    details: record.details, date: record.date ?? video.date, organized: true, urls: record.urls ?? [],
    studioId: studio == null ? null : ids.studios[studio],
    tagIds: relationIds(record.tags, ids.tags, "tag"), performerIds: relationIds(record.performers, ids.performers, "performer"), groupIds: [], clearFields: studio == null ? ["studioId"] : [],
  };
}

export function audioPayload(video, index, ids) { return derivativePayload("audio", video, index, ids); }
export function textPayload(video, index, ids) { return derivativePayload("text", video, index, ids); }
function standaloneMediaPayload(record, ids) {
  return {
    title: record.title, code: record.code, details: record.details, date: record.date, organized: true, urls: record.urls ?? [],
    studioId: record.studio == null ? null : ids.studios[record.studio],
    tagIds: relationIds(record.tags, ids.tags, "tag"), performerIds: relationIds(record.performers, ids.performers, "performer"),
    groupIds: [], clearFields: record.studio == null ? ["studioId"] : [],
  };
}
export function audioPlans(library, manifest, ids) {
  return audiosFor(manifest).map((audio, index) => ({
    code: audio.code, expectedId: ids.audios[audio.code] ?? audio.id, filename: path.join(library, audio.output_path), label: audio.slug,
    standalone: audio.standalone,
    payload: audio.standalone ? standaloneMediaPayload(audio, ids) : audioPayload(audio.video, index, ids),
  })).sort((left, right) => left.expectedId - right.expectedId);
}
export function textPlans(library, manifest, ids) {
  return textsFor(manifest).map((text, index) => ({
    code: text.code, expectedId: ids.texts[text.code] ?? text.id, filename: path.join(library, text.output_path), label: text.slug,
    standalone: text.standalone,
    payload: text.standalone ? standaloneMediaPayload(text, ids) : textPayload(text.video, index, ids),
  })).sort((left, right) => left.expectedId - right.expectedId);
}
export function performerMetadataUpdates(manifest, ids) { return manifest.performers.map((performer) => ({ endpoint: `/performers/${ids.performers[performer.name]}`, payload: performerPayload(performer, ids) })); }
export function performerBirthdateUpdates(manifest, ids) { return manifest.performers.map((performer) => ({ endpoint: `/performers/${ids.performers[performer.name]}`, payload: { birthdate: performer.birth_date } })); }
export function validateScanCompletion(type, state) {
  const summary = state.summary ?? state.subTask ?? ""; const count = (pattern) => Number((summary.match(pattern)?.[1] ?? "-1").replaceAll(",", ""));
  const imported = count(/([\d,]+) imported/); const updated = count(/([\d,]+) updated/); const invalid = count(/([\d,]+) invalid media files?/); const deferred = count(/([\d,]+) unsettled files?/); const failed = count(/([\d,]+) file failures?/); const assetFailures = count(/([\d,]+) asset generation failures?/);
  if (imported + updated !== 1 || invalid !== 0 || deferred !== 0 || failed !== 0 || assetFailures !== 0) throw new Error(`${type} scan did not process exactly one file successfully: ${summary || "missing completion summary"}`);
}
async function importExact(api, type, filename) { const resolved = path.resolve(filename); const job = await api.request("POST", "/metadata/scan", { paths: [resolved], rescan: true, scanGenerateThumbnails: type === "images" }); let completedState; for (let attempt = 0; attempt < 480; attempt += 1) { const state = await api.request("GET", `/jobs/${job.jobId}`); if ([2, "completed"].includes(state.status)) { completedState = state; break; } if ([3, 4, "failed", "cancelled"].includes(state.status)) throw new Error(`${type} scan failed: ${state.error ?? state.subTask}`); await sleep(250); } if (!completedState) throw new Error(`${type} scan timed out`); validateScanCompletion(type, completedState); for (const summary of await api.listAll(`/${type}?scanResult=${crypto.randomUUID()}`)) { const item = type === "galleries" ? await api.request("GET", `/galleries/${summary.id}`) : summary; if (item.files?.some((file) => path.resolve(file.path) === resolved)) return item; } throw new Error(`${type} scan did not import ${filename}`); }

export function performerPhotoPlans(library, manifest, ids) {
  return performerPhotosFor(manifest).map((photo, index) => {
    const code = photo.code ?? entityCode("IMG", manifest.performers.length + index);
    const expectedId = photo.id ?? ids.images[code];
    return {
      code, expectedId, filename: path.join(library, "performers", photo.performer.slug, "photos", photo.filename),
      payload: { title: `${photo.performer.name}: ${photo.title}`, code, details: photo.details, photographer: photo.photographer ?? "Cove Demo Art Department", organized: true, studioId: photo.studio ? ids.studios[photo.studio] : null, date: photo.date, urls: photo.urls ?? [], tagIds: relationIds(photo.tags ?? [], ids.tags, "tag"), performerIds: relationIds(photo.performers ?? [photo.performer.name], ids.performers, "performer"), galleryIds: curatedGalleryIds(manifest, ids, code), groupIds: photo.collection ? [{ groupId: ids.collections[photo.collection], videoIndex: 0 }] : [], clearFields: photo.studio ? [] : ["studioId"] },
    };
  }).sort((left, right) => left.expectedId - right.expectedId);
}

export function performerReferencePlans(library, manifest, ids) {
  return manifest.performers.map((performer, index) => {
    const code = referenceCode(performer, index); const studio = performer.reference_studio ?? null; const collection = performer.reference_collection ?? null; const date = performer.reference_date ?? null;
    return {
      code, expectedId: performer.reference_id ?? ids.images[code], filename: path.join(library, "performers", performer.slug, "reference.jpg"), label: performer.slug,
      payload: {
        title: performer.reference_title ?? `${performer.name}: Character Reference`, code,
        details: performer.reference_details ?? "AI-generated artwork for a fictional performer.",
        photographer: performer.reference_photographer ?? "Cove Demo Art Department", organized: true,
        studioId: studio ? ids.studios[studio] : null, date,
        urls: performer.reference_urls ?? [], tagIds: relationIds(performer.reference_tags ?? [], ids.tags, "tag"),
        performerIds: [ids.performers[performer.name]], galleryIds: curatedGalleryIds(manifest, ids, code),
        groupIds: collection ? [{ groupId: ids.collections[collection], videoIndex: 0 }] : [], clearFields: [...(studio ? [] : ["studioId"]), ...(date ? [] : ["date"])],
      },
    };
  });
}

export function galleryPlans(library, manifest, ids) {
  return galleriesFor(manifest).map((record, index) => {
    const code = galleryCode(record, index); const performers = [...new Set(record.videos.flatMap((video) => video.image_performers ?? video.performers))];
    const studio = Object.hasOwn(record, "studio") ? record.studio : record.videos[0].studio;
    return {
      code, expectedId: ids.galleries[code], filename: path.join(library, "galleries", `${record.decade} - Feature Posters.zip`), label: record.decade,
      payload: { title: record.title ?? record.name, code, date: record.date ?? record.videos[0].date, details: record.description, photographer: "Cove Demo Art Department", organized: true, studioId: studio == null ? null : ids.studios[studio], urls: [], tagIds: relationIds(record.tags ?? [record.decade], ids.tags, "tag"), performerIds: relationIds(performers, ids.performers, "performer"), videoIds: record.videos.map((video) => ids.videos[videoCode(video, manifest.videos.indexOf(video))]), clearFields: studio == null ? ["studioId"] : [] },
    };
  });
}

function curatedGalleryIds(manifest, ids, imageCode) {
  return standaloneGalleriesFor(manifest).filter(({ code, image_refs }) => ids.galleries?.[code] != null && image_refs.includes(imageCode)).map((gallery) => ids.galleries[gallery.code]).sort((left, right) => left - right);
}

export function standaloneGalleryPlans(manifest, ids) {
  return standaloneGalleriesFor(manifest).map((gallery) => ({
    code: gallery.code, expectedId: ids.galleries[gallery.code] ?? gallery.id, label: gallery.slug,
    imageIds: gallery.image_refs.map((code) => {
      const id = ids.images[code]; if (id == null) throw new Error(`Missing image identity for ${code}`); return id;
    }),
    payload: {
      title: gallery.title, code: gallery.code, date: gallery.date, details: gallery.details, photographer: gallery.photographer,
      organized: true, studioId: gallery.studio == null ? null : ids.studios[gallery.studio], urls: gallery.urls ?? [],
      tagIds: relationIds(gallery.tags, ids.tags, "tag"), performerIds: relationIds(gallery.performers, ids.performers, "performer"),
      videoIds: relationIds(gallery.video_slugs, Object.fromEntries(manifest.videos.map((video, index) => [video.slug, ids.videos[videoCode(video, index)]])), "video"),
      clearFields: gallery.studio == null ? ["studioId"] : [],
    },
  })).sort((left, right) => left.expectedId - right.expectedId);
}

export function galleryImagePlans(library, manifest, ids) {
  return galleriesFor(manifest).flatMap((gallery, galleryIndex) => gallery.videos.map((video, imageIndex) => {
    const galleryIdentity = galleryCode(gallery, galleryIndex); const basename = `${String(imageIndex + 1).padStart(2, "0")}-${video.slug}.jpg`; const key = `${galleryIdentity}/${basename}`;
    return { type: "images", id: ids.gallery_images[key], filename: `${path.join(library, "galleries", `${gallery.decade} - Feature Posters.zip`)}#virtual/${basename}`, label: key, endpoint: `/images/${ids.gallery_images[key]}`, payload: { performerIds: relationIds(video.image_performers ?? video.performers, ids.performers, "performer") } };
  }));
}

export function validateCanonicalExtensionSnapshot(actual, expected, manifest, library = "/library") {
  const plans = performerPhotoPlans(library, manifest, expected); const extensionCodes = new Set(plans.map(({ code }) => code));
  const referenceCodes = new Set(performerReferencePlans(library, manifest, expected).map(({ code }) => code));
  const baseImages = Object.fromEntries(Object.entries(expected.images).filter(([code]) => referenceCodes.has(code)));
  const entityKeys = ["studios", "performers", "videos", "gallery_images"];
  const unmatchedKeys = Object.keys(actual).filter((key) => key.startsWith("unmatched_") && !["unmatched_images", "unmatched_audios", "unmatched_texts"].includes(key));
  const expectedTags = Object.entries(expected.tags); const actualTagCount = Object.keys(actual.tags ?? {}).length;
  const canonicalTagCount = manifest.canonical_tag_count ?? manifest.tags.length;
  const tagsAreCanonicalPrefix = canonicalTagCount > 0 && actualTagCount >= canonicalTagCount && actualTagCount <= expectedTags.length
    && same(actual.tags, Object.fromEntries(expectedTags.slice(0, actualTagCount)));
  const firstMissing = plans.findIndex(({ code }) => actual.images[code] == null); const presentPrefixLength = firstMissing < 0 ? plans.length : firstMissing;
  const extensionIsPrefix = plans.every(({ code }, index) => (actual.images[code] != null) === (index < presentPrefixLength));
  const recoverablePlan = plans[presentPrefixLength]; const unmatchedImageEntries = Object.entries(actual.unmatched_images ?? {});
  const recoverableUncodedImage = unmatchedImageEntries.length === 0 || (unmatchedImageEntries.length === 1 && recoverablePlan != null
    && unmatchedImageEntries[0][0] === `image:${recoverablePlan.expectedId}` && unmatchedImageEntries[0][1] === recoverablePlan.expectedId
    && same(actual.uncoded_images?.[recoverablePlan.expectedId], [path.resolve(recoverablePlan.filename)]));
  const imagesValid = same(Object.fromEntries(Object.entries(actual.images).filter(([code]) => !extensionCodes.has(code))), baseImages)
    && Object.entries(actual.images).every(([code, id]) => expected.images[code] === id) && extensionIsPrefix;
  const prefixState = (type, baseCount) => {
    const entries = Object.entries(expected[type]).sort((left, right) => left[1] - right[1]); const actualCount = Object.keys(actual[type] ?? {}).length;
    return { entries, actualCount, valid: actualCount >= baseCount && actualCount <= entries.length && same(actual[type], Object.fromEntries(entries.slice(0, actualCount))), next: entries[actualCount] };
  };
  const audioState = prefixState("audios", manifest.videos.length); const textState = prefixState("texts", manifest.videos.length); const galleryState = prefixState("galleries", manifest.collections.length);
  const recoverableUncoded = (kind, state, mediaPlans) => {
    const entries = Object.entries(actual[`unmatched_${kind}`] ?? {}); if (!entries.length) return true;
    const next = state.next; if (entries.length !== 1 || !next || entries[0][0] !== `${kind.slice(0, -1)}:${next[1]}` || entries[0][1] !== next[1]) return false;
    const plan = mediaPlans.find(({ code }) => code === next[0]); return plan != null && same(actual[`uncoded_${kind}`]?.[next[1]], [path.resolve(plan.filename)]);
  };
  const canonical = entityKeys.every((key) => same(actual[key], expected[key])) && same(actual.collections, { ...expected.built_in_groups, ...expected.collections }) && unmatchedKeys.every((key) => !Object.keys(actual[key]).length) && tagsAreCanonicalPrefix && imagesValid && recoverableUncodedImage
    && audioState.valid && textState.valid && galleryState.valid
    && recoverableUncoded("audios", audioState, audioPlans(library, manifest, expected)) && recoverableUncoded("texts", textState, textPlans(library, manifest, expected));
  if (!canonical) throw new Error("Cove must be canonical or contain only the expected append-only tag, media, and gallery extensions; refusing to mutate noncanonical data");
  return actual;
}

export function validatePerformerPhotoExtensionSnapshot(actual, expected, manifest, library = "/library") { return validateCanonicalExtensionSnapshot(actual, expected, manifest, library); }

function tagPayload(name, ids, manifest) {
  const hierarchy = manifest ? tagHierarchy(manifest) : null;
  return {
    name, description: manifest?.tag_descriptions?.[name] ?? "A fictional demo catalog topic.", organized: true, aliases: [],
    parentIds: (hierarchy?.parentsByName.get(name) ?? []).map((parent) => ids.tags[parent]),
    childIds: (hierarchy?.childrenByName.get(name) ?? []).map((child) => ids.tags[child]),
  };
}
export async function appendMissingTags(api, manifest, expected, existingTags, databaseUrl, verifyNext = verifyNextTagSequence) {
  const expectedEntries = Object.entries(expected.tags); const existingCount = Object.keys(existingTags ?? {}).length;
  const canonicalCount = manifest.canonical_tag_count ?? manifest.tags.length;
  if (canonicalCount <= 0 || existingCount < canonicalCount || existingCount > expectedEntries.length || !same(existingTags, Object.fromEntries(expectedEntries.slice(0, existingCount)))) throw new Error("Cove tags are not the expected canonical prefix; refusing to append tags");
  const result = { ...existingTags };
  for (const [name, expectedId] of expectedEntries.slice(existingCount)) {
    await verifyNext(databaseUrl, expectedId);
    const entity = await api.request("POST", "/tags", tagPayload(name));
    if (entity.id !== expectedId) throw new Error(`Tag identity changed for ${name}: expected ${expectedId}, found ${entity.id}`);
    result[name] = entity.id;
  }
  return result;
}

export async function appendFileBackedMedia(api, kind, library, manifest, expected, actual, databaseUrl, verifyNext) {
  const allPlans = kind === "audios" ? audioPlans(library, manifest, expected) : textPlans(library, manifest, expected);
  const baseCount = manifest.videos.length; const plans = allPlans.filter(({ expectedId }) => expectedId > baseCount); const result = { ...(actual[kind] ?? {}) };
  for (const plan of plans) {
    let id = result[plan.code]; const recovered = same(actual[`uncoded_${kind}`]?.[plan.expectedId], [path.resolve(plan.filename)]);
    if (id == null && recovered) id = plan.expectedId;
    if (id == null) {
      await verifyNext(databaseUrl, plan.expectedId);
      const entity = await api.request("POST", `/${kind}/from-file`, { filePath: path.resolve(plan.filename) });
      if (entity.id !== plan.expectedId) throw new Error(`${kind} identity changed for ${plan.code}: expected ${plan.expectedId}, found ${entity.id}`);
      id = entity.id;
    }
    const entity = await api.request("GET", `/${kind}/${id}`); const resolved = path.resolve(plan.filename);
    const filePaths = (entity.files ?? []).map((file) => path.resolve(file.path)).sort();
    if (!same(filePaths, [resolved])) throw new Error(`Canonical ${kind} record ${plan.code} must retain its exact file association ${resolved}`);
    await api.request("PUT", `/${kind}/${id}`, plan.payload); result[plan.code] = id;
  }
  return result;
}

export async function validateStandaloneMediaAssociations(api, library, manifest, ids) {
  for (const [kind, plans] of [["audios", audioPlans(library, manifest, ids)], ["texts", textPlans(library, manifest, ids)]]) {
    for (const plan of plans.filter(({ standalone }) => standalone)) {
      const entity = await api.request("GET", `/${kind}/${plan.expectedId}`); const expectedPath = path.resolve(plan.filename);
      const actualPaths = (entity.files ?? []).map((file) => path.resolve(file.path)).sort();
      if (!same(actualPaths, [expectedPath])) throw new Error(`Canonical ${kind} record ${plan.code} must retain its exact file association ${expectedPath}`);
    }
  }
}

export async function reconcileStandaloneGalleryImages(api, manifest, ids) {
  for (const plan of standaloneGalleryPlans(manifest, ids)) {
    const current = new Set((await api.listAll(`/images?galleryId=${plan.expectedId}`)).map(({ id }) => id)); const expected = new Set(plan.imageIds);
    const add = [...expected].filter((id) => !current.has(id)); const remove = [...current].filter((id) => !expected.has(id));
    if (add.length) await api.request("POST", `/galleries/${plan.expectedId}/images`, { imageIds: add });
    if (remove.length) await api.request("DELETE", `/galleries/${plan.expectedId}/images`, { imageIds: remove });
  }
}

async function appendStandaloneGalleries(api, manifest, expected, existing, databaseUrl, verifyNext = verifyNextGallerySequence) {
  const result = { ...(existing ?? {}) };
  for (const plan of standaloneGalleryPlans(manifest, expected)) {
    let id = result[plan.code];
    if (id == null) {
      await verifyNext(databaseUrl, plan.expectedId);
      const { clearFields, ...createPayload } = plan.payload;
      const entity = await api.request("POST", "/galleries", createPayload);
      if (entity.id !== plan.expectedId) throw new Error(`Gallery identity changed for ${plan.code}: expected ${plan.expectedId}, found ${entity.id}`);
      id = entity.id; result[plan.code] = id;
    }
    await api.request("PUT", `/galleries/${id}`, plan.payload);
  }
  await reconcileStandaloneGalleryImages(api, manifest, expected);
  return result;
}

async function importPerformerPhotos(api, library, manifest, ids, existingImages = {}) {
  return withLibraryScanning(api, library, async () => {
    for (const plan of performerPhotoPlans(library, manifest, ids)) {
      let imageId = existingImages[plan.code];
      if (imageId == null) {
        const image = await importExact(api, "images", plan.filename);
        if (image.id !== plan.expectedId) throw new Error(`Performer photo identity changed for ${plan.code}: expected ${plan.expectedId}, found ${image.id}`);
        imageId = image.id;
      } else {
        const image = await api.request("GET", `/images/${imageId}`); const resolved = path.resolve(plan.filename);
        if (!image.files?.some((file) => path.resolve(file.path) === resolved)) throw new Error(`Canonical performer photo ${plan.code} is not associated with ${resolved}`);
      }
      await api.request("PUT", `/images/${imageId}`, plan.payload);
    }
  });
}

export async function prepareIdentityContract(api, library, manifest, expected, allowFresh, databaseUrl, { verifyImage = verifyNextImageSequence, verifyTag = verifyNextTagSequence, verifyAudio = verifyNextAudioSequence, verifyText = verifyNextTextSequence, verifyGallery = verifyNextGallerySequence, readIdentities = identityMaps } = {}) {
  const actual = await readIdentities(api, manifest); let strictError;
  try { validateIdentitySnapshot(actual, expected, allowFresh); }
  catch (error) { strictError = error; }
  if (!strictError) {
    if (same(actual.audios, expected.audios) && same(actual.texts, expected.texts)) await validateStandaloneMediaAssociations(api, library, manifest, expected);
    return actual;
  }
  if (strictError) {
    try { validateCanonicalExtensionSnapshot(actual, expected, manifest, library); }
    catch { throw strictError; }
    await appendMissingTags(api, manifest, expected, actual.tags, databaseUrl, verifyTag);
    const recoveredImages = Object.fromEntries(performerPhotoPlans(library, manifest, expected)
      .filter(({ expectedId, filename }) => same(actual.uncoded_images?.[expectedId], [path.resolve(filename)]))
      .map(({ code, expectedId }) => [code, expectedId]));
    const nextMissing = performerPhotoPlans(library, manifest, expected).find(({ code }) => actual.images[code] == null && recoveredImages[code] == null);
    if (nextMissing) await verifyImage(databaseUrl, nextMissing.expectedId);
    if (nextMissing || Object.keys(recoveredImages).length) await importPerformerPhotos(api, library, manifest, expected, { ...actual.images, ...recoveredImages });
    await appendFileBackedMedia(api, "audios", library, manifest, expected, actual, databaseUrl, verifyAudio);
    await appendFileBackedMedia(api, "texts", library, manifest, expected, actual, databaseUrl, verifyText);
    await appendStandaloneGalleries(api, manifest, expected, actual.galleries, databaseUrl, verifyGallery);
    return validateIdentityContract(api, expected, false, manifest);
  }
}

export function canonicalMetadataUpdates(library, manifest, ids) {
  return [
    ...manifest.tags.map((name) => ({ endpoint: `/tags/${ids.tags[name]}`, payload: tagPayload(name, ids, manifest) })),
    ...manifest.studios.map((studio) => ({ endpoint: `/studios/${ids.studios[studio.name]}`, payload: studioPayload(studio, ids) })),
    ...performerMetadataUpdates(manifest, ids),
    ...manifest.collections.map((collection) => ({ endpoint: `/groups/${ids.collections[collection.name]}`, payload: collectionPayload(collection, ids) })),
    ...manifest.videos.map((video, index) => ({ endpoint: `/videos/${ids.videos[videoCode(video, index)]}`, payload: videoPayload(video, index, ids) })),
    ...audioPlans(library, manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/audios/${expectedId}`, payload })),
    ...textPlans(library, manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/texts/${expectedId}`, payload })),
    ...performerReferencePlans(library, manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/images/${expectedId}`, payload })),
    ...performerPhotoPlans(library, manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/images/${expectedId}`, payload })),
    ...galleryPlans(library, manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/galleries/${expectedId}`, payload })),
    ...standaloneGalleryPlans(manifest, ids).map(({ expectedId, payload }) => ({ endpoint: `/galleries/${expectedId}`, payload })),
    ...galleryImagePlans(library, manifest, ids).map(({ endpoint, payload }) => ({ endpoint, payload })),
  ];
}

export async function applyCanonicalMetadata(api, library, manifest, ids) { const updates = canonicalMetadataUpdates(library, manifest, ids); for (const update of updates) await api.request("PUT", update.endpoint, update.payload); return updates.length; }

export async function loadIntoCove(api, library, expected, idMapOutput, databaseUrl, { verifyFresh = verifyFreshSequences, validate = validateBundle } = {}) {
  const { manifest } = await loadAllManifests(); await validate(library); const preflight = await prepareIdentityContract(api, library, manifest, expected, true, databaseUrl); if (same(preflight.videos, expected.videos)) { const result = await syncCanonicalDataset(api, library, manifest, preflight); if (idMapOutput) await writeMap(idMapOutput, preflight); reportSync(result); return; } await verifyFresh(databaseUrl);
  const tags = await createMissing(api, "/tags", manifest.tags, (item) => typeof item === "string" ? item : item.name, tagPayload);
  const studios = {}; for (const studio of manifest.studios) studios[studio.name] = (await api.request("POST", "/studios", studioPayload(studio, { tags, studios }))).id;
  const ids = { ...expected, tags, studios };
  const performers = await createMissing(api, "/performers", manifest.performers, (item) => item.name, (item) => performerPayload(item, { ...ids, performers: {} })); ids.performers = performers;
  ids.collections = await createCollections(api, manifest.collections, ids);
  ids.videos = {}; for (const [index, video] of manifest.videos.entries()) { const entity = await api.request("POST", "/videos/from-file", { filePath: path.resolve(library, video.slug, `${video.slug}.mp4`) }); ids.videos[videoCode(video, index)] = entity.id; }
  ids.audios = {}; ids.texts = {}; for (const [index, video] of manifest.videos.entries()) { const audio = await api.request("POST", "/audios/from-file", { filePath: path.resolve(library, video.slug, "score-preview.mp3") }); ids.audios[audioCode(video, index)] = audio.id; const text = await api.request("POST", "/texts/from-file", { filePath: path.resolve(library, video.slug, "production-notes.md") }); ids.texts[textCode(video, index)] = text.id; }
  ids.galleries = {};
  await withLibraryScanning(api, library, async () => {
    for (const plan of performerReferencePlans(library, manifest, ids)) { const image = await importExact(api, "images", plan.filename); if (image.id !== plan.expectedId) throw new Error(`Performer reference identity changed for ${plan.code}: expected ${plan.expectedId}, found ${image.id}`); }
    for (const plan of galleryPlans(library, manifest, expected)) { const gallery = await importExact(api, "galleries", plan.filename); if (gallery.id !== plan.expectedId) throw new Error(`Gallery identity changed for ${plan.code}: expected ${plan.expectedId}, found ${gallery.id}`); ids.galleries[plan.code] = gallery.id; }
  });
  await importPerformerPhotos(api, library, manifest, ids);
  ids.audios = await appendFileBackedMedia(api, "audios", library, manifest, expected, { audios: ids.audios }, databaseUrl, async () => {});
  ids.texts = await appendFileBackedMedia(api, "texts", library, manifest, expected, { texts: ids.texts }, databaseUrl, async () => {});
  ids.galleries = await appendStandaloneGalleries(api, manifest, expected, ids.galleries, databaseUrl, async () => {});
  await applyCanonicalMetadata(api, library, manifest, ids);
  const uploads = managedImageUploads(library, manifest, ids); for (const upload of uploads) await api.uploadImage(upload.endpoint, upload.filename);
  const actual = await validateIdentityContract(api, expected, false, manifest); if (idMapOutput) await writeMap(idMapOutput, actual); console.log("Loaded the canonical fictional Cove demo dataset.");
}

export function scannedArtworkTargets(library, manifest, ids) { return [
  ...performerReferencePlans(library, manifest, ids).map(({ expectedId, filename, label }) => ({ type: "images", id: expectedId, filename, label })),
  ...performerPhotoPlans(library, manifest, ids).map((photo) => ({ type: "images", id: photo.expectedId, filename: photo.filename, label: photo.code })),
  ...manifest.videos.map((video, index) => ({ type: "videos", id: ids.videos[videoCode(video, index)], filename: path.join(library, video.slug, `${video.slug}.mp4`), label: video.slug })),
  ...audioPlans(library, manifest, ids).map(({ expectedId, filename, code }) => ({ type: "audios", id: expectedId, filename, label: code })),
  ...textPlans(library, manifest, ids).map(({ expectedId, filename, code }) => ({ type: "texts", id: expectedId, filename, label: code })),
  ...galleryPlans(library, manifest, ids).map(({ expectedId, filename, label }) => ({ type: "galleries", id: expectedId, filename, label })),
]; }
function fileAssociationSnapshot(entity) { return (entity.files ?? []).map((file) => ({ id: file.id, path: path.resolve(file.path) })).sort((left, right) => left.id - right.id || left.path.localeCompare(right.path)); }
export async function validateScanTargetAssociations(api, targets, expected) { const snapshots = new Map(); for (const target of targets) { const entity = await api.request("GET", `/${target.type}/${target.id}`); const resolved = path.resolve(target.filename); const snapshot = fileAssociationSnapshot(entity); if (!snapshot.some((file) => file.path === resolved)) throw new Error(`Canonical ${target.type} record ${target.id} is not associated with ${resolved}; refusing to scan`); const key = `${target.type}:${target.id}`; if (expected && !same(snapshot, expected.get(key))) throw new Error(`Canonical ${target.type} file associations changed for ${target.label}`); snapshots.set(key, snapshot); } return snapshots; }
export async function syncScannedArtwork(api, library, manifest, ids) { const targets = scannedArtworkTargets(library, manifest, ids); const associationTargets = [...targets, ...galleryImagePlans(library, manifest, ids)]; const originalAssociations = await validateScanTargetAssociations(api, associationTargets); return withLibraryScanning(api, library, async () => { let scans = 0; for (const target of targets) { const entity = await importExact(api, target.type, target.filename); if (entity.id !== target.id) throw new Error(`${target.type} identity changed for ${target.label}`); scans += 1; } await validateScanTargetAssociations(api, associationTargets, originalAssociations); return scans; }); }
export async function syncCanonicalDataset(api, library, manifest, ids, syncScanned = false) { const scans = syncScanned ? await syncScannedArtwork(api, library, manifest, ids) : 0; const metadata = await applyCanonicalMetadata(api, library, manifest, ids); await reconcileStandaloneGalleryImages(api, manifest, ids); const uploads = managedImageUploads(library, manifest, ids); for (const upload of uploads) await api.uploadImage(upload.endpoint, upload.filename); return { scans, metadata, uploads: uploads.length }; }
function reportSync({ scans, uploads }) { console.log(`Synchronized ${uploads} managed demo artwork files${scans ? ` and rescanned ${scans} file-backed artwork records` : ""}.`); }
export async function syncIntoCove(api, library, expected, idMapOutput, databaseUrl) { const { manifest } = await loadAllManifests(); await validateBundle(library); const ids = await prepareIdentityContract(api, library, manifest, expected, false, databaseUrl); const result = await syncCanonicalDataset(api, library, manifest, ids, true); const validated = await validateIdentityContract(api, expected, false, manifest); if (idMapOutput) await writeMap(idMapOutput, validated); reportSync(result); }

async function writeMap(filename, map) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, `${JSON.stringify(map, null, 2)}\n`); }
export function parseArguments(argv) { const options = { library: path.join(root, "output", "library"), apiUrl: process.env.COVE_URL ?? process.env.COVE_DEV_API_URL, token: process.env.COVE_TOKEN, username: process.env.COVE_USERNAME ?? process.env.COVE_DEV_APP_USERNAME, password: process.env.COVE_PASSWORD ?? process.env.COVE_DEV_APP_PASSWORD, databaseUrl: process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL, idMapOutput: path.join(root, "id-map.json") }; for (let index = 0; index < argv.length; index += 1) { const value = argv[index]; if (value === "--library") options.library = path.resolve(argv[++index]); else if (value === "--api-url") options.apiUrl = argv[++index]; else if (value === "--token") options.token = argv[++index]; else if (value === "--username") options.username = argv[++index]; else if (value === "--password") options.password = argv[++index]; else if (value === "--database-url") options.databaseUrl = argv[++index]; else if (value === "--id-map-output") options.idMapOutput = path.resolve(argv[++index]); else throw new Error(`Unknown argument: ${value}`); } return options; }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) { const options = parseArguments(process.argv.slice(2)); if (!options.apiUrl || (!options.token && (!options.username || !options.password))) { console.error("Provide --api-url and either --token or --username/--password."); process.exit(2); } else { const token = options.token ?? await authenticate(options.apiUrl, options.username, options.password); const { expectedIds } = await loadAllManifests(); loadIntoCove(new CoveApi(options.apiUrl, token), path.resolve(options.library), expectedIds, options.idMapOutput, options.databaseUrl).catch((error) => { console.error(error); process.exitCode = 1; }); } }
