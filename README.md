# Hellspy Stremio Addon

A Stremio addon that provides access to content from Hellspy.to with Czech and English title resolution via Wikidata.

## ⚠️ Important Requirements

**This addon only works with Czech IP addresses.** The Hellspy.to API requires access from Czech Republic IP addresses to function properly.

## Local Setup

### Prerequisites
- PHP 7.4 or higher
- Composer
- Web server (Apache/Nginx) or PHP built-in server

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tomasalias/Stremio.git
   cd Stremio
   ```

2. **Install dependencies:**
   ```bash
   composer install
   ```

3. **Set up permissions:**
   ```bash
   chmod 755 cache_hellspy_php
   chmod 644 addon.log
   ```

### Running Locally

#### Option 1: PHP Built-in Server
```bash
php -S localhost:8080
```

#### Option 2: Docker
```bash
docker build -t stremio-hellspy .
docker run -p 8080:80 stremio-hellspy
```

### Testing the Addon

1. **Check the manifest:**
   ```
   http://localhost:8080/manifest.json
   ```

2. **Test stream endpoint:**
   ```bash
   curl -X POST http://localhost:8080/stream \
     -H "Content-Type: application/json" \
     -d '{"type":"movie","id":"tt0111161","name":"The Shawshank Redemption","year":"1994"}'
   ```

3. **Add to Stremio:**
   - Open Stremio
   - Go to Addons
   - Enter: `http://localhost:8080/manifest.json`

## Deployment

### Recommended Hosting: Endora.cz

For production deployment, we recommend using **[endora.cz](https://www.endora.cz)** as they provide:
- Czech IP addresses (required for Hellspy.to API)
- PHP hosting support
- Reliable uptime
- Local Czech hosting

### Deployment Steps for Endora.cz:

1. **Upload files** to your web hosting directory
2. **Add the addon to Stremio** using your domain URL + `/manifest.json`

## Features

- **Dual Language Support**: Searches for content using both Czech and English titles
- **Wikidata Integration**: Automatically resolves IMDB IDs to proper titles
- **Series Support**: Handles TV series with season/episode notation
- **Quality Selection**: Multiple quality options when available
- **Caching**: Built-in caching system for improved performance
- **Comprehensive Logging**: Detailed logging for debugging

## Configuration

Key configuration constants in `addon.php`:
- `CACHE_TTL`: Cache time-to-live (default: 3600 seconds)
- `REQUEST_DELAY`: Rate limiting delay (default: 1.0 seconds)
- `MAX_RETRIES`: Maximum retry attempts (default: 3)
- `REQUEST_TIMEOUT`: HTTP request timeout (default: 10 seconds)

## API Endpoints

- `GET /manifest.json` - Stremio addon manifest
- `GET /stream/{type}/{id}.json` - Get streams for content
- `POST /stream` - Debug endpoint for stream requests

## Support

If you find this addon useful, consider supporting the development:
**[☕ Buy me a coffee](https://buymeacoffee.com/tomasalias)**

## License

This project is provided as-is for educational purposes. Please respect content creators and local copyright laws.

## Troubleshooting

### Common Issues:

1. **No streams found**: Ensure you're using a Czech IP address
2. **API errors**: Check the `addon.log` file for detailed error messages
3. **Cache issues**: Clear the `cache_hellspy_php` directory
4. **Permissions**: Ensure web server can write to cache and log directories

### Log Files:
- Check `addon.log` for detailed request and error logging
- Logs include search queries, API responses, and error details
