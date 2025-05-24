#!/usr/bin/env node

const { serveHTTP, publishToCentral } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const PORT = process.env.PORT || 7000;

serveHTTP(addonInterface, { port: PORT })
  .then(({ url }) => {
    console.log(`Addon running at ${url}`);

    // Uncomment to publish to Stremio Central
    // publishToCentral("https://my-addon.glitch.me/manifest.json");
  })
  .catch((error) => {
    console.error("Error starting server:", error);
  });
