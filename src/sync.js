#!/usr/bin/env node
import path from "node:path";
import { authenticate, CoveApi, parseArguments, syncIntoCove } from "./load.js";
import { loadAllManifests } from "./manifests.js";

const options = parseArguments(process.argv.slice(2));
if (!options.apiUrl || (!options.token && (!options.username || !options.password))) {
  console.error("Provide --api-url and either --token or --username/--password.");
  process.exit(2);
}

const token = options.token ?? await authenticate(options.apiUrl, options.username, options.password);
const { expectedIds } = await loadAllManifests();
await syncIntoCove(new CoveApi(options.apiUrl, token), path.resolve(options.library), expectedIds, options.idMapOutput, options.databaseUrl).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
