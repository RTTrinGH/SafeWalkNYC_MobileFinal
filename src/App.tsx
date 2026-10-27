import React, { useState, useEffect } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TextInput, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, Polyline } from './Map';
import { ApiService } from './services/apiService';

export default function App() {
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [startCoords, setStartCoords] = useState(null);
  const [endCoords, setEndCoords] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [crimeData, setCrimeData] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFindRoute = async () => {
    if (!startLocation || !endLocation) {
      Alert.alert('Error', 'Please enter both start and end locations');
      return;
    }

    setLoading(true);
    try {
      // Get coordinates for both locations
      const [start, end] = await Promise.all([
        ApiService.geocodeAddress(startLocation),
        ApiService.geocodeAddress(endLocation)
      ]);

      if (!start || !end) {
        throw new Error('Could not find coordinates for one or both locations');
      }

      setStartCoords(start);
      setEndCoords(end);

      // Get crime data for the route area
      const crimeData = await ApiService.getCrimeData({
        north: Math.max(start.lat, end.lat),
        south: Math.min(start.lat, end.lat),
        east: Math.max(start.lng, end.lng),
        west: Math.min(start.lng, end.lng)
      });

      setCrimeData(crimeData);

      // Calculate route (for now, we'll just draw a straight line)
      setRouteCoordinates([
        { latitude: start.lat, longitude: start.lng },
        { latitude: end.lat, longitude: end.lng }
      ]);

      Alert.alert(
        'Safe Route Found',
        `Found ${crimeData.length} crime incidents in the area. Please be cautious.`
      );
    } catch (error) {
      Alert.alert('Error', error.message || 'An error occurred while finding the route');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>SafeWalkNYC</Text>
      </View>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter starting point"
          value={startLocation}
          onChangeText={setStartLocation}
        />
        <TextInput
          style={styles.input}
          placeholder="Enter destination"
          value={endLocation}
          onChangeText={setEndLocation}
        />
        <TouchableOpacity
          style={styles.button}
          onPress={handleFindRoute}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Finding route...' : 'Find Safe Route'}</Text>
        </TouchableOpacity>
      </View>

      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 40.7128,
          longitude: -74.0060,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {startCoords && (
          <Marker
            coordinate={{ latitude: startCoords.lat, longitude: startCoords.lng }}
            title="Start"
          />
        )}
        {endCoords && (
          <Marker
            coordinate={{ latitude: endCoords.lat, longitude: endCoords.lng }}
            title="End"
          />
        )}
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#0000FF"
            strokeWidth={3}
          />
        )}
        {crimeData.map((crime, index) => (
          <Marker
            key={index}
            coordinate={{
              latitude: crime.location_1.latitude,
              longitude: crime.location_1.longitude,
            }}
            pinColor="red"
          />
        ))}
      </MapView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  inputContainer: {
    padding: 10,
    backgroundColor: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    marginVertical: 5,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  map: {
    flex: 1,
  },
});
