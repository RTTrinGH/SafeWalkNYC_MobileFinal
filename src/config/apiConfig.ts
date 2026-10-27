export const API_CONFIG = {
  opencage: {
    apiKey: process.env.OPENCAGE_API_KEY,
  },
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
  },
};

// Type definitions
export type ApiConfig = typeof API_CONFIG;
