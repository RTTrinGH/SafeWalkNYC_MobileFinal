# Real Crime Data Guide for SafeWalkNYC

## Overview

This guide explains how to get and integrate real crime data into your SafeWalkNYC application. Your project now includes multiple sources of real crime data from NYC's official APIs.

## 🚀 Quick Start

### 1. Start the Crime Data Server

```bash
# Install dependencies (if not already done)
npm install

# Start the server
npm start
```

The server will run on `http://localhost:3001` and provide:
- `/api/nyc-crime` - Comprehensive crime data from multiple sources
- `/api/nyc-crime/area` - Area-specific crime data
- `/api/health` - Health check endpoint

### 2. Open Your Application

Open `index.html` in your browser. The application will automatically:
- Fetch real crime data from NYC APIs
- Use real data for route safety analysis
- Fall back to mock data if APIs are unavailable

## 📊 Crime Data Sources

### 1. NYC Open Data APIs (Primary Sources)

#### NYPD Complaint Data (Historic)
- **URL**: `https://data.cityofnewyork.us/resource/5uac-w243.json`
- **Data**: All NYPD complaints with location, type, date, time
- **Update Frequency**: Daily
- **Fields**: `cmplnt_num`, `ofns_desc`, `latitude`, `longitude`, `cmplnt_fr_dt`, `cmplnt_fr_tm`, `patrol_bor`

#### NYPD Shooting Incident Data
- **URL**: `https://data.cityofnewyork.us/resource/5ucz-vwe8.json`
- **Data**: Shooting incidents with precise locations
- **Update Frequency**: Daily
- **Fields**: `incident_key`, `occur_date`, `occur_time`, `latitude`, `longitude`, `boro`

#### NYPD Arrest Data
- **URL**: `https://data.cityofnewyork.us/resource/uip8-fykc.json`
- **Data**: Arrest records with location and offense details
- **Update Frequency**: Daily
- **Fields**: `arrest_key`, `arst_date`, `arrest_time`, `arrest_latitude`, `arrest_longitude`, `ofns_desc`

#### NYPD Hate Crime Data
- **URL**: `https://data.cityofnewyork.us/resource/bqiq-cu78.json`
- **Data**: Hate crime incidents
- **Update Frequency**: Monthly
- **Fields**: `full_complaint_id`, `complaint_date`, `offense_category`, `location`

### 2. Alternative Crime Data Sources

#### SpotCrime API
- **URL**: `https://api.spotcrime.com/crimes`
- **Cost**: Free tier available
- **Coverage**: Multiple cities including NYC
- **Limitations**: Rate limits, requires API key

#### Crime Data API
- **URL**: `https://api.crimespotting.org/`
- **Cost**: Paid service
- **Coverage**: Comprehensive crime data
- **Features**: Real-time updates, detailed crime categories

#### FBI Crime Data API
- **URL**: `https://crime-data-explorer.fr.cloud.gov/api`
- **Cost**: Free
- **Coverage**: National data, less granular than local sources
- **Update Frequency**: Annual

## 🔧 Implementation Details

### Server-Side Processing (`server.js`)

The server processes crime data from multiple sources:

```javascript
// Process and standardize crime data from different sources
function processCrimeData(crimeData) {
    const processed = [];
    
    // Process complaints data
    crimeData.complaints.forEach(complaint => {
        if (complaint.latitude && complaint.longitude) {
            processed.push({
                id: complaint.cmplnt_num,
                type: complaint.ofns_desc || 'Unknown',
                severity: getCrimeSeverity(complaint.ofns_desc),
                lat: parseFloat(complaint.latitude),
                lng: parseFloat(complaint.longitude),
                date: complaint.cmplnt_fr_dt,
                time: complaint.cmplnt_fr_tm,
                area: complaint.patrol_bor || 'Unknown',
                source: 'complaint'
            });
        }
    });
    
    return processed;
}
```

### Crime Severity Classification

Crimes are automatically classified by severity:

```javascript
function getCrimeSeverity(offenseDesc) {
    const highSeverity = [
        'MURDER', 'RAPE', 'ROBBERY', 'FELONY ASSAULT', 'BURGLARY',
        'GRAND LARCENY', 'GRAND LARCENY OF MOTOR VEHICLE', 'SHOOTING'
    ];
    
    const mediumSeverity = [
        'PETIT LARCENY', 'CRIMINAL MISCHIEF', 'CRIMINAL TRESPASS',
        'HARRASSMENT', 'ASSAULT', 'CRIMINAL POSSESSION'
    ];
    
    // Classification logic...
}
```

### Client-Side Integration (`index.html`)

The frontend fetches and uses real crime data:

```javascript
// Fetch real crime data from NYC API
async function fetchRealCrimeData() {
    try {
        const response = await fetch(CRIME_API_URL);
        const result = await response.json();
        
        if (result.success && result.data) {
            realCrimeData = result.data;
            return realCrimeData;
        }
    } catch (error) {
        console.error('Error fetching real crime data:', error);
        // Fall back to mock data
        return fallbackCrimeHotspots;
    }
}
```

## 📈 Data Quality & Limitations

### Strengths
- **Real-time**: Data updated daily
- **Comprehensive**: Multiple crime types and sources
- **Geolocated**: Precise latitude/longitude coordinates
- **Official**: Direct from NYC government APIs
- **Free**: No API costs or rate limits

### Limitations
- **NYC Only**: Limited to New York City
- **Historical**: Data may be 1-2 days old
- **Reported Crimes**: Only includes reported incidents
- **Location Accuracy**: Some coordinates may be approximate

### Data Gaps
- **Unreported Crimes**: Many incidents go unreported
- **Time Delays**: Processing delays in data publication
- **Geographic Coverage**: Some areas may have incomplete data

## 🔒 Privacy & Legal Considerations

### Data Usage
- **Public Data**: NYC crime data is public domain
- **No Personal Info**: APIs don't include victim/offender details
- **Aggregated**: Data is aggregated for privacy protection

### Compliance
- **Terms of Service**: Follow NYC Open Data terms
- **Rate Limiting**: Respect API rate limits
- **Attribution**: Credit NYC Open Data when required

## 🛠️ Advanced Features

### Area-Specific Queries

Query crime data for specific geographic areas:

```javascript
// Get crime data for specific bounds
const areaData = await fetchAreaCrimeData({
    north: 40.8,
    south: 40.7,
    east: -73.9,
    west: -74.0
});
```

### Real-time Updates

Set up periodic data refresh:

```javascript
// Refresh crime data every hour
setInterval(async () => {
    await fetchRealCrimeData();
    console.log('Crime data refreshed');
}, 60 * 60 * 1000);
```

### Data Caching

Implement caching to reduce API calls:

```javascript
// Simple caching implementation
let crimeDataCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function getCachedCrimeData() {
    const now = Date.now();
    
    if (!crimeDataCache || !cacheTimestamp || (now - cacheTimestamp) > CACHE_DURATION) {
        crimeDataCache = await fetchRealCrimeData();
        cacheTimestamp = now;
    }
    
    return crimeDataCache;
}
```

## 🚨 Troubleshooting

### Common Issues

1. **Server Not Starting**
   ```bash
   # Check if port 3001 is available
   lsof -i :3001
   # Kill process if needed
   kill -9 <PID>
   ```

2. **CORS Errors**
   - Ensure server CORS settings include your frontend origin
   - Check browser console for CORS error details

3. **API Rate Limits**
   - NYC Open Data has generous limits but monitor usage
   - Implement caching to reduce API calls

4. **Data Not Loading**
   - Check server logs for API errors
   - Verify internet connection
   - Check NYC Open Data API status

### Debug Mode

Enable detailed logging:

```javascript
// Add to server.js for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
```

## 📚 Additional Resources

### Documentation
- [NYC Open Data](https://data.cityofnewyork.us/)
- [NYPD Crime Data](https://data.cityofnewyork.us/Public-Safety/NYPD-Complaint-Data-Historic/5uac-w243)
- [SODA API Documentation](https://dev.socrata.com/)

### Tools
- [SODA Query Builder](https://data.cityofnewyork.us/Public-Safety/NYPD-Complaint-Data-Historic/5uac-w243)
- [NYC Crime Map](https://maps.nyc.gov/crime/)

### Community
- [NYC Open Data Community](https://opendata.cityofnewyork.us/)
- [NYC Tech Meetups](https://www.meetup.com/topics/nyc-tech/)

## 🎯 Next Steps

1. **Deploy to Production**: Set up proper hosting for the crime data server
2. **Add More Cities**: Extend to other cities with similar open data
3. **Real-time Alerts**: Implement push notifications for new incidents
4. **Machine Learning**: Add predictive crime analysis
5. **Community Reports**: Allow users to report incidents
6. **Mobile App**: Create native mobile applications

---

*This guide covers the current implementation. For updates and new features, check the project repository.* 