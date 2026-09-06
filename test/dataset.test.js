import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performerArtBrief, videoArtBrief } from "../src/art-direction.js";
import { build, sourceArtworkInventory, validateDistinctAssets } from "../src/build.js";
import { ageOnDate } from "../src/dates.js";
import { canonicalMetadataUpdates, demoUrls, expectedBundlePaths, identityMaps, isOwnedVideo, managedImageUploads, performerBirthdateUpdates, scannedArtworkTargets, syncIntoCove, validateBuiltArtwork, validateBundle, validateScanCompletion, validateScanTargetAssociations, verifyFreshSequences, verifyNextImageSequence, verifyNextTagSequence, withLibraryScanning } from "../src/load.js";
import { assetSlug, galleriesFor, loadAllManifests, loadManifest, validateManifest } from "../src/manifests.js";

test("manifest contains the complete fictional catalog in deterministic order", async () => {
  const { manifest, expectedIds } = await loadAllManifests();
  assert.equal(manifest.videos.length, 25); assert.equal(manifest.performers.length, 25); assert.equal(manifest.collections.length, 5);
  assert.deepEqual(manifest.videos.map(({ slug }) => slug), ["neon-alibi", "curtain-call-collect", "dangerously-overdressed", "one-more-number-before-dawn", "the-last-honest-mirror", "dial-m-for-makeover", "negative-space", "the-usual-accessories", "exposure-compensation", "tomorrow-never-rsvpd", "room-service-for-two", "terms-and-conditions-apply", "the-supporting-evidence", "love-in-the-time-of-voicemail", "half-light-at-closing", "undercover-overdressed", "the-unreliable-dress-rehearsal", "a-very-public-secret", "rooms-with-an-alibi", "exit-music-for-two", "soft-launch", "everyone-is-muted", "rook-new-orders", "the-last-take-was-perfect", "a-favor-between-professionals"]);
  assert.deepEqual(manifest.performers.map(({ name }) => name), ["Cressida Maraschino", "Velvet Thunder", "Beatrix Havenly", "Randolph Dandridge", "Gideon Slate", "Simona Valewood", "Marisol Vega", "Kenji Watanari", "Julian March", "Amina Shaw", "Darius King", "Rafael Sato", "Tess North", "Nia Hart", "Dev Malik", "Sofia Calderon", "Ellis Ward", "Bella Bloom", "Imani Cole", "Arun Sen", "Lucia Ferrer", "Amara Okoye", "June Park", "Elias Grant", "Noor Haddad"]);
  assert.deepEqual(manifest.studios.map(({ name }) => name), ["Barely Dressed Pictures", "Second Take Features", "Electric Marquee", "Open Secret Features", "Fourth Wall Pictures", "Available Light Cooperative"]);
  assert.deepEqual(manifest.collections.map(({ name }) => name), ["Electric Evenings: The 1980s", "Wrong Coats: The 1990s", "Fine Print: The 2000s", "Open Secrets: The 2010s", "New Orders: The 2020s"]);
  assert.deepEqual(manifest.tags, ["1980s", "1990s", "2000s", "2010s", "2020s", "Comedy", "Mystery", "Drama", "Romance", "Caper", "Thriller", "Workplace", "Backstage", "Music", "Generated Artwork", "Bodybuilder", "Stunt Performer", "Actor", "Voice Actor", "Comedian", "Director", "Screenwriter", "Composer", "Musician", "Choreographer", "Photographer", "Editor", "Sound Designer", "Sound Recordist", "Stage Performer", "Documentary Filmmaker", "Athlete", "Demo Archive", "Release Decade", "Story Genre", "Story Theme", "People", "Performance", "Filmmaking Craft", "Production Metadata"]);
  assert.deepEqual(Object.keys(expectedIds.videos), Array.from({ length: 25 }, (_, index) => `BDP-${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(Object.keys(expectedIds.images), Array.from({ length: 44 }, (_, index) => `BDP-IMG-${String(index + 1).padStart(2, "0")}`));
  assert.equal(Object.keys(expectedIds.images).length, 44); assert.equal(Object.keys(expectedIds.gallery_images).length, 25);
  assert.deepEqual(galleriesFor(manifest).map(({ videos }) => videos.length), [5, 5, 6, 4, 5]);
});

test("catalog has no remote or public-domain source metadata", async () => {
  const source = JSON.stringify(await loadManifest()).toLowerCase().replaceAll(/[-_]+/g, " ");
  for (const forbidden of ["nasa", "wikimedia", "public domain", "http://", "https://", "cherry poppins", "bea haven", "randy dandy", "kenji watanabe", "simone vale", "open secret films"]) assert.equal(source.includes(forbidden), false, forbidden);
});

test("canonical metadata gives every URL-capable demo record a filterable archive URL", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const updates = canonicalMetadataUpdates("/demo/library", manifest, expectedIds);
  const urlUpdates = updates.filter(({ endpoint }) => /^\/(videos|images|galleries|audios|texts|performers|studios|groups)\//.test(endpoint));
  const actualCounts = Object.groupBy(urlUpdates, ({ endpoint }) => endpoint.split("/")[1]);
  const expectedCounts = {
    audios: Object.keys(expectedIds.audios).length, galleries: Object.keys(expectedIds.galleries).length, groups: manifest.collections.length,
    images: Object.keys(expectedIds.images).length + Object.keys(expectedIds.gallery_images).length, performers: manifest.performers.length,
    studios: manifest.studios.length, texts: Object.keys(expectedIds.texts).length, videos: manifest.videos.length,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(actualCounts).map(([kind, records]) => [kind, records.length])), expectedCounts);
  assert.equal(new Set(urlUpdates.map(({ endpoint }) => endpoint)).size, urlUpdates.length);
  assert.equal(urlUpdates.every(({ payload }) => payload.urls?.some((url) => url.startsWith("https://archive.example/"))), true);
  const videoUrls = urlUpdates.filter(({ endpoint }) => endpoint.startsWith("/videos/")).flatMap(({ payload }) => payload.urls);
  assert.equal(videoUrls.some((url) => url.includes("/public/")), true); assert.equal(videoUrls.some((url) => url.includes("/private/")), true);
  assert.deepEqual(demoUrls("videos", "stable-record", ["https://source.example/item"]), ["https://source.example/item", demoUrls("videos", "stable-record")[0]]);
});

test("performers have exact fictional birthdates and plausible adult careers", async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.performers.every(({ birth_date }) => /^\d{4}-\d{2}-\d{2}$/.test(birth_date)), true);
  assert.equal(new Set(manifest.performers.map(({ birth_date }) => birth_date)).size, manifest.performers.length);
  assert.throws(() => validateManifest({ ...manifest, performers: manifest.performers.map((performer, index) => index ? performer : { ...performer, birth_date: "1948-02-30" }) }), /valid calendar date/);
  assert.throws(() => validateManifest({ ...manifest, performers: manifest.performers.map((performer, index) => index ? performer : { ...performer, birth_date: "1950-03-17" }) }), /career starts before adulthood/);
});

test("art briefs calculate calendar age and bind it to period direction", async () => {
  const manifest = await loadManifest();
  assert.equal(ageOnDate("1937-03-17", "1964-03-16"), 26);
  assert.equal(ageOnDate("1937-03-17", "1964-03-17"), 27);
  const performer = performerArtBrief(manifest, "cressida-maraschino", "1964-07-10");
  assert.deepEqual(performer.subjects[0], { name: "Cressida Maraschino", slug: "cressida-maraschino", birth_date: "1937-03-17", age: 27 });
  assert.equal(performer.period.decade, "1960s");
  assert.match(performer.period.environment, /no digital cameras/i);
  const video = videoArtBrief(manifest, "neon-alibi");
  assert.equal(video.depicts_date, "2005-10-08");
  assert.deepEqual(video.subjects.map(({ age }) => age), [31, 39, 37]);
  assert.throws(() => performerArtBrief(manifest, "cressida-maraschino", "1950-01-01"), /under 18/);
});

test("the generated bundle passes its checksum inventory", async () => { await validateBundle(path.resolve("output/library")); });
test("the expected bundle contract derives every canonical file path", async () => { const manifest = await loadManifest(); const photos = manifest.performers.reduce((count, performer) => count + (performer.photos?.length ?? 0), 0); const standaloneMedia = (manifest.standalone_audios?.length ?? 0) + (manifest.standalone_texts?.length ?? 0) + [...(manifest.standalone_audios ?? []), ...(manifest.standalone_texts ?? [])].filter(({ cover }) => cover).length; assert.equal(expectedBundlePaths(manifest).size, manifest.collections.length + manifest.performers.length * 4 + photos + manifest.studios.length + manifest.videos.length * 12 + Math.ceil(manifest.videos.length / 5) + standaloneMedia); });
test("video ownership requires the local fixture identifier", () => { assert.equal(isOwnedVideo({ remoteIds: [{ endpoint: "cove-demo", remoteId: "neon-alibi" }] }, "neon-alibi"), true); assert.equal(isOwnedVideo({ remoteIds: [{ endpoint: "cove-demo", remoteId: "other" }] }, "neon-alibi"), false); });

test("builder refuses to replace an unrelated output directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cove-unsafe-output-")); await writeFile(path.join(directory, "valuable.txt"), "keep me");
  await assert.rejects(build({ output: directory }), /Refusing to replace non-demo/); assert.equal(await readFile(path.join(directory, "valuable.txt"), "utf8"), "keep me");
});

test("distinct asset validation rejects studio logos copied from media artwork", async () => {
  const manifest = await loadManifest();
  for (const reusedArtwork of ["poster", "cover", "standalone-cover"]) {
    const library = await mkdtemp(path.join(os.tmpdir(), `cove-reused-${reusedArtwork}-logo-`));
    for (const video of manifest.videos) {
      const directory = path.join(library, video.slug); await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "poster.jpg"), `poster:${video.slug}`);
      await writeFile(path.join(directory, "score-cover.jpg"), `cover:${video.slug}`);
    }
    for (const audio of manifest.standalone_audios ?? []) if (audio.cover) { const directory = path.join(library, "extras", "audios"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${audio.slug}-cover.jpg`), `standalone:${audio.slug}`); }
    for (const text of manifest.standalone_texts ?? []) if (text.cover) { const directory = path.join(library, "extras", "texts"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${text.slug}-cover.jpg`), `standalone-text:${text.slug}`); }
    for (const [index, studio] of manifest.studios.entries()) {
      const directory = path.join(library, "studios", assetSlug(studio.name)); await mkdir(directory, { recursive: true });
      const reused = reusedArtwork === "standalone-cover" ? `standalone:${manifest.standalone_audios.find(({ cover }) => cover).slug}` : `${reusedArtwork}:${manifest.videos[0].slug}`;
      await writeFile(path.join(directory, "logo.jpg"), index === 0 ? reused : `logo:${studio.name}`);
    }
    await assert.rejects(validateDistinctAssets(library, { ...manifest, performers: [] }), /Studio logos must not reuse movie, audio or performer artwork/);
  }
});

test("distinct asset validation includes standalone audio covers in uniqueness", async () => {
  const manifest = await loadManifest(); const library = await mkdtemp(path.join(os.tmpdir(), "cove-duplicate-standalone-cover-"));
  for (const video of manifest.videos) { const directory = path.join(library, video.slug); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "poster.jpg"), `poster:${video.slug}`); await writeFile(path.join(directory, "score-cover.jpg"), `cover:${video.slug}`); }
  for (const [index, audio] of (manifest.standalone_audios ?? []).filter(({ cover }) => cover).entries()) { const directory = path.join(library, "extras", "audios"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${audio.slug}-cover.jpg`), index < 2 ? "duplicate standalone cover" : `standalone:${audio.slug}`); }
  for (const studio of manifest.studios) { const directory = path.join(library, "studios", assetSlug(studio.name)); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "logo.jpg"), `logo:${studio.name}`); }
  await assert.rejects(validateDistinctAssets(library, { ...manifest, performers: [] }), /Audio covers must be unique/);
});

test("duplicate gallery image identities are recorded as unmatched", async () => {
  const responses = { "/groups": [], "/audios": [], "/texts": [], "/galleries": [{ id: 1, code: "BDP-GAL-01" }], "/images": [{ id: 10, galleryIds: [1], files: [{ basename: "same.jpg" }] }, { id: 11, galleryIds: [1], files: [{ basename: "same.jpg" }] }], "/tags": [], "/studios": [], "/performers": [], "/videos": [] };
  const maps = await identityMaps({ listAll: async (endpoint) => responses[endpoint] }); assert.equal(maps.gallery_images["BDP-GAL-01/same.jpg"], 10); assert.equal(maps.unmatched_images["duplicate:BDP-GAL-01/same.jpg:11"], 11);
});

test("identity maps retain no-code and duplicate records as unmatched", async () => {
  const responses = { "/groups": [], "/audios": [], "/texts": [], "/images": [], "/tags": [], "/studios": [], "/galleries": [{ id: 7 }, { id: 8, code: "BDP-GAL-01" }, { id: 9, code: "BDP-GAL-01" }], "/performers": [{ id: 3, name: "Duplicate" }, { id: 4, name: "Duplicate" }], "/videos": [{ id: 5 }, { id: 6, code: "BDP-01" }, { id: 10, code: "BDP-01" }, { id: 11, code: "__proto__" }] };
  const maps = await identityMaps({ listAll: async (endpoint) => responses[endpoint] });
  assert.deepEqual(maps.videos, Object.fromEntries([["BDP-01", 6], ["__proto__", 11]])); assert.deepEqual(maps.unmatched_videos, { "video:5": 5, "duplicate:video:BDP-01:10": 10 });
  assert.deepEqual(maps.unmatched_galleries, { "gallery:7": 7, "duplicate:gallery:BDP-GAL-01:9": 9 });
  assert.deepEqual(maps.unmatched_performers, { "duplicate:performer:Duplicate:4": 4 });
});

test("identity sequence verification requires a database URL", async () => {
  await assert.rejects(verifyFreshSequences(), /database-url is required/);
  await assert.rejects(verifyNextImageSequence(undefined, 51), /database-url is required/);
  await assert.rejects(verifyNextTagSequence(undefined, 16), /database-url is required/);
});

test("managed artwork plan covers every uploaded entity image", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const uploads = managedImageUploads("/demo/library", manifest, expectedIds);
  const studioUploads = uploads.filter(({ endpoint }) => endpoint.startsWith("/studios/"));
  const standaloneCoverCount = [...(manifest.standalone_audios ?? []), ...(manifest.standalone_texts ?? [])].filter(({ cover }) => cover).length;
  const expectedUploadCount = manifest.performers.length + manifest.studios.length + manifest.collections.length + manifest.tags.length + manifest.videos.length * 3 + standaloneCoverCount;
  assert.equal(uploads.length, expectedUploadCount); assert.equal(new Set(uploads.map(({ endpoint }) => endpoint)).size, uploads.length);
  assert.equal(uploads.filter(({ endpoint }) => endpoint.startsWith("/performers/")).length, 25);
  assert.equal(uploads.filter(({ endpoint }) => endpoint.startsWith("/videos/")).length, 25);
  assert.equal(uploads.filter(({ endpoint }) => endpoint.startsWith("/audios/")).length, manifest.videos.length + (manifest.standalone_audios ?? []).filter(({ cover }) => cover).length);
  assert.equal(uploads.filter(({ endpoint }) => endpoint.startsWith("/texts/")).length, manifest.videos.length + (manifest.standalone_texts ?? []).filter(({ cover }) => cover).length);
  assert.deepEqual(studioUploads.map(({ filename }) => filename), manifest.studios.map((studio) => path.join("/demo/library", "studios", assetSlug(studio.name), "logo.jpg")));
  assert.equal(new Set(studioUploads.map(({ filename }) => filename)).size, manifest.studios.length);
  assert.equal(uploads.some(({ endpoint }) => endpoint.includes("metadata/scan")), false);
});

test("performer birthdate updates preserve canonical identities", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const updates = performerBirthdateUpdates(manifest, expectedIds);
  assert.equal(updates.length, manifest.performers.length);
  assert.equal(new Set(updates.map(({ endpoint }) => endpoint)).size, manifest.performers.length);
  assert.deepEqual(updates[0], { endpoint: `/performers/${expectedIds.performers["Cressida Maraschino"]}`, payload: { birthdate: "1937-03-17" } });
});

test("source artwork inventory tracks explicit performer portrait overrides", async () => {
  const { manifest } = await loadAllManifests(); const inventory = await sourceArtworkInventory(manifest);
  assert.ok(inventory["assets/performer-portraits/imani-cole.jpg"]);
});

test("source artwork inventory tracks every studio logo", async () => {
  const { manifest } = await loadAllManifests(); const inventory = await sourceArtworkInventory(manifest);
  assert.equal(Object.keys(inventory).filter((filename) => filename.startsWith("assets/studio-logos/")).length, manifest.studios.length);
});

test("scanned artwork targets require the canonical records to use the selected library", async () => {
  const targets = [{ type: "images", id: 4, filename: "/selected/reference.jpg" }];
  await assert.rejects(validateScanTargetAssociations({ request: async () => ({ files: [{ path: "/other/reference.jpg" }] }) }, targets), /not associated/);
});

test("scanned artwork association validation preserves exact file IDs and paths", async () => {
  const targets = [{ type: "images", id: 4, filename: "/selected/reference.jpg", label: "selected" }];
  const original = await validateScanTargetAssociations({ request: async () => ({ files: [{ id: 8, path: "/selected/reference.jpg" }] }) }, targets);
  await assert.rejects(validateScanTargetAssociations({ request: async () => ({ files: [{ id: 9, path: "/selected/reference.jpg" }] }) }, targets, original), /file associations changed/);
  await assert.rejects(validateScanTargetAssociations({ request: async () => ({ files: [{ id: 8, path: "/selected/reference.jpg" }, { id: 10, path: "/selected/extra.jpg" }] }) }, targets, original), /file associations changed/);
});

test("scan completion rejects skipped or partially failed file processing", () => {
  assert.doesNotThrow(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 1 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." }));
  assert.throws(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 0 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." }), /exactly one file/);
  assert.throws(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 1 updated, 1 invalid media file skipped, 0 unsettled files deferred, 0 file failures, 0 asset generation failures." }), /exactly one file/);
  assert.throws(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 1 updated, 0 invalid media files skipped, 1 unsettled file deferred, 0 file failures, 0 asset generation failures." }), /exactly one file/);
  assert.throws(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 1 updated, 0 invalid media files skipped, 0 unsettled files deferred, 1 file failure, 0 asset generation failures." }), /exactly one file/);
  assert.throws(() => validateScanCompletion("images", { summary: "Scan complete: 0 imported, 1 updated, 0 invalid media files skipped, 0 unsettled files deferred, 0 file failures, 1 asset generation failure." }), /exactly one file/);
});

test("temporary scan configuration restores the exact original paths on failure", async () => {
  const original = { covePaths: [{ path: "/demo", excludeVideo: true, excludeImage: false, excludeAudio: false, excludeText: true, custom: "keep" }], unrelated: true }; const puts = [];
  const api = { request: async (method, endpoint, payload) => { if (method === "GET") return structuredClone(original); puts.push(structuredClone(payload)); return {}; } };
  await assert.rejects(withLibraryScanning(api, "/demo", async () => { throw new Error("scan failed"); }), /scan failed/);
  assert.equal(puts.length, 2); assert.equal(puts[0].covePaths[0].excludeVideo, false); assert.equal(puts[0].covePaths[0].excludeImage, false); assert.deepEqual(puts[1], original);
});

test("scanned artwork plan covers every canonical file association", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const targets = scannedArtworkTargets("/demo/library", manifest, expectedIds);
  const photos = manifest.performers.reduce((count, performer) => count + (performer.photos?.length ?? 0), 0); const expectedTargetCount = manifest.performers.length + photos + manifest.videos.length * 3 + manifest.collections.length + (manifest.standalone_audios?.length ?? 0) + (manifest.standalone_texts?.length ?? 0);
  assert.equal(targets.length, expectedTargetCount); assert.equal(new Set(targets.map(({ type, id }) => `${type}:${id}`)).size, expectedTargetCount);
});

test("built artwork validation rejects tracked assets newer than output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cove-stale-artwork-")); const { manifest: canonical } = await loadAllManifests(); const performer = canonical.performers[0]; const manifest = { performers: [performer], videos: [] };
  await mkdir(path.join(directory, "performers", performer.slug), { recursive: true }); await writeFile(path.join(directory, ".cove-demo-dataset"), JSON.stringify({ source_artwork_sha256: {} }));
  await assert.rejects(validateBuiltArtwork(directory, manifest), /run npm run build/);
});

test("sync refuses a noncanonical instance before uploading artwork", async () => {
  const { expectedIds } = await loadAllManifests(); let uploads = 0;
  const api = {
    listAll: async (endpoint) => endpoint === "/groups" ? Object.entries(expectedIds.built_in_groups).map(([name, id]) => ({ id, name })) : [],
    uploadImage: async () => { uploads += 1; },
  };
  await assert.rejects(syncIntoCove(api, path.resolve("output/library"), expectedIds), /must be canonical/);
  assert.equal(uploads, 0);
});
