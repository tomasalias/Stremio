// Test script to verify that environment variables are properly loaded

require("dotenv").config();
console.log("===== ENVIRONMENT VARIABLES DIAGNOSTIC =====");
console.log(`NODE_ENV: ${process.env.NODE_ENV || "(not set)"}`);
console.log(
  `TMDB_API_KEY: ${process.env.TMDB_API_KEY ? "(set)" : "(not set)"}`
);

// Check the actual key value (first 4 characters only for security)
if (process.env.TMDB_API_KEY) {
  const key = process.env.TMDB_API_KEY;
  console.log(
    `TMDB_API_KEY first 4 chars: ${key.substring(0, 4)}${"*".repeat(
      key.length - 4
    )}`
  );
}

console.log('\nIf you see "(not set)" for TMDB_API_KEY, try:');
console.log("1. Check your .env file exists in the project root directory");
console.log(
  "2. Verify the .env file contains TMDB_API_KEY=yourkey (no quotes)"
);
console.log("3. Run the setup-tmdb.js script again to create the .env file");
console.log(
  "4. Try running with the start-with-tmdb.bat or start-with-tmdb.ps1 scripts"
);
