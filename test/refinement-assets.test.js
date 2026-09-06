import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { ageOnDate } from "../src/dates.js";
import { audiosFor, loadManifest, root } from "../src/manifests.js";

const json = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
const sorted = values => [...new Set(values)].sort();
const hash = async file => createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");

test("spoken archives credit their actual scripted speakers and retain verified playable sources", async () => {
  const manifest = await loadManifest();
  const audios = audiosFor(manifest);
  const notes = await json("assets/production-audio/generation-notes.json");
  assert.deepEqual(sorted(notes.records.map(r => r.source)), sorted(audios.map(a => a.source)));
  const hashes = new Set();
  const durations = new Set();
  for (const record of notes.records) {
    const audio = audios.find(a => a.source === record.source);
    assert.equal(record.date, audio.date ?? audio.video.date);
    assert.deepEqual(sorted(record.turns.map(t => t.speaker)), sorted(audio.performers));
    for (const turn of record.turns) {
      assert.ok(turn.text.trim().split(/\s+/).length >= 8);
      assert.equal(turn.voice, notes.voices[turn.speaker].voice);
      assert.equal(turn.speed, notes.voices[turn.speaker].speed);
      const performer = manifest.performers.find(p => p.name === turn.speaker);
      assert.ok(ageOnDate(performer.birth_date, record.date) >= 18);
    }
    const checks = record.render.checks;
    const digest = await hash(record.source);
    assert.equal(digest, checks.sha256, record.source);
    assert.ok(checks.decoded && checks.nonzero_audio && !checks.clipping_detected);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(root, record.source)], { encoding: "utf8" }));
    assert.equal(probe.streams.length, 1);
    assert.equal(probe.streams[0].codec_name, "mp3");
    const duration = Number(probe.format.duration);
    assert.ok(duration >= 15 && duration < 600, record.source);
    assert.ok(Math.abs(duration - checks.duration_seconds) < 0.1, record.source);
    const wordCount = record.turns.reduce((total, turn) => total + turn.text.trim().split(/\s+/).length, 0);
    assert.ok(duration / wordCount >= 0.22, `${record.source}: speech may have been truncated`);
    assert.deepEqual(record.render.sentence_chunk_counts, record.turns.map(turn => turn.text.split(/(?<=[.!?])\s+/).filter(Boolean).length));
    hashes.add(digest);
    durations.add(Math.round(duration));
  }
  assert.equal(hashes.size, audios.length, "Archive recordings cannot share a placeholder file");
  assert.ok(durations.size > 3, "Archive excerpts should not all use one fixed duration");
});

test("reviewed production audio covers retain their explicit dates, credits, hashes and landscape dimensions", async () => {
  const manifest = await loadManifest();
  const notes = await json("assets/audio-covers/generation-notes.json");
  for (const record of notes.assets) {
    const video = manifest.videos.find(v => v.slug === record.video_slug);
    assert.equal(video.audio.cover, record.asset);
    assert.equal(video.audio.date ?? video.date, record.depicted_date);
    assert.deepEqual(sorted(video.audio.performers), sorted(record.audio_participants));
    assert.equal(await hash(record.asset), record.sha256);
    assert.ok(record.generation_steps.length && record.composition && record.period_art_brief);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path.join(root, record.asset)], { encoding: "utf8" }));
    assert.equal(probe.streams[0].width * 9, probe.streams[0].height * 16);
  }
});

test("portrait and Cressida costume refinements preserve authored adult dates and canonical identity references", async () => {
  const manifest = await loadManifest();
  const cressida = manifest.performers.find(p => p.slug === "cressida-maraschino");
  const portrait = await json("assets/performer-portraits/cressida-portrait-refinement-notes.json");
  const shoots = await json("assets/performer-photo-sets/cressida-maraschino/generation-notes.json");
  assert.equal(portrait.depicts_date, cressida.portrait_date);
  assert.deepEqual(sorted(shoots.refinements.map(r => r.filename)), sorted(cressida.photos.map(p => p.filename)));
  for (const record of [portrait, ...shoots.refinements]) {
    if (record.filename) assert.equal(record.depicts_date, cressida.photos.find(p => p.filename === record.filename).date);
    assert.equal(record.age, ageOnDate(cressida.birth_date, record.depicts_date));
    assert.ok(record.age >= 18);
    assert.ok(record.input_images.some(i => i.filename === "assets/performers/cressida-maraschino.jpg" && i.role));
    assert.ok((record.prompt_lines ?? record.accepted_prompt_lines).length);
  }
  const amina = manifest.performers.find(p => p.slug === "amina-shaw");
  const record = (await json("assets/performer-portraits/remaining-collisions-notes.json")).accepted_asset;
  assert.equal(record.depicted_date, amina.portrait_date);
  assert.equal(record.birth_date, amina.birth_date);
  assert.equal(record.calculated_age, ageOnDate(amina.birth_date, record.depicted_date));
  assert.ok(record.identity_reference_files.some(i => i.path === "assets/performers/amina-shaw.jpg"));
});
