const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Create a new addon builder instance
const builder = new addonBuilder({
  id: "org.stremio.hellspy",
  version: "0.0.1",
  name: "Hellspy",
  description: "Hellspy.to addon for Stremio",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: [],
  stremioAddonsConfig: {
    issuer: "https://stremio-addons.net",
    signature:
      "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..Q3c1o6zGBTzcnwfyb57kMw.evFQ-ODwmOeZWPsJ2Zkx-S_EgSpekuJcSOgnrTUR8pPy9tGHSZHo0n2PaIr5kRag6A4GVxDQ5MEW2G-4w8sHVwjEyO9TIqJMHBbZ0xbItd83SmHtN9unjgIi3tgwf6xr.XxBTJoNyWmi89W67BhG4FA",
  },
});

const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

const REQUEST_DELAY = 600; // Reduced to 600ms between requests
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000;

const userQueue = [];
const activeUsers = new Map(); // userId -> { processing: boolean, lastActivity: timestamp }
const MAX_CONCURRENT_USERS = 1; // Maximum number of users processing at once
const USER_TIMEOUT = 300000;

let requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;

function getUserId(req) {
  // Use a combination of user-agent and IP for basic user identification
  const userAgent = req?.headers?.["user-agent"] || "unknown";
  const ip =
    req?.ip ||
    req?.connection?.remoteAddress ||
    req?.headers?.["x-forwarded-for"] ||
    "unknown";
  return require("crypto")
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex")
    .substring(0, 8);
}

function cleanupInactiveUsers() {
  const now = Date.now();
  for (const [userId, userData] of activeUsers.entries()) {
    if (now - userData.lastActivity > USER_TIMEOUT) {
      console.log(`🧹 Removing inactive user ${userId}`);
      activeUsers.delete(userId);
      // Remove from queue if present
      const queueIndex = userQueue.indexOf(userId);
      if (queueIndex > -1) {
        userQueue.splice(queueIndex, 1);
      }
    }
  }
}

function addUserToQueue(userId) {
  cleanupInactiveUsers();

  if (!activeUsers.has(userId)) {
    activeUsers.set(userId, {
      processing: false,
      lastActivity: Date.now(),
    });
  }

  const userData = activeUsers.get(userId);
  userData.lastActivity = Date.now();

  if (userData.processing) {
    return { position: 0, message: "Your request is being processed..." };
  }

  const processingUsers = Array.from(activeUsers.values()).filter(
    (u) => u.processing
  ).length;

  if (processingUsers < MAX_CONCURRENT_USERS) {
    userData.processing = true;
    console.log(
      `✅ User ${userId} can process immediately (${
        processingUsers + 1
      }/${MAX_CONCURRENT_USERS} slots used)`
    );
    return { position: 0, message: "Processing your request..." };
  }

  if (!userQueue.includes(userId)) {
    userQueue.push(userId);
    console.log(
      `⏳ User ${userId} added to queue. Queue length: ${userQueue.length}`
    );
  }

  const position = userQueue.indexOf(userId) + 1;
  const estimatedWait = position * 20; // 20 seconds per position estimate

  return {
    position,
    message: `You are #${position} in queue. Estimated wait: ~${estimatedWait}s`,
  };
}

function processNextUserInQueue() {
  cleanupInactiveUsers();

  const processingUsers = Array.from(activeUsers.values()).filter(
    (u) => u.processing
  ).length;

  if (processingUsers < MAX_CONCURRENT_USERS && userQueue.length > 0) {
    const nextUserId = userQueue.shift();
    const userData = activeUsers.get(nextUserId);

    if (userData) {
      userData.processing = true;
      console.log(
        `🔄 User ${nextUserId} moved from queue to processing (${
          processingUsers + 1
        }/${MAX_CONCURRENT_USERS} slots used)`
      );
    }
  }
}

function finishUserProcessing(userId) {
  const userData = activeUsers.get(userId);
  if (userData && userData.processing) {
    userData.processing = false;
    userData.lastActivity = Date.now();
    console.log(`✅ User ${userId} finished processing`);

    // Process next user in queue after a small delay
    setTimeout(processNextUserInQueue, 500);
  }
}

async function makeRateLimitedRequest(url, options = {}, retries = 0) {
  return new Promise((resolve, reject) => {
    requestQueue.push({
      url,
      options,
      retries,
      resolve,
      reject,
    });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { url, options, retries, resolve, reject } = requestQueue.shift();

    // Ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < REQUEST_DELAY) {
      const delay = REQUEST_DELAY - timeSinceLastRequest;
      console.log(`Rate limiting: waiting ${delay}ms before next request`);
      await new Promise((res) => setTimeout(res, delay));
    }

    try {
      lastRequestTime = Date.now();
      const response = await axios.get(url, {
        timeout: 8000, // 8 second timeout
        ...options,
      });
      resolve(response);
    } catch (error) {
      if (
        error.response &&
        error.response.status === 429 &&
        retries < MAX_RETRIES
      ) {
        // Rate limited - retry with exponential backoff
        const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries);
        console.log(
          `Rate limited (429). Retrying in ${retryDelay}ms (attempt ${
            retries + 1
          }/${MAX_RETRIES})`
        );

        await new Promise((res) => setTimeout(res, retryDelay));

        // Re-queue with incremented retry count
        requestQueue.unshift({
          url,
          options,
          retries: retries + 1,
          resolve,
          reject,
        });
      } else {
        reject(error);
      }
    }
  }

  isProcessingQueue = false;
}

// Search Hellspy API for a given query
async function searchHellspy(query, userId = null) {
  if (searchCache.has(query)) {
    const { results, timestamp } = searchCache.get(query);
    if (Date.now() - timestamp < CACHE_TTL) {
      return results;
    }
  }
  try {
    console.log(
      `🔍 Searching Hellspy API for "${query}" (User: ${
        userId || "unknown"
      })...`
    );
    const response = await makeRateLimitedRequest(
      `https://api.hellspy.to/gw/search?query=${encodeURIComponent(
        query
      )}&offset=0&limit=64`
    );
    const items = response.data.items || [];
    const results = items.filter((item) => item.objectType === "GWSearchVideo");
    searchCache.set(query, { results, timestamp: Date.now() });
    return results;
  } catch (error) {
    // Handle errors gracefully
    console.error(
      `Hellspy API search error for user ${userId || "unknown"}:`,
      error.message || error
    );
    return [];
  }
}

// Get stream URL from Hellspy API using video ID and file hash
async function getStreamUrl(id, fileHash, userId = null) {
  const cacheKey = `${id}:${fileHash}`;
  if (searchCache.has(cacheKey)) {
    const { url, timestamp } = searchCache.get(cacheKey);
    if (Date.now() - timestamp < CACHE_TTL) {
      return url;
    }
  }
  try {
    console.log(
      `🎥 Fetching stream URL for video ID ${id} with hash ${fileHash} (User: ${
        userId || "unknown"
      })...`
    );
    const response = await makeRateLimitedRequest(
      `https://api.hellspy.to/gw/video/${id}/${fileHash}`
    );

    // Get video details for additional information
    const title = response.data.title || "";
    const duration = response.data.duration || 0;
    console.log(
      `Found video: "${title}" (Duration: ${Math.floor(duration / 60)}m ${
        duration % 60
      }s)`
    );

    // Extract available stream qualities
    const conversions = response.data.conversions || {};

    // If no conversions are available, try the direct download link as a fallback
    if (Object.keys(conversions).length === 0 && response.data.download) {
      console.log(
        "No conversions available, using direct download link as fallback"
      );
      const streams = [
        {
          url: response.data.download,
          quality: "original",
          title: title,
        },
      ];
      searchCache.set(cacheKey, { url: streams, timestamp: Date.now() });
      return streams;
    }

    // Map conversions to stream format
    const streams = Object.entries(conversions).map(([quality, url]) => ({
      url,
      quality: quality + "p",
      title: title,
    }));

    console.log(
      `Found ${streams.length} quality options: ${streams
        .map((s) => s.quality)
        .join(", ")}`
    );
    searchCache.set(cacheKey, { url: streams, timestamp: Date.now() });
    return streams;
  } catch (error) {
    console.error("Hellspy API getStreamUrl error:", error.message || error);
    return [];
  }
}

// Get title information from Wikidata using SPARQL and IMDb ID
async function getTitleFromWikidata(imdbId, userId = null) {
  try {
    console.log(
      `📚 Fetching titles for ${imdbId} from Wikidata (User: ${
        userId || "unknown"
      })`
    );

    // Base SPARQL query to get film information
    const baseQuery = (lang) => `
      SELECT ?film ?filmLabel ?originalTitle ?publicationDate ?instanceLabel WHERE {
        ?film wdt:P345 "${imdbId}".
        OPTIONAL { ?film wdt:P1476 ?originalTitle. }
        OPTIONAL { ?film wdt:P577 ?publicationDate. }
        OPTIONAL { ?film wdt:P31 ?instance. }

        SERVICE wikibase:label {
          bd:serviceParam wikibase:language "${lang}".
        }
      }
    `;

    const url = "https://query.wikidata.org/sparql";
    const headers = { Accept: "application/sparql-results+json" };

    const [czResponse, enResponse] = await Promise.all([
      makeRateLimitedRequest(url, {
        params: { query: baseQuery("cs") },
        headers,
      }),
      makeRateLimitedRequest(url, {
        params: { query: baseQuery("en") },
        headers,
      }),
    ]);

    const czResult = czResponse.data.results.bindings[0] || {};
    const enResult = enResponse.data.results.bindings[0] || {};

    const czTitle = czResult.filmLabel?.value || null;
    const enTitle = enResult.filmLabel?.value || null;
    const originalTitle =
      czResult.originalTitle?.value || enResult.originalTitle?.value || null;
    const year =
      czResult.publicationDate?.value?.substring(0, 4) ||
      enResult.publicationDate?.value?.substring(0, 4) ||
      null;
    const type =
      czResult.instanceLabel?.value || enResult.instanceLabel?.value || null;

    // Check if the Czech title is a Wikidata entity ID (starts with Q followed by numbers)
    const isWikidataId = czTitle && /^Q\d+$/.test(czTitle);
    const validCzTitle = isWikidataId ? null : czTitle;

    console.log(
      `Found titles: CZ: ${
        validCzTitle || "Not available"
      }, EN: ${enTitle}, Year: ${year}`
    );
    return {
      czTitle: validCzTitle,
      enTitle,
      originalTitle,
      year,
      type,
    };
  } catch (error) {
    console.error(
      `Error fetching title information for ${imdbId}:`,
      error.message || error
    );
    return null;
  }
}

// Helper to extract season/episode patterns
function getSeasonEpisodePatterns(season, episode) {
  const seasonStr = season.toString().padStart(2, "0");
  const episodeStr = episode.toString().padStart(2, "0");
  // Add more flexible patterns for fallback
  return [
    `S${seasonStr}E${episodeStr}`,
    `${seasonStr}x${episodeStr}`,
    ` - ${episodeStr}`, // Format found on PC: "Title - 01"
    ` - ${parseInt(episodeStr, 10)}`, // Non-zero padded version: "Title - 1"
    `Ep. ${episodeStr}`,
    `Ep ${episodeStr}`,
    `Episode ${episodeStr}`,
    ` ${episodeStr} `, // surrounded by spaces
    ` ${parseInt(episodeStr, 10)} `, // non-padded
  ];
}

function isLikelyEpisode(title) {
  if (!title) return false;
  const upperTitle = title.toUpperCase();
  return (
    /\bS\d{2}E\d{2}\b/.test(upperTitle) ||
    /\b\d{1,2}x\d{1,2}\b/.test(upperTitle) ||
    /\s-\s\d{1,2}\b/.test(upperTitle) // "Title - 01" format
  );
}

async function searchSeriesWithPattern(queries, season, episode) {
  const patterns = getSeasonEpisodePatterns(season, episode);
  for (const query of queries) {
    if (!query) continue;

    // Add delay between searches to prevent overwhelming the API
    if (queries.indexOf(query) > 0) {
      console.log(`Waiting before next search query...`);
      await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms between different queries
    }

    const results = await searchHellspy(query);
    // Try strict patterns first (SxxExx, xxXxx)
    let filtered = results.filter((r) =>
      patterns
        .slice(0, 2)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;

    // Try "Title - XX" format specifically
    filtered = results.filter((r) =>
      patterns
        .slice(2, 4)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;

    // Fallback: allow looser episode number match
    filtered = results.filter((r) =>
      patterns
        .slice(4)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;
  }
  return [];
}

// Stream handler
builder.defineStreamHandler(async ({ type, id, name, episode, year }, req) => {
  // Generate user ID and manage queue
  const userId = getUserId(req);
  console.log(
    `🎬 Stream request from user ${userId}:`,
    type,
    id,
    name,
    episode
  );

  // Check user queue status
  const queueStatus = addUserToQueue(userId);

  if (queueStatus.position > 0) {
    console.log(
      `⏳ User ${userId} is in queue at position ${queueStatus.position}`
    );
    return {
      streams: [
        {
          name: "Hellspy - Queue",
          title: `⏳ ${queueStatus.message}\n\nPlease wait and try again in a few seconds.`,
          url: "#",
        },
      ],
    };
  }

  try {
    console.log(`🚀 Processing request for user ${userId}...`);
    console.log("Stream request:", type, id, name, episode);

    // Check if the ID is in the format "tt1234567:1:2" (IMDb ID with season and episode)
    if (id.includes(":")) {
      const parts = id.split(":");
      id = parts[0];
      episode = {
        season: parseInt(parts[1]),
        number: parseInt(parts[2]),
      };
    }

    // If the type is not provided, try to determine it from the ID
    if (!name && id.startsWith("tt")) {
      const titleInfo = await getTitleFromWikidata(id);
      if (titleInfo) {
        name =
          titleInfo.czTitle || titleInfo.enTitle || titleInfo.originalTitle;
        year = titleInfo.year;

        if (!type && titleInfo.type) {
          type = titleInfo.type === "movie" ? "movie" : "series";
        }
      }
    }

    if (!name) {
      console.log(
        `❌ Could not find title name for id: ${id} (User: ${userId})`
      );
      finishUserProcessing(userId);
      return { streams: [] };
    }

    const originalName = name;

    // Check if the name contains a colon and simplify it if necessary
    let simplifiedName = name;
    if (name.includes(":")) {
      const parts = name.split(":");
      simplifiedName = parts[0].trim();
      console.log(
        `Title contains colon, trying simplified name: "${simplifiedName}"`
      );
    }

    let searchQuery = name;
    let additionalQuery = null;
    let classicQuery = null;
    let simplifiedQuery = null;
    let simplifiedAdditionalQuery = null;
    let episodeNumberOnlyQuery = null;
    let simplifiedEpisodeNumberOnlyQuery = null;
    if (type === "series" && name && episode) {
      const seasonStr = episode.season.toString().padStart(2, "0");
      const episodeStr = episode.number.toString().padStart(2, "0");
      searchQuery = `${name} S${seasonStr}E${episodeStr}`;
      additionalQuery = `${name} ${seasonStr}x${episodeStr}`;

      // Add anime-style "Title - XX" format which is common for anime releases
      const animeStyleQuery = `${name} - ${episodeStr}`;

      let classicBase = name.replace(/[:&]/g, "").replace(/\s+/g, " ").trim();
      classicQuery = `${classicBase} ${episodeStr}`;
      // Add query with episode as a two-digit string (e.g. 04 for S01E04)
      episodeNumberOnlyQuery = `${classicBase} ${episodeStr}`;

      if (simplifiedName !== name) {
        simplifiedQuery = `${simplifiedName} S${seasonStr}E${episodeStr}`;
        simplifiedAdditionalQuery = `${simplifiedName} ${seasonStr}x${episodeStr}`;
        // Also add anime-style query for simplified name
        const simplifiedAnimeStyleQuery = `${simplifiedName} - ${episodeStr}`;
        simplifiedEpisodeNumberOnlyQuery = `${simplifiedName
          .replace(/[:&]/g, "")
          .replace(/\s+/g, " ")
          .trim()} ${episodeStr}`;
      }
    } else if (type === "movie" && name) {
      searchQuery = name + (year ? " " + year : "");
      additionalQuery = name;

      if (simplifiedName !== name) {
        simplifiedQuery = simplifiedName + (year ? " " + year : "");
        simplifiedAdditionalQuery = simplifiedName;
      }
    }

    let results = [];
    if (type === "series" && episode) {
      // Try all queries in order, including anime-style format
      const queries = [
        searchQuery,
        additionalQuery,
        // Include anime-style "Title - XX" format which is common for anime releases
        `${name} - ${episode.number.toString().padStart(2, "0")}`,
        episodeNumberOnlyQuery,
        simplifiedQuery,
        simplifiedAdditionalQuery,
        // Add anime-style for simplified name
        simplifiedName !== name
          ? `${simplifiedName} - ${episode.number.toString().padStart(2, "0")}`
          : null,
        classicQuery,
        simplifiedEpisodeNumberOnlyQuery,
      ].filter(Boolean); // Remove null values
      results = await searchSeriesWithPattern(
        queries,
        episode.season,
        episode.number
      );
      // If still no results, try alternate title from Wikidata
      if (results.length === 0) {
        const titleInfo = await getTitleFromWikidata(id);
        if (
          titleInfo &&
          titleInfo.enTitle &&
          titleInfo.enTitle !== originalName
        ) {
          const altName = titleInfo.enTitle;
          const altSimplified = altName.includes(":")
            ? altName.split(":")[0].trim()
            : null;
          const seasonStr = episode.season.toString().padStart(2, "0");
          const episodeStr = episode.number.toString().padStart(2, "0");
          const altQueries = [
            `${altName} S${seasonStr}E${episodeStr}`,
            `${altName} ${seasonStr}x${episodeStr}`,
            // Add anime-style format for alternate title
            `${altName} - ${episodeStr}`,
          ];
          if (altSimplified) {
            altQueries.push(
              `${altSimplified} S${seasonStr}E${episodeStr}`,
              `${altSimplified} ${seasonStr}x${episodeStr}`,
              // Add anime-style format for simplified alternate title
              `${altSimplified} - ${episodeStr}`
            );
          }
          results = await searchSeriesWithPattern(
            altQueries,
            episode.season,
            episode.number
          );
        }
      }
    } else {
      // For movies, try queries sequentially with delays
      const movieQueries = [
        searchQuery,
        additionalQuery,
        simplifiedQuery,
        simplifiedAdditionalQuery,
        classicQuery,
      ].filter(Boolean);

      for (let i = 0; i < movieQueries.length && results.length === 0; i++) {
        if (i > 0) {
          console.log(`Waiting before next movie search query...`);
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms between queries
        }
        results = await searchHellspy(movieQueries[i]);
      }
      // If no results found, try searching with the simplified name
      if (results.length === 0) {
        const titleInfo = await getTitleFromWikidata(id);
        if (
          titleInfo &&
          titleInfo.enTitle &&
          titleInfo.enTitle !== originalName
        ) {
          console.log(
            `Trying alternate title from Wikidata: "${titleInfo.enTitle}"`
          );

          if (type === "series" && episode) {
            const seasonStr = episode.season.toString().padStart(2, "0");
            const episodeStr = episode.number.toString().padStart(2, "0");

            searchQuery = `${titleInfo.enTitle} S${seasonStr}E${episodeStr}`;

            additionalQuery = `${titleInfo.enTitle} ${seasonStr}x${episodeStr}`;
          } else if (type === "movie") {
            searchQuery = titleInfo.enTitle + (year ? " " + year : "");
            additionalQuery = titleInfo.enTitle;
          }

          results = await searchHellspy(searchQuery);

          if (results.length === 0 && additionalQuery) {
            results = await searchHellspy(additionalQuery);
          }

          if (results.length === 0 && titleInfo.enTitle.includes(":")) {
            const altSimplifiedName = titleInfo.enTitle.split(":")[0].trim();
            console.log(
              `Trying simplified alternate title: "${altSimplifiedName}"`
            );

            if (type === "series" && episode) {
              const seasonStr = episode.season.toString().padStart(2, "0");
              const episodeStr = episode.number.toString().padStart(2, "0");

              results = await searchHellspy(
                `${altSimplifiedName} S${seasonStr}E${episodeStr}`
              );

              if (results.length === 0) {
                results = await searchHellspy(
                  `${altSimplifiedName} ${seasonStr}x${episodeStr}`
                );
              }
            } else if (type === "movie") {
              results = await searchHellspy(
                altSimplifiedName + (year ? " " + year : "")
              );

              if (results.length === 0) {
                results = await searchHellspy(altSimplifiedName);
              }
            }
          }
        }
      }
    }
    // If no results found, try searching with the original name
    if (results.length === 0 && type === "series" && episode) {
      console.log(
        `No results found with specific episode query, trying generic search...`
      );

      // Try multiple search approaches for generic search
      const genericQueries = [
        originalName, // Original full name
        simplifiedName, // Simplified name (without subtitle)
        originalName.split(" ").slice(0, 2).join(" "), // First two words only
        simplifiedName.split(" ").slice(0, 2).join(" "), // First two words of simplified name
      ].filter((q, i, self) => q && self.indexOf(q) === i); // Remove duplicates and empties

      let genericResults = [];

      // Try each generic query
      for (const query of genericQueries) {
        console.log(`Searching for generic title: "${query}"`);
        const queryResults = await searchHellspy(query);
        genericResults.push(...queryResults);
        if (queryResults.length > 0) {
          console.log(
            `Found ${queryResults.length} results with query "${query}"`
          );
          break; // Stop if we found results
        }
      }

      // Filter results based on the season and episode information
      const patterns = getSeasonEpisodePatterns(episode.season, episode.number);
      results = genericResults.filter((result) => {
        if (!result.title) return false;
        const title = result.title.toUpperCase();
        return patterns.some((p) => title.includes(p.toUpperCase()));
      });
    }

    // If no results found, try searching with the original name
    if (results.length === 0) {
      console.log(`❌ No matching streams found for user ${userId}`);
      return { streams: [] };
    }

    const streams = [];
    const processedResults = [];
    // Filter results based on the type and episode information
    if (type === "series" && episode) {
      const patterns = getSeasonEpisodePatterns(episode.season, episode.number);

      // Add a special check for anime-style titles that exactly match the pattern we see in your local results
      // E.g. "So I'm a Spider, So What - 01"
      const exactAnimePattern = ` - ${episode.number
        .toString()
        .padStart(2, "0")}$`;
      const exactAnimeRegex = new RegExp(exactAnimePattern, "i");

      const animeMatches = results.filter(
        (result) => result.title && exactAnimeRegex.test(result.title)
      );

      // If we found exact anime-style matches, prioritize those
      if (animeMatches.length > 0) {
        console.log(
          `Found ${animeMatches.length} results with anime-style pattern "${exactAnimePattern}"`
        );
        processedResults.push(...animeMatches);
      } else {
        // Otherwise use the regular pattern matching
        processedResults.push(
          ...results.filter((result) => {
            const title = result.title?.toUpperCase() || "";
            return patterns.some((p) => title.includes(p.toUpperCase()));
          })
        );
      }
    } else if (type === "movie") {
      // Filter out likely episode results
      processedResults.push(
        ...results.filter((result) => !isLikelyEpisode(result.title))
      );
    } else {
      processedResults.push(...results);
    }
    // Sort results to prioritize anime-style titles for anime content
    if (type === "series" && processedResults.length > 1) {
      const animePattern = ` - ${episode.number.toString().padStart(2, "0")}`;

      processedResults.sort((a, b) => {
        const aTitle = a.title || "";
        const bTitle = b.title || "";
        const aHasAnimePattern = aTitle.includes(animePattern);
        const bHasAnimePattern = bTitle.includes(animePattern);

        if (aHasAnimePattern && !bHasAnimePattern) return -1;
        if (!aHasAnimePattern && bHasAnimePattern) return 1;

        // If same pattern status, prioritize by size (larger files often better quality)
        return (b.size || 0) - (a.size || 0);
      });
    }

    // Show results for debugging
    console.log(`Found ${processedResults.length} matching results:`);
    processedResults
      .slice(0, 5)
      .forEach((r) =>
        console.log(
          `- ${r.title} (Size: ${Math.floor(r.size / 1024 / 1024)} MB)`
        )
      );

    // Limit to top 5 results for faster processing
    const limitedResults = processedResults.slice(0, 5);

    // Process multiple results in parallel (but limit concurrency to avoid overwhelming the API)
    const streamPromises = limitedResults.map(async (result, index) => {
      if (!result.id || !result.fileHash) {
        console.warn("Skipping result due to missing id or fileHash:", result);
        return [];
      }

      try {
        const streamInfo = await getStreamUrl(
          result.id,
          result.fileHash,
          userId
        );
        if (Array.isArray(streamInfo) && streamInfo.length > 0) {
          // Format file size for display
          const sizeGB = result.size
            ? (result.size / 1024 / 1024 / 1024).toFixed(2) + " GB"
            : "Unknown size";

          return streamInfo.map((s) => ({
            url: s.url,
            quality: s.quality,
            title: `${result.title}\n${s.quality} | ${sizeGB}`,
            name: `Hellspy - ${s.quality}`,
          }));
        }
        return [];
      } catch (error) {
        console.error(
          `Error processing result for user ${userId}:`,
          error.message || error
        );
        return [];
      }
    });

    // Wait for all streams to be processed
    const streamResults = await Promise.allSettled(streamPromises);

    // Flatten successful results
    for (const result of streamResults) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        streams.push(...result.value);
      }
    }

    console.log(`📊 Found ${streams.length} streams for user ${userId}`);
    finishUserProcessing(userId);

    if (streams.length > 0) {
      return { streams };
    }
    return { streams: [] };
  } catch (error) {
    console.error(
      `❌ Error processing request for user ${userId}:`,
      error.message || error
    );
    finishUserProcessing(userId);
    return {
      streams: [
        {
          name: "Hellspy - Error",
          title: `❌ Error: ${
            error.message || "Request failed"
          }\n\nPlease try again later.`,
          url: "#",
        },
      ],
    };
  }
});

module.exports = builder.getInterface();
