const exclusionList = require('metro-config/src/defaults/exclusionList');

module.exports = {
  resolver: {
    // block server.js from being resolved/bundled by Metro
    blockList: exclusionList([/\/server\.js$/]),
  },
};