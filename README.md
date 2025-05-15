# Stremio Hellspy.to Addon

This addon allows you to search and stream content from Hellspy.to directly in Stremio.

## Features

- Search for movies and series on Hellspy.to
- Stream content directly in Stremio (requires stremio-local-addon)
- No login required

## How it works

1. The addon lets you search Hellspy.to's content directly from Stremio
2. When you select a movie or episode, the addon fetches the stream URL from Hellspy.to
3. The content is streamed using stremio-local-addon

## Installation

1. Install [Stremio](https://www.stremio.com/downloads)
2. Install [stremio-local-addon](https://github.com/sleeyax/stremio-addons/tree/master/packages/addons/local-addon) to enable streaming from external sources
3. Clone this repository
4. Install dependencies:
   ```
   npm install
   ```
5. Start the addon:
   ```
   npm start
   ```
6. Add the addon to Stremio by clicking on this link:
   ```
   stremio://127.0.0.1:7000/manifest.json
   ```

## Usage

1. Open Stremio
2. Go to the Addons section
3. Find the Hellspy addon
4. Use the search function to find content on Hellspy.to
5. Select an item and stream it

## Configuration

This addon uses the following environment variables to configure proxy settings for accessing Hellspy.to content from outside the Czech Republic:

| Variable | Description |
|----------|-------------|
| `CZECH_PROXY_HOST` | The hostname or IP address of a Czech proxy server |
| `CZECH_PROXY_PORT` | The port number of the proxy server |
| `CZECH_PROXY_USERNAME` | (Optional) Username for proxy authentication |
| `CZECH_PROXY_PASSWORD` | (Optional) Password for proxy authentication |

You can set these environment variables before starting the addon. For example:

```bash
# Set proxy configuration
export CZECH_PROXY_HOST=your-czech-proxy.com
export CZECH_PROXY_PORT=8080
export CZECH_PROXY_USERNAME=username  # if your proxy requires authentication
export CZECH_PROXY_PASSWORD=password  # if your proxy requires authentication

# Start the addon
npm start
```

The addon will automatically detect if you're already in the Czech Republic and only use the proxy when needed.

## Notes

- This addon doesn't download files but streams them through stremio-local-addon
- Streaming quality depends on the source file quality from Hellspy.to
- No registration or login required
- A proxy or VPN with a Czech IP address may be required as Hellspy.to is primarily accessible from Czechia
- Some content might be geo-restricted to Czech Republic and Slovakia

## License

This project is licensed under the GNU General Public License v2.0 - see the [LICENSE](LICENSE) file for details.
