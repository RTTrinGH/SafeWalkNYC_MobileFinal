import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function MapView({ style, children }: { style?: any; children?: React.ReactNode }) {
  return (
    <View style={[styles.map, style]}>
      <Text style={styles.text}>Map preview not available on web.</Text>
      {children}
    </View>
  );
}

export const Marker = () => null;
export const Polyline = () => null;

const styles = StyleSheet.create({
  map: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eee',
  },
  text: {
    color: '#333',
    fontSize: 16,
  },
});
