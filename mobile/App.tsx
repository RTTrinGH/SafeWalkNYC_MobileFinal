import { SafeAreaProvider } from 'react-native-safe-area-context';

import Main from './src/Main';
import { StoreProvider, useStore } from './src/lib/store';

// Hold the first frame until saved settings are read, so the app never opens in
// the wrong theme or units and then jumps.
function Gate() {
  const { ready } = useStore();
  return ready ? <Main /> : null;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
