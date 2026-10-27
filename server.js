require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

// Enable CORS for your frontend
app.use(cors({
    origin: ['http://localhost:8000', 'http://localhost:3000', 'http://127.0.0.1:5500'],
    credentials: true
}));

// Serve static files (your HTML)
app.use(express.static('.'));

// NYC Crime Data Sources
const NYC_CRIME_SOURCES = {
    // NYPD Complaint Data (Historic) - Most comprehensive
    complaints: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
    // NYPD Shooting Incident Data
    shootings: 'https://data.cityofnewyork.us/resource/5ucz-vwe8.json',
    // NYPD Major Case Data
    majorCases: 'https://data.cityofnewyork.us/resource/833y-fsy8.json',
    // NYPD Arrest Data (Historic)
    arrests: 'https://data.cityofnewyork.us/resource/uip8-fykc.json'
};

// NYC Open Data API credentials
const API_TOKEN = process.env.NYC_API_TOKEN || '8X5nL3fB71e7N7u569H26X89A';

// Crime API query limit configurations
const COMPLAINTS_LIMIT = parseInt(process.env.COMPLAINTS_LIMIT, 10);
const SHOOTINGS_LIMIT = parseInt(process.env.SHOOTINGS_LIMIT, 10);
const ARRESTS_LIMIT = parseInt(process.env.ARRESTS_LIMIT, 10);
const AREA_CRIMES_LIMIT = parseInt(process.env.AREA_CRIMES_LIMIT, 10) || 6000;

/*
 * How wide a window of incidents to score against.
 *
 * Two things ride on this. The window has to be short enough that the row limit
 * below is never reached: if a query gets truncated, a busy area silently
 * returns only its most recent few weeks while a quiet one returns the full
 * window, and the two are no longer comparable. Midtown over 90 days is ~7,900
 * incidents and would be cut off; over 45 it is ~4,000 and comes back whole.
 *
 * And it is anchored to the newest data in the feed rather than to today. The
 * year-to-date dataset runs about a quarter behind, so a window measured from
 * now can land entirely in the publication gap and return nothing at all -
 * which is exactly what had happened, leaving every route unscored.
 */
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS, 10) || 45;

let latestKnown = null;
const LATEST_TTL_MS = 6 * 60 * 60 * 1000;

async function latestDataDate() {
    if (latestKnown && Date.now() - latestKnown.at < LATEST_TTL_MS) {
        return latestKnown.date;
    }

    const headers = {};
    if (API_TOKEN && API_TOKEN !== 'YOUR_APP_TOKEN') {
        headers['X-App-Token'] = API_TOKEN;
    }
    const response = await fetch(
        `${NYC_CRIME_SOURCES.complaints}?$select=max(cmplnt_fr_dt)`,
        { headers }
    );
    if (!response.ok) throw new Error('Could not read the incident feed');

    const rows = await response.json();
    const raw = rows && rows[0] && rows[0].max_cmplnt_fr_dt;
    const date = typeof raw === 'string' && raw.length >= 10
        ? raw.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    latestKnown = { at: Date.now(), date };
    return date;
}

/*
 * Area lookups repeat constantly - every re-search of the same neighbourhood,
 * every alternative route sharing a bounding box. Without this, each one is a
 * fresh round trip to SODA and a bite out of the app token's rate limit.
 */
const areaCache = new Map();
const AREA_CACHE_TTL_MS = 10 * 60 * 1000;
const AREA_CACHE_MAX = 60;

function areaCacheKey(bounds) {
    // Round to ~100m so near-identical bounding boxes share an entry.
    return ['north', 'south', 'east', 'west']
        .map((k) => Number(bounds[k]).toFixed(3))
        .join(',');
}

function areaCacheGet(key) {
    const hit = areaCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.storedAt > AREA_CACHE_TTL_MS) {
        areaCache.delete(key);
        return null;
    }
    // Refresh recency for the LRU eviction below.
    areaCache.delete(key);
    areaCache.set(key, hit);
    return hit.payload;
}

function areaCacheSet(key, payload) {
    areaCache.set(key, { storedAt: Date.now(), payload });
    while (areaCache.size > AREA_CACHE_MAX) {
        areaCache.delete(areaCache.keys().next().value);
    }
}

// Enhanced crime data endpoint with multiple sources
// Test endpoint to check direct API access
app.get('/api/test', async (req, res) => {
    try {
        const testUrl = 'https://data.cityofnewyork.us/resource/5uac-w243.json?$limit=1';
        console.log('Testing API with:', testUrl);
        const response = await fetch(testUrl);
        console.log('Test response status:', response.status);
        const data = await response.json();
        console.log('Test data:', data);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Test API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Main crime data endpoint
app.get('/api/nyc-crime', async (req, res) => {
    try {
        console.log('Fetching comprehensive NYC crime data...');

        // Get current date and 14 days ago for more comprehensive data
        const now = new Date();
        const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));

        // Format dates for API query
        const endDate = now.toISOString().split('T')[0];
        const startDate = fourteenDaysAgo.toISOString().split('T')[0];

        console.log(`Fetching crime data from ${startDate} to ${endDate}`);

        // Fetch data from multiple sources
        const crimeData = {
            complaints: [],
            arrests: [],
            shootings: [],
            hateCrimes: [],
            majorCases: [],
            robberies: []
        };

        const headers = {};
        if (API_TOKEN && API_TOKEN !== 'YOUR_APP_TOKEN') {
            headers['X-App-Token'] = API_TOKEN;
        }

        // Fetch complaint data (most comprehensive)
        try {
            const complaintsQuery = `?$where=cmplnt_fr_dt between '${startDate}' and '${endDate}'&$limit=${COMPLAINTS_LIMIT}`;
            console.log('Complaints URL:', NYC_CRIME_SOURCES.complaints + complaintsQuery);
            const complaintsResponse = await fetch(NYC_CRIME_SOURCES.complaints + complaintsQuery, { headers });
            console.log('Complaints response status:', complaintsResponse.status);

            if (complaintsResponse.ok) {
                const data = await complaintsResponse.json();
                // Process the data to extract relevant fields
                crimeData.complaints = data.map(item => ({
                    id: item.cmplnt_num,
                    type: item.ofns_desc,
                    severity: getCrimeSeverity(item.ofns_desc),
                    lat: parseFloat(item.latitude),
                    lng: parseFloat(item.longitude),
                    date: item.cmplnt_fr_dt,
                    time: item.cmplnt_fr_tm,
                    area: item.patrol_bor
                })).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

                console.log(`✅ Successfully processed ${crimeData.complaints.length} valid complaints`);
                console.log('Sample processed complaint:', crimeData.complaints[0]);
            } else {
                console.error('❌ Failed to fetch complaints:', complaintsResponse.status);
                console.error('Complaints response body:', await complaintsResponse.text());
            }
        } catch (error) {
            console.error('Error fetching complaints:', error);
        }

        // Fetch shooting data
        try {
            const shootingsQuery = `?$where=occur_date between '${startDate}' and '${endDate}'&$limit=${SHOOTINGS_LIMIT}`;
            console.log('Shootings URL:', NYC_CRIME_SOURCES.shootings + shootingsQuery);
            const shootingsResponse = await fetch(NYC_CRIME_SOURCES.shootings + shootingsQuery, { headers });
            console.log('Shootings response status:', shootingsResponse.status);

            if (shootingsResponse.ok) {
                const data = await shootingsResponse.json();
                // Process the data to extract relevant fields
                crimeData.shootings = data.map(item => ({
                    id: item.incident_key,
                    type: 'Shooting',
                    severity: 'high',
                    lat: parseFloat(item.latitude),
                    lng: parseFloat(item.longitude),
                    date: item.occur_date,
                    time: item.occur_time,
                    area: item.boro
                })).filter(item => !isNaN(item.lat) && !isNaN(item.lng));

                console.log(`✅ Successfully processed ${crimeData.shootings.length} valid shootings`);
                console.log('Sample processed shooting:', crimeData.shootings[0]);
            } else {
                console.error('❌ Failed to fetch shootings:', shootingsResponse.status);
                console.error('Shootings response body:', await shootingsResponse.text());
            }
        } catch (error) {
            console.error('Error fetching shootings:', error);
        }

        // Fetch arrest data
        try {
            const arrestsQuery = `?$where=arrest_date between '${startDate}' and '${endDate}'&$limit=${ARRESTS_LIMIT}`;
            console.log('Arrests URL:', NYC_CRIME_SOURCES.arrests + arrestsQuery);
            const arrestsResponse = await fetch(NYC_CRIME_SOURCES.arrests + arrestsQuery, { headers });
            console.log('Arrests response status:', arrestsResponse.status);

            if (arrestsResponse.ok) {
                crimeData.arrests = await arrestsResponse.json();
                console.log(`✅ Successfully fetched ${crimeData.arrests.length} arrests`);
                console.log('Sample arrest:', crimeData.arrests[0]);
                console.log('Sample arrest coordinates:', crimeData.arrests[0]?.latitude, crimeData.arrests[0]?.longitude);
            } else {
                console.error('❌ Failed to fetch arrests:', arrestsResponse.status);
                console.error('Arrests response body:', await arrestsResponse.text());
            }
        } catch (error) {
            console.error('Error fetching arrests:', error);
        }

        // Combine and process all crime data
        const processedCrimeData = processCrimeData(crimeData);

        res.json({
            success: true,
            data: processedCrimeData,
            summary: {
                totalIncidents: processedCrimeData.length,
                complaints: crimeData.complaints.length,
                shootings: crimeData.shootings.length,
                arrests: crimeData.arrests.length
            }
        });

    } catch (error) {
        console.error('Error fetching crime data:', error);
        res.status(500).json({
            error: 'Failed to fetch crime data',
            message: error.message
        });
    }
});

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

    // Process shooting data
    crimeData.shootings.forEach(shooting => {
        if (shooting.latitude && shooting.longitude) {
            processed.push({
                id: `shooting_${shooting.incident_key}`,
                type: 'Shooting',
                severity: 'high',
                lat: parseFloat(shooting.latitude),
                lng: parseFloat(shooting.longitude),
                date: shooting.occur_date,
                time: shooting.occur_time,
                area: shooting.boro || 'Unknown',
                source: 'shooting'
            });
        }
    });

    // Process arrest data
    crimeData.arrests.forEach(arrest => {
        if (arrest.latitude && arrest.longitude) {
            processed.push({
                id: `arrest_${arrest.arrest_key}`,
                type: arrest.ofns_desc || 'Arrest',
                severity: getCrimeSeverity(arrest.ofns_desc),
                lat: parseFloat(arrest.latitude),
                lng: parseFloat(arrest.longitude),
                date: arrest.arrest_date,
                time: arrest.arrest_time || '00:00:00',
                area: arrest.arrest_boro || 'Unknown',
                source: 'arrest'
            });
        }
    });

    return processed;
}

// Determine crime severity based on offense description
function getCrimeSeverity(offenseDesc) {
    if (!offenseDesc) return 'medium';

    const highSeverity = [
        'MURDER', 'RAPE', 'ROBBERY', 'FELONY ASSAULT', 'BURGLARY',
        'GRAND LARCENY', 'GRAND LARCENY OF MOTOR VEHICLE', 'SHOOTING'
    ];

    const mediumSeverity = [
        'PETIT LARCENY', 'CRIMINAL MISCHIEF', 'CRIMINAL TRESPASS',
        'HARRASSMENT', 'ASSAULT', 'CRIMINAL POSSESSION'
    ];

    const upperDesc = offenseDesc.toUpperCase();

    if (highSeverity.some(crime => upperDesc.includes(crime))) {
        return 'high';
    } else if (mediumSeverity.some(crime => upperDesc.includes(crime))) {
        return 'medium';
    } else {
        return 'low';
    }
}

// Get crime data for specific area/bounds
app.get('/api/nyc-crime/area', async (req, res) => {
    try {
        const { north, south, east, west } = req.query;

        if (!north || !south || !east || !west) {
            return res.status(400).json({ error: 'Missing bounds parameters' });
        }

        const cacheKey = areaCacheKey({ north, south, east, west });
        const cached = areaCacheGet(cacheKey);
        if (cached) {
            return res.json({ ...cached, cached: true });
        }

        /*
         * The limit matters more than it looks. Ordering by date and taking a
         * small slice means a long route gets judged on whatever corner of the
         * bounding box happened to report most recently, so comparing two
         * routes becomes close to arbitrary. Pull a full window instead and let
         * the client weigh what is actually near each path.
         */
        const latest = await latestDataDate();
        const latestMs = new Date(`${latest}T00:00:00`).getTime();
        const since = new Date(latestMs - LOOKBACK_DAYS * 86400000)
            .toISOString()
            .slice(0, 10);

        const params = new URLSearchParams({
            '$select': [
                'cmplnt_num', 'ofns_desc', 'pd_desc', 'law_cat_cd',
                'cmplnt_fr_dt', 'cmplnt_fr_tm', 'latitude', 'longitude',
                'patrol_boro',
                // Whether it happened on the street or behind a door, which
                // decides how much a walker should care about it at all.
                'loc_of_occur_desc', 'prem_typ_desc',
                'crm_atpt_cptd_cd'
            ].join(','),
            '$where':
                `latitude between ${south} and ${north}` +
                ` and longitude between ${west} and ${east}` +
                ` and cmplnt_fr_dt >= '${since}T00:00:00'`,
            '$limit': String(AREA_CRIMES_LIMIT),
            '$order': 'cmplnt_fr_dt DESC'
        });
        const url = `${NYC_CRIME_SOURCES.complaints}?${params}`;

        const headers = {};
        if (API_TOKEN && API_TOKEN !== 'YOUR_APP_TOKEN') {
            headers['X-App-Token'] = API_TOKEN;
        }
        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const processedData = data
            .map(crime => ({
                id: crime.cmplnt_num,
                type: crime.ofns_desc || 'Unknown',
                detail: crime.pd_desc || '',
                severity: getCrimeSeverity(crime.ofns_desc),
                // Felony / misdemeanour / violation, straight from NYPD.
                lawCat: crime.law_cat_cd || '',
                lat: parseFloat(crime.latitude),
                lng: parseFloat(crime.longitude),
                date: crime.cmplnt_fr_dt,
                time: crime.cmplnt_fr_tm,
                where: crime.loc_of_occur_desc || '',
                premises: crime.prem_typ_desc || '',
                completed: crime.crm_atpt_cptd_cd || '',
                area: crime.patrol_boro || 'Unknown'
            }))
            .filter(crime => Number.isFinite(crime.lat) && Number.isFinite(crime.lng));

        const payload = {
            success: true,
            data: processedData,
            count: processedData.length,
            since,
            // Recency and normalisation are judged against the newest data the
            // feed actually holds, not against the wall clock.
            latest,
            referenceMs: latestMs,
            windowDays: LOOKBACK_DAYS,
            truncated: data.length >= AREA_CRIMES_LIMIT,
            bounds: { north, south, east, west }
        };

        areaCacheSet(cacheKey, payload);
        res.json(payload);

    } catch (error) {
        console.error('Error fetching area crime data:', error);
        res.status(500).json({
            error: 'Failed to fetch area crime data',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'NYC Crime API Proxy is running',
        endpoints: {
            crime: '/api/nyc-crime',
            areaCrime: '/api/nyc-crime/area',
            health: '/api/health'
        }
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 NYC Crime API Proxy running on http://localhost:${PORT}`);
    console.log(`📊 Crime data endpoint: http://localhost:${PORT}/api/nyc-crime`);
    console.log(`🗺️ Area crime endpoint: http://localhost:${PORT}/api/nyc-crime/area`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
});
