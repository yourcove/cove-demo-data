import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validatePosterDimensions } from "../src/build.js";
import { loadManifest } from "../src/manifests.js";

test("every tracked movie poster is exactly 16:9", async () => {
  await validatePosterDimensions(await loadManifest());
});

test("poster validation rejects non-widescreen artwork", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cove-portrait-poster-"));
  await cp(path.resolve("assets", "performer-portraits", "imani-cole.jpg"), path.join(directory, "portrait.jpg"));
  await assert.rejects(
    validatePosterDimensions({ videos: [{ poster: "portrait.jpg" }] }, directory),
    /Movie poster portrait\.jpg must be 16:9; found \d+x\d+/,
  );
});
