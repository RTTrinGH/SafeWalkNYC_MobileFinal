const fetch = require('node-fetch');

async function testCrimeAPI() {
    console.log('🧪 Testing SafeWalkNYC Crime Data API...\n');
    
    try {
        // Test health endpoint
        console.log('1. Testing health endpoint...');
        const healthResponse = await fetch('http://localhost:3001/api/health');
        const healthData = await healthResponse.json();
        console.log('✅ Health check:', healthData.status);
        console.log('📋 Available endpoints:', healthData.endpoints);
        console.log('');
        
        // Test main crime data endpoint
        console.log('2. Testing main crime data endpoint...');
        const crimeResponse = await fetch('http://localhost:3001/api/nyc-crime');
        const crimeData = await crimeResponse.json();
        
        if (crimeData.success) {
            console.log('✅ Crime data fetched successfully');
            console.log(`📊 Total incidents: ${crimeData.summary.totalIncidents}`);
            console.log(`📝 Complaints: ${crimeData.summary.complaints}`);
            console.log(`🔫 Shootings: ${crimeData.summary.shootings}`);
            console.log(`🚔 Arrests: ${crimeData.summary.arrests}`);
            
            if (crimeData.data.length > 0) {
                const sampleCrime = crimeData.data[0];
                console.log('\n📋 Sample crime incident:');
                console.log(`   Type: ${sampleCrime.type}`);
                console.log(`   Severity: ${sampleCrime.severity}`);
                console.log(`   Location: ${sampleCrime.lat}, ${sampleCrime.lng}`);
                console.log(`   Date: ${sampleCrime.date}`);
                console.log(`   Source: ${sampleCrime.source}`);
            }
        } else {
            console.log('❌ Failed to fetch crime data');
        }
        console.log('');
        
        // Test area-specific endpoint
        console.log('3. Testing area-specific crime data...');
        const areaResponse = await fetch('http://localhost:3001/api/nyc-crime/area?north=40.8&south=40.7&east=-73.9&west=-74.0');
        const areaData = await areaResponse.json();
        
        if (areaData.success) {
            console.log('✅ Area crime data fetched successfully');
            console.log(`📊 Incidents in area: ${areaData.data.length}`);
            console.log(`🗺️ Bounds: ${JSON.stringify(areaData.bounds)}`);
        } else {
            console.log('❌ Failed to fetch area crime data');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n💡 Make sure the server is running with: npm start');
    }
}

// Run the test
testCrimeAPI(); 