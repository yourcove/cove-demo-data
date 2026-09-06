import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest, performerPhotoSetSources, sourceArtworkInventory, writePerformer } from "../src/build.js";
import { ageOnDate } from "../src/dates.js";
import { loadManifest, root } from "../src/manifests.js";

const setDirectory = path.join(root, "assets", "performer-photo-sets", "cressida-maraschino");

test("Cressida photo-set notes match the dated source assets and canonical chronology", async () => {
  const manifest = await loadManifest(); const performer = manifest.performers.find(({ slug }) => slug === "cressida-maraschino");
  const notes = JSON.parse(await readFile(path.join(setDirectory, "generation-notes.json"), "utf8"));
  assert.equal(notes.birth_date, performer.birth_date);
  assert.deepEqual(notes.photos.slice(0, 4).map(({ filename }) => filename), [
    "1961-04-12-debut-publicity.jpg",
    "1964-07-18-resort-editorial.jpg",
    "1967-09-06-on-set-candid.jpg",
    "1969-11-03-premiere-arrival.jpg",
  ]);
  for (const photo of notes.photos) {
    assert.equal(photo.age, ageOnDate(notes.birth_date, photo.depicts_date));
    assert.deepEqual(photo.intentional_anachronisms, []);
    assert.equal(photo.prompt_lines.length > 8, true);
  }
  const sources = await performerPhotoSetSources(performer); const inventory = await sourceArtworkInventory(manifest);
  assert.deepEqual(sources.map((filename) => path.basename(filename)), notes.photos.map(({ filename }) => filename));
  assert.equal(sources.every((filename) => inventory[filename]), true);
});

test("Cressida canonical illustrated reference is preserved independently of all dated photo shoots", async () => {
  const manifest = await loadManifest(); const performer = manifest.performers.find(({ slug }) => slug === "cressida-maraschino");
  const first = await mkdtemp(path.join(os.tmpdir(), "cove-cressida-contact-a-")); const second = await mkdtemp(path.join(os.tmpdir(), "cove-cressida-contact-b-"));
  await writePerformer(first, performer); await writePerformer(second, performer);
  const firstReference = path.join(first, "performers", performer.slug, "reference.jpg");
  const secondReference = path.join(second, "performers", performer.slug, "reference.jpg");
  assert.equal(await digest(firstReference), await digest(secondReference));
  assert.equal(await digest(firstReference), await digest(path.join(root, "assets", "performers", `${performer.slug}.jpg`)));
});
