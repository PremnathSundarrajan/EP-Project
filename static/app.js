const state = {
  route: null,
  traffic: null,
  vehicle: null,
  destination: null,
  nextIntersection: null,
  emergencyMode: false,
};

const els = {
  toggleBtn: document.getElementById("emergency-toggle"),
  refreshBtn: document.getElementById("refresh-route"),
  vehicleName: document.getElementById("vehicle-name"),
  vehicleStatus: document.getElementById("vehicle-status"),
  vehicleLocation: document.getElementById("vehicle-location"),
  vehicleSpeed: document.getElementById("vehicle-speed"),
  etaValue: document.getElementById("eta-value"),
  routeName: document.getElementById("route-name"),
  routeDistance: document.getElementById("route-distance"),
  routeTraffic: document.getElementById("route-traffic"),
  routeEta: document.getElementById("route-eta"),
  routeRecommendation: document.getElementById("route-recommendation"),
  intersectionList: document.getElementById("intersection-list"),
  trafficIntersection: document.getElementById("traffic-intersection"),
  trafficCount: document.getElementById("traffic-count"),
  trafficDensity: document.getElementById("traffic-density"),
  trafficSource: document.getElementById("traffic-source"),
  vehicleMarker: document.getElementById("vehicle-marker"),
  destinationMarker: document.getElementById("destination-marker"),
  svg: document.getElementById("route-svg"),
  signalNorth: document.getElementById("signal-north"),
  signalSouth: document.getElementById("signal-south"),
  signalEast: document.getElementById("signal-east"),
  signalWest: document.getElementById("signal-west"),
};

function api(path, method = "GET", body = null) {
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (body) options.body = JSON.stringify(body);
  return fetch(path, options).then((response) => response.json());
}

function updateSignalVisuals(signalStatus) {
  Object.entries(signalStatus || {}).forEach(([direction, value]) => {
    const element = document.getElementById(
      `signal-${direction.toLowerCase()}`,
    );
    if (element) element.textContent = value;
  });
}

function renderIntersections(intersections) {
  els.intersectionList.innerHTML = "";
  (intersections || []).forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${item.id}</strong><br>
        <small>${item.name}</small>
      </div>
      <div>
        <span>${item.direction}</span><br>
        <small>${item.lane}</small>
      </div>
    `;
    els.intersectionList.appendChild(li);
  });
}

function renderMap() {
  if (!state.route || !state.route.points) return;

  const width = 760;
  const height = 420;
  const points = state.route.points;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const toXY = (lat, lng) => ({
    x: ((lng - minLng) / Math.max(maxLng - minLng, 0.0001)) * width,
    y: height - ((lat - minLat) / Math.max(maxLat - minLat, 0.0001)) * height,
  });

  const pathString = points
    .map((point, index) => {
      const pointXY = toXY(point.latitude, point.longitude);
      return `${index === 0 ? "M" : "L"} ${pointXY.x} ${pointXY.y}`;
    })
    .join(" ");

  els.svg.innerHTML = `
    <path d="${pathString}" fill="none" stroke="#2dd4bf" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"></path>
    <path d="${pathString}" fill="none" stroke="#6ee7f9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"></path>
  `;

  const vehicle = state.vehicle || { latitude: 12.9716, longitude: 77.5946 };
  const destination = state.destination || {
    latitude: 12.9822,
    longitude: 77.6194,
  };
  const vehicleXY = toXY(vehicle.latitude, vehicle.longitude);
  const destinationXY = toXY(destination.latitude, destination.longitude);

  els.vehicleMarker.style.left = `${vehicleXY.x}px`;
  els.vehicleMarker.style.top = `${vehicleXY.y}px`;
  els.destinationMarker.style.left = `${destinationXY.x}px`;
  els.destinationMarker.style.top = `${destinationXY.y}px`;
}

function renderUi() {
  const vehicle = state.vehicle || {};
  const route = state.route || {};
  const traffic = state.traffic || {};

  els.vehicleName.textContent = vehicle.name || "Ambulance 01";
  els.vehicleStatus.textContent = state.emergencyMode ? "ACTIVE" : "STANDBY";
  els.vehicleLocation.textContent = `${(vehicle.latitude || "--").toFixed ? (vehicle.latitude || 0).toFixed(4) : "--"}, ${(vehicle.longitude || "--").toFixed ? (vehicle.longitude || 0).toFixed(4) : "--"}`;
  els.vehicleSpeed.textContent = `${vehicle.speed_kmh || 0} km/h`;
  els.etaValue.textContent = route.estimated_travel_time_min
    ? `${route.estimated_travel_time_min} min`
    : "--";

  els.routeName.textContent = route.id || "--";
  els.routeDistance.textContent = route.distance_km
    ? `${route.distance_km} km`
    : "--";
  els.routeTraffic.textContent = route.traffic_density || "--";
  els.routeEta.textContent = route.estimated_travel_time_min
    ? `${route.estimated_travel_time_min} min`
    : "--";
  els.routeRecommendation.textContent =
    state.routeRecommendation ||
    "Select a destination to calculate the best route.";

  els.trafficIntersection.textContent = traffic.intersection_id || "INT001";
  els.trafficCount.textContent = traffic.vehicle_count || "--";
  els.trafficDensity.textContent = traffic.traffic_density || "--";
  els.trafficSource.textContent = traffic.source || "best.onnx";

  updateSignalVisuals(state.signalStatus || {});
  renderIntersections(state.intersections || []);
  renderMap();
}

async function loadDashboard() {
  try {
    const [routeResponse, trafficResponse, intersectionsResponse] =
      await Promise.all([
        fetch("/api/emergency/route"),
        fetch("/api/emergency/traffic"),
        fetch("/api/intersections"),
      ]);

    const routeJson = await routeResponse.json();
    const trafficJson = await trafficResponse.json();
    const intersectionsJson = await intersectionsResponse.json();

    state.route = routeJson.selected_route;
    state.routeRecommendation = routeJson.recommended_reason;
    state.traffic = trafficJson.traffic;
    state.intersections = intersectionsJson.intersections;
    state.signalStatus = {
      NORTH: "RED",
      SOUTH: "RED",
      EAST: "RED",
      WEST: "RED",
    };
    renderUi();
  } catch (error) {
    console.error("Failed to load dashboard", error);
  }
}

async function startEmergencyMode() {
  const payload = {
    vehicle_type: "Ambulance 01",
    mode: "ON",
  };
  const result = await api("/api/emergency/start", "POST", payload);
  state.emergencyMode = result.emergency_mode;
  state.vehicle = result.vehicle;
  state.destination = result.destination;
  state.route = result.route;
  state.routeRecommendation = result.route_recommendation;
  state.traffic = result.traffic;
  state.signalStatus = result.signal_status;
  renderUi();
}

async function simulateLocation() {
  const lat = 12.9716 + Math.random() * 0.008;
  const lng = 77.5946 + Math.random() * 0.012;
  const speed = 32 + Math.random() * 20;
  const heading = "NORTH";

  const result = await api("/api/emergency/location", "POST", {
    latitude: lat,
    longitude: lng,
    speed,
    heading,
    timestamp: new Date().toISOString(),
  });

  state.vehicle = result.vehicle;
  state.emergencyMode = result.emergency_mode;
  state.route = result.route;
  state.routeRecommendation = result.route_recommendation;
  state.traffic = result.traffic;
  state.signalStatus = result.signal_status;
  renderUi();
}

els.toggleBtn.addEventListener("click", async () => {
  if (!state.emergencyMode) {
    await startEmergencyMode();
    els.toggleBtn.textContent = "Emergency Mode: ON";
  } else {
    state.emergencyMode = false;
    els.toggleBtn.textContent = "Emergency Mode: OFF";
    renderUi();
  }
});

els.refreshBtn.addEventListener("click", async () => {
  await loadDashboard();
});

if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const result = await api("/api/emergency/location", "POST", {
        latitude: lat,
        longitude: lng,
        speed: position.coords.speed || 0,
        heading: "NORTH",
        timestamp: new Date().toISOString(),
      });
      state.vehicle = result.vehicle;
      state.emergencyMode = result.emergency_mode;
      state.route = result.route;
      state.routeRecommendation = result.route_recommendation;
      state.traffic = result.traffic;
      state.signalStatus = result.signal_status;
      renderUi();
    },
    async () => {
      await simulateLocation();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
  );
} else {
  setInterval(simulateLocation, 5000);
}

loadDashboard();
setInterval(loadDashboard, 6000);
