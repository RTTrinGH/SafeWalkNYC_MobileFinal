import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';

// Mock data for safe spots and crime alerts
const SAFE_SPOTS = [
  {
    id: '1',
    title: 'Police Station',
    latitude: 40.7128,
    longitude: -74.0060,
    type: 'police'
  },
  {
    id: '2',
    title: 'Community Center',
    latitude: 40.7140,
    longitude: -74.0070,
    type: 'community'
  }
];

const CRIME_ALERTS = [
  {
    id: '1',
    title: 'Recent Crime',
    latitude: 40.7130,
    longitude: -74.0050,
    type: 'crime'
  }
];

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [destination, setDestination] = useState({
    latitude: 40.7128,
    longitude: -74.0060
  });
  const [route, setRoute] = useState(null);
  const { user, signOut } = useAuth();

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Location access is required to use this app');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location);
    })();
  }, []);

  const handleReportUnsafe = async () => {
    // TODO: Implement unsafe spot reporting
    Alert.alert('Report Unsafe Spot', 'This feature will be implemented soon');
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 40.7128,
          longitude: -74.0060,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
      >
        {/* Current Location */}
        {location && (
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude
            }}
            title="Current Location"
          />
        )}

        {/* Safe Spots */}
        {SAFE_SPOTS.map((spot) => (
          <Marker
            key={spot.id}
            coordinate={{
              latitude: spot.latitude,
              longitude: spot.longitude
            }}
            title={spot.title}
            pinColor={spot.type === 'police' ? 'blue' : 'green'}
          />
        ))}

        {/* Crime Alerts */}
        {CRIME_ALERTS.map((alert) => (
          <Marker
            key={alert.id}
            coordinate={{
              latitude: alert.latitude,
              longitude: alert.longitude
            }}
            title={alert.title}
            pinColor="red"
          />
        ))}

        {/* Route Line (will be implemented with Google Maps API) */}
        {route && (
          <Polyline
            coordinates={route}
            strokeColor="#000"
            strokeWidth={3}
          />
        )}
      </MapView>

      {/* Destination Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter destination"
          value={destination}
          onChangeText={setDestination}
        />
      </View>

      {/* Report Unsafe Spot Button */}
      <TouchableOpacity
        style={styles.reportButton}
        onPress={handleReportUnsafe}
      >
        <Text style={styles.reportButtonText}>Report Unsafe Spot</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    flex: 1,
  },
  inputContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 1,
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    paddingLeft: 10,
    borderRadius: 5,
  },
  reportButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#ff4444',
    padding: 15,
    borderRadius: 5,
  },
  reportButtonText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
