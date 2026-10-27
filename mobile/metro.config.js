// Pin Metro to this app. Without a config here it walks up to the repo root and
// loads the old web/Expo 49 metro.config.js, which breaks the build.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
