#!/usr/bin/env node

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

// Configuration
const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '127.0.0.1';

// Log the addon manifest
console.log('Loaded addon with manifest:');
console.log(JSON.stringify(addonInterface.manifest, null, 4));

// Serve the addon
serveHTTP(addonInterface, { port: PORT })
    .then(() => {
        console.log(`Hellspy addon running at http://${HOST}:${PORT}`);
        console.log('To install in Stremio, open:');
        console.log(`stremio://${HOST}:${PORT}/manifest.json`);
    })
    .catch(error => {
        console.error('Failed to start the addon server:', error);
    });
