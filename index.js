const { publishToCentral } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

if (process.argv.includes("--publish")) {
  // Publish to central
  publishToCentral("https://my-addon.domain/manifest.json")
    .then((response) => {
      console.log("Published successfully:", response);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error publishing:", error);
      process.exit(1);
    });
} else {
  // Output the addon manifest
  console.log(JSON.stringify(addonInterface.manifest, null, 4));
}
