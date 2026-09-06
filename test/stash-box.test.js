import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateOshash, createStashBoxData, slugify } from "../src/stash-box-data.js";
import { createRootValue, createStashBoxServer, parseArguments } from "../src/stash-box-server.js";

const library = path.resolve("output/library");

test("OSHASH is stable for a generated demo video", async () => { assert.match(await calculateOshash(path.join(library, "neon-alibi", "neon-alibi.mp4")), /^[0-9a-f]{16}$/); });
test("OSHASH rejects undersized files", async () => { const directory = await mkdtemp(path.join(os.tmpdir(), "cove-oshash-")); const filename = path.join(directory, "small.mp4"); await writeFile(filename, Buffer.alloc(1024)); await assert.rejects(calculateOshash(filename), /at least 131072 bytes/); });

test("metadata maps the full fictional catalog", async () => {
  const data = await createStashBoxData({ library, baseUrl: "http://metadata.test:9998" });
  assert.equal(data.scenes.length, 25); assert.equal(data.performers.length, 25); assert.equal(data.tags.length, 40); assert.ok(data.performers.every(p => p.disambiguation === "")); assert.equal(data.studios.length, 6); assert.equal(data.assets.size, 50);
  const movie = data.scenes.find(({ code }) => code === "BDP-01"); assert.equal(movie.id, "scene-neon-alibi"); assert.deepEqual(movie.performers.map(({ performer }) => performer.name), ["Simona Valewood", "Julian March", "Velvet Thunder"]); assert.equal(movie.images[0].url, "http://metadata.test:9998/assets/videos/neon-alibi/poster.jpg");
  assert.equal(data.studios.find(({ name }) => name === "Second Take Features").parent.name, "Barely Dressed Pictures");
});

test("root resolvers search and preserve fingerprint batches", async () => {
  const data = await createStashBoxData({ library }); const root = createRootValue(data);
  assert.equal(root.searchScene({ term: " neon alibi " })[0].code, "BDP-01"); assert.equal(root.searchPerformer({ term: "fictional performer", limit: 2 }).length, 0); assert.equal(root.findTag({ name: "mystery" }).name, "Mystery");
  const hash = data.scenes[0].fingerprints[0].hash.toUpperCase(); const batches = root.findScenesBySceneFingerprints({ fingerprints: [[{ algorithm: "OSHASH", hash }], [{ algorithm: "MD5", hash: "absent" }]] }); assert.deepEqual(batches[0].map(({ code }) => code), ["BDP-01"]); assert.deepEqual(batches[1], []);
});

test("HTTP server authenticates GraphQL and serves generated assets", async (t) => {
  const data = await createStashBoxData({ library }); const server = createStashBoxServer({ apiKey: "test-key", data }); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); t.after(() => new Promise((resolve) => server.close(resolve))); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200); assert.equal((await fetch(`${baseUrl}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query Me { me { name } }" }) })).status, 401);
  const response = await fetch(`${baseUrl}/graphql`, { method: "POST", headers: { "content-type": "application/json", ApiKey: "test-key" }, body: JSON.stringify({ query: "query { me { name } searchScene(term: \"Neon Alibi\") { code title } }" }) }); const payload = await response.json(); assert.equal(payload.data.me.name, "Cove Demo Curator"); assert.equal(payload.data.searchScene[0].code, "BDP-01");
  const asset = await fetch(`${baseUrl}/assets/videos/neon-alibi/poster.jpg`, { method: "HEAD" }); assert.equal(asset.status, 200); assert.equal(asset.headers.get("content-type"), "image/jpeg");
});

test("CLI arguments use safe defaults", () => { const defaults = parseArguments([]); assert.equal(defaults.port, 9998); assert.equal(defaults.apiKey, "cove-demo"); assert.equal(slugify("A Very Public Secret"), "a-very-public-secret"); assert.throws(() => parseArguments(["--port", "0"]), /port/); assert.throws(() => parseArguments(["--base-url", "file:\/\/tmp"]), /HTTP or HTTPS/); });

test("metadata server serializes authored country and gender using Stash-box values", async () => {
  const data = await createStashBoxData({ library });
  assert.equal(data.performers.find(p => p.name === "June Park").gender, "TRANSGENDER_MALE");
  assert.equal(data.performers.find(p => p.name === "June Park").country, "KR");
  assert.equal(data.performers.find(p => p.name === "Amina Shaw").gender, "NON_BINARY");
  assert.ok(data.performers.every(p => p.country && p.gender));
});
