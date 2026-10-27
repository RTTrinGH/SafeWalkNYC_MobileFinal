import axios from 'axios';

const API_CONFIG = {
  opencage: {
    apiKey: process.env.OPENCAGE_API_KEY,
    baseUrl: 'https://api.opencagedata.com/geocode/v1/json',
  },
  nycCrime: {
    baseUrl: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
    appToken: process.env.NYC_API_TOKEN
  },
};

export const ApiService = {
  // Geocoding address to coordinates
  async geocodeAddress(address: string) {
    try {
      const response = await axios.get(API_CONFIG.opencage.baseUrl, {
        params: {
          q: address,
          key: API_CONFIG.opencage.apiKey,
        },
      });
      return response.data.results[0]?.geometry;
    } catch (error) {
      console.error('Error geocoding address:', error);
      throw error;
    }
  },

  // Reverse geocoding coordinates to address
  async reverseGeocode(lat: number, lng: number) {
    try {
      const response = await axios.get(API_CONFIG.opencage.baseUrl, {
        params: {
          q: `${lat},${lng}`,
          key: API_CONFIG.opencage.apiKey,
        },
      });
      return response.data.results[0]?.formatted;
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      throw error;
    }
  },

  // Get crime data for an area
  async getCrimeData(bounds: { north: number; south: number; east: number; west: number }) {
    try {
      const response = await axios.get(API_CONFIG.nycCrime.baseUrl, {
        params: {
          app_token: API_CONFIG.nycCrime.appToken,
          $where: `latitude BETWEEN ${bounds.south} AND ${bounds.north} AND longitude BETWEEN ${bounds.west} AND ${bounds.east}`,
          $limit: 1000
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching crime data:', error);
      throw error;
    }
  },
};
