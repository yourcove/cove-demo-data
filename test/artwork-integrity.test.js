import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { digest, validateDistinctAssets, videoArtworkSource, writePerformer } from "../src/build.js";
import { loadManifest, root } from "../src/manifests.js";

test("all canonical reference sheets survive production exports byte for byte", async () => {
  const manifest = await loadManifest();
  const target = await mkdtemp(path.join(os.tmpdir(), "cove-references-"));
  for (const performer of manifest.performers) {
    await writePerformer(target, performer);
    assert.equal(await digest(path.join(target, "performers", performer.slug, "reference.jpg")),
      await digest(path.join(root, "assets", "performers", performer.slug + ".jpg")), performer.slug);
    for (const photo of performer.photos ?? []) assert.equal(
      await digest(path.join(target, "performers", performer.slug, "photos", photo.filename)),
      await digest(path.join(root, "assets", "performer-photo-sets", performer.slug, photo.filename)));
  }
});

test("production validation rejects a review sheet substituted for a canonical reference", async () => {
  const performer = (await loadManifest()).performers[0];
  const target = await mkdtemp(path.join(os.tmpdir(), "cove-review-substitution-"));
  await writePerformer(target, performer);
  await writeFile(path.join(target, "performers", performer.slug, "reference.jpg"), "review contact sheet");
  await assert.rejects(validateDistinctAssets(target, { performers: [performer], videos: [], studios: [] }), /canonical source/);
});

test("studio artwork cannot reuse a performer reference or profile photograph", async () => {
  const performer = (await loadManifest()).performers[1];
  for (const asset of ["reference.jpg", "portrait.jpg"]) {
    const target = await mkdtemp(path.join(os.tmpdir(), "cove-studio-performer-collision-"));
    await writePerformer(target, performer);
    await mkdir(path.join(target, "studios", "test-studio"), { recursive: true });
    await cp(path.join(target, "performers", performer.slug, asset), path.join(target, "studios", "test-studio", "logo.jpg"));
    await assert.rejects(validateDistinctAssets(target, { performers: [performer], videos: [], studios: [{ name: "Test Studio" }] }), /must not reuse/);
  }
});

// Legacy cover files remain archived, but cannot override reviewed cast artwork.
test("video playback and stills use the chronology-reviewed poster source", async () => {
  for (const video of (await loadManifest()).videos) {
    assert.equal(videoArtworkSource(video), path.join(root, "assets", "posters", video.poster));
  }
});
