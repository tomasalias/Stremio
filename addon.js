const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://hellspy.to';

// Proxy configuration from environment variables
const PROXY_HOST = process.env.CZECH_PROXY_HOST;
const PROXY_PORT = process.env.CZECH_PROXY_PORT;
const PROXY_USERNAME = process.env.CZECH_PROXY_USERNAME;
const PROXY_PASSWORD = process.env.CZECH_PROXY_PASSWORD;

let proxyConfig = null;
if (PROXY_HOST && PROXY_PORT) {
    const auth = PROXY_USERNAME && PROXY_PASSWORD 
        ? `${PROXY_USERNAME}:${PROXY_PASSWORD}@` 
        : '';
    proxyConfig = {
        protocol: 'http',
        host: PROXY_HOST,
        port: PROXY_PORT,
        auth: auth ? { username: PROXY_USERNAME, password: PROXY_PASSWORD } : undefined
    };
    console.log(`Proxy configured: ${PROXY_HOST}:${PROXY_PORT}`);
} else {
    console.log('No proxy configuration found in environment variables');
}

async function isInCzechRepublic() {
    try {
        const response = await axios.get('https://ipinfo.io/json');
        const country = response.data.country;
        console.log(`Current server country: ${country}`);
        return country === 'CZ';
    } catch (error) {
        console.error('Error detecting country, assuming not in Czech Republic:', error);
        return false;
    }
}

// Create an axios instance that might use the proxy
let axiosInstance = axios;
let proxyEnabled = false;

// Initialize the proxy if needed
(async () => {
    if (proxyConfig && !(await isInCzechRepublic())) {
        const HttpsProxyAgent = require('https-proxy-agent');
        const proxyUrl = `http://${proxyConfig.auth ? proxyConfig.auth.username + ':' + proxyConfig.auth.password + '@' : ''}${proxyConfig.host}:${proxyConfig.port}`;
        const httpsAgent = new HttpsProxyAgent(proxyUrl);
        
        axiosInstance = axios.create({
            httpsAgent,
            proxy: false  // Don't use Node's default proxy handling
        });
        
        proxyEnabled = true;
        console.log('Using Czech proxy for Hellspy requests');
    } else {
        console.log('No proxy needed - either in Czech Republic or no proxy configured');
    }
})();

// Create a simple cache to avoid redundant searches
const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Create a new addon builder
const builder = new addonBuilder({
    id: 'org.stremio.hellspy',
    version: '0.0.1',
    name: 'Hellspy',
    description: 'Hellspy.to addon for Stremio',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'kitsu'],
    catalogs: [] // Empty array for catalogs as we're using Cinemeta catalog
});

// Search hellspy.to and parse results
async function searchHellspy(query) {
    // Check if we have a cached result that's still valid
    if (searchCache.has(query)) {
        const { results, timestamp } = searchCache.get(query);
        if (Date.now() - timestamp < CACHE_TTL) {
            console.log(`Using cached results for "${query}"`);
            return results;
        }
    }
    
    try {
        console.log(`Searching Hellspy for "${query}"...`);
        const response = await axiosInstance.get(`${BASE_URL}/?query=${encodeURIComponent(query)}`);
        const $ = cheerio.load(response.data);
        
        const results = [];
        $('.results-grid .result-video').each((i, elem) => {
            const title = $(elem).attr('title');
            const href = $(elem).attr('href');
            
            if (title && href) {
                // Parse season and episode from title if available
                let season = null;
                let episode = null;
                
                const seasonMatch = title.match(/S(\d+)E(\d+)/i);
                if (seasonMatch) {
                    season = parseInt(seasonMatch[1]);
                    episode = parseInt(seasonMatch[2]);
                }
                
                // Extract video ID
                const urlParts = href.split('/');
                const videoId = urlParts[urlParts.length - 1];
                const hash = urlParts[urlParts.length - 2];
                
                results.push({
                    title,
                    videoId,
                    hash,
                    season,
                    episode,
                    href
                });
            }
        });
        
        // Cache the results
        searchCache.set(query, { results, timestamp: Date.now() });
        console.log(`Found ${results.length} results for "${query}"`);
        
        return results;
    } catch (error) {
        console.error('Error searching Hellspy:', error);
        return [];
    }
}

// Get stream URL from Hellspy
async function getStreamUrl(videoId, hash) {
    const cacheKey = `${hash}:${videoId}`;
    
    // Check if we have a cached result that's still valid
    if (searchCache.has(cacheKey)) {
        const { result, timestamp } = searchCache.get(cacheKey);
        if (Date.now() - timestamp < CACHE_TTL) {
            console.log(`Using cached stream info for ${cacheKey}`);
            return result;
        }
    }
    
    try {
        console.log(`Getting stream info for ${hash}/${videoId}...`);
        const url = `${BASE_URL}/video/${hash}/${videoId}`;
        const response = await axiosInstance.get(url);
        const $ = cheerio.load(response.data);
        
        // Find the download button and get its href
        const downloadLink = $('.controls .link-button[download]').attr('href');
        const title = $('.video-header h1').text().trim();
        
        let result = null;
        if (downloadLink) {
            result = {
                url: downloadLink,
                title: title
            };
        }
        
        // Cache the result
        searchCache.set(cacheKey, { result, timestamp: Date.now() });
        
        return result;
    } catch (error) {
        console.error('Error getting stream URL:', error);
        return null;
    }
}

// Get title information from Wikidata using SPARQL and IMDb ID
async function getTitleFromWikidata(imdbId) {
    try {
        console.log(`Fetching title information for ${imdbId} from Wikidata SPARQL endpoint`);
        
        const query = `
            SELECT ?film ?filmLabel ?originalTitle ?publicationDate ?instanceLabel WHERE {
                ?film wdt:P345 "${imdbId}".
                OPTIONAL { ?film wdt:P1476 ?originalTitle. }       # Original title
                OPTIONAL { ?film wdt:P577 ?publicationDate. }      # Publication date
                OPTIONAL { ?film wdt:P31 ?instance. }              # Instance of (e.g., film, TV series)
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
            }
        `;

        const url = 'https://query.wikidata.org/sparql';
        const headers = { 'Accept': 'application/sparql-results+json' };
        
        const response = await axios.get(url, {  // Use default axios here, no proxy needed for Wikidata
            params: { query },
            headers
        });

        const results = response.data.results.bindings;

        if (results.length > 0) {
            const result = results[0];
            const title = result.filmLabel?.value || null;
            const originalTitle = result.originalTitle?.value || null;
            const year = result.publicationDate?.value?.substring(0, 4) || null;
            const type = result.instanceLabel?.value || null;

            console.log(`Found title: ${title} (${year})`);
            return {
                title,
                originalTitle,
                year,
                type
            };
        } else {
            console.log(`No title information found for ${imdbId}`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching title information for ${imdbId}:`, error);
        return null;
    }
}

// Stream handler
builder.defineStreamHandler(async ({ type, id, name, episode, year }) => {
    console.log('Stream request:', type, id, name, episode);

    // Check if the ID is in the format "tt1234567:1:2" (IMDb ID with season and episode)
    if (id.includes(':')) {
        const parts = id.split(':');
        id = parts[0];
        episode = {
            season: parseInt(parts[1]),
            number: parseInt(parts[2])
        };
    }

    // If we don't have a name but we have an IMDb ID, try to get the title info from Wikidata
    if (!name && id.startsWith('tt')) {
        const titleInfo = await getTitleFromWikidata(id);
        if (titleInfo) {
            name = titleInfo.title;
            year = titleInfo.year;
            // If type wasn't provided but we got it from IMDb, use that
            if (!type && titleInfo.type) {
                type = titleInfo.type === 'movie' ? 'movie' : 'series';
            }
        }
    }

    // If we still don't have a name, we can't proceed
    if (!name) {
        console.log(`Could not find title name for id: ${id}`);
        return { streams: [] };
    }

    // For series, we need to handle episodes
    let searchQuery = name;
    let additionalQuery = null;
    
    if (type === 'series' && episode) {
        // Format the search query for TV shows, e.g. "Show Name S01E05"
        const seasonStr = episode.season.toString().padStart(2, '0');
        const episodeStr = episode.number.toString().padStart(2, '0');
        
        // First try with the full format
        searchQuery = `${name} S${seasonStr}E${episodeStr}`;
        
        // Prepare a backup query format with just the name and episode identifier
        additionalQuery = `${name} ${seasonStr}x${episodeStr}`;
    }

    if (type === 'movie') {
        // For movies, we can use the name and year
        searchQuery = name + " " + year;
        additionalQuery = name;
    }
    
    // First attempt with the primary search query
    let results = await searchHellspy(searchQuery);
    
    // If no results and we have an additional query, try that
    if (results.length === 0 && additionalQuery) {
        results = await searchHellspy(additionalQuery);
    }

    if (results.length === 0 && name.includes(':')) {
        const parts = name.split(':');
        name = parts[0].trim();
        results = await searchHellspy(name);
    }
    
    // If still no results, try a more generic search with just the name
    if (results.length === 0 && type === 'series' && episode) {
        const simpleQuery = name;
        console.log(`No results found with specific episode query, trying generic search for: "${simpleQuery}"`);
        
        const genericResults = await searchHellspy(simpleQuery);
        
        // Filter results to try to match the season and episode
        results = genericResults.filter(result => {
            if (!result.season || !result.episode) return false;
            
            return (result.season === episode.season && result.episode === episode.number);
        });
    }
    
    if (results.length === 0) {
        console.log('No matching streams found');
        return { streams: [] };
    }
    
    // Process each result to get stream URL
    const streams = [];
    const processedResults = [];
    
    // First process exact matches for series
    if (type === 'series' && episode) {
        processedResults.push(...results.filter(result => 
            result.season === episode.season && result.episode === episode.number
        ));
    }
    
    // Then add all other results
    processedResults.push(...results.filter(result => 
        !processedResults.includes(result)
    ));
    
    // Limit to top 10 most relevant results
    const limitedResults = processedResults.slice(0, 10);
    
    for (const result of limitedResults) {
        try {
            const streamInfo = await getStreamUrl(result.videoId, result.hash);
            
            if (streamInfo && streamInfo.url) {
                // Add quality info based on title if available
                let quality = 'unknown';
                if (result.title.includes('720p')) quality = '720p';
                if (result.title.includes('1080p')) quality = '1080p';
                if (result.title.includes('2160p') || result.title.includes('4K')) quality = '4K';
                
                // Check for audio info
                let audioInfo = '';
                if (result.title.includes('DD5.1') || result.title.includes('DD+5.1')) {
                    audioInfo = '5.1';
                }
                
                const titleInfo = quality !== 'unknown' ? `${quality}${audioInfo ? ', ' + audioInfo : ''}` : result.title;
                
                streams.push({
                    title: `Hellspy - ${titleInfo}`,
                    url: streamInfo.url,
                    // Use stremio-local-addon protocol for streaming
                    behaviorHints: {
                        notWebReady: true,
                        bingeGroup: 'hellspy'
                    }
                });
            }
        } catch (error) {
            console.error('Error processing result:', error);
        }
    }
    
    return { streams };
});

module.exports = builder.getInterface();
