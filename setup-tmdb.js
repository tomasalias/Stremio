// Setup script for TMDb API configuration
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function testApiKey(apiKey) {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/movie/550?api_key=${apiKey}&language=cs-CZ`
    );
    return response.status === 200;
  } catch (error) {
    console.error("Error testing TMDb API key:", error.message);
    return false;
  }
}

async function createEnvFile(apiKey) {
  const envPath = path.join(__dirname, ".env");
  const envContent = `TMDB_API_KEY=${apiKey}`;

  try {
    fs.writeFileSync(envPath, envContent);
    console.log(`Successfully created .env file at ${envPath}`);
  } catch (error) {
    console.error("Error creating .env file:", error.message);
  }
}

console.log("=== TMDb API Setup for Stremio Hellspy Addon ===");

rl.question("Please enter your TMDb API key: ", async (apiKey) => {
  apiKey = apiKey.trim();

  if (!apiKey) {
    console.log("No API key provided. Setup canceled.");
    rl.close();
    return;
  }

  console.log("Testing API key...");
  const isValid = await testApiKey(apiKey);

  if (!isValid) {
    console.log("API key test failed. Please check your key and try again.");
    rl.close();
    return;
  }
  console.log("API key is valid!");

  // Create configuration file
  await createEnvFile(apiKey);

  console.log("\nSetup completed successfully!");
  console.log("You can now run the addon with the TMDb API enabled using:");
  console.log("1. Run the server with: npm start");
  console.log("2. The .env file will be automatically loaded by the server");

  rl.close();
});
