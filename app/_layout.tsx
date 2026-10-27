import { View } from 'react-native';
import { AuthProvider } from '../context/AuthContext';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <AuthProvider>
        <Stack />
      </AuthProvider>
    </View>
  );
}
