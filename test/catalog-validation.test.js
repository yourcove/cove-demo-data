import assert from "node:assert/strict";
import test from "node:test";
import { ageOnDate } from "../src/dates.js";
import { expectedIdentityMaps, loadAllManifests, loadManifest, performerMediaDistributions, performerMediaMatrix, tagHierarchy, validateManifest } from "../src/manifests.js";
import { supportedCountryCodes, supportedGenders } from "../src/performer-values.js";

const baselineIdentities = {
  tags: ["1980s", "1990s", "2000s", "2010s", "2020s", "Comedy", "Mystery", "Drama", "Romance", "Caper", "Thriller", "Workplace", "Backstage", "Music", "Generated Artwork"].map((name, index) => [name, index + 1]),
  studios: ["Barely Dressed Pictures", "Second Take Features", "Electric Marquee", "Open Secret Features", "Fourth Wall Pictures", "Available Light Cooperative"].map((name, index) => [name, index + 1]),
  performers: ["Cressida Maraschino", "Velvet Thunder", "Beatrix Havenly", "Randolph Dandridge", "Gideon Slate", "Simona Valewood", "Marisol Vega", "Kenji Watanari", "Julian March", "Amina Shaw", "Darius King", "Rafael Sato", "Tess North", "Nia Hart", "Dev Malik", "Sofia Calderon", "Ellis Ward", "Bella Bloom", "Imani Cole", "Arun Sen", "Lucia Ferrer", "Amara Okoye", "June Park", "Elias Grant", "Noor Haddad"].map((name, index) => [name, index + 1]),
  collections: ["Electric Evenings: The 1980s", "Wrong Coats: The 1990s", "Fine Print: The 2000s", "Open Secrets: The 2010s", "New Orders: The 2020s"].map((name, index) => [name, index + 4]),
  videos: Array.from({ length: 25 }, (_, index) => [`BDP-${String(index + 1).padStart(2, "0")}`, index + 1]),
  audios: Array.from({ length: 25 }, (_, index) => [`BDP-AUD-${String(index + 1).padStart(2, "0")}`, index + 1]),
  texts: Array.from({ length: 25 }, (_, index) => [`BDP-TXT-${String(index + 1).padStart(2, "0")}`, index + 1]),
  images: [...Array.from({ length: 25 }, (_, index) => [`BDP-IMG-${String(index + 1).padStart(2, "0")}`, index + 1]), ...Array.from({ length: 4 }, (_, index) => [`BDP-IMG-${index + 26}`, index + 51])],
  galleries: Array.from({ length: 5 }, (_, index) => [`BDP-GAL-${String(index + 1).padStart(2, "0")}`, index + 1]),
  gallery_images: Object.entries({
    "BDP-GAL-01/01-neon-alibi.jpg": 26, "BDP-GAL-01/02-curtain-call-collect.jpg": 27, "BDP-GAL-01/03-dangerously-overdressed.jpg": 28, "BDP-GAL-01/04-one-more-number-before-dawn.jpg": 29, "BDP-GAL-01/05-the-last-honest-mirror.jpg": 30,
    "BDP-GAL-02/01-dial-m-for-makeover.jpg": 31, "BDP-GAL-02/02-negative-space.jpg": 32, "BDP-GAL-02/03-the-usual-accessories.jpg": 33, "BDP-GAL-02/04-exposure-compensation.jpg": 34, "BDP-GAL-02/05-tomorrow-never-rsvpd.jpg": 35,
    "BDP-GAL-03/01-room-service-for-two.jpg": 36, "BDP-GAL-03/02-terms-and-conditions-apply.jpg": 37, "BDP-GAL-03/03-the-supporting-evidence.jpg": 38, "BDP-GAL-03/04-love-in-the-time-of-voicemail.jpg": 39, "BDP-GAL-03/05-half-light-at-closing.jpg": 40, "BDP-GAL-03/06-undercover-overdressed.jpg": 41,
    "BDP-GAL-04/01-the-unreliable-dress-rehearsal.jpg": 42, "BDP-GAL-04/02-a-very-public-secret.jpg": 43, "BDP-GAL-04/03-rooms-with-an-alibi.jpg": 44, "BDP-GAL-04/04-exit-music-for-two.jpg": 45,
    "BDP-GAL-05/01-soft-launch.jpg": 46, "BDP-GAL-05/02-everyone-is-muted.jpg": 47, "BDP-GAL-05/03-rook-new-orders.jpg": 48, "BDP-GAL-05/04-the-last-take-was-perfect.jpg": 49, "BDP-GAL-05/05-a-favor-between-professionals.jpg": 50,
  }),
};

const mutate = (manifest, action) => { const copy = structuredClone(manifest); action(copy); return copy; };

test("all authored countries and genders use exact Cove API values", async () => {
  const manifest = await loadManifest(); assert.equal(supportedCountryCodes.length, 250); assert.deepEqual(supportedGenders, ["Male", "Female", "Intersex", "NonBinary", "TransgenderMale", "TransgenderFemale"]);
  assert.equal(manifest.performers.every(({ country }) => supportedCountryCodes.includes(country)), true); assert.equal(manifest.performers.every(({ gender }) => supportedGenders.includes(gender)), true);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { delete copy.performers[0].country; })), /incomplete performer/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers[0].country = "XX"; })), /unsupported country XX/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { delete copy.performers[0].gender; })), /incomplete performer/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers[0].gender = "TransMale"; })), /unsupported gender TransMale/);
});

test("career bounds and every visual or audio depiction remain adult and career-coherent", async () => {
  const manifest = await loadManifest();
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers[0].career_end_year = copy.performers[0].career_start_year - 1; })), /invalid career_end_year/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers.find(({ name }) => name === "Simona Valewood").career_start_year = 2010; })), /outside the authored career range/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { const performer = copy.performers.find(({ name }) => name === "Elias Grant"); performer.birth_date = "2010-10-15"; performer.career_start_year = 2028; })), /implausible depicted age/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers.find(({ name }) => name === "Amara Okoye").portrait_date = "2019-03-22"; })), /implausible depicted age/);
  for (const performer of manifest.performers) assert.ok(ageOnDate(performer.birth_date, `${performer.career_start_year}-12-31`) >= 18);
});

test("manifest validation rejects missing, duplicate, and unknown explicit relationships", async () => {
  const manifest = await loadManifest();
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { delete copy.videos[0].audio; })), /incomplete video|explicit audio/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.videos[0].audio.performers.push(copy.videos[0].audio.performers[0]); })), /audio performers must be unique/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.videos[0].text.tags.push("Unknown Topic"); })), /unknown tag Unknown Topic/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.videos[0].image_performers = ["Randolph Dandridge"]; })), /is not in the video cast/);
});

test("baseline canonical entity identities remain frozen while photo extensions append", async () => {
  const { expectedIds } = await loadAllManifests();
  for (const [type, entries] of Object.entries(baselineIdentities)) assert.deepEqual(Object.entries(expectedIds[type]).filter(([, id]) => entries.some(([, baselineId]) => baselineId === id)), entries, type);
  const appended = Object.entries(expectedIds.images).filter(([, id]) => id > 54); assert.deepEqual(appended.map(([, id]) => id), Array.from({ length: 15 }, (_, index) => index + 55)); assert.equal(appended.every(([code], index) => code === `BDP-IMG-${index + 30}`), true);
  assert.deepEqual(Object.entries(expectedIds.tags).slice(0, baselineIdentities.tags.length), baselineIdentities.tags);
  assert.deepEqual(Object.entries(expectedIds.gallery_images), baselineIdentities.gallery_images);
});

test("standalone media and galleries use explicit append-only identities", async () => {
  const manifest = await loadManifest(); const expected = expectedIdentityMaps(manifest);
  assert.deepEqual(Object.entries(expected.audios).slice(25), [["BDP-AUD-26", 26], ["BDP-AUD-27", 27], ["BDP-AUD-28", 28]]);
  assert.deepEqual(Object.entries(expected.texts).slice(25), Array.from({ length: 7 }, (_, index) => [`BDP-TXT-${index + 26}`, index + 26]));
  assert.deepEqual(Object.entries(expected.galleries).slice(5), [["BDP-GAL-06", 6], ["BDP-GAL-07", 7]]);
  assert.deepEqual(expected.gallery_images, Object.fromEntries(baselineIdentities.gallery_images));
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.standalone_audios[1].id = 29; copy.standalone_audios[1].code = "BDP-AUD-29"; })), /contiguous append-only range/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.standalone_texts[0].code = "BDP-TXT-31"; })), /code must match explicit ID|text codes must be unique/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.standalone_audios[0].source = "../outside.mp3"; })), /source must be project audio/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.standalone_galleries[0].image_refs.push("BDP-IMG-999"); })), /unknown image ref/);
});

test("standalone relationships contribute to the matrix without changing gallery virtual identities", async () => {
  const manifest = await loadManifest(); const matrix = performerMediaMatrix(manifest);
  const audioCredits = manifest.videos.reduce((count, video) => count + video.audio.performers.length, 0) + manifest.standalone_audios.reduce((count, audio) => count + audio.performers.length, 0);
  const textCredits = manifest.videos.reduce((count, video) => count + video.text.performers.length, 0) + manifest.standalone_texts.reduce((count, text) => count + text.performers.length, 0);
  assert.equal(matrix.reduce((count, row) => count + row.audios, 0), audioCredits);
  assert.equal(matrix.reduce((count, row) => count + row.texts, 0), textCredits);
  for (const gallery of manifest.standalone_galleries) assert.equal(new Set(gallery.image_refs).size, gallery.image_refs.length);
  assert.equal(manifest.standalone_galleries.some(({ image_refs }) => image_refs.length !== manifest.collections.length), true);
});

test("explicit photo identities and gallery identities do not depend on performer photo ordering", async () => {
  const manifest = await loadManifest(); const reordered = structuredClone(manifest); for (const performer of reordered.performers) performer.photos?.reverse();
  assert.deepEqual(expectedIdentityMaps(reordered).images, expectedIdentityMaps(manifest).images);
  const extended = structuredClone(manifest); extended.performers[0].photos.push({ code: "BDP-IMG-44", id: 69, filename: "2025-01-01-extra.jpg", date: "2025-01-01", title: "Extra", details: "An append-only fixture." });
  assert.deepEqual(expectedIdentityMaps(extended).gallery_images, expectedIdentityMaps(manifest).gallery_images); assert.equal(expectedIdentityMaps(extended).images["BDP-IMG-44"], 69);
});

test("new performer photos cannot reuse a canonical code or reserved image ID", async () => {
  const manifest = await loadManifest();
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers[1].photos[0].id = 54; })), /append after canonical image identities|performer image IDs must be unique/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.performers[1].photos[0].code = "BDP-IMG-29"; })), /append after canonical image identities|performer image codes must be unique/);
});

test("descriptive performer tags are authored while the legacy artwork tag remains unassociated", async () => {
  const manifest = await loadManifest(); const associated = [
    ...manifest.studios.flatMap(({ tags = [] }) => tags), ...manifest.collections.flatMap(({ tags = [] }) => tags),
    ...manifest.performers.flatMap((performer) => [...(performer.tags ?? []), ...(performer.reference_tags ?? []), ...(performer.photos ?? []).flatMap(({ tags = [] }) => tags)]),
    ...manifest.videos.flatMap((video) => [...video.tags, ...video.audio.tags, ...video.text.tags]),
    ...(manifest.standalone_audios ?? []).flatMap(({ tags = [] }) => tags), ...(manifest.standalone_texts ?? []).flatMap(({ tags = [] }) => tags), ...(manifest.standalone_galleries ?? []).flatMap(({ tags = [] }) => tags),
  ];
  assert.equal(manifest.tags[14], "Generated Artwork"); assert.ok(manifest.tags.length > 15);
  assert.equal(manifest.canonical_tag_count, 15);
  assert.equal(manifest.performers.every(({ tags }) => Array.isArray(tags) && tags.length > 0), true);
  assert.equal(manifest.performers.every(({ disambiguation = "" }) => disambiguation === ""), true);
  assert.equal(manifest.performers.every(({ reference_tags = [] }) => reference_tags.length === 0), true);
  const descriptors = new Set(manifest.tags.slice(15)); assert.equal(manifest.performers.every(({ tags }) => tags.every((tag) => descriptors.has(tag))), true);
  const lucia = manifest.performers.find(({ name }) => name === "Lucia Ferrer"); assert.equal(lucia.favorite, true); assert.ok(lucia.tags.includes("Bodybuilder"));
  assert.deepEqual(manifest.performers.filter(({ favorite }) => favorite === true).map(({ name }) => name), ["Cressida Maraschino", "Darius King", "Lucia Ferrer"]);
  assert.equal(associated.includes("Generated Artwork"), false);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { [copy.tags[0], copy.tags[1]] = [copy.tags[1], copy.tags[0]]; })), /canonical tags must remain/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.canonical_tag_count = 14; })), /canonical_tag_count/);
});

test("tag hierarchy connects the catalog through meaningful deterministic categories", async () => {
  const manifest = await loadManifest();
  const hierarchy = tagHierarchy(manifest);
  assert.deepEqual(hierarchy.childrenByName.get("Demo Archive"), ["Release Decade", "Story Genre", "Story Theme", "People", "Production Metadata"]);
  assert.deepEqual(hierarchy.childrenByName.get("Release Decade"), ["1980s", "1990s", "2000s", "2010s", "2020s"]);
  assert.deepEqual(hierarchy.childrenByName.get("Story Genre"), ["Comedy", "Mystery", "Drama", "Romance", "Caper", "Thriller"]);
  assert.deepEqual(hierarchy.childrenByName.get("Performance"), ["Bodybuilder", "Stunt Performer", "Actor", "Voice Actor", "Comedian", "Stage Performer", "Athlete"]);
  assert.deepEqual(hierarchy.parentsByName.get("Sound Designer"), ["Filmmaking Craft"]);
  assert.equal(hierarchy.edges.length, manifest.tags.length - 1);
  assert.match(manifest.tag_descriptions["Demo Archive"], /complete fictional/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy[0].children.push("Unknown Category"); })), /unknown child tag Unknown Category/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy.push({ parent: "Drama", children: ["Demo Archive"] }); })), /tag hierarchy must be acyclic/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy[1].children.push(copy.tag_hierarchy[1].children[0]); })), /tag hierarchy edges must be unique/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy.at(-1).children = []; })), /tag hierarchy must connect every tag beneath one root/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_descriptions["Unknown Category"] = "Unknown."; })), /tag descriptions: unknown tag Unknown Category/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy = {}; })), /tag_hierarchy must be an array/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy[0].children = 5; })), /children must be an array/);
  assert.throws(() => validateManifest(mutate(manifest, (copy) => { copy.tag_hierarchy[0] = null; })), /tag hierarchy entries must be objects/);
});

test("performer media footprints contain organic variation without fixing one exact distribution", async () => {
  const manifest = await loadManifest(); const matrix = performerMediaMatrix(manifest); const distributions = performerMediaDistributions(manifest);
  const positiveVideoBucket = Math.max(...Object.entries(distributions.videos).filter(([count]) => Number(count) > 0).map(([, frequency]) => frequency));
  assert.ok(positiveVideoBucket < matrix.length / 2); assert.ok(Object.keys(distributions.images).length >= 3);
  assert.ok(matrix.some(({ audios, videos }) => audios > videos)); assert.ok(matrix.some(({ texts, videos }) => texts > videos));
  assert.ok(matrix.every(({ videos, images, audios, texts }) => videos + images + audios + texts > 1));
  const completeFootprints = Object.values(Object.groupBy(matrix, (row) => [row.videos, row.images, row.galleries, row.audios, row.texts, row.groups, row.studios, row.tags].join("/")));
  assert.ok(Math.max(...completeFootprints.map((rows) => rows.length)) <= 3);
  const mirroredAudio = manifest.videos.filter((video) => [...video.audio.performers].sort().join("|") === [...video.performers].sort().join("|")).length;
  const mirroredText = manifest.videos.filter((video) => [...video.text.performers].sort().join("|") === [...video.performers].sort().join("|")).length;
  assert.ok(mirroredAudio < manifest.videos.length / 2); assert.ok(mirroredText < manifest.videos.length / 2);
  const castSizes = new Set(manifest.videos.map((video) => video.performers.length)); assert.ok(castSizes.size >= 4);
});

test("current-age mix is led by working-age performers with only a few older legends", async () => {
  const manifest = await loadManifest(); const ages = manifest.performers.map((performer) => ageOnDate(performer.birth_date, "2026-09-05"));
  const younger = ages.filter((age) => age >= 18 && age <= 35).length; const established = ages.filter((age) => age > 35 && age <= 65).length; const legends = ages.filter((age) => age > 65).length;
  assert.ok(younger > established); assert.ok(established >= 5); assert.ok(legends <= 4);
});
