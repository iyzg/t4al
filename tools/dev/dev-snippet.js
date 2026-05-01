// Dev convenience: sets up Falcons identity + a mock geolocation + goTo() helper,
// then SPA-navigates to the active sandbox game. Loaded from /dev-snippet.js,
// which Vite serves out of public/.
(() => {
  const G = '59519718-a2b1-40c8-8fbe-141be953f204';
  localStorage.setItem('gameId', G);
  localStorage.setItem('teamId', '8d73bb38-f5ac-4616-bd62-3c4cebb5287a');
  localStorage.setItem('teamColor', '#C41230');
  localStorage.setItem(`adminCode:${G}`, '5aYoQ1JhRHhJxtdR');
  if (!localStorage.getItem('deviceId')) localStorage.setItem('deviceId', crypto.randomUUID());

  let _pos = { lat: 41.88, lng: -87.621 };
  const watchers = new Set();
  const mock = {
    getCurrentPosition: (cb) => cb({ coords: { latitude: _pos.lat, longitude: _pos.lng, accuracy: 5 } }),
    watchPosition: (cb) => {
      watchers.add(cb);
      cb({ coords: { latitude: _pos.lat, longitude: _pos.lng, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      return Math.random();
    },
    clearWatch: () => {},
  };
  Object.defineProperty(navigator, 'geolocation', { value: mock, writable: true, configurable: true });

  window.goTo = (where, lng) => {
    const SPOTS = {
      sentinel: { lat: 41.8796, lng: -87.6237 },
      bean:     { lat: 41.8827, lng: -87.6233 },
      fountain: { lat: 41.8758, lng: -87.6189 },
      pennies:  { lat: 41.8765, lng: -87.6175 },
      riddle:   { lat: 41.8838, lng: -87.6278 },
      center:   { lat: 41.88,   lng: -87.621  },
    };
    if (typeof where === 'string') _pos = SPOTS[where] || _pos;
    else _pos = { lat: where, lng };
    watchers.forEach((cb) =>
      cb({ coords: { latitude: _pos.lat, longitude: _pos.lng, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }),
    );
    console.log('@', _pos);
  };

  history.pushState({}, '', `/game/${G}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  console.log('[dev] identity + GPS mock installed; try goTo("sentinel")');
})();
