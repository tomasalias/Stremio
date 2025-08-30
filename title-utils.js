// Helper functions for handling title variations and translations
const axios = require("axios");

/**
 * Get alternative titles for a movie or series from TMDb API
 * @param {string} name Original title name
 * @param {string} type Content type (movie or series)
 * @param {string} apiKey TMDb API key
 * @param {string} language Primary language for results (e.g., "cs-CZ")
 * @returns {Promise<string[]>} Array of alternative titles
 */
async function getAlternativeTitlesFromTMDb(name, type, apiKey, language = "cs-CZ") {
  if (!apiKey || !name) return [];
  
  try {
    console.log(`Searching TMDb for alternative titles for "${name}" (${type})`);
    
    // Step 1: Search for the title on TMDb
    const searchType = type === "series" ? "tv" : "movie";
    const searchUrl = `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(name)}&language=${language}`;
    
    const searchResponse = await axios.get(searchUrl);
    const results = searchResponse.data.results || [];
    
    if (results.length === 0) {
      console.log(`No TMDb results found for "${name}"`);
      return [];
    }
    
    // Get the first matching result
    const item = results[0];
    const itemId = item.id;
    
    // Step 2: Get alternative titles using the TMDb ID
    const altTitlesUrl = `https://api.themoviedb.org/3/${searchType}/${itemId}/alternative_titles?api_key=${apiKey}`;
    const altResponse = await axios.get(altTitlesUrl);
    
    // Extract all titles
    const titles = [];
    
    // Add original title and name
    if (type === "series") {
      titles.push(item.name);
      if (item.original_name && item.original_name !== item.name) {
        titles.push(item.original_name);
      }
    } else {
      titles.push(item.title);
      if (item.original_title && item.original_title !== item.title) {
        titles.push(item.original_title);
      }
    }
    
    // Add alternative titles
    if (altResponse.data.titles) {
      altResponse.data.titles.forEach(title => {
        titles.push(title.title);
      });
    }
    
    // Remove duplicates
    const uniqueTitles = [...new Set(titles)].filter(Boolean);
    
    console.log(`Found ${uniqueTitles.length} alternative titles for "${name}"`);
    return uniqueTitles;
  } catch (error) {
    console.error(`Error fetching alternative titles for "${name}":`, error.message);
    return [];
  }
}

/**
 * Combined function that merges hardcoded anime mappings with dynamic TMDb lookups
 * @param {string} title Original title
 * @param {string} type Content type (movie or series)
 * @param {string} tmdbApiKey TMDb API key (optional)
 * @returns {Promise<string[]>} Array of title variations
 */
async function getAllTitleVariations(title, type, tmdbApiKey) {
  if (!title) return [];
  
  // Start with static mappings
  const staticVariations = getStaticAnimeNameVariations(title);
  
  // If TMDb API key is provided, get dynamic variations too
  let dynamicVariations = [];
  if (tmdbApiKey) {
    try {
      dynamicVariations = await getAlternativeTitlesFromTMDb(title, type, tmdbApiKey);
    } catch (error) {
      console.error("Error getting dynamic title variations:", error.message);
    }
  }
  
  // Combine results, remove duplicates, and ensure original title is included
  const allVariations = [...staticVariations, ...dynamicVariations, title];
  return [...new Set(allVariations)].filter(Boolean);
}

/**
 * Static mappings of common anime names (fallback when TMDb API is unavailable)
 */
function getStaticAnimeNameVariations(title) {
  if (!title) return [];

  // Common anime name substitutions to improve search results
  const commonMappings = {
    "Sósó no Frieren": ["Frieren", "Frieren Beyond Journeys End", "Sousou no Frieren", "Frieren: Beyond Journey's End"],
    "葬送のフリーレン": ["Frieren", "Frieren Beyond Journeys End", "Sousou no Frieren", "Frieren: Beyond Journey's End"],
    "Sousou no Frieren": ["Frieren", "Frieren Beyond Journeys End", "Frieren: Beyond Journey's End"],
    "Frieren: Beyond Journey's End": ["Frieren", "Sousou no Frieren"],
    "Spy×Family": ["Spy Family", "SpyFamily", "Spy x Family"],
    "Jujutsu Kaisen": ["JJK"],
    "Boku no Hero Academia": ["My Hero Academia", "MHA"],
    "Shingeki no Kyojin": ["Attack on Titan", "AOT"],
    "Kimetsu no Yaiba": ["Demon Slayer"],
    "One Piece": ["ワンピース", "Wan Pīsu"],
    "Naruto": ["ナルト"],
    "Dragon Ball": ["ドラゴンボール", "Doragon Bōru"],
    "Bleach": ["ブリーチ", "Burīchi"],
    "Hunter x Hunter": ["Hunter × Hunter", "HxH", "ハンターハンター"],
    "Fullmetal Alchemist": ["Fullmetal Alchemist: Brotherhood", "FMA", "FMA:B", "鋼の錬金術師"],
    "Death Note": ["デスノート", "Desu Nōto"],
    "Tokyo Ghoul": ["東京喰種", "Tōkyō Gūru"],
    "Attack on Titan": ["Shingeki no Kyojin", "AOT", "進撃の巨人"],
    "Demon Slayer": ["Kimetsu no Yaiba", "鬼滅の刃"],
    "My Hero Academia": ["Boku no Hero Academia", "MHA", "僕のヒーローアカデミア"],
    "One Punch Man": ["ワンパンマン", "Wanpanman"],
    "Vinland Saga": ["ヴィンランド・サガ"],
    "Chainsaw Man": ["チェンソーマン", "Chensō Man"],
    "Bocchi the Rock!": ["ぼっち・ざ・ろっく!"],
    "Solo Leveling": ["나 혼자만 레벨업", "Na Honjaman Level Up", "I Level Up Alone"],
    "Oshi no Ko": ["【推しの子】", "My Star"],
    "Jigokuraku": ["Hell's Paradise", "地獄楽"]
  };

  // Check for direct matches in our mapping
  const variations = [];
  const titleLower = title.toLowerCase();

  for (const [key, values] of Object.entries(commonMappings)) {
    // Check if the title or any part of it matches the key
    if (
      titleLower.includes(key.toLowerCase()) ||
      values.some(v => titleLower.includes(v.toLowerCase()))
    ) {
      // Add all variations for this title
      variations.push(...values);
      // Also add the key as a variation if it's not the original title
      if (key.toLowerCase() !== titleLower) {
        variations.push(key);
      }
    }
  }

  // Check for partial matches in words (useful for anime with multiple name formats)
  const titleWords = title.toLowerCase().split(/\s+/);
  for (const [key, values] of Object.entries(commonMappings)) {
    const keyWords = key.toLowerCase().split(/\s+/);
    // Check for overlap in words
    const hasCommonWords = keyWords.some(word =>
      titleWords.includes(word) && word.length > 3 // Only consider substantial words
    );

    if (hasCommonWords) {
      variations.push(...values);
      variations.push(key);
    }
  }

  // Add current title to variations
  variations.push(title);

  // Remove duplicates and filter out empty strings
  return [...new Set(variations)].filter(Boolean);
}

module.exports = {
  getAlternativeTitlesFromTMDb,
  getStaticAnimeNameVariations,
  getAllTitleVariations
};
