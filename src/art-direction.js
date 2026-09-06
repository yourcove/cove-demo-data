import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageOnDate, parseExactDate } from "./dates.js";
import { loadManifest } from "./manifests.js";

const eraGuidance = {
  1950: { photography: "mid-century color film or press photography with period grain and restrained dynamic range", wardrobe: "1950s tailoring, eveningwear, workwear, hair, and makeup", environment: "period architecture, signage, vehicles, props, and analog cameras; no post-1950s consumer technology" },
  1960: { photography: "1960s editorial or press photography with era-appropriate film stock, grain, and flash", wardrobe: "1960s silhouettes, textiles, formalwear, swimwear, hair, and makeup without costume caricature", environment: "period architecture, signage, vehicles, props, and analog press cameras; no digital cameras or modern devices" },
  1970: { photography: "1970s color film or editorial photography with natural grain and era-appropriate color response", wardrobe: "1970s tailoring, casualwear, stagewear, hair, and makeup without costume caricature", environment: "period architecture, signage, vehicles, props, and analog equipment; no later digital technology" },
  1980: { photography: "1980s theatrical key art or editorial photography with practical lighting and film grain", wardrobe: "1980s silhouettes, tailoring, sportswear, hair, and makeup; avoid contemporary retro pastiche", environment: "period interiors, signage, vehicles, office equipment, and analog media; no smartphones or later flat-screen devices" },
  1990: { photography: "1990s theatrical key art or editorial photography with photochemical texture and restrained retouching", wardrobe: "1990s silhouettes, tailoring, streetwear, hair, and makeup; do not substitute current social-media aesthetics", environment: "period interiors, signage, vehicles, computers, phones, and cameras; no smartphones or contemporary influencer styling" },
  2000: { photography: "2000s theatrical key art or editorial photography with period color grading and plausible early-digital or film texture", wardrobe: "2000s silhouettes, tailoring, casualwear, hair, and makeup without present-day restyling", environment: "period interiors, signage, vehicles, phones, computers, and cameras; avoid technology introduced later" },
  2010: { photography: "2010s theatrical key art or editorial photography with era-appropriate digital color and retouching", wardrobe: "2010s silhouettes, tailoring, casualwear, hair, and makeup", environment: "2010s architecture, signage, vehicles, phones, computers, and cameras; avoid distinctly 2020s trends unless intentionally noted" },
  2020: { photography: "contemporary theatrical key art or editorial photography with polished but natural digital detail", wardrobe: "2020s silhouettes, tailoring, casualwear, hair, and makeup appropriate to the story", environment: "contemporary architecture, signage, vehicles, devices, and cameras" },
};

export function periodDirection(depictsDate) {
  const year = parseExactDate(depictsDate, "depicts date").getUTCFullYear();
  const decade = Math.floor(year / 10) * 10;
  const guidance = eraGuidance[decade];
  if (!guidance) throw new Error(`No art-direction guidance is defined for the ${decade}s`);
  return { depicts_date: depictsDate, decade: `${decade}s`, ...guidance, flexibility: "Subtle forward-looking or individual style is welcome when plausible; any deliberate major anachronism must be named in intentional_anachronisms." };
}

function subjectBrief(performer, depictsDate) {
  const age = ageOnDate(performer.birth_date, depictsDate);
  if (age < 18) throw new Error(`${performer.name} would be under 18 on ${depictsDate}; refusing to create an art brief`);
  return { name: performer.name, slug: performer.slug, birth_date: performer.birth_date, age };
}

export function videoArtBrief(manifest, slug) {
  const video = manifest.videos.find((item) => item.slug === slug);
  if (!video) throw new Error(`Unknown video slug: ${slug}`);
  return { asset: `video:${slug}:poster`, title: video.title, genre: video.genre, story: video.details, studio: video.studio, identity_references: video.performers.map(name => `assets/performers/${manifest.performers.find(p => p.name === name).slug}.jpg`), depicts_date: video.date, subjects: video.performers.map((name) => subjectBrief(manifest.performers.find((item) => item.name === name), video.date)), period: periodDirection(video.date), intentional_anachronisms: [] };
}

export function performerArtBrief(manifest, slug, depictsDate) {
  const performer = manifest.performers.find((item) => item.slug === slug);
  if (!performer) throw new Error(`Unknown performer slug: ${slug}`);
  return { asset: `performer:${slug}`, identity_references: [`assets/performers/${slug}.jpg`], depicts_date: depictsDate, subjects: [subjectBrief(performer, depictsDate)], period: periodDirection(depictsDate), intentional_anachronisms: [] };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--video") options.video = argv[++index];
    else if (argv[index] === "--performer") options.performer = argv[++index];
    else if (argv[index] === "--date") options.date = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (options.video && !options.performer && !options.date) return options;
  if (options.performer && options.date && !options.video) return options;
  throw new Error("Use --video <slug>, or --performer <slug> --date <YYYY-MM-DD>");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv); const manifest = await loadManifest();
  const brief = options.video ? videoArtBrief(manifest, options.video) : performerArtBrief(manifest, options.performer, options.date);
  console.log(JSON.stringify(brief, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
