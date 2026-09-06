# Cove fictional demo dataset

This repository builds and loads a deterministic, screenshot-friendly media library for [Cove](https://github.com/yourcove/cove). Every person, production, organization, and piece of source artwork in the catalog is fictional. The checked-in artwork was generated with AI; video, audio, documents, captions, and archives are generated locally from it.

The catalog follows 25 fictional films released from 2005 through 2026, with a contemporary cast and a few older legends. It includes 25 performers, 25 silent poster-based video art previews, 25 canonical character-reference images, 19 independently browsable archive photographs, 28 production and interview audio records, 32 authored production documents, five thematic collections, five poster-archive galleries, and two curated photo galleries.

## Requirements

- Node.js 22 or newer
- npm
- `ffmpeg` on `PATH`
- PostgreSQL `psql` on `PATH` and a database connection URL for the first load or any sync that appends canonical image, audio, text, gallery, or tag records
- A fresh Cove instance

The build is self-contained and does not download remote media.

## Quick start

```bash
npm ci
npm run build
npm run load -- \
  --api-url https://your-cove.example \
  --database-url "$COVE_DATABASE_URL" \
  --username "$COVE_USERNAME" \
  --password "$COVE_PASSWORD"
```

The default output is `output/library`. Builds are staged and atomically replace only a recognized Cove demo output. Loading requires an otherwise untouched fresh Cove database and creates entities synchronously so identifiers remain deterministic.

After changing tracked artwork, rebuild the library and synchronize every managed performer, video,
audio, text, studio, collection, and tag image into an already-loaded canonical
demo instance:

```bash
npm run build
npm run sync
```

The command uses the same connection environment variables and options as `npm run load`. It validates the complete built bundle and canonical identity map before changing the instance, reconciles authored metadata and relationships, rescans the exact video, audio, text, image and gallery files, restores the exact original library configuration, and uploads managed artwork. Repeated synchronization converges the existing catalog to the manifest. File IDs and full file-association sets are checked before and after rescanning, including virtual gallery children.

Each video file is an explicitly labeled 9–18-second silent art preview built from the same chronology-reviewed poster source as the video grid. It exists to exercise Cove's video workflow and does not claim to be footage from a fictional feature. Generated stills use that poster source as well. Older cover sources remain archived and cannot override the reviewed artwork.

Performer reference sheets live under `assets/performers` and are copied byte for byte into the library. Profile portraits live separately under `assets/performer-portraits`. Dated photographs are declared in each performer's `photos` array and stored under `assets/performer-photo-sets/<slug>/`; each is an independent image record. Review contact sheets belong only in ignored audit directories and can never replace a production reference.

Country uses Cove's uppercase ISO alpha-2 values; gender uses the API enum names, including `TransgenderMale`, `TransgenderFemale`, and `NonBinary`. These are authored fictional attributes, not conclusions drawn from faces or names. Exact birthdates and career bounds are validated against depicted appearances.

Every video declares separate `audio` and `text` metadata, including explicit performer and tag lists. `image_performers` describes the people actually shown in its gallery poster. Audio records are short fictional spoken excerpts from film interviews, production discussions, rehearsal debriefs and behind-the-scenes material, including conversations with the musicians making music for the films; they are neither songs nor complete interviews. Interview participants, document subjects, and screen casts need not match. The legacy `score-preview.mp3` and `score-cover.jpg` filenames remain stable to preserve existing file associations. Empty image credits are appropriate for prop-led artwork.

Collection `name` remains its canonical identity key and `title` is the current display title. The legacy `decade` value is retained only as the existing ZIP filename key; release dates and tags describe the current chronology. Existing poster filenames also retain their historical suffixes to preserve file associations. Do not derive dates from those filenames. Original gallery membership and virtual image basenames remain stable.

Lucia, Cressida and Darius are the featured performers and are authored as favorites. Performer tags describe skills, occupations or physical disciplines; disambiguation is empty unless a name actually needs clarification. The legacy Generated Artwork tag retains its canonical ID but is not assigned to entities. New descriptor and category tags append after the original tag IDs. `tag_hierarchy` connects every tag beneath one archive root so Cove's graph view demonstrates eras, genres, themes, and nested people disciplines without changing the canonical identity prefix.

New performer photographs have explicit append-only `code` and `id` values. The original references, gallery children, and first four photographs keep their original IDs; later records append after them. Interrupted image imports recover only the next expected record with its exact file path.

## Image generation chronology

Every performer has an exact fictional `birth_date` in `manifests/manifest.json`. Before generating artwork containing a performer, produce a deterministic brief:

```bash
npm run art-brief -- --video neon-alibi
npm run art-brief -- --performer cressida-maraschino --date 1964-07-10
```

Use the brief's exact depicted date, calendar age for every subject, and period direction in the generation prompt. A video poster uses the video's release date as its depicted date unless an artwork record explicitly documents another date. Preserve the performer's reference-sheet identity while depicting the calculated age rather than the reference image's apparent age.

Wardrobe, hair, makeup, photographic treatment, background extras, architecture, signage, vehicles, props, and technology should be plausible for the depicted date. They need not be stereotypical: individual style and subtle forward-looking design are welcome. Name any deliberate major exception in an `intentional_anachronisms` note; otherwise avoid unmistakable era mismatches such as modern digital cameras in a 1960s press line or 2020s social-media styling in a 1990s scene.

For a new standalone performer image, record an exact depicted date alongside the source asset. Retain the generated brief and final prompt in the asset's generation notes so later regeneration uses the same chronology.

## Local metadata server

```bash
npm run serve:stash-box
```

The read-only Stash-box-compatible fixture listens at `http://127.0.0.1:9998/graphql` by default and uses API key `cove-demo`. It supports the scene, performer, studio, tag, and fingerprint queries used by Cove, and serves generated posters and performer portraits below `/assets/`.

## Commands

```bash
npm run build
npm run load -- --api-url https://your-cove.example --database-url "$COVE_DATABASE_URL" --token "$COVE_TOKEN"
npm run sync
npm run check
```

`output/`, `id-map.json`, and runtime logs are ignored. The optimized AI artwork under `assets/` and the canonical metadata in `manifests/manifest.json` are tracked inputs.

## Dataset policy

- Keep all names, organizations, biographies, and works fictional.
- Add no scraped, public-domain, or other third-party media.
- Keep artwork non-explicit and suitable for product documentation.
- Preserve all existing canonical identities, manifest order, and file associations. Append justified records with explicit identities; never renumber existing records.
- Build twice and compare `output/library/checksums.sha256` after changing generation logic or assets.
