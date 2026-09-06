import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendFileBackedMedia, appendMissingTags, audioPayload, audioPlans, canonicalMetadataUpdates, galleryImagePlans, galleryPlans, identityMaps, loadIntoCove, managedImageUploads, performerPayload, performerPhotoPlans, performerReferencePlans, prepareIdentityContract, reconcileStandaloneGalleryImages, scannedArtworkTargets, standaloneGalleryPlans,
  syncCanonicalDataset, syncScannedArtwork, textPayload, textPlans, validateCanonicalExtensionSnapshot, validatePerformerPhotoExtensionSnapshot, validateStandaloneMediaAssociations, withLibraryScanning,
} from "../src/load.js";
import { expectedIdentityMaps, loadAllManifests } from "../src/manifests.js";

function fixture() {
  const manifest = {
    canonical_tag_count: 4,
    tags: ["2020s", "Drama", "Music", "Generated Artwork", "Director"],
    studios: [{ name: "Studio", details: "A studio." }],
    collections: [{ name: "Legacy Collection Key", title: "Contemporary Stories", decade: "2020s", description: "A collection." }],
    performers: [
      { name: "Alex Example", slug: "alex-example", details: "A director and writer.", birth_date: "1995-04-10", country: "NZ", gender: "NonBinary", career_start_year: 2015, favorite: true, tags: ["Drama", "Director"], reference_code: "BDP-IMG-01", reference_id: 1, reference_title: "Alex Example: Design Reference", reference_details: "The canonical illustrated identity reference.", reference_date: "2020-06-01", photos: [{ code: "BDP-IMG-26", id: 4, filename: "2021-06-01-publicity.jpg", date: "2021-06-01", title: "Publicity Portrait", details: "A dated publicity portrait." }] },
      { name: "Blair Example", slug: "blair-example", details: "A musician.", birth_date: "1993-03-02", country: "CA", gender: "Female", career_start_year: 2013, career_end_year: 2024, reference_code: "BDP-IMG-02", reference_id: 2 },
    ],
    videos: [{
      slug: "example-film", code: "BDP-01", title: "Example Film", details: "A film.", date: "2022-09-09", genre: "Drama", studio: "Studio", collection: "Legacy Collection Key", tags: ["2020s", "Drama"], performers: ["Alex Example", "Blair Example"], image_performers: ["Alex Example"], preview_duration_seconds: 12,
      audio: { code: "BDP-AUD-01", title: "Example Sessions", details: "A score performed by Blair.", performers: ["Blair Example"], tags: ["Music"] },
      text: { code: "BDP-TXT-01", details: "Alex's production diary.", performers: ["Alex Example"], tags: ["Drama"] },
    }],
  };
  const ids = {
    built_in_groups: { "Save for Later": 1, "Watch History": 2, "Continue Watching": 3 },
    tags: { "2020s": 1, Drama: 2, Music: 3, "Generated Artwork": 4, Director: 5 }, studios: { Studio: 1 },
    performers: { "Alex Example": 1, "Blair Example": 2 }, collections: { "Legacy Collection Key": 4 },
    videos: { "BDP-01": 1 }, audios: { "BDP-AUD-01": 1 }, texts: { "BDP-TXT-01": 1 },
    images: { "BDP-IMG-01": 1, "BDP-IMG-02": 2, "BDP-IMG-26": 4 }, galleries: { "BDP-GAL-01": 1 },
    gallery_images: { "BDP-GAL-01/01-example-film.jpg": 3 },
  };
  return { manifest, ids };
}

test("performer payload is shared, complete, and preserves authored demographic metadata", () => {
  const { manifest, ids } = fixture(); const payload = performerPayload(manifest.performers[0], ids);
  assert.deepEqual(payload, { name: "Alex Example", disambiguation: "", details: "A director and writer.", birthdate: "1995-04-10", country: "NZ", gender: "NonBinary", careerStart: "2015", careerEnd: null, organized: true, urls: ["https://archive.example/public/performers/alex-example"], aliases: [], tagIds: [2, 5], favorite: true, clearFields: ["disambiguation", "careerEnd"] });
  assert.deepEqual(performerPayload(manifest.performers[1], ids).tagIds, []);
  assert.equal(Object.hasOwn(performerPayload(manifest.performers[1], ids), "favorite"), false);
  assert.equal(performerPayload(manifest.performers[1], ids).careerEnd, "2024");
  const authored = performerPayload({ ...manifest.performers[1], disambiguation: "The stage performer" }, ids); assert.equal(authored.disambiguation, "The stage performer"); assert.equal(authored.clearFields.includes("disambiguation"), false);
});

test("audio and text payloads use explicit relationships instead of inheriting the video cast", () => {
  const { manifest, ids } = fixture(); const video = manifest.videos[0];
  assert.deepEqual(audioPayload(video, 0, ids).performerIds, [2]); assert.deepEqual(audioPayload(video, 0, ids).tagIds, [3]); assert.deepEqual(audioPayload(video, 0, ids).groupIds, []);
  assert.deepEqual(textPayload(video, 0, ids).performerIds, [1]); assert.deepEqual(textPayload(video, 0, ids).tagIds, [2]); assert.deepEqual(textPayload(video, 0, ids).groupIds, []);
  assert.equal(audioPayload(video, 0, ids).title, "Example Sessions"); assert.equal(textPayload(video, 0, ids).title, "Example Film: Production Notes");
  assert.deepEqual(audioPayload({ ...video, audio: { ...video.audio, studio: null } }, 0, ids).clearFields, ["studioId"]);
  assert.throws(() => audioPayload({ ...video, audio: undefined }, 0, ids), /explicit audio metadata is required/);
});

test("canonical metadata plans cover every mutable relationship including gallery child credits", () => {
  const { manifest, ids } = fixture(); const updates = canonicalMetadataUpdates("/demo/library", manifest, ids);
  assert.equal(updates.length, 17);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/groups/4").payload.name, "Contemporary Stories");
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/audios/1").payload.performerIds, [2]);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/texts/1").payload.performerIds, [1]);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/images/3").payload, { urls: ["https://archive.example/public/images/bdp-gal-01-example-film"], performerIds: [1] });
  assert.equal(updates.find(({ endpoint }) => endpoint === "/studios/1").payload.details, "A studio.");
  assert.match(updates.find(({ endpoint }) => endpoint === "/videos/1").payload.details, /12-second silent poster-based art preview, not feature-film footage/);
  assert.equal(updates.find(({ endpoint }) => endpoint === "/images/1").payload.title, "Alex Example: Design Reference");
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/images/1").payload.tagIds, []);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/images/2").payload.clearFields, ["studioId", "date"]);
  assert.equal(updates.find(({ endpoint }) => endpoint === "/images/4").payload.code, "BDP-IMG-26");
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/images/4").payload.tagIds, []);
});

test("canonical metadata plans reconcile both sides of tag hierarchy edges", () => {
  const { manifest, ids } = fixture(); manifest.tag_hierarchy = [{ parent: "Music", children: ["Drama", "Director"] }];
  const updates = canonicalMetadataUpdates("/demo/library", manifest, ids);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/tags/3").payload, {
    name: "Music", description: "A fictional demo catalog topic.", organized: true, aliases: [], parentIds: [], childIds: [2, 5],
  });
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/tags/2").payload.parentIds, [3]);
  assert.deepEqual(updates.find(({ endpoint }) => endpoint === "/tags/5").payload.parentIds, [3]);
});

test("explicit photo identities remain stable when the performer list changes", () => {
  const { manifest, ids } = fixture(); const original = performerPhotoPlans("/demo/library", manifest, ids)[0];
  const expanded = { ...manifest, performers: [...manifest.performers, { name: "Casey Example", slug: "casey-example", details: "An actor.", birth_date: "1998-01-01", country: "US", gender: "Male", career_start_year: 2018 }] };
  const after = performerPhotoPlans("/demo/library", expanded, ids)[0]; assert.deepEqual([after.code, after.expectedId], [original.code, original.expectedId]);
});

test("identity maps accept a managed collection's canonical key or updated display name", async () => {
  const { manifest } = fixture(); const empty = ["audios", "texts", "galleries", "images", "tags", "studios", "performers", "videos"];
  for (const liveName of ["Legacy Collection Key", "Contemporary Stories"]) {
    const api = { listAll: async (endpoint) => endpoint === "/groups" ? [{ id: 4, name: liveName }] : empty.includes(endpoint.slice(1)) ? [] : [] };
    const maps = await identityMaps(api, manifest); assert.equal(maps.collections["Legacy Collection Key"], 4); assert.deepEqual(maps.unmatched_collections, {});
  }
});

test("canonical sync is repeatable and applies identical full metadata before managed uploads", async () => {
  const { manifest, ids } = fixture(); const runs = [];
  for (let run = 0; run < 2; run += 1) {
    const requests = []; const uploads = []; const api = { request: async (method, endpoint, payload) => { requests.push({ method, endpoint, payload }); return {}; }, uploadImage: async (endpoint, filename) => uploads.push({ endpoint, filename }) };
    const result = await syncCanonicalDataset(api, "/demo/library", manifest, ids, false); runs.push({ requests, uploads, result });
  }
  assert.deepEqual(runs[1], runs[0]); assert.equal(runs[0].result.scans, 0); assert.equal(runs[0].result.metadata, 17);
  assert.equal(runs[0].requests.every(({ method }) => method === "PUT"), true); assert.equal(runs[0].uploads.length, 12);
});

test("descriptor tag artwork prefers a favorited tagged performer while media tags retain movie art", () => {
  const { manifest, ids } = fixture(); const uploads = managedImageUploads("/demo/library", manifest, ids);
  assert.equal(uploads.find(({ endpoint }) => endpoint === "/tags/5/image").filename, path.join("/demo/library", "performers", "alex-example", "portrait.jpg"));
  assert.equal(uploads.find(({ endpoint }) => endpoint === "/tags/2/image").filename, path.join("/demo/library", "example-film", "poster.jpg"));
  assert.equal(uploads.find(({ endpoint }) => endpoint === "/tags/4/image").filename, path.join("/demo/library", "example-film", "poster.jpg"));
});

test("scan planning includes generated audio and text and separately tracks gallery child associations", () => {
  const { manifest, ids } = fixture(); const targets = scannedArtworkTargets("/demo/library", manifest, ids);
  assert.deepEqual(targets.map(({ type }) => type), ["images", "images", "images", "videos", "audios", "texts", "galleries"]);
  const child = galleryImagePlans("/demo/library", manifest, ids)[0]; assert.equal(child.id, 3); assert.match(child.filename, /Feature Posters\.zip#virtual\/01-example-film\.jpg$/);
});

test("standalone plans keep canonical paths and reuse existing images without new gallery files", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = "/demo/library";
  const audios = audioPlans(library, manifest, expectedIds).filter(({ expectedId }) => expectedId > 25);
  const texts = textPlans(library, manifest, expectedIds).filter(({ expectedId }) => expectedId > 25);
  const galleries = standaloneGalleryPlans(manifest, expectedIds);
  assert.deepEqual(audios.map(({ expectedId }) => expectedId), [26, 27, 28]); assert.equal(audios.every(({ filename }) => filename.startsWith(path.join(library, "extras", "audios"))), true);
  assert.deepEqual(texts.map(({ expectedId }) => expectedId), [26, 27, 28, 29, 30, 31, 32]); assert.equal(texts.every(({ filename }) => filename.startsWith(path.join(library, "extras", "texts"))), true);
  assert.deepEqual(galleries.map(({ expectedId, imageIds }) => [expectedId, imageIds.length]), [[6, 4], [7, 9]]);
  assert.equal(galleries.every(({ payload }) => payload.clearFields.includes("studioId") && payload.videoIds.length === 0), true);
  assert.deepEqual(performerPhotoPlans(library, manifest, expectedIds).find(({ code }) => code === "BDP-IMG-36").payload.galleryIds, [6, 7]);
});

test("standalone gallery reconciliation changes only each managed gallery membership and is idempotent", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const plans = standaloneGalleryPlans(manifest, expectedIds);
  const memberships = new Map(plans.map((plan) => [plan.expectedId, new Set(plan.imageIds)])); const first = plans[0]; memberships.get(first.expectedId).delete(first.imageIds[0]); memberships.get(first.expectedId).add(999);
  const requests = []; const api = {
    listAll: async (endpoint) => { const id = Number(new URLSearchParams(endpoint.split("?")[1]).get("galleryId")); return [...memberships.get(id)].map((imageId) => ({ id: imageId })); },
    request: async (method, endpoint, payload) => { requests.push({ method, endpoint, payload }); const id = Number(endpoint.split("/")[2]); const set = memberships.get(id); for (const imageId of payload.imageIds) method === "POST" ? set.add(imageId) : set.delete(imageId); return {}; },
  };
  await reconcileStandaloneGalleryImages(api, manifest, expectedIds);
  assert.deepEqual(requests.map(({ method, payload }) => [method, payload.imageIds]), [["POST", [first.imageIds[0]]], ["DELETE", [999]]]);
  requests.length = 0; await reconcileStandaloneGalleryImages(api, manifest, expectedIds); assert.deepEqual(requests, []);
});

test("extension snapshot accepts only exact interrupted audio and text file paths", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = "/selected/library";
  const base = {
    tags: expectedIds.tags, studios: expectedIds.studios, performers: expectedIds.performers, collections: { ...expectedIds.built_in_groups, ...expectedIds.collections }, videos: expectedIds.videos,
    audios: Object.fromEntries(Object.entries(expectedIds.audios).slice(0, 25)), texts: Object.fromEntries(Object.entries(expectedIds.texts).slice(0, 25)), images: expectedIds.images,
    galleries: Object.fromEntries(Object.entries(expectedIds.galleries).slice(0, 5)), gallery_images: expectedIds.gallery_images,
    unmatched_collections: {}, unmatched_tags: {}, unmatched_studios: {}, unmatched_performers: {}, unmatched_videos: {}, unmatched_galleries: {}, unmatched_images: {}, uncoded_images: {},
  };
  const audio = audioPlans(library, manifest, expectedIds)[25]; const text = textPlans(library, manifest, expectedIds)[25];
  const interrupted = { ...base, unmatched_audios: { "audio:26": 26 }, uncoded_audios: { 26: [path.resolve(audio.filename)] }, unmatched_texts: { "text:26": 26 }, uncoded_texts: { 26: [path.resolve(text.filename)] } };
  assert.doesNotThrow(() => validateCanonicalExtensionSnapshot(interrupted, expectedIds, manifest, library));
  assert.throws(() => validateCanonicalExtensionSnapshot({ ...interrupted, uncoded_audios: { 26: ["/wrong/file.mp3"] } }, expectedIds, manifest, library), /append-only tag, media, and gallery extensions/);
});

test("interrupted standalone audio and text imports recover the exact file once and retry idempotently", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = "/selected/library";
  for (const kind of ["audios", "texts"]) {
    const plans = (kind === "audios" ? audioPlans : textPlans)(library, manifest, expectedIds).filter(({ standalone }) => standalone);
    const files = new Map([[plans[0].expectedId, [{ id: 900 + plans[0].expectedId, path: path.resolve(plans[0].filename) }]]]); const requests = []; const verified = [];
    const api = { request: async (method, endpoint, payload) => {
      requests.push({ method, endpoint, payload });
      if (method === "POST" && endpoint === `/${kind}/from-file`) { const id = plans.find(({ filename }) => path.resolve(filename) === path.resolve(payload.filePath)).expectedId; files.set(id, [{ id: 900 + id, path: path.resolve(payload.filePath) }]); return { id }; }
      if (method === "GET") return { id: Number(endpoint.split("/").at(-1)), files: structuredClone(files.get(Number(endpoint.split("/").at(-1)))) };
      if (method === "PUT") return {};
      throw new Error(`Unexpected request ${method} ${endpoint}`);
    } };
    const base = Object.fromEntries(Object.entries(expectedIds[kind]).slice(0, manifest.videos.length));
    const recovered = { [kind]: base, [`uncoded_${kind}`]: { [plans[0].expectedId]: [path.resolve(plans[0].filename)] } };
    const result = await appendFileBackedMedia(api, kind, library, manifest, expectedIds, recovered, "postgres://catalog", async (databaseUrl, id) => verified.push([databaseUrl, id]));
    assert.deepEqual(result, expectedIds[kind]); assert.deepEqual(verified.map(([, id]) => id), plans.slice(1).map(({ expectedId }) => expectedId));
    assert.equal(requests.filter(({ method }) => method === "POST").length, plans.length - 1);
    const postCount = requests.filter(({ method }) => method === "POST").length; verified.length = 0;
    await appendFileBackedMedia(api, kind, library, manifest, expectedIds, { [kind]: expectedIds[kind], [`uncoded_${kind}`]: {} }, "postgres://catalog", async (...args) => verified.push(args));
    assert.equal(requests.filter(({ method }) => method === "POST").length, postCount); assert.deepEqual(verified, []);
  }
});

test("standalone media association validation rejects missing and additional files", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = "/selected/library";
  const expectedFiles = new Map([
    ...audioPlans(library, manifest, expectedIds).filter(({ standalone }) => standalone).map((plan) => [`/audios/${plan.expectedId}`, [{ id: plan.expectedId, path: plan.filename }]]),
    ...textPlans(library, manifest, expectedIds).filter(({ standalone }) => standalone).map((plan) => [`/texts/${plan.expectedId}`, [{ id: plan.expectedId, path: plan.filename }]]),
  ]);
  const api = { request: async (_method, endpoint) => ({ files: structuredClone(expectedFiles.get(endpoint)) }) };
  await validateStandaloneMediaAssociations(api, library, manifest, expectedIds);
  const first = expectedFiles.keys().next().value; expectedFiles.get(first).push({ id: 999, path: "/unrelated/file.mp3" });
  await assert.rejects(validateStandaloneMediaAssociations(api, library, manifest, expectedIds), /must retain its exact file association/);
});

test("canonical preflight rejects a wrong standalone file association before any mutation", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = "/selected/library";
  const actual = {
    tags: expectedIds.tags, studios: expectedIds.studios, performers: expectedIds.performers, collections: { ...expectedIds.built_in_groups, ...expectedIds.collections },
    videos: expectedIds.videos, audios: expectedIds.audios, texts: expectedIds.texts, images: expectedIds.images, galleries: expectedIds.galleries, gallery_images: expectedIds.gallery_images,
    unmatched_collections: {}, unmatched_tags: {}, unmatched_studios: {}, unmatched_performers: {}, unmatched_videos: {}, unmatched_audios: {}, unmatched_texts: {}, unmatched_galleries: {}, unmatched_images: {}, uncoded_images: {}, uncoded_audios: {}, uncoded_texts: {},
  };
  const audioFiles = new Map(audioPlans(library, manifest, expectedIds).filter(({ standalone }) => standalone).map((plan) => [plan.expectedId, plan.expectedId === 27 ? "/wrong/audio.mp3" : plan.filename]));
  const textFiles = new Map(textPlans(library, manifest, expectedIds).filter(({ standalone }) => standalone).map((plan) => [plan.expectedId, plan.filename]));
  const requests = []; let uploads = 0;
  const api = {
    request: async (method, endpoint, payload) => { requests.push({ method, endpoint, payload }); const [kind, rawId] = endpoint.slice(1).split("/"); const filename = (kind === "audios" ? audioFiles : textFiles).get(Number(rawId)); return { id: Number(rawId), files: [{ id: Number(rawId) + 1000, path: filename }] }; },
    uploadImage: async () => { uploads += 1; },
  };
  await assert.rejects(prepareIdentityContract(api, library, manifest, expectedIds, false, "postgres://catalog", { readIdentities: async () => structuredClone(actual) }), /BDP-AUD-27 must retain its exact file association/);
  assert.deepEqual(requests.map(({ method, endpoint }) => [method, endpoint]), [["GET", "/audios/26"], ["GET", "/audios/27"]]); assert.equal(uploads, 0);
});

test("interrupted photo recovery resolves uncoded files against the selected library", () => {
  const { manifest, ids } = fixture(); const library = "/selected/demo-library";
  const actual = {
    tags: Object.fromEntries(Object.entries(ids.tags).slice(0, 4)), studios: ids.studios, performers: ids.performers, collections: { ...ids.built_in_groups, ...ids.collections }, videos: ids.videos, audios: ids.audios, texts: ids.texts,
    images: { "BDP-IMG-01": 1, "BDP-IMG-02": 2 }, galleries: ids.galleries, gallery_images: ids.gallery_images,
    unmatched_collections: {}, unmatched_tags: {}, unmatched_studios: {}, unmatched_performers: {}, unmatched_videos: {}, unmatched_audios: {}, unmatched_texts: {}, unmatched_galleries: {},
    unmatched_images: { "image:4": 4 }, uncoded_images: { 4: [path.resolve(library, "performers", "alex-example", "photos", "2021-06-01-publicity.jpg")] },
  };
  assert.doesNotThrow(() => validatePerformerPhotoExtensionSnapshot(actual, ids, manifest, library));
  assert.throws(() => validatePerformerPhotoExtensionSnapshot(actual, ids, manifest, "/wrong/library"), /append-only tag, media, and gallery extensions/);
});

test("tag extension accepts only the exact canonical ID prefix and appends deterministically", async () => {
  const { manifest, ids } = fixture(); const extendedManifest = { ...manifest, tags: [...manifest.tags, "Actor"] }; const extendedIds = { ...ids, tags: { ...ids.tags, Actor: 6 } }; const prefix = Object.fromEntries(Object.entries(ids.tags).slice(0, 4)); const calls = []; const verified = []; let nextId = 5;
  const api = { request: async (method, endpoint, payload) => { calls.push({ method, endpoint, payload }); return { id: nextId++, ...payload }; } };
  assert.deepEqual(await appendMissingTags(api, extendedManifest, extendedIds, prefix, "postgres://catalog", async (databaseUrl, expectedId) => verified.push([databaseUrl, expectedId])), extendedIds.tags);
  assert.deepEqual(verified, [["postgres://catalog", 5], ["postgres://catalog", 6]]); assert.deepEqual(calls.map(({ method, endpoint }) => [method, endpoint]), [["POST", "/tags"], ["POST", "/tags"]]);
  calls.length = 0; verified.length = 0; assert.deepEqual(await appendMissingTags(api, extendedManifest, extendedIds, extendedIds.tags, "postgres://catalog", async (...args) => verified.push(args)), extendedIds.tags); assert.deepEqual(calls, []); assert.deepEqual(verified, []);
  await assert.rejects(appendMissingTags({ request: async () => ({ id: 7 }) }, extendedManifest, extendedIds, prefix, "postgres://catalog", async () => {}), /expected 5, found 7/);
});

test("tag extension rejects gaps, reordered names, wrong IDs and unrelated catalog changes", () => {
  const { manifest, ids } = fixture(); const library = "/selected/demo-library";
  const canonical = { tags: Object.fromEntries(Object.entries(ids.tags).slice(0, 4)), studios: ids.studios, performers: ids.performers, collections: { ...ids.built_in_groups, ...ids.collections }, videos: ids.videos, audios: ids.audios, texts: ids.texts, images: ids.images, galleries: ids.galleries, gallery_images: ids.gallery_images, unmatched_collections: {}, unmatched_tags: {}, unmatched_studios: {}, unmatched_performers: {}, unmatched_videos: {}, unmatched_audios: {}, unmatched_texts: {}, unmatched_galleries: {}, unmatched_images: {}, uncoded_images: {} };
  assert.doesNotThrow(() => validateCanonicalExtensionSnapshot(canonical, ids, manifest, library));
  for (const tags of [{ ...canonical.tags, Director: 6 }, { "2020s": 1, Drama: 2, Music: 3, Director: 5 }, { ...canonical.tags, Intruder: 5 }]) assert.throws(() => validateCanonicalExtensionSnapshot({ ...canonical, tags }, ids, manifest, library), /append-only tag, media, and gallery extensions/);
  assert.throws(() => validateCanonicalExtensionSnapshot({ ...canonical, studios: { Studio: 2 } }, ids, manifest, library), /append-only tag, media, and gallery extensions/);
});

test("interrupted canonical extension appends tags before photos and is idempotent on retry", async () => {
  const { manifest, ids } = fixture(); const library = "/selected/demo-library";
  const state = {
    groups: [...Object.entries(ids.built_in_groups).map(([name, id]) => ({ id, name })), { id: 4, name: "Legacy Collection Key" }],
    audios: [{ id: 1, code: "BDP-AUD-01" }], texts: [{ id: 1, code: "BDP-TXT-01" }], galleries: [{ id: 1, code: "BDP-GAL-01" }],
    images: [{ id: 1, code: "BDP-IMG-01" }, { id: 2, code: "BDP-IMG-02" }, { id: 3, code: null, galleryIds: [1], files: [{ id: 3, basename: "01-example-film.jpg", path: `${library}/galleries/2020s - Feature Posters.zip#virtual/01-example-film.jpg` }] }],
    tags: Object.entries(ids.tags).slice(0, 4).map(([name, id]) => ({ id, name })), studios: [{ id: 1, name: "Studio" }],
    performers: [{ id: 1, name: "Alex Example" }, { id: 2, name: "Blair Example" }], videos: [{ id: 1, code: "BDP-01" }],
  };
  const verified = []; let jobId = 0; const requests = [];
  const api = {
    listAll: async (endpoint) => structuredClone(state[endpoint.slice(1).split("?")[0]]),
    request: async (method, endpoint, payload) => {
      requests.push({ method, endpoint, payload: structuredClone(payload) });
      if (method === "GET" && endpoint === "/system/config") return { covePaths: [{ path: library, excludeImage: true }], preserve: true };
      if (method === "PUT" && endpoint === "/system/config") return {};
      if (method === "POST" && endpoint === "/tags") { const entity = { id: 5, ...structuredClone(payload) }; state.tags.push(entity); return structuredClone(entity); }
      if (method === "POST" && endpoint === "/metadata/scan") { const filename = path.resolve(payload.paths[0]); state.images.push({ id: 4, code: null, galleryIds: [], files: [{ id: 4, basename: path.basename(filename), path: filename }] }); return { jobId: ++jobId }; }
      if (method === "GET" && endpoint.startsWith("/jobs/")) return { status: "completed", summary: "Scan complete: 1 imported, 0 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." };
      if (method === "GET" && endpoint === "/images/4") return structuredClone(state.images.find(({ id }) => id === 4));
      if (method === "PUT" && endpoint === "/images/4") { Object.assign(state.images.find(({ id }) => id === 4), structuredClone(payload)); return {}; }
      throw new Error(`Unexpected request ${method} ${endpoint}`);
    },
  };
  const dependencies = { verifyTag: async (databaseUrl, expectedId) => verified.push(["tag", databaseUrl, expectedId]), verifyImage: async (databaseUrl, expectedId) => verified.push(["image", databaseUrl, expectedId]) };
  const first = await prepareIdentityContract(api, library, manifest, ids, false, "postgres://catalog", dependencies);
  assert.deepEqual(first.tags, ids.tags); assert.deepEqual(first.images, ids.images); assert.deepEqual(verified, [["tag", "postgres://catalog", 5], ["image", "postgres://catalog", 4]]);
  const mutationCount = requests.filter(({ method }) => method === "POST").length; await prepareIdentityContract(api, library, manifest, ids, false, "postgres://catalog", dependencies);
  assert.equal(requests.filter(({ method }) => method === "POST").length, mutationCount); assert.equal(verified.length, 2);
});

test("temporary scanning enables every managed media type and restores the exact original configuration", async () => {
  const original = { covePaths: [{ path: "/demo/library/", excludeVideo: true, excludeImage: true, excludeAudio: true, excludeText: true, custom: "preserve" }], unrelated: { preserve: true } }; const puts = [];
  const api = { request: async (method, endpoint, payload) => method === "GET" ? structuredClone(original) : (puts.push(structuredClone(payload)), {}) };
  await withLibraryScanning(api, "/demo/library", async () => { assert.equal(puts[0].covePaths[0].excludeVideo, false); assert.equal(puts[0].covePaths[0].excludeImage, false); assert.equal(puts[0].covePaths[0].excludeAudio, false); assert.equal(puts[0].covePaths[0].excludeText, false); });
  assert.deepEqual(puts.at(-1), original);
});

test("rescans preserve exact file identities for gallery children as well as scanned records", async () => {
  const { manifest, ids } = fixture(); const library = "/demo/library"; const targets = [...scannedArtworkTargets(library, manifest, ids), ...galleryImagePlans(library, manifest, ids)];
  const entities = new Map(targets.map((target, index) => [`/${target.type}/${target.id}`, { id: target.id, files: [{ id: 100 + index, path: target.filename }] }]));
  const originalConfig = { covePaths: [{ path: library, excludeVideo: true, excludeImage: true, excludeAudio: true, excludeText: true }], preserve: true }; const configPuts = []; const jobs = new Map(); let lastScan;
  const api = {
    request: async (method, endpoint, payload) => {
      if (method === "GET" && endpoint === "/system/config") return structuredClone(originalConfig);
      if (method === "PUT" && endpoint === "/system/config") { configPuts.push(structuredClone(payload)); return {}; }
      if (method === "POST" && endpoint === "/metadata/scan") { const jobId = jobs.size + 1; lastScan = payload.paths[0]; jobs.set(jobId, lastScan); return { jobId }; }
      if (method === "GET" && endpoint.startsWith("/jobs/")) return { status: "completed", summary: "Scan complete: 0 imported, 1 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." };
      if (method === "GET" && entities.has(endpoint)) return structuredClone(entities.get(endpoint));
      throw new Error(`Unexpected request ${method} ${endpoint}`);
    },
    listAll: async (endpoint) => {
      const type = endpoint.slice(1).split("?")[0]; const match = [...entities.entries()].find(([key, entity]) => key.startsWith(`/${type}/`) && path.resolve(entity.files[0].path) === path.resolve(lastScan));
      return match ? [{ id: match[1].id, files: match[1].files }] : [];
    },
  };
  assert.equal(await syncScannedArtwork(api, library, manifest, ids), 7); assert.deepEqual(configPuts.at(-1), originalConfig);
});

test("fresh load creates the complete canonical identity graph in deterministic order", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const library = path.resolve("output/library");
  const state = Object.fromEntries(["tags", "studios", "performers", "groups", "videos", "audios", "texts", "images", "galleries"].map((type) => [type, []]));
  state.groups.push(...Object.entries(expectedIds.built_in_groups).map(([name, id]) => ({ id, name })));
  const references = performerReferencePlans(library, manifest, expectedIds); const photos = performerPhotoPlans(library, manifest, expectedIds); const galleries = galleryPlans(library, manifest, expectedIds); const children = galleryImagePlans(library, manifest, expectedIds);
  const imageScans = new Map([...references.map(plan => [path.resolve(plan.filename), plan]), ...photos.map(plan => [path.resolve(plan.filename), plan])]);
  const galleryScans = new Map(galleries.map(plan => [path.resolve(plan.filename), plan])); let fileId = 1; let jobId = 0; let uploads = 0; let sequenceDatabase;
  const nextId = (type) => state[type].length ? Math.max(...state[type].map(item => item.id)) + 1 : 1;
  const createFileEntity = (type, id, filename, extra = {}) => { const entity = { id, files: [{ id: fileId++, path: path.resolve(filename), basename: path.basename(filename) }], ...extra }; state[type].push(entity); return entity; };
  const api = {
    listAll: async (endpoint) => {
      const type = endpoint.slice(1).split("?")[0]; const galleryId = Number(new URLSearchParams(endpoint.split("?")[1] ?? "").get("galleryId"));
      return state[type].filter((item) => !galleryId || item.galleryIds?.includes(galleryId)).map(item => structuredClone(item));
    },
    request: async (method, endpoint, payload) => {
      if (method === "GET" && endpoint === "/system/config") return { covePaths: [{ path: library, excludeVideo: true, excludeImage: true, excludeAudio: true, excludeText: true }], preserve: "exactly" };
      if (method === "PUT" && endpoint === "/system/config") return {};
      if (method === "GET" && endpoint.startsWith("/jobs/")) return { status: "completed", summary: "Scan complete: 1 imported, 0 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." };
      if (method === "GET") { const [type, id] = endpoint.slice(1).split("/"); return structuredClone(state[type].find(item => item.id === Number(id))); }
      if (method === "POST" && endpoint === "/metadata/scan") {
        const filename = path.resolve(payload.paths[0]);
        if (imageScans.has(filename)) { const plan = imageScans.get(filename); createFileEntity("images", plan.expectedId, filename, { code: null, galleryIds: [] }); }
        else if (galleryScans.has(filename)) {
          const plan = galleryScans.get(filename); createFileEntity("galleries", plan.expectedId, filename, { code: null });
          for (const child of children.filter(item => item.label.startsWith(`${plan.code}/`))) createFileEntity("images", child.id, child.filename, { code: null, galleryIds: [plan.expectedId] });
        } else throw new Error(`Unexpected fresh scan ${filename}`);
        return { jobId: ++jobId };
      }
      if (method === "POST" && ["/tags", "/studios", "/performers", "/groups"].includes(endpoint)) { const type = endpoint.slice(1); const entity = { id: nextId(type), ...structuredClone(payload) }; state[type].push(entity); return structuredClone(entity); }
      if (method === "POST" && endpoint === "/galleries") { const entity = { id: nextId("galleries"), ...structuredClone(payload), files: [] }; state.galleries.push(entity); return structuredClone(entity); }
      if ((method === "POST" || method === "DELETE") && /^\/galleries\/\d+\/images$/.test(endpoint)) { const galleryId = Number(endpoint.split("/")[2]); for (const image of state.images.filter(({ id }) => payload.imageIds.includes(id))) { image.galleryIds ??= []; if (method === "POST" && !image.galleryIds.includes(galleryId)) image.galleryIds.push(galleryId); if (method === "DELETE") image.galleryIds = image.galleryIds.filter((id) => id !== galleryId); } return {}; }
      if (method === "POST" && ["/videos/from-file", "/audios/from-file", "/texts/from-file"].includes(endpoint)) { const type = endpoint.slice(1).split("/")[0]; return structuredClone(createFileEntity(type, nextId(type), payload.filePath, { code: null })); }
      if (method === "PUT") { const [type, id] = endpoint.slice(1).split("/"); const entity = state[type].find(item => item.id === Number(id)); Object.assign(entity, structuredClone(payload)); return structuredClone(entity); }
      throw new Error(`Unexpected request ${method} ${endpoint}`);
    },
    uploadImage: async () => { uploads += 1; },
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "cove-fresh-load-")); const idMap = path.join(directory, "id-map.json");
  await loadIntoCove(api, library, expectedIds, idMap, "postgres://fresh", { validate: async () => {}, verifyFresh: async (databaseUrl) => { sequenceDatabase = databaseUrl; } });
  const written = JSON.parse(await readFile(idMap, "utf8")); assert.equal(sequenceDatabase, "postgres://fresh"); assert.equal(uploads, managedImageUploads(library, manifest, expectedIds).length);
  const tagsByName = new Map(state.tags.map((tag) => [tag.name, tag]));
  for (const { parent, children } of manifest.tag_hierarchy) {
    assert.deepEqual(tagsByName.get(parent).childIds, children.map((name) => expectedIds.tags[name]));
    for (const child of children) assert.deepEqual(tagsByName.get(child).parentIds, [expectedIds.tags[parent]]);
  }
  assert.equal(tagsByName.get("Demo Archive").description, manifest.tag_descriptions["Demo Archive"]);
  for (const type of ["tags", "studios", "performers", "videos", "audios", "texts", "images", "galleries", "gallery_images"]) assert.deepEqual(written[type], expectedIds[type], type);
  assert.deepEqual(written.collections, { ...expectedIds.built_in_groups, ...expectedIds.collections });
  assert.equal(state.images.find(({ id }) => id === 26).files[0].path.endsWith("#virtual/01-neon-alibi.jpg"), true);
  assert.equal(state.images.find(({ id }) => id === 51).files[0].path.endsWith("/performers/cressida-maraschino/photos/1961-04-12-debut-publicity.jpg"), true);
  for (const plan of standaloneGalleryPlans(manifest, expectedIds)) assert.deepEqual(state.images.filter(({ galleryIds = [] }) => galleryIds.includes(plan.expectedId)).map(({ id }) => id).sort((left, right) => left - right), [...plan.imageIds].sort((left, right) => left - right));
  assert.deepEqual(state.images.find(({ id }) => id === expectedIds.images["BDP-IMG-36"]).galleryIds.sort((left, right) => left - right), [6, 7]);
});
