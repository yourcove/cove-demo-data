import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { performerPhotoPlans, validatePerformerPhotoExtensionSnapshot } from "../src/load.js";
import { loadAllManifests, performerPhotosFor } from "../src/manifests.js";

test("performer photo shoots have stable append-only identities", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const photos = performerPhotosFor(manifest); const plans = performerPhotoPlans("/demo/library", manifest, expectedIds); const cressida = plans.filter(({ code }) => ["BDP-IMG-26", "BDP-IMG-27", "BDP-IMG-28", "BDP-IMG-29"].includes(code));
  assert.ok(photos.length >= 10); assert.equal(plans.length, photos.length);
  assert.deepEqual(cressida.map(({ code, expectedId }) => [code, expectedId]), [["BDP-IMG-26", 51], ["BDP-IMG-27", 52], ["BDP-IMG-28", 53], ["BDP-IMG-29", 54]]);
  assert.deepEqual(plans.map(({ expectedId }) => expectedId), Array.from({ length: photos.length }, (_, index) => index + 51));
  assert.deepEqual(plans.map(({ filename }) => path.relative("/demo/library", filename)), [...photos].sort((left, right) => left.id - right.id).map((photo) => path.join("performers", photo.performer.slug, "photos", photo.filename)));
  assert.equal(new Set(cressida.map(({ payload }) => payload.date)).size, 4);
  assert.equal(plans.every(({ payload }) => payload.performerIds.length === 1), true);
  for (const plan of plans) assert.deepEqual(plan.payload.galleryIds, manifest.standalone_galleries.filter(({ image_refs }) => image_refs.includes(plan.code)).map(({ id }) => id).sort((left, right) => left - right));
});

test("performer photo migration accepts only a canonical extension prefix and its recoverable next scan", async () => {
  const { manifest, expectedIds } = await loadAllManifests(); const extensionCodes = new Set(performerPhotoPlans("/demo", manifest, expectedIds).map(({ code }) => code));
  const baseImages = Object.fromEntries(Object.entries(expectedIds.images).filter(([code]) => !extensionCodes.has(code)));
  const actual = {
    tags: expectedIds.tags, studios: expectedIds.studios, performers: expectedIds.performers, videos: expectedIds.videos, audios: expectedIds.audios, texts: expectedIds.texts,
    images: baseImages, galleries: expectedIds.galleries, gallery_images: expectedIds.gallery_images, collections: { ...expectedIds.built_in_groups, ...expectedIds.collections },
    unmatched_collections: {}, unmatched_tags: {}, unmatched_studios: {}, unmatched_performers: {}, unmatched_videos: {}, unmatched_audios: {}, unmatched_texts: {}, unmatched_galleries: {}, unmatched_images: {}, uncoded_images: {},
  };
  assert.doesNotThrow(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest));
  actual.images["BDP-IMG-26"] = expectedIds.images["BDP-IMG-26"];
  assert.doesNotThrow(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest));
  actual.images["BDP-IMG-28"] = expectedIds.images["BDP-IMG-28"];
  assert.throws(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest), /only the expected append-only tag, media, and gallery extensions/);
  delete actual.images["BDP-IMG-28"];
  actual.unmatched_images["image:52"] = 52; actual.uncoded_images[52] = [path.resolve("/library/performers/cressida-maraschino/photos/1964-07-18-resort-editorial.jpg")];
  assert.doesNotThrow(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest));
  actual.uncoded_images[52] = [path.resolve("/library/performers/cressida-maraschino/photos/wrong.jpg")];
  assert.throws(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest), /only the expected append-only tag, media, and gallery extensions/);
  actual.unmatched_images = {}; actual.uncoded_images = {};
  actual.images["unexpected"] = 999;
  assert.throws(() => validatePerformerPhotoExtensionSnapshot(actual, expectedIds, manifest), /only the expected append-only tag, media, and gallery extensions/);
});
