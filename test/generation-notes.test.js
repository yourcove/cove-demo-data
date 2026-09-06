import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ageOnDate } from "../src/dates.js";
import { loadManifest, root } from "../src/manifests.js";

const json = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const sorted = (names) => [...names].sort();
function checkAge(performer, date, birthdate, age) {
  assert.equal(birthdate, performer.birth_date, performer.name);
  assert.equal(age, ageOnDate(birthdate, date), performer.name);
  assert.ok(age >= 18, `${performer.name}: underage artwork`);
}

test("regenerated portraits retain their authored date, adult age, identity source and deliberate brief", async () => {
  const manifest = await loadManifest();
  const notes = await json("assets/performer-portraits/generation-notes.json");
  for (const record of notes.portraits) {
    const performer = manifest.performers.find(p => `${p.slug}.jpg` === record.filename);
    assert.ok(performer, record.filename);
    assert.equal(record.depicts_date, performer.portrait_date);
    checkAge(performer, record.depicts_date, record.birth_date, record.age);
    assert.ok(record.identity_reference_files.some(r => r.filename === `assets/performers/${performer.slug}.jpg` && r.role));
    for (const field of ["composition", "hairstyle", "expression", "intended_distinguishing_traits"]) assert.ok(record[field], field);
    assert.ok(record.prompt_lines.length > 0);
    assert.ok(Array.isArray(record.intentional_anachronisms));
  }
});

test("Cressida's archival and late-career shoots document exact dates and ages against the original illustrated identity", async () => {
  const manifest = await loadManifest();
  const performer = manifest.performers.find(p => p.slug === "cressida-maraschino");
  const notes = await json("assets/performer-photo-sets/cressida-maraschino/generation-notes.json");
  assert.deepEqual(sorted(notes.photos.map(p => p.filename)), sorted(performer.photos.map(p => p.filename)));
  assert.ok(notes.identity_reference_files.some(r => r.filename === "assets/performers/cressida-maraschino.jpg"));
  for (const record of notes.photos) {
    assert.equal(record.depicts_date, performer.photos.find(p => p.filename === record.filename).date);
    checkAge(performer, record.depicts_date, notes.birth_date, record.age);
    assert.ok(record.prompt_lines.length > 0);
    for (const field of ["composition", "hairstyle", "expression"]) assert.ok(record[field], field);
  }
});

test("featured performer photo archives document each independent asset and its adult chronology", async () => {
  const manifest = await loadManifest();
  for (const slug of ["lucia-ferrer", "darius-king"]) {
    const performer = manifest.performers.find(p => p.slug === slug);
    const notes = await json(`assets/performer-photo-sets/${slug}/generation-notes.json`);
    assert.deepEqual(sorted(notes.photos.map(p => p.filename)), sorted(performer.photos.map(p => p.filename)));
    assert.ok(notes.identity_reference_files.some(r => r.filename === `assets/performers/${slug}.jpg`));
    for (const record of notes.photos) {
      assert.equal(record.depicts_date, performer.photos.find(p => p.filename === record.filename).date);
      checkAge(performer, record.depicts_date, notes.birth_date, record.age);
      assert.ok(record.prompt_lines.length > 0);
      for (const field of ["composition", "hairstyle", "expression"]) assert.ok(record[field], field);
      assert.ok(Array.isArray(record.intentional_anachronisms));
    }
  }
});

test("every reviewed poster records its current chronology and exact depicted performer credits", async () => {
  const manifest = await loadManifest();
  const files = ["assets/posters/generation-notes.json", "assets/posters/generation-notes-extra.json"];
  const notes = (await Promise.all(files.map(json))).flatMap(n => n.assets);
  assert.deepEqual(sorted(notes.map(n => n.asset)), sorted(manifest.videos.map(v => v.poster)));
  for (const record of notes) {
    const video = manifest.videos.find(v => v.poster === record.asset);
    assert.equal(record.depicted_date, video.date, video.slug);
    assert.equal(record.final_dimensions, "1600x900");
    assert.deepEqual(sorted(record.depicted_performers), sorted(video.image_performers), video.slug);
    const subjects = record.full_cast_ages.map(s => typeof s === "string" ? s.split("|") : [s.name, s.birthdate, s.age]);
    assert.deepEqual(sorted(subjects.map(s => s[0])), sorted(video.performers), video.slug);
    for (const [name, birthdate, age] of subjects) checkAge(manifest.performers.find(p => p.name === name), video.date, birthdate, Number(age));
    for (const name of record.depicted_performers) {
      const performer = manifest.performers.find(p => p.name === name);
      assert.ok(record.identity_references.some(r => (typeof r === "string" ? r.split("|")[0] : r.path) === `assets/performers/${performer.slug}.jpg`), name);
    }
    assert.ok(record.generation_steps?.length > 0, `${video.slug}: missing generation prompt history`);
    assert.ok(record.period_art_brief, `${video.slug}: missing period brief`);
    assert.ok(Array.isArray(record.intentional_anachronisms));
    for (const field of ["composition", "hairstyle", "expression"]) assert.ok(record[field], `${video.slug}: ${field}`);
  }
});
