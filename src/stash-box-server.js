#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildSchema, graphql } from "graphql";
import { createStashBoxData } from "./stash-box-data.js";
import { root } from "./manifests.js";

const schema = buildSchema(`
  enum FingerprintAlgorithm { MD5 OSHASH PHASH }
  input FingerprintQueryInput { hash: String!, algorithm: FingerprintAlgorithm! }
  type URL { url: String! }
  type Image { url: String! }
  type Measurements { band_size: Int, cup_size: String, waist: Int, hip: Int }
  type BodyModification { location: String, description: String }
  type Fingerprint { algorithm: FingerprintAlgorithm!, hash: String!, duration: Int! }
  type Performer {
    id: ID!, name: String!, disambiguation: String, aliases: [String!], gender: String,
    deleted: Boolean!, merged_into_id: ID, urls: [URL!]!, images: [Image!]!,
    birth_date: String, death_date: String, ethnicity: String, country: String,
    eye_color: String, hair_color: String, height: Int, measurements: Measurements,
    breast_type: String, career_start_year: Int, career_end_year: Int,
    tattoos: [BodyModification!]!, piercings: [BodyModification!]!
  }
  type PerformerAppearance { performer: Performer! }
  type Tag { id: ID!, name: String!, description: String, aliases: [String!] }
  type Studio { id: ID!, name: String!, aliases: [String!]!, urls: [URL!]!, images: [Image!]!, parent: Studio }
  type Scene {
    id: ID!, title: String, code: String, details: String, director: String, duration: Int,
    date: String, urls: [URL!]!, images: [Image!]!, studio: Studio, tags: [Tag!]!,
    performers: [PerformerAppearance!]!, fingerprints: [Fingerprint!]!
  }
  type User { name: String! }
  type Query {
    me: User
    searchPerformer(term: String!, limit: Int): [Performer!]!
    findPerformer(id: ID!): Performer
    searchStudio(term: String!): [Studio!]!
    findStudio(id: ID, name: String): Studio
    findTag(id: ID, name: String): Tag
    searchScene(term: String!, limit: Int): [Scene!]!
    findScene(id: ID!): Scene
    findScenesBySceneFingerprints(fingerprints: [[FingerprintQueryInput!]!]!): [[Scene!]!]!
  }
`);

const contentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

function normalize(value) {
  return value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function search(items, term, fields, limit) {
  const needle = normalize(term);
  const matches = items.filter((item) => fields.some((field) => normalize(item[field] ?? "").includes(needle)));
  return Number.isInteger(limit) && limit >= 0 ? matches.slice(0, limit) : matches;
}

export function createRootValue(data) {
  const performersById = new Map(data.performers.map((item) => [item.id, item]));
  const studiosById = new Map(data.studios.map((item) => [item.id, item]));
  const tagsById = new Map(data.tags.map((item) => [item.id, item]));
  const scenesById = new Map(data.scenes.map((item) => [item.id, item]));
  const fingerprintIndex = new Map();
  for (const scene of data.scenes) {
    for (const fingerprint of scene.fingerprints) {
      const key = `${fingerprint.algorithm}:${fingerprint.hash}`.toUpperCase();
      const matches = fingerprintIndex.get(key) ?? [];
      matches.push(scene);
      fingerprintIndex.set(key, matches);
    }
  }

  return {
    me: () => ({ name: "Cove Demo Curator" }),
    searchPerformer: ({ term, limit }) => search(data.performers, term, ["name", "disambiguation"], limit),
    findPerformer: ({ id }) => performersById.get(id) ?? null,
    searchStudio: ({ term }) => search(data.studios, term, ["name"]),
    findStudio: ({ id, name }) => id
      ? studiosById.get(id) ?? null
      : data.studios.find((item) => normalize(item.name) === normalize(name ?? "")) ?? null,
    findTag: ({ id, name }) => id
      ? tagsById.get(id) ?? null
      : data.tags.find((item) => normalize(item.name) === normalize(name ?? "")
        || item.aliases.some((alias) => normalize(alias) === normalize(name ?? ""))) ?? null,
    searchScene: ({ term, limit }) => search(data.scenes, term, ["title", "code", "details"], limit),
    findScene: ({ id }) => scenesById.get(id) ?? null,
    findScenesBySceneFingerprints: ({ fingerprints }) => fingerprints.map((group) => {
      const results = [];
      const seen = new Set();
      for (const fingerprint of group) {
        const key = `${fingerprint.algorithm}:${fingerprint.hash}`.toUpperCase();
        for (const scene of fingerprintIndex.get(key) ?? []) {
          if (seen.add(scene.id)) results.push(scene);
        }
      }
      return results;
    }),
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/graphql-response+json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error("Request body exceeds 1 MiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createStashBoxServer({ apiKey, data }) {
  const rootValue = createRootValue(data);
  return createHttpServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      return sendJson(response, 200, { status: "ok" });
    }

    if ((request.method === "GET" || request.method === "HEAD") && data.assets.has(requestUrl.pathname)) {
      const filename = data.assets.get(requestUrl.pathname);
      const headers = { "content-type": contentTypes.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream" };
      response.writeHead(200, headers);
      if (request.method === "HEAD") return response.end();
      const stream = createReadStream(filename);
      stream.once("error", () => response.destroy());
      stream.pipe(response);
      return;
    }

    if (requestUrl.pathname !== "/graphql") return sendJson(response, 404, { error: "Not found" });
    if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
    if (request.headers.apikey !== apiKey) return sendJson(response, 401, { errors: [{ message: "Unauthorized" }] });

    try {
      const payload = await readJsonBody(request);
      const query = payload.query ?? payload.Query;
      const variables = payload.variables ?? payload.Variables;
      const operationName = payload.operationName ?? payload.OperationName;
      if (typeof query !== "string") return sendJson(response, 400, { errors: [{ message: "query must be a string" }] });
      const result = await graphql({
        schema,
        source: query,
        rootValue,
        variableValues: variables,
        operationName,
      });
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 400, { errors: [{ message: error instanceof Error ? error.message : "Invalid request" }] });
    }
  });
}

export function parseArguments(argv) {
  const options = {
    host: "127.0.0.1",
    port: 9998,
    library: path.join(root, "output", "library"),
    apiKey: "cove-demo",
    baseUrl: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { ...options, help: true };
    if (!["--host", "--port", "--library", "--api-key", "--base-url"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (argv[index + 1] === undefined) throw new Error(`${argument} requires a value`);
    const value = argv[index += 1];
    if (argument === "--host") options.host = value;
    if (argument === "--port") options.port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (argument === "--library") options.library = path.resolve(value);
    if (argument === "--api-key") options.apiKey = value;
    if (argument === "--base-url") options.baseUrl = value;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be an integer from 1 through 65535");
  if (!options.host.trim()) throw new Error("--host must not be empty");
  if (!options.apiKey) throw new Error("--api-key must not be empty");
  const urlHost = options.host === "0.0.0.0" || options.host === "::"
    ? "127.0.0.1"
    : options.host.includes(":") ? `[${options.host}]` : options.host;
  options.baseUrl ??= `http://${urlHost}:${options.port}`;
  try {
    const parsedBaseUrl = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) throw new Error();
  } catch {
    throw new Error("--base-url must be an absolute HTTP or HTTPS URL");
  }
  return options;
}

function usage() {
  return `Usage: npm run serve:stash-box -- [options]

Options:
  --host <address>    Listening address (default: 127.0.0.1)
  --port <number>     Listening port (default: 9998)
  --library <path>    Built demo library (default: output/library)
  --api-key <value>   Required ApiKey header (default: cove-demo)
  --base-url <url>    Public base URL used for image links
  --help              Show this help
`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const data = await createStashBoxData(options);
  const server = createStashBoxServer({ apiKey: options.apiKey, data });
  server.listen(options.port, options.host, () => {
    process.stdout.write(`Cove demo metadata server: ${options.baseUrl}/graphql\n`);
    process.stdout.write(`Health check: ${options.baseUrl}/healthz\n`);
  });
  const close = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
