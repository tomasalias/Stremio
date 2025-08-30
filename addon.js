// Load environment variables from .env file
require("dotenv").config();

const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// TMDb API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const LANGUAGE = "cs-CZ"; // Czech language
const TMDB_BASE = "https://api.themoviedb.org/3";
const USE_TMDB = !!TMDB_API_KEY;

console.log(`TMDb API Key: ${TMDB_API_KEY ? "Found" : "Not found"}`);
console.log(`TMDb API is ${USE_TMDB ? "ENABLED" : "DISABLED"}`);

const builder = new addonBuilder({
  id: "org.stremio.hellspy",
  version: "0.1.0",
  name: USE_TMDB ? "Hellspy with TMDb" : "Hellspy",
  description: USE_TMDB
    ? "Hellspy.to addon for Stremio with enhanced TMDb metadata"
    : "Hellspy.to addon for Stremio (TMDb metadata disabled)",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: [],
  stremioAddonsConfig: {
    issuer: "https://stremio-addons.net",
    signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..Q3c1o6zGBTzcnwfyb57kMw.evFQ-ODwmOeZWPsJ2Zkx-S_EgSpekuJcSOgnrTUR8pPy9tGHSZHo0n2PaIr5kRag6A4GVxDQ5MEW2G-4w8sHVwjEyO9TIqJMHBbZ0xbItd83SmHtN9unjgIi3tgwf6xr.XxBTJoNyWmi89W67BhG4FA"
  }
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
    console.log(
      `Fetching stream URL for video ID ${id} with hash ${fileHash}...`
    );
    const response = await axios.get(
      `https://api.hellspy.to/gw/video/${id}/${fileHash}`
    );

    const title = response.data.title || "";
    const duration = response.data.duration || 0;
    console.log(
      `Found video: "${title}" (Duration: ${Math.floor(duration / 60)}m ${
        duration % 60
      }s)`
    );

    const conversions = response.data.conversions || {};

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

// Get title information from TMDb using IMDb ID
async function getTitleFromTMDb(imdbId) {
  try {
    console.log(`Fetching title information for ${imdbId} from TMDb API`);

    const url = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&language=${LANGUAGE}&external_source=imdb_id`;
    const response = await axios.get(url);
    const data = response.data;

    const movieResults = data.movie_results || [];
    const tvResults = data.tv_results || [];

    if (movieResults.length > 0) {
      const movie = movieResults[0];
      console.log(
        `Found movie: ${movie.title} (${
          movie.release_date?.substring(0, 4) || "Unknown year"
        })`
      );
      return {
        type: "movie",
        czTitle: movie.title,
        enTitle: movie.original_title,
        originalTitle: movie.original_title,
        year: movie.release_date?.substring(0, 4),
        overview: movie.overview,
        poster: movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : null,
        backdrop: movie.backdrop_path
          ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
          : null,
        tmdbId: movie.id,
      };
    } else if (tvResults.length > 0) {
      const show = tvResults[0];
      console.log(
        `Found TV show: ${show.name} (${
          show.first_air_date?.substring(0, 4) || "Unknown year"
        })`
      );
      return {
        type: "series",
        czTitle: show.name,
        enTitle: show.original_name,
        originalTitle: show.original_name,
        year: show.first_air_date?.substring(0, 4),
        overview: show.overview,
        poster: show.poster_path
          ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
          : null,
        backdrop: show.backdrop_path
          ? `https://image.tmdb.org/t/p/original${show.backdrop_path}`
          : null,
        tmdbId: show.id,
      };
    }

    console.log(`No results found on TMDb for ${imdbId}`);
    return null;
  } catch (error) {
    console.error(
      `Error fetching title information from TMDb for ${imdbId}:`,
      error
    );
    return null;
  }
}

// Get episode information from TMDb using TMDb ID
async function getEpisodeFromTMDb(tmdbId, season, episode) {
  if (!TMDB_API_KEY || !tmdbId) return null;

  try {
    console.log(
      `Fetching episode S${season}E${episode} info for TMDb ID ${tmdbId}`
    );
    const url = `${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=${LANGUAGE}`;
    const response = await axios.get(url);
    const data = response.data;

    if (!data || !data.name) {
      console.log(`No episode data found for S${season}E${episode}`);
      return null;
    }

    console.log(
      `Found episode: ${data.name} (Air date: ${data.air_date || "Unknown"})`
    );
    return {
      name: data.name,
      overview: data.overview,
      airDate: data.air_date,
      episodeNumber: data.episode_number,
      seasonNumber: data.season_number,
      still: data.still_path
        ? `https://image.tmdb.org/t/p/original${data.still_path}`
        : null,
    };
  } catch (error) {
    console.error(`Error fetching episode information from TMDb:`, error);
    return null;
  }
}

// Helper to extract season/episode patterns
function getSeasonEpisodePatterns(season, episode) {
  const seasonStr = season.toString().padStart(2, "0");
  const episodeStr = episode.toString().padStart(2, "0");
  const nonPaddedEpisode = parseInt(episodeStr, 10);

  return [
    // Standard TV formats
    `S${seasonStr}E${episodeStr}`,
    `${seasonStr}x${episodeStr}`,

    // Anime-specific formats
    ` - ${episodeStr}`, // "Title - 01"
    ` - ${nonPaddedEpisode}`, // "Title - 1"
    `#${episodeStr}`, // "Title #01"
    `#${nonPaddedEpisode}`, // "Title #1"

    // Common descriptive formats
    `Ep. ${episodeStr}`,
    `Ep ${episodeStr}`,
    `Episode ${episodeStr}`,
    `Episode ${nonPaddedEpisode}`,

    // Standalone numbers (surrounded by spaces or symbols)
    ` ${episodeStr} `,
    ` ${nonPaddedEpisode} `,
    `[${episodeStr}]`,
    `[${nonPaddedEpisode}]`,

    // Japanese style episode notation
    `第${nonPaddedEpisode}話`, // "dai X wa" format
    `第${nonPaddedEpisode}集`, // "dai X shu" format
  ];
}

// Import title utilities
const {
  getStaticAnimeNameVariations,
  getAllTitleVariations,
} = require("./title-utils");

// Helper function to get common anime name variations
// This is kept for backward compatibility
function getAnimeNameVariations(title) {
  return getStaticAnimeNameVariations(title);
}

function isLikelyEpisode(title) {
  if (!title) return false;
  const upperTitle = title.toUpperCase();

  return (
    // Standard TV formats
    /\bS\d{1,2}E\d{1,2}\b/.test(upperTitle) || // S01E01, S1E1
    /\b\d{1,2}x\d{1,2}\b/.test(upperTitle) || // 01x01, 1x1
    // Common anime formats
    /\s-\s\d{1,2}\b/.test(upperTitle) || // "Title - 01"
    /\s#\d{1,2}\b/.test(upperTitle) || // "Title #01"
    /\[(\s)?\d{1,2}(\s)?\]/.test(upperTitle) || // "[01]" or "[ 01 ]"
    // Japanese style formats
    /第\d{1,2}[話集]/.test(title) || // "第1話" (episode 1)
    // Other common patterns
    /\bEP\.?\s\d{1,2}\b/i.test(upperTitle) || // "EP 01", "Ep. 01"
    /\bEPISODE\s\d{1,2}\b/i.test(upperTitle) // "Episode 01"
  );
}

async function searchSeriesWithPattern(queries, season, episode) {
  const patterns = getSeasonEpisodePatterns(season, episode);
  const allResults = [];

  // Track which queries we've already tried to avoid duplicates
  const triedQueries = new Set();

  for (const query of queries) {
    if (!query || triedQueries.has(query.toLowerCase())) continue;
    triedQueries.add(query.toLowerCase());

    console.log(`Trying query: "${query}"`);
    const results = await searchHellspy(query);
    allResults.push(...results);

    // Try standard episode patterns first (S01E01, 01x01)
    let filtered = results.filter((r) =>
      patterns
        .slice(0, 2)
        .some((p) => r.title && r.title.toUpperCase().includes(p.toUpperCase()))
    );
    if (filtered.length > 0) return filtered;

    // Try "Title - XX" format specifically (common in anime)
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

  // If we have results but couldn't find matching episodes,
  // try one more pass looking for any episode pattern in all results
  if (allResults.length > 0) {
    console.log(
      `Found ${allResults.length} total results, checking for episode patterns`
    );
    const filtered = allResults.filter((r) =>
      patterns.some(
        (p) => r.title && r.title.toUpperCase().includes(p.toUpperCase())
      )
    );
    if (filtered.length > 0) {
      console.log(
        `Found ${filtered.length} matching episodes in combined results`
      );
      return filtered;
    }
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
    let titleInfo = null;

    if (USE_TMDB) {
      titleInfo = await getTitleFromTMDb(id);
    }

    if (!titleInfo) {
      titleInfo = await getTitleFromWikidata(id);
    }

    if (titleInfo) {
      name = titleInfo.czTitle || titleInfo.enTitle || titleInfo.originalTitle;
      year = titleInfo.year;

      if (!type && titleInfo.type) {
        type = titleInfo.type;
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
    // Get anime name variations to improve search results
    const animeVariations = getAnimeNameVariations(name);
    const simplifiedVariations =
      simplifiedName !== name ? getAnimeNameVariations(simplifiedName) : [];

    console.log(
      `Searching with ${animeVariations.length} name variations for "${name}"`
    );
    if (animeVariations.length > 1) {
      console.log(
        `Alternative names: ${animeVariations.slice(0, 3).join(", ")}${
          animeVariations.length > 3 ? "..." : ""
        }`
      );
    }

    // Base queries with original name
    const baseQueries = [
      searchQuery,
      additionalQuery,
      // Anime-style query
      `${name} - ${episode.number.toString().padStart(2, "0")}`,
      episodeNumberOnlyQuery,
      simplifiedQuery,
      simplifiedAdditionalQuery,
      simplifiedName !== name
        ? `${simplifiedName} - ${episode.number.toString().padStart(2, "0")}`
        : null,
      classicQuery,
      simplifiedEpisodeNumberOnlyQuery,
    ];

    // Add queries with anime name variations
    const variationQueries = [];
    const seasonStr = episode.season.toString().padStart(2, "0");
    const episodeStr = episode.number.toString().padStart(2, "0");

    for (const variation of animeVariations) {
      if (variation !== name && variation !== simplifiedName) {
        variationQueries.push(
          `${variation} S${seasonStr}E${episodeStr}`,
          `${variation} ${seasonStr}x${episodeStr}`,
          `${variation} - ${episodeStr}`,
          `${variation} ${episodeStr}`
        );
      }
    }

    // Combine all queries and remove duplicates/null values
    const queries = [...baseQueries, ...variationQueries].filter(Boolean);
    results = await searchSeriesWithPattern(
      queries,
      episode.season,
      episode.number
    ); // If still no results, try alternate title from TMDb or Wikidata
    if (results.length === 0) {
      let titleInfo = null;
      let episodeInfo = null;

      if (USE_TMDB) {
        titleInfo = await getTitleFromTMDb(id);

        if (titleInfo && titleInfo.tmdbId && episode) {
          episodeInfo = await getEpisodeFromTMDb(
            titleInfo.tmdbId,
            episode.season,
            episode.number
          );
        }
      }

      if (!titleInfo) {
        titleInfo = await getTitleFromWikidata(id);
      }
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

        // Add specific episode title to improve search if available
        const episodeTitle = episodeInfo?.name;
        const episodeQueries = [];

        if (episodeTitle) {
          console.log(`Adding episode title to search: "${episodeTitle}"`);
          episodeQueries.push(`${altName} ${episodeTitle}`, episodeTitle);

          if (altSimplified) {
            episodeQueries.push(`${altSimplified} ${episodeTitle}`);
          }
        }

        const altQueries = [
          `${altName} S${seasonStr}E${episodeStr}`,
          `${altName} ${seasonStr}x${episodeStr}`,
          `${altName} - ${episodeStr}`,
          // Add episode title queries if available
          ...episodeQueries,
        ];
        if (altSimplified) {
          altQueries.push(
            `${altSimplified} S${seasonStr}E${episodeStr}`,
            `${altSimplified} ${seasonStr}x${episodeStr}`,
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
    } // If no results found, try searching with the simplified name
    if (results.length === 0) {
      let titleInfo = null;

      // Try TMDb API first if API key is available
      if (USE_TMDB) {
        titleInfo = await getTitleFromTMDb(id);
      }

      // Fall back to Wikidata if no results from TMDb or if TMDb is not available
      if (!titleInfo) {
        titleInfo = await getTitleFromWikidata(id);
      }

      if (
        titleInfo &&
        titleInfo.enTitle &&
        titleInfo.enTitle !== originalName
      ) {
        console.log(
          `Trying alternate title from ${USE_TMDB ? "TMDb" : "Wikidata"}: "${
            titleInfo.enTitle
          }"`
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

    // Get anime name variations to enhance generic search
    const animeVariations = getAnimeNameVariations(originalName);
    console.log(
      `Trying generic search with ${animeVariations.length} name variations`
    );

    // Try multiple search approaches for generic search
    const baseQueries = [
      originalName, // Original full name
      simplifiedName, // Simplified name (without subtitle)
      originalName.split(" ").slice(0, 2).join(" "), // First two words only
      simplifiedName.split(" ").slice(0, 2).join(" "), // First two words of simplified name
    ];

    // Add alternative anime names to generic search queries
    const allGenericQueries = [
      ...baseQueries,
      ...animeVariations.filter(
        (v) => v !== originalName && v !== simplifiedName
      ),
    ].filter((q, i, self) => q && self.indexOf(q) === i); // Remove duplicates and empties

    let genericResults = [];

    // Try each generic query
    for (const query of allGenericQueries) {
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

  if (results.length === 0) {
    console.log("No matching streams found");
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
      console.log(`- ${r.title} (Size: ${Math.floor(r.size / 1024 / 1024)} MB)`)
    );

  // Limit to top 10 results after sorting
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
        // Format file size for display
        const sizeGB = result.size
          ? (result.size / 1024 / 1024 / 1024).toFixed(2) + " GB"
          : "Unknown size";

        for (const s of streamInfo) {
          streams.push({
            url: s.url,
            quality: s.quality,
            title: `${result.title}\n${s.quality} | ${sizeGB}`, // put quality and size on second line
            name: `Hellspy - ${s.quality}`,
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
