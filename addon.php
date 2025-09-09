<?php
// addon.php
// Hellspy Stremio addon with full file logging + Wikidata title resolver
declare(strict_types=1);

// ---------- CONFIG ----------
const ADDON_ID = "org.stremio.hellspy";
const ADDON_VERSION = "0.0.1";
const ADDON_NAME = "Hellspy";
const ADDON_DESCRIPTION = "Hellspy.to addon for Stremio";

const CACHE_DIR = __DIR__ . '/cache_hellspy_php';
const CACHE_TTL = 3600; // seconds
const REQUEST_DELAY = 1.0; // seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2.0;
const REQUEST_TIMEOUT = 10;

const LOG_FILE = __DIR__ . '/addon.log';

// ensure cache dir
if (!is_dir(CACHE_DIR)) {
    mkdir(CACHE_DIR, 0755, true);
}

// ---------- Logging ----------
function log_msg(string $level, string $msg) {
    $entry = "[" . date('Y-m-d H:i:s') . "][$level] $msg\n";
    file_put_contents(LOG_FILE, $entry, FILE_APPEND);
}
function log_info(string $msg) { log_msg('INFO', $msg); }
function log_warn(string $msg) { log_msg('WARN', $msg); }
function log_err(string $msg)  { log_msg('ERROR', $msg); }

// startup log
file_put_contents(LOG_FILE, "[".date('Y-m-d H:i:s')."][START] addon.php loaded\n", FILE_APPEND);

// ---------- Helpers ----------
function now_float(): float { return microtime(true); }

function cache_get(string $key) {
    $path = CACHE_DIR . '/' . md5($key) . '.json';
    if (!file_exists($path)) return null;
    $data = @json_decode(file_get_contents($path), true);
    if (!$data) return null;
    if (isset($data['timestamp']) && (time() - $data['timestamp'] < CACHE_TTL)) return $data['value'];
    @unlink($path);
    return null;
}
function cache_set(string $key, $value) {
    $path = CACHE_DIR . '/' . md5($key) . '.json';
    file_put_contents($path, json_encode(['timestamp'=>time(),'value'=>$value]));
}

// ---------- HTTP Requests ----------
$lastRequestTime = 0.0;
function make_rate_limited_request(string $url, array $opts = [], int $retries = 0) {
    global $lastRequestTime;

    $now = now_float();
    $elapsed = $now - $lastRequestTime;
    if ($elapsed < REQUEST_DELAY) {
        usleep((int)(max(0, (REQUEST_DELAY - $elapsed) * 1e6)));
    }

    $ch = curl_init();
    $headers = $opts['headers'] ?? [];
    $params = $opts['params'] ?? null;
    if ($params && is_array($params)) {
        $url .= (strpos($url,'?')===false?'?':'&') . http_build_query($params);
    }
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => REQUEST_TIMEOUT,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => $headers
    ]);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);
    $lastRequestTime = now_float();

    log_info("HTTP GET: $url");

    if ($result === false) {
        $err = $curlErr ?: 'Unknown cURL error';
        log_err("HTTP request error for $url: $err");
        if ($retries < MAX_RETRIES) {
            sleep((int)(RETRY_DELAY_BASE*pow(2,$retries)));
            return make_rate_limited_request($url,$opts,$retries+1);
        }
        throw new RuntimeException("HTTP request failed: $err");
    }
    if ($httpCode===429 && $retries<MAX_RETRIES) {
        sleep((int)(RETRY_DELAY_BASE*pow(2,$retries)));
        return make_rate_limited_request($url,$opts,$retries+1);
    }
    if ($httpCode>=200 && $httpCode<300) {
        $decoded = json_decode($result,true);
        log_info("HTTP response (truncated): " . substr($result,0,500));
        return $decoded ?? $result;
    }
    $msg = "HTTP $httpCode for $url"; log_err($msg);
    throw new RuntimeException($msg);
}

// ---------- Wikidata ----------
function get_title_from_wikidata(string $imdbId): ?array {
    $cacheKey = "wikidata:$imdbId";
    $cached = cache_get($cacheKey);
    if ($cached !== null) return $cached;

    try {
        log_info("Fetching titles for $imdbId from Wikidata");

        $baseQuery = function($lang) use ($imdbId) {
            return "
              SELECT ?film ?filmLabel ?originalTitle ?publicationDate ?instanceLabel WHERE {
                ?film wdt:P345 \"$imdbId\".
                OPTIONAL { ?film wdt:P1476 ?originalTitle. }
                OPTIONAL { ?film wdt:P577 ?publicationDate. }
                OPTIONAL { ?film wdt:P31 ?instance. }
                SERVICE wikibase:label { bd:serviceParam wikibase:language \"$lang\". }
              }
            ";
        };

        $url = "https://query.wikidata.org/sparql";
        $headers = [
            'Accept: application/sparql-results+json',
            'User-Agent: Hellspy-Stremio-Addon/0.0.1 (https://stremio-addon.example/)'
        ];

        $cz = make_rate_limited_request($url, ['params'=>['query'=>$baseQuery("cs")], 'headers'=>$headers]);
        $en = make_rate_limited_request($url, ['params'=>['query'=>$baseQuery("en")], 'headers'=>$headers]);

        $czRes = $cz['results']['bindings'][0] ?? [];
        $enRes = $en['results']['bindings'][0] ?? [];

        $czTitle = $czRes['filmLabel']['value'] ?? null;
        $enTitle = $enRes['filmLabel']['value'] ?? null;
        $origTitle = $czRes['originalTitle']['value'] ?? ($enRes['originalTitle']['value'] ?? null);
        $year = null;
        if (!empty($czRes['publicationDate']['value'])) $year = substr($czRes['publicationDate']['value'],0,4);
        elseif (!empty($enRes['publicationDate']['value'])) $year = substr($enRes['publicationDate']['value'],0,4);

        // discard Wikidata IDs as titles
        if ($czTitle && preg_match('/^Q\d+$/',$czTitle)) $czTitle = null;

        $info = [
            'czTitle'=>$czTitle,
            'enTitle'=>$enTitle,
            'originalTitle'=>$origTitle,
            'year'=>$year
        ];
        cache_set($cacheKey,$info);
        log_info("Wikidata resolved: EN=$enTitle, CZ=$czTitle, Year=$year");
        return $info;
    } catch (Throwable $e) {
        log_err("Wikidata error for $imdbId: ".$e->getMessage());
        return null;
    }
}

// ---------- Hellspy ----------
function search_hellspy(string $query) {
    $cacheKey = "search:$query"; $cached=cache_get($cacheKey);
    if($cached!==null) return $cached;
    try {
        log_info("Searching Hellspy for \"$query\"...");
        $resp = make_rate_limited_request('https://api.hellspy.to/gw/search',['params'=>['query'=>$query,'offset'=>0,'limit'=>64]]);
        if(!is_array($resp)) {
            log_warn("Unexpected search response for $query");
            cache_set($cacheKey,[]);
            return [];
        }
        $items=$resp['items']??[];
        $results=array_values(array_filter($items,fn($i)=>isset($i['objectType'])&&$i['objectType']==='GWSearchVideo'));
        cache_set($cacheKey,$results);
        log_info("Found ".count($results)." items for \"$query\"");
        return $results;
    } catch(Throwable $e) {
        log_err("Search error: ".$e->getMessage());
        return [];
    }
}

function get_stream_url(string $id,string $fileHash) {
    $cacheKey="stream:$id:$fileHash"; $cached=cache_get($cacheKey);
    if($cached!==null) return $cached;
    try {
        log_info("Fetching stream for video $id ($fileHash)");
        $resp = make_rate_limited_request("https://api.hellspy.to/gw/video/$id/$fileHash");
        if(!is_array($resp)) {
            log_warn("Stream response not JSON for $id");
            return [];
        }
        $title=$resp['title']??''; $duration=$resp['duration']??0;
        log_info("Video: \"$title\" duration $duration s");
        $conversions=$resp['conversions']??[];
        if(empty($conversions)&&!empty($resp['download'])) {
            $streams=[['url'=>$resp['download'],'quality'=>'original','title'=>$title]];
            cache_set($cacheKey,$streams);
            return $streams;
        }
        $streams=[];
        foreach($conversions as $q=>$u) {
            $streams[]=['url'=>$u,'quality'=>$q.'p','title'=>$title];
        }
        cache_set($cacheKey,$streams);
        log_info("Found ".count($streams)." qualities for $id");
        return $streams;
    } catch(Throwable $e){
        log_err("get_stream_url error: ".$e->getMessage());
        return [];
    }
}

// ---------- Main Stream Logic ----------
function handle_stream_request(array $body): array {
    $type = $body['type'] ?? null;
    $id = $body['id'] ?? null;
    $name = $body['name'] ?? null;
    $episode = $body['episode'] ?? null;
    $year = $body['year'] ?? null;

    log_info("Stream request: type=$type id=$id name=$name episode=" . json_encode($episode));

    // Parse series episode notation "tt1234567:1:2" -> ['season'=>1,'number'=>2]
    $season = $episodeNumber = null;
    if ($id && preg_match('/^tt\d+:\d+:\d+$/', $id)) {
        [$id, $season, $episodeNumber] = explode(':', $id);
        $season = (int)$season;
        $episodeNumber = (int)$episodeNumber;
    }

    // resolve IMDB id -> title
    if ($id && preg_match('/^tt\d+$/', $id)) {
        $wikidata = get_title_from_wikidata($id);
        if ($wikidata) {
            $name = $wikidata['czTitle'] ?? $wikidata['enTitle'] ?? $wikidata['originalTitle'] ?? $name;
            $year = $wikidata['year'] ?? $year;
            if (!$type && isset($wikidata['type'])) {
                $type = stripos($wikidata['type'], 'series') !== false ? 'series' : 'movie';
            }
        }
    }

    if (empty($name)) {
        log_warn("No title name found for id $id");
        return ['streams' => []];
    }

    // Build search queries
    $searchQueries = [];
    $simplifiedName = $name;
    if (strpos($name, ':') !== false) {
        $simplifiedName = explode(':', $name)[0];
    }

    if ($type === 'series' && $season !== null && $episodeNumber !== null) {
        $seasonStr = str_pad((string)$season, 2, '0', STR_PAD_LEFT);
        $epStr = str_pad((string)$episodeNumber, 2, '0', STR_PAD_LEFT);

        $searchQueries = [
            "$name S{$seasonStr}E{$epStr}",
            "$name {$seasonStr}x{$epStr}",
            "$name - $epStr",
            "$simplifiedName S{$seasonStr}E{$epStr}",
            "$simplifiedName {$seasonStr}x{$epStr}",
            "$simplifiedName - $epStr"
        ];
    } else { // movies
        $searchQueries = [$name . ($year ? " $year" : ""), $simplifiedName . ($year ? " $year" : ""), $name, $simplifiedName];
    }

    // Remove duplicates
    $searchQueries = array_unique(array_filter($searchQueries));

    $results = [];
    foreach ($searchQueries as $query) {
        $res = search_hellspy($query);
        if (!empty($res)) {
            $results = $res;
            break;
        }
    }

    // If still no results and type=series, try alternate title from Wikidata
    if (empty($results) && $type === 'series' && $season !== null && $episodeNumber !== null && !empty($wikidata['enTitle']) && $wikidata['enTitle'] !== $name) {
        $altName = $wikidata['enTitle'];
        $altSimplified = explode(':', $altName)[0] ?? $altName;
        $seasonStr = str_pad((string)$season, 2, '0', STR_PAD_LEFT);
        $epStr = str_pad((string)$episodeNumber, 2, '0', STR_PAD_LEFT);

        $altQueries = [
            "$altName S{$seasonStr}E{$epStr}",
            "$altName {$seasonStr}x{$epStr}",
            "$altName - $epStr",
            "$altSimplified S{$seasonStr}E{$epStr}",
            "$altSimplified {$seasonStr}x{$epStr}",
            "$altSimplified - $epStr"
        ];

        foreach ($altQueries as $query) {
            $res = search_hellspy($query);
            if (!empty($res)) {
                $results = $res;
                break;
            }
        }
    }

    if (empty($results)) {
        log_info("No search results for $name");
        return ['streams' => []];
    }

    // Prepare stream URLs
    $streams = [];
    $limited = array_slice($results, 0, 5);
    foreach ($limited as $res) {
        if (empty($res['id']) || empty($res['fileHash'])) {
            log_warn("Skipping result missing id/fileHash");
            continue;
        }
        try {
            $sinfo = get_stream_url((string)$res['id'], (string)$res['fileHash']);
            if (is_array($sinfo) && count($sinfo) > 0) {
                $sizeGB = isset($res['size']) ? round($res['size'] / 1024 / 1024 / 1024, 2) . ' GB' : 'Unknown size';
                foreach ($sinfo as $s) {
                    $streams[] = [
                        'url' => $s['url'],
                        'quality' => $s['quality'],
                        'title' => ($res['title'] ?? '') . "\n" . ($s['quality'] ?? '') . " | " . $sizeGB,
                        'name' => "Hellspy - " . ($s['quality'] ?? '')
                    ];
                }
            }
        } catch (Throwable $e) {
            log_err("Processing result error: " . $e->getMessage());
        }
    }

    log_info("Returning " . count($streams) . " streams");
    return ['streams' => $streams];
}

// ---------- HTTP Routing ----------
$method=$_SERVER['REQUEST_METHOD'];
$uri=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);

// manifest
if($method==='GET' && $uri==='/manifest.json'){
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'id'=>ADDON_ID,'version'=>ADDON_VERSION,'name'=>ADDON_NAME,'description'=>ADDON_DESCRIPTION,
        'resources'=>['stream'],'types'=>['movie','series'],'idPrefixes'=>['tt','kitsu'],'catalogs'=>[],
        'stremioAddonsConfig'=>['issuer'=>'https://stremio-addons.net','signature'=>'']
    ],JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
    exit;
}

// Stremio GET stream route: /stream/movie/tt123.json
if($method==='GET' && preg_match('~^/stream/(movie|series)/([^/]+)\.json$~',$uri,$m)){
    $type=$m[1]; $id=urldecode($m[2]);
    log_info("Stremio GET stream: type=$type id=$id");
    $body=['type'=>$type,'id'=>$id,'name'=>$id];
    $result=handle_stream_request($body);
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
    exit;
}

// curl/debug POST stream
if($method==='POST' && $uri==='/stream'){
    $raw=file_get_contents('php://input');
    log_info("Raw POST body: " . $raw);
    $body=json_decode($raw,true)??[];
    log_info("Decoded request: " . json_encode($body));
    try {
        $result=handle_stream_request($body);
        log_info("Stream result count: " . count($result['streams'] ?? []));
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES);
    } catch(Throwable $e) {
        log_err("Stream handler error: " . $e->getMessage());
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error'=>$e->getMessage()]);
    }
    exit;
}

// default 404
http_response_code(404);
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
echo json_encode(['error'=>'Not found']);
exit;
