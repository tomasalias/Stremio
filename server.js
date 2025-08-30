#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const { serveHTTP, publishToCentral } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const PORT = process.env.PORT || 7000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Display startup configuration information
console.log(`
===== Stremio Hellspy.to Addon =====
TMDb API: ${TMDB_API_KEY ? 'ENABLED' : 'DISABLED - metadata will fallback to Wikidata'}
Starting server on port ${PORT}...
`);

serveHTTP(addonInterface, { port: PORT })
  .then(({ url }) => {
    console.log(`Addon running at ${url}`);
    console.log(`Add to Stremio: ${url}/manifest.json`);

    // Uncomment to publish to Stremio Central
    // publishToCentral("https://my-addon.glitch.me/manifest.json");
  })
  .catch((error) => {
    console.error("Error starting server:", error);
  });
