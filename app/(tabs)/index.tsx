import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../context/AuthContext';

export default function TabLayout() {
  const { user } = useAuth();

  if (!user) {
    return null; // Redirect to auth group
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="MapScreen" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
