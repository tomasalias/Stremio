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

## Notes

- This addon doesn't download files but streams them through stremio-local-addon
- Streaming quality depends on the source file quality from Hellspy.to
- No registration or login required

## License

This project is licensed under the GNU General Public License v2.0 - see the [LICENSE](LICENSE) file for details.
