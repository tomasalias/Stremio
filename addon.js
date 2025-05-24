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
});

const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Search Hellspy API for a given query
async function searchHellspy(query) {
  if (searchCache.has(query)) {
    const { results, timestamp } = searchCache.get(query);
    if (Date.now() - timestamp < CACHE_TTL) {
      return results;
    }
  }
  try {
    console.log(`Searching Hellspy API for "${query}"...`);
    const response = await axios.get(
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
    console.error("Hellspy API search error:", error);
    return [];
  }
}

// Get stream URL from Hellspy API using video ID and file hash
async function getStreamUrl(id, fileHash) {
  const cacheKey = `${id}:${fileHash}`;
  if (searchCache.has(cacheKey)) {
    const { url, timestamp } = searchCache.get(cacheKey);
    if (Date.now() - timestamp < CACHE_TTL) {
      return url;
    }
  }
  try {
    const response = await axios.get(
      `https://api.hellspy.to/gw/video/${id}/${fileHash}`
    );
    const conversions = response.data.conversions || {};
    const streams = Object.entries(conversions).map(([quality, url]) => ({
      url,
      quality: quality + "p",
    }));
    searchCache.set(cacheKey, { url: streams, timestamp: Date.now() });
    return streams;
  } catch (error) {
    console.error("Hellspy API getStreamUrl error:", error);
    return [];
  }
}

// Get title information from Wikidata using SPARQL and IMDb ID
async function getTitleFromWikidata(imdbId) {
  try {
    console.log(
      `Fetching Czech and English titles for ${imdbId} from Wikidata SPARQL endpoint`
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
      axios.get(url, { params: { query: baseQuery("cs") }, headers }),
      axios.get(url, { params: { query: baseQuery("en") }, headers }),
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
    console.error(`Error fetching title information for ${imdbId}:`, error);
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
    /\b\d{1,2}x\d{1,2}\b/.test(upperTitle)
  );
}

async function searchSeriesWithPattern(queries, season, episode) {
  const patterns = getSeasonEpisodePatterns(season, episode);
  for (const query of queries) {
    if (!query) continue;
    const results = await searchHellspy(query);
    // Try strict patterns first
    let filtered = results.filter((r) =>
      patterns
        .slice(0, 2)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;
    // Fallback: allow looser episode number match
    filtered = results.filter((r) =>
      patterns
        .slice(2)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;
  }
  return [];
}

// Stream handler
builder.defineStreamHandler(async ({ type, id, name, episode, year }) => {
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
      name = titleInfo.czTitle || titleInfo.enTitle || titleInfo.originalTitle;
      year = titleInfo.year;

      if (!type && titleInfo.type) {
        type = titleInfo.type === "movie" ? "movie" : "series";
      }
    }
  }

  if (!name) {
    console.log(`Could not find title name for id: ${id}`);
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
    let classicBase = name.replace(/[:&]/g, "").replace(/\s+/g, " ").trim();
    classicQuery = `${classicBase} ${episodeStr}`;
    // Add query with episode as a two-digit string (e.g. 04 for S01E04)
    episodeNumberOnlyQuery = `${classicBase} ${episodeStr}`;
    if (simplifiedName !== name) {
      simplifiedQuery = `${simplifiedName} S${seasonStr}E${episodeStr}`;
      simplifiedAdditionalQuery = `${simplifiedName} ${seasonStr}x${episodeStr}`;
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
    // Try all queries in order, only keep those with matching SxxExx or xxXxx in title
    const queries = [
      searchQuery,
      additionalQuery,
      episodeNumberOnlyQuery,
      simplifiedQuery,
      simplifiedAdditionalQuery,
      classicQuery,
      simplifiedEpisodeNumberOnlyQuery,
    ];
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
        const altQueries = [
          `${altName} S${episode.season
            .toString()
            .padStart(2, "0")}E${episode.number.toString().padStart(2, "0")}`,
          `${altName} ${episode.season
            .toString()
            .padStart(2, "0")}x${episode.number.toString().padStart(2, "0")}`,
        ];
        if (altSimplified) {
          altQueries.push(
            `${altSimplified} S${episode.season
              .toString()
              .padStart(2, "0")}E${episode.number.toString().padStart(2, "0")}`,
            `${altSimplified} ${episode.season
              .toString()
              .padStart(2, "0")}x${episode.number.toString().padStart(2, "0")}`
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
    results = await searchHellspy(searchQuery);
    if (results.length === 0 && additionalQuery) {
      results = await searchHellspy(additionalQuery);
    }
    if (results.length === 0 && simplifiedQuery) {
      results = await searchHellspy(simplifiedQuery);
    }
    if (results.length === 0 && simplifiedAdditionalQuery) {
      results = await searchHellspy(simplifiedAdditionalQuery);
    }
    if (results.length === 0 && classicQuery) {
      results = await searchHellspy(classicQuery);
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
    const simpleQuery = originalName;
    console.log(
      `No results found with specific episode query, trying generic search for: "${simpleQuery}"`
    );

    let genericResults = await searchHellspy(simpleQuery);

    if (genericResults.length === 0 && simplifiedName !== originalName) {
      console.log(
        `No results with original name, trying generic search for simplified name: "${simplifiedName}"`
      );
      genericResults = await searchHellspy(simplifiedName);
    }

    // Filter results based on the season and episode information
    const patterns = getSeasonEpisodePatterns(episode.season, episode.number);
    results = genericResults.filter((result) => {
      const title = result.title?.toUpperCase() || "";
      return patterns.some((p) => title.includes(p.toUpperCase()));
    });
  }

  // If no results found, try searching with the original name
  if (results.length === 0) {
    console.log("No matching streams found");
    return { streams: [] };
  }

  const streams = [];
  const processedResults = [];

  // Filter results based on the type and episode information
  if (type === "series" && episode) {
    const patterns = getSeasonEpisodePatterns(episode.season, episode.number);
    processedResults.push(
      ...results.filter((result) => {
        const title = result.title?.toUpperCase() || "";
        return patterns.some((p) => title.includes(p.toUpperCase()));
      })
    );
  } else if (type === "movie") {
    // Filter out likely episode results
    processedResults.push(
      ...results.filter((result) => !isLikelyEpisode(result.title))
    );
  } else {
    processedResults.push(...results);
  }

  // Show the first 10 results
  const limitedResults = processedResults.slice(0, 10);

  // Process each result and get the stream URL
  for (const result of limitedResults) {
    if (!result.id || !result.fileHash) {
      console.warn("Skipping result due to missing id or fileHash:", result);
      continue;
    }
    try {
      const streamInfo = await getStreamUrl(result.id, result.fileHash);
      if (Array.isArray(streamInfo) && streamInfo.length > 0) {
        for (const s of streamInfo) {
          streams.push({
            url: s.url,
            quality: s.quality,
            title: result.title, // add full title for Stremio display
          });
        }
      }
    } catch (error) {
      console.error("Error processing result:", error);
    }
  }
  if (streams.length > 0) {
    return { streams };
  }
  return { streams: [] };
});

module.exports = builder.getInterface();
