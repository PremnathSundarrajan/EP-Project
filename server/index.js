/**
 * Smart Traffic Emergency Priority — Node.js Backend
 * Architecture: Two IP Webcams (North, South) → Python/YOLO → Traffic Density
 *               Node.js → ESP32 (USB Serial)
 *
 * Inference is delegated to the Python service (app.py, port 8000).
 * This server handles: ESP32 serial, WebSocket, routing, camera health checks.
 */

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const WebSocket = require("ws");

// Python inference service base URL (app.py)
const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

dotenv.config();

// ─── Server Setup ────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// ─── Environment Config ───────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 5000;
let SERIAL_PORT_PATH = process.env.SERIAL_PORT || "COM3";
const SERIAL_BAUD_RATE = Number(process.env.SERIAL_BAUD_RATE) || 115200;
const PRIORITY_PREPARE_DISTANCE_M =
  Number(process.env.PRIORITY_PREPARE_DISTANCE_M) || 500;
const PRIORITY_ACTIVATE_DISTANCE_M =
  Number(process.env.PRIORITY_ACTIVATE_DISTANCE_M) || 300;
const EMERGENCY_TIMEOUT_MS = Number(process.env.EMERGENCY_TIMEOUT_MS) || 120000;

// ─── Static Config ───────────────────────────────────────────────────────────
const MODEL_PATH = path.join(__dirname, "..", "best.onnx");
const INTERSECTIONS_PATH = path.join(__dirname, "config", "intersections.json");
const CAMERAS_PATH = path.join(__dirname, "config", "cameras.json");

let INTERSECTIONS = [];
let CAMERAS = [];

try {
  INTERSECTIONS = JSON.parse(fs.readFileSync(INTERSECTIONS_PATH, "utf8"));
} catch (e) {
  console.warn("Could not load intersections.json:", e.message);
  INTERSECTIONS = [
    {
      id: "INT001",
      name: "MG Road Junction",
      latitude: 12.9735,
      longitude: 77.604,
      signals: ["NORTH", "SOUTH", "EAST", "WEST"],
      onRoutes: ["Route A", "Route B"],
    },
    {
      id: "INT002",
      name: "Hospital Signal",
      latitude: 12.9785,
      longitude: 77.6124,
      signals: ["NORTH", "SOUTH", "EAST", "WEST"],
      onRoutes: ["Route A", "Route B", "Route C"],
    },
  ];
}
try {
  CAMERAS = JSON.parse(fs.readFileSync(CAMERAS_PATH, "utf8"));
} catch (e) {
  console.warn("Could not load cameras.json:", e.message);
  CAMERAS = [
    {
      id: "CAM_NORTH",
      name: "North Camera",
      direction: "NORTH",
      videoUrl: process.env.CAM_NORTH_URL || "http://10.245.55.176:8080/video",
      healthUrl: "http://10.245.55.176:8080/",
    },
    {
      id: "CAM_SOUTH",
      name: "South Camera",
      direction: "SOUTH",
      videoUrl: process.env.CAM_SOUTH_URL || "http://192.168.1.102:8080/video",
      healthUrl: "http://192.168.1.102:8080/",
    },
  ];
}

// Override JSON with .env values if they are explicitly set in the environment
if (process.env.CAM_NORTH_URL) {
  const northCam = CAMERAS.find((c) => c.id === "CAM_NORTH");
  if (northCam) northCam.videoUrl = process.env.CAM_NORTH_URL;
}
if (process.env.CAM_SOUTH_URL) {
  const southCam = CAMERAS.find((c) => c.id === "CAM_SOUTH");
  if (southCam) southCam.videoUrl = process.env.CAM_SOUTH_URL;
}

function saveCamerasConfig() {
  try {
    fs.writeFileSync(CAMERAS_PATH, JSON.stringify(CAMERAS, null, 2));
  } catch (e) {
    console.error("Failed to save cameras config:", e);
  }
}

// ─── Route Candidates ─────────────────────────────────────────────────────────
const ROUTE_LIBRARY = [
  {
    id: "Route A",
    distanceKm: 5.2,
    traffic: "HIGH",
    etaMinutes: 18,
    signalDelay: 5,
    congestionPenalty: 4,
    intersections: ["INT001", "INT002"],
    points: [
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9729, longitude: 77.6012 },
      { latitude: 12.9748, longitude: 77.6091 },
      { latitude: 12.9796, longitude: 77.6168 },
    ],
  },
  {
    id: "Route B",
    distanceKm: 6.1,
    traffic: "LOW",
    etaMinutes: 11,
    signalDelay: 2,
    congestionPenalty: 1,
    intersections: ["INT001", "INT002"],
    points: [
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9734, longitude: 77.5999 },
      { latitude: 12.9761, longitude: 77.6066 },
      { latitude: 12.9822, longitude: 77.6194 },
    ],
  },
  {
    id: "Route C",
    distanceKm: 6.9,
    traffic: "MEDIUM",
    etaMinutes: 13,
    signalDelay: 3,
    congestionPenalty: 2,
    intersections: ["INT002", "INT003"],
    points: [
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 12.9694, longitude: 77.6071 },
      { latitude: 12.9731, longitude: 77.615 },
      { latitude: 12.9801, longitude: 77.6235 },
    ],
  },
];

const TRAFFIC_DELAY_MAP = { LOW: 2, MEDIUM: 5, HIGH: 9, CRITICAL: 14 };
const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"];

// ─── Application State ────────────────────────────────────────────────────────
const state = {
  // Emergency vehicle
  emergencyMode: false,
  emergencyStarted: false,
  vehicle: {
    name: "Ambulance 01",
    status: "STANDBY",
    gpsStatus: "OFFLINE",
    latitude: null,
    longitude: null,
    speedKmh: 0,
    heading: "NORTH",
    timestamp: null,
    lastGpsUpdate: null,
  },
  destination: null,

  // Route
  route: null,
  routeRecommendation: null,
  routeCandidates: ROUTE_LIBRARY,

  // Intersection
  nextIntersection: null,
  distanceToIntersectionM: null,
  intersectionPriorityStatus: "INACTIVE",
  intersectionDirection: null,

  // Traffic AI (Two Cameras)
  trafficData: {
    NORTH: {
      cameraId: null,
      vehicleCount: 0,
      density: "UNKNOWN",
      status: "DISCONNECTED",
      lastUpdate: null,
    },
    SOUTH: {
      cameraId: null,
      vehicleCount: 0,
      density: "UNKNOWN",
      status: "DISCONNECTED",
      lastUpdate: null,
    },
    EAST: {
      cameraId: null,
      vehicleCount: 0,
      density: "NOT CONFIGURED",
      status: "OFFLINE",
      lastUpdate: null,
    },
    WEST: {
      cameraId: null,
      vehicleCount: 0,
      density: "NOT CONFIGURED",
      status: "OFFLINE",
      lastUpdate: null,
    },
  },

  // Camera Health Status (separate from inference/traffic data)
  cameraHealth: {}, // { [cameraId]: { status, lastChecked, failureCount, message } }

  // Signal
  signalState: { NORTH: "RED", SOUTH: "RED", EAST: "RED", WEST: "RED" },
  trafficMode: "NORMAL",
  signalTransitionState: "IDLE",

  // ESP32
  esp32: {
    connected: false,
    port: SERIAL_PORT_PATH,
    baudRate: SERIAL_BAUD_RATE,
    status: "DISCONNECTED",
    lastCommand: null,
    lastResponse: null,
  },

  // Logs
  serialLog: [],
  eventLog: [],

  // Intersections list
  intersections: INTERSECTIONS,

  // Cameras list
  cameras: CAMERAS,
};

// Map configured cameras to directions
function updateCameraStateMapping() {
  const directionsWithCameras = new Set();
  CAMERAS.forEach((cam) => {
    const dir = cam.direction.toUpperCase();
    if (state.trafficData[dir]) {
      state.trafficData[dir].cameraId = cam.id;
      if (state.trafficData[dir].density === "NOT CONFIGURED") {
        state.trafficData[dir].density = "UNKNOWN";
      }
      directionsWithCameras.add(dir);
      // Initialize camera health status
      if (!state.cameraHealth[cam.id]) {
        state.cameraHealth[cam.id] = {
          status: "CHECKING",
          lastChecked: null,
          failureCount: 0,
          message: "Initial check",
        };
      }
    }
  });

  // Mark others as NOT CONFIGURED
  DIRECTIONS.forEach((dir) => {
    if (!directionsWithCameras.has(dir)) {
      state.trafficData[dir].cameraId = null;
      state.trafficData[dir].density = "NOT CONFIGURED";
      state.trafficData[dir].status = "OFFLINE";
    }
  });
}
updateCameraStateMapping();

// ─── Note ────────────────────────────────────────────────────────────────────
// MJPEG frame buffering has been removed. The browser loads the camera video
// feed directly from the phone IP (see App.js <img src={camConfig.videoUrl}>).
// Vehicle inference is handled by the Python service (app.py) using OpenCV.

// ─── Camera Health Check (with timeout) ───────────────────────────────────────
async function checkCameraHealth(camera) {
  const cameraId = camera.id;
  const healthUrl = camera.healthUrl;

  if (!healthUrl) {
    state.cameraHealth[cameraId] = {
      status: "DISCONNECTED",
      lastChecked: new Date().toISOString(),
      failureCount: -1,
      message: "No health URL configured",
    };
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await axios.get(healthUrl, {
      timeout: 3000,
      validateStatus: () => true, // Accept any status code
    });

    clearTimeout(timeout);

    // If we get any response (including error codes), camera is reachable
    if (response.status >= 200 && response.status < 500) {
      // Success
      state.cameraHealth[cameraId] = {
        status: "CONNECTED",
        lastChecked: new Date().toISOString(),
        failureCount: 0,
        message: "Health check passed",
      };
      return true;
    } else {
      // Server error or no response
      state.cameraHealth[cameraId].failureCount =
        (state.cameraHealth[cameraId].failureCount || 0) + 1;
      state.cameraHealth[cameraId].status =
        state.cameraHealth[cameraId].failureCount > 3
          ? "DISCONNECTED"
          : "CHECKING";
      state.cameraHealth[cameraId].lastChecked = new Date().toISOString();
      state.cameraHealth[cameraId].message = `HTTP ${response.status}`;
      return false;
    }
  } catch (err) {
    // Network error, timeout, abort, etc.
    const failureCount = (state.cameraHealth[cameraId]?.failureCount || 0) + 1;
    state.cameraHealth[cameraId] = {
      status: failureCount > 3 ? "DISCONNECTED" : "CHECKING",
      lastChecked: new Date().toISOString(),
      failureCount: failureCount,
      message: err.message.slice(0, 60),
    };
    return false;
  }
}

// ─── Runtime variables ────────────────────────────────────────────────────────
let serialPort = null;
let parser = null;
let emergencyTimeoutTimer = null;
let signalTransitionTimer = null;
let cameraLoops = {}; // Store intervals per camera

// ─── Utility ──────────────────────────────────────────────
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function densityLabel(count) {
  if (count < 8) return "LOW";
  if (count < 16) return "MEDIUM";
  return "HIGH";
}

function addEvent(message) {
  const entry = {
    timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
    message,
  };
  state.eventLog.push(entry);
  if (state.eventLog.length > 80) state.eventLog.shift();
  console.log(`[EVENT] ${entry.timestamp} ${message}`);
}

function addSerialLog(direction, payload) {
  state.serialLog.push({
    direction,
    payload,
    timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
  });
  if (state.serialLog.length > 50) state.serialLog.shift();
}

function broadcast() {
  const payload = JSON.stringify({ type: "state", data: state });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ─── ESP32 Serial Communication ───────────────────────────────────────────────
function sendToEsp32(command) {
  if (!serialPort || !serialPort.isOpen) {
    state.esp32.connected = false;
    state.esp32.status = "DISCONNECTED";
    addSerialLog("→", `NOT_SENT:${command}`);
    addEvent(`ESP32 not connected — could not send: ${command}`);
    broadcast();
    return { ok: false, error: "ESP32 not connected." };
  }

  const payload = `${command}\r\n`;
  serialPort.write(Buffer.from(payload), (err) => {
    if (err) {
      addSerialLog("→", `ERROR:${command}`);
      addEvent(`Serial write error sending: ${command}`);
      console.error("Serial write error:", err.message);
      return;
    }

    serialPort.drain((drainErr) => {
      if (drainErr) {
        console.error("Serial drain error:", drainErr.message);
      }
      state.esp32.lastCommand = command;
      addSerialLog("→", command);
      addEvent(`Sent to ESP32: ${command}`);
      broadcast();
    });
  });

  return { ok: true, command };
}

async function autoDetectPort() {
  try {
    const ports = await SerialPort.list();
    const match = ports.find(
      (p) =>
        (p.manufacturer &&
          /Silicon|WCH|FTDI|Prolific|Espressif/i.test(p.manufacturer)) ||
        (p.friendlyName &&
          /CP210|CH340|FT232|UART|Serial USB/i.test(p.friendlyName)) ||
        (p.vendorId &&
          ["10C4", "1A86", "0403", "303A"].includes(p.vendorId.toUpperCase())),
    );
    if (match) return match.path;
  } catch (_) {}
  return null;
}

async function initSerialPort(portPath) {
  if (serialPort && serialPort.isOpen) {
    try {
      serialPort.close();
    } catch (_) {}
  }

  let targetPort = portPath || SERIAL_PORT_PATH;
  if (!portPath) {
    const detected = await autoDetectPort();
    if (detected) {
      targetPort = detected;
      SERIAL_PORT_PATH = detected;
    }
  }

  state.esp32.port = targetPort;
  state.esp32.status = "CONNECTING";
  addEvent(`Connecting to ESP32 on ${targetPort} @ ${SERIAL_BAUD_RATE}`);

  try {
    serialPort = new SerialPort({
      path: targetPort,
      baudRate: SERIAL_BAUD_RATE,
      autoOpen: true,
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

    serialPort.on("open", () => {
      state.esp32.connected = true;
      state.esp32.status = "CONNECTED";
      state.esp32.lastResponse = "ESP32 ready";
      addSerialLog("←", "ESP32 connected");
      addEvent(`ESP32 connected on ${targetPort}`);
      broadcast();
    });

    serialPort.on("error", (err) => {
      state.esp32.connected = false;
      state.esp32.status = "ERROR: " + err.message.slice(0, 40);
      addSerialLog("←", `ERROR:${err.message.slice(0, 60)}`);
      addEvent(`ESP32 error: ${err.message.slice(0, 60)}`);
      broadcast();
    });

    serialPort.on("close", () => {
      state.esp32.connected = false;
      state.esp32.status = "DISCONNECTED";
      addEvent("ESP32 serial port closed");
      broadcast();
    });

    parser.on("data", (data) => {
      const message = String(data).trim();
      if (message) {
        state.esp32.lastResponse = message;
        state.esp32.status = "CONNECTED";
        addSerialLog("←", message);
        addEvent(`ESP32 response: ${message}`);
        broadcast();
      }
    });
  } catch (err) {
    console.warn("Unable to open serial port:", err.message);
    state.esp32.connected = false;
    state.esp32.status = "DISCONNECTED";
    addEvent(`Could not open ${targetPort}: ${err.message.slice(0, 60)}`);
  }
}

// ─── Camera Inference via Python Service ─────────────────────────────────────
/**
 * Calls the Python inference service (app.py) to get vehicle count + density
 * for the given camera direction. Python uses OpenCV + Ultralytics YOLO.
 *
 * Flow: Node.js → GET http://localhost:8000/api/camera/detect?direction=NORTH
 *              ← { vehicle_count, traffic_density, detections, model.status }
 */
async function runCameraInference(camera) {
  const dir = camera.direction.toUpperCase();
  if (!state.trafficData[dir]) return;

  // If camera health check says it is not reachable, mark as disconnected
  const isHealthy = state.cameraHealth[camera.id]?.status === "CONNECTED";
  if (!isHealthy) {
    state.trafficData[dir].vehicleCount = 0;
    state.trafficData[dir].density = "UNKNOWN";
    state.trafficData[dir].status =
      state.cameraHealth[camera.id]?.status || "DISCONNECTED";
    broadcast();
    return;
  }

  try {
    console.log(`[CAMERA] ${dir} calling Python inference service...`);
    const response = await axios.get(`${PYTHON_API}/api/camera/detect`, {
      params: { direction: dir },
      timeout: 12000, // 12 s — allow time for OpenCV connect + YOLO inference
    });

    const data = response.data;
    const modelStatus = data.model?.status;

    if (modelStatus === "inference_ok") {
      const count = data.traffic.vehicle_count;
      const density = data.traffic.traffic_density;

      state.trafficData[dir].vehicleCount = count;
      state.trafficData[dir].density = density;
      state.trafficData[dir].status = "CONNECTED";
      state.trafficData[dir].lastUpdate = Date.now();

      console.log(`[MODEL] Vehicles detected: ${count}`);
      console.log(`[TRAFFIC] ${dir} density: ${density}`);
      addEvent(`[${camera.id}] inference: ${count} vehicles (${density})`);
    } else if (modelStatus === "camera_error") {
      // Camera reachable by health check but Python couldn't grab a frame
      console.warn(
        `[CAMERA] ${dir} — Python could not capture frame: ${data.error || ""}`,
      );
      state.trafficData[dir].vehicleCount = 0;
      state.trafficData[dir].density = "UNKNOWN";
      state.trafficData[dir].status = "CHECKING";
    } else {
      // inference_error or model_not_loaded — do not fake data
      console.warn(`[MODEL] ${dir} inference returned status: ${modelStatus}`);
      // Keep previous vehicleCount/density; just flag status
      state.trafficData[dir].status = "CONNECTED";
    }
  } catch (err) {
    // Python service is unreachable (not started, port wrong, etc.)
    if (!state._pythonWarnLogged) {
      console.warn(
        `[SYSTEM] Python inference service not reachable at ${PYTHON_API} — start app.py`,
      );
      addEvent(
        `[SYSTEM] Python service unreachable: ${err.message.slice(0, 60)}`,
      );
      state._pythonWarnLogged = true;
    }
    state.trafficData[dir].status = "CHECKING";
  }

  if (!state.emergencyMode) {
    runNormalSignalDecision();
  }
  console.log(`[SIGNAL] ${dir} evaluated for signal decision`);
  broadcast();
}

// ─── Normal Traffic Signal Decision ──────────────────────────────────────────
let lastNormalSwitchTime = Date.now();
const NORMAL_CYCLE_DURATION_MS = 10000; // Cycle every 10s if counts are equal

function runNormalSignalDecision() {
  if (state.emergencyMode) return;

  const laneCounts = {
    NORTH: state.trafficData.NORTH?.vehicleCount || 0,
    SOUTH: state.trafficData.SOUTH?.vehicleCount || 0,
    EAST: state.trafficData.EAST?.vehicleCount || 0,
    WEST: state.trafficData.WEST?.vehicleCount || 0,
  };

  const prevGreen = Object.entries(state.signalState).find(
    ([, v]) => v === "GREEN",
  )?.[0];

  let targetGreen = prevGreen || "NORTH";
  const now = Date.now();
  const highestCount = Math.max(...Object.values(laneCounts));
  const leadingDirections = Object.entries(laneCounts)
    .filter(([, count]) => count === highestCount)
    .map(([direction]) => direction);

  if (highestCount > 0) {
    if (leadingDirections.includes(prevGreen)) {
      targetGreen = prevGreen;
    } else {
      targetGreen = leadingDirections[0];
    }
  } else if (
    !prevGreen ||
    now - lastNormalSwitchTime > NORMAL_CYCLE_DURATION_MS
  ) {
    targetGreen = prevGreen === "NORTH" ? "SOUTH" : "NORTH";
    lastNormalSwitchTime = now;
  }

  if (prevGreen !== targetGreen || state.signalState[targetGreen] !== "GREEN") {
    DIRECTIONS.forEach((d) => {
      state.signalState[d] = d === targetGreen ? "GREEN" : "RED";
    });
    lastNormalSwitchTime = now;
    sendToEsp32(`${targetGreen}_GREEN`);
    addEvent(
      `Normal mode: ${targetGreen} selected (${JSON.stringify(laneCounts)}) → ${targetGreen}_GREEN`,
    );
  }
}

// ─── Route Selection ──────────────────────────────────────────────────────────
function computeRouteCost(route) {
  const trafficDelay = TRAFFIC_DELAY_MAP[route.traffic] || 5;
  return (
    (route.etaMinutes || 0) +
    trafficDelay +
    (route.signalDelay || 0) +
    (route.congestionPenalty || 0)
  );
}

function chooseRoute(destinationName) {
  let candidates = ROUTE_LIBRARY;

  const adjustedCandidates = candidates.map((r) => {
    // Basic proxy for overall density
    const avgDensity = "MEDIUM";
    const densityPenalty =
      { LOW: 0, MEDIUM: 2, HIGH: 5, UNKNOWN: 1 }[avgDensity] || 0;
    return {
      ...r,
      etaMinutes: r.etaMinutes + (r.traffic === "HIGH" ? densityPenalty : 0),
    };
  });

  const best = adjustedCandidates.reduce((bestSoFar, candidate) =>
    computeRouteCost(candidate) < computeRouteCost(bestSoFar)
      ? candidate
      : bestSoFar,
  );

  state.route = best;
  state.routeRecommendation = `Selected ${best.id} — lowest estimated travel time (${best.etaMinutes} min, ${best.distanceKm} km, ${best.traffic} traffic)`;
  addEvent(`Route calculated: ${best.id} selected`);
  return best;
}

// ─── Next Intersection on Route ───────────────────────────────────────────────
function getNextIntersectionOnRoute() {
  if (!state.vehicle.latitude || !state.vehicle.longitude) return null;
  if (!state.route) return null;

  const routeIntersectionIds = state.route.intersections || [];
  const routeIntersections = INTERSECTIONS.filter((i) =>
    routeIntersectionIds.includes(i.id),
  );
  if (routeIntersections.length === 0) return null;

  const sorted = routeIntersections
    .map((i) => ({
      ...i,
      distanceKm: distanceKm(
        state.vehicle.latitude,
        state.vehicle.longitude,
        i.latitude,
        i.longitude,
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return sorted[0];
}

// ─── Emergency Intersection Logic ─────────────────────────────────────────────
function updateIntersectionPriority() {
  if (!state.emergencyMode || !state.vehicle.latitude) return;

  const next = getNextIntersectionOnRoute();
  if (!next) {
    state.nextIntersection = null;
    state.distanceToIntersectionM = null;
    state.intersectionPriorityStatus = "INACTIVE";
    return;
  }

  const distM = Math.round(next.distanceKm * 1000);
  state.nextIntersection = next;
  state.distanceToIntersectionM = distM;

  const heading = state.vehicle.heading || "NORTH";
  state.intersectionDirection = heading;

  const prevStatus = state.intersectionPriorityStatus;

  if (distM > PRIORITY_PREPARE_DISTANCE_M) {
    if (prevStatus !== "INACTIVE") {
      state.intersectionPriorityStatus = "INACTIVE";
      addEvent(`INT${next.id} — distance ${distM}m, priority INACTIVE`);
    }
  } else if (
    distM <= PRIORITY_PREPARE_DISTANCE_M &&
    distM > PRIORITY_ACTIVATE_DISTANCE_M
  ) {
    if (prevStatus !== "PREPARING") {
      state.intersectionPriorityStatus = "PREPARING";
      addEvent(`INT${next.id} — ${distM}m away, entering PREPARE zone`);
    }
  } else if (distM <= PRIORITY_ACTIVATE_DISTANCE_M) {
    if (prevStatus !== "ACTIVE") {
      state.intersectionPriorityStatus = "ACTIVE";
      addEvent(
        `INT${next.id} — ${distM}m away, ACTIVATING emergency priority for ${heading}`,
      );
      activateEmergencySignal(heading, next.id);
    }
  }
}

// ─── Signal Transition: YELLOW → ALL_RED → EMERGENCY ─────────────────────────
function activateEmergencySignal(direction, intersectionId) {
  if (signalTransitionTimer) clearTimeout(signalTransitionTimer);
  const dir = direction.toUpperCase();
  state.signalTransitionState = "YELLOW";

  addEvent(`Signal transition: YELLOW phase for ${dir}`);
  sendToEsp32("YELLOW");
  DIRECTIONS.forEach((d) => {
    state.signalState[d] = "YELLOW";
  });
  broadcast();

  signalTransitionTimer = setTimeout(() => {
    state.signalTransitionState = "ALL_RED";
    addEvent("Signal transition: ALL_RED clearance phase");
    sendToEsp32("ALL_RED");
    DIRECTIONS.forEach((d) => {
      state.signalState[d] = "RED";
    });
    broadcast();

    signalTransitionTimer = setTimeout(() => {
      state.signalTransitionState = "EMERGENCY";
      const command = `EMERGENCY_${dir}`;
      DIRECTIONS.forEach((d) => {
        state.signalState[d] = d === dir ? "GREEN" : "RED";
      });
      state.trafficMode = "EMERGENCY";
      sendToEsp32(command);
      addEvent(`Emergency priority ACTIVE: ${dir} → GREEN`);
      broadcast();
    }, 1000);
  }, 1500);
}

// ─── Emergency Mode Start/Stop ────────────────────────────────────────────────
function startEmergencyMode() {
  state.emergencyMode = true;
  state.emergencyStarted = true;
  state.vehicle.status = "ACTIVE";
  state.trafficMode = "EMERGENCY";
  state.intersectionPriorityStatus = "INACTIVE";

  resetEmergencyTimeout();
  if (state.destination) {
    chooseRoute(state.destination.name);
  }
  addEvent("Emergency mode ACTIVATED");
  broadcast();
}

function stopEmergencyMode(reason) {
  state.emergencyMode = false;
  state.emergencyStarted = false;
  state.vehicle.status = "STANDBY";
  state.vehicle.gpsStatus = "OFFLINE";
  state.trafficMode = "NORMAL";
  state.intersectionPriorityStatus = "INACTIVE";
  state.signalTransitionState = "IDLE";
  state.nextIntersection = null;
  state.distanceToIntersectionM = null;
  state.intersectionDirection = null;

  if (signalTransitionTimer) clearTimeout(signalTransitionTimer);
  if (emergencyTimeoutTimer) clearTimeout(emergencyTimeoutTimer);

  sendToEsp32("NORMAL_MODE");
  addEvent(`Emergency mode DEACTIVATED — ${reason || "trip completed"}`);
  broadcast();
}

function resetEmergencyTimeout() {
  if (emergencyTimeoutTimer) clearTimeout(emergencyTimeoutTimer);
  emergencyTimeoutTimer = setTimeout(() => {
    if (state.emergencyMode) stopEmergencyMode("GPS timeout");
  }, EMERGENCY_TIMEOUT_MS);
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.get("/api/state", (_, res) => res.json(state));

app.get("/api/cameras", (_, res) => res.json({ cameras: state.cameras }));

app.get("/api/cameras/:cameraId/health", (req, res) => {
  const { cameraId } = req.params;
  const camera = state.cameras.find((c) => c.id === cameraId);

  if (!camera) {
    return res.status(404).json({
      ok: false,
      error: "Camera not found",
      cameraId,
    });
  }

  const health = state.cameraHealth[cameraId] || {
    status: "UNKNOWN",
    lastChecked: null,
    failureCount: 0,
    message: "No health check data yet",
  };

  res.json({
    ok: true,
    cameraId: camera.id,
    name: camera.name,
    direction: camera.direction,
    status: health.status,
    lastChecked: health.lastChecked,
    failureCount: health.failureCount,
    message: health.message,
    videoUrl: camera.videoUrl,
    healthUrl: camera.healthUrl,
  });
});

app.post("/api/cameras/update", async (req, res) => {
  const { id, videoUrl } = req.body || {};
  const cam = state.cameras.find((c) => c.id === id);
  if (!cam) {
    return res.status(404).json({ ok: false, error: "Camera not found" });
  }

  if (videoUrl) cam.videoUrl = videoUrl;
  saveCamerasConfig();
  updateCameraStateMapping();
  addEvent(`Updated camera ${id} videoUrl → ${videoUrl}`);

  // Sync the new URL to the Python inference service so it uses the right IP
  try {
    await axios.post(
      `${PYTHON_API}/api/camera/config`,
      {
        [cam.direction.toUpperCase()]: videoUrl,
      },
      { timeout: 3000 },
    );
    console.log(`[CAMERA] Synced ${cam.direction} URL to Python service`);
  } catch (err) {
    console.warn(
      `[CAMERA] Could not sync URL to Python service: ${err.message}`,
    );
    // Non-fatal — Python service may not be running yet
  }

  broadcast();
  res.json({ ok: true, camera: cam });
});

app.post("/api/cameras/test", async (req, res) => {
  const { id } = req.body || {};
  const cam = state.cameras.find((c) => c.id === id);
  if (!cam) {
    return res.status(404).json({ ok: false, error: "Camera not found" });
  }

  addEvent(`Manual test triggered for ${id}`);
  const healthOk = await checkCameraHealth(cam);

  let testResult = { ok: true, cameraId: id, healthy: healthOk };

  if (healthOk) {
    try {
      const dir = cam.direction.toUpperCase();
      console.log(`[CAMERA] ${dir} running manual test via Python service`);
      const response = await axios.get(`${PYTHON_API}/api/camera/test`, {
        params: { direction: dir },
        timeout: 20000, // generous timeout for manual test
      });
      testResult = { ...testResult, ...response.data };
      const count = response.data.vehicle_count;
      addEvent(`[${id}] Test complete: ${count} vehicles detected`);
    } catch (err) {
      testResult.inferenceError = `Python service error: ${err.message.slice(0, 80)}`;
      addEvent(`[${id}] Test failed — Python service unreachable`);
    }
  }

  broadcast();
  res.json(testResult);
});

app.post("/api/emergency/destination", (req, res) => {
  const { latitude, longitude, name } = req.body || {};
  if (!name)
    return res
      .status(400)
      .json({ ok: false, error: "Destination name required." });
  state.destination = {
    name,
    latitude: latitude || null,
    longitude: longitude || null,
  };
  addEvent(`Destination set: ${name}`);
  broadcast();
  res.json({ ok: true, destination: state.destination });
});

app.post("/api/emergency/start", (req, res) => {
  if (!state.destination)
    return res.status(400).json({
      ok: false,
      error: "Set a destination before starting emergency.",
    });
  startEmergencyMode();
  res.json({
    ok: true,
    emergencyMode: true,
    vehicle: state.vehicle,
    route: state.route,
  });
});

app.post("/api/emergency/stop", (req, res) => {
  stopEmergencyMode("driver stopped");
  res.json({ ok: true, emergencyMode: false });
});

app.post("/api/emergency/location", (req, res) => {
  const { latitude, longitude, speed, heading, gpsStatus } = req.body || {};
  if (gpsStatus) state.vehicle.gpsStatus = gpsStatus;

  if (typeof latitude === "number" && typeof longitude === "number") {
    state.vehicle.latitude = latitude;
    state.vehicle.longitude = longitude;
    state.vehicle.speedKmh = speed ? Math.round(speed * 3.6) : 0;
    if (heading !== null && heading !== undefined) {
      state.vehicle.heading = headingDegreesToDirection(heading);
    }
    state.vehicle.timestamp = new Date().toISOString();
    state.vehicle.lastGpsUpdate = Date.now();
    state.vehicle.gpsStatus = "LIVE";

    if (state.emergencyMode) {
      resetEmergencyTimeout();
      updateIntersectionPriority();
      if (state.destination?.latitude && state.destination?.longitude) {
        const distToDest = distanceKm(
          latitude,
          longitude,
          state.destination.latitude,
          state.destination.longitude,
        );
        const avgSpeedKmh = Math.max(state.vehicle.speedKmh || 40, 10);
        state.vehicle.etaMinutes = Math.round((distToDest / avgSpeedKmh) * 60);
        state.vehicle.distanceKm = Math.round(distToDest * 10) / 10;
      }
    }
  }
  broadcast();
  res.json({ ok: true, vehicle: state.vehicle });
});

function headingDegreesToDirection(heading) {
  if (heading === null || heading === undefined) return "NORTH";
  const h = ((heading % 360) + 360) % 360;
  if (h >= 315 || h < 45) return "NORTH";
  if (h >= 45 && h < 135) return "EAST";
  if (h >= 135 && h < 225) return "SOUTH";
  return "WEST";
}

app.post("/api/signal/test", (req, res) => {
  const { direction } = req.body || {};
  const target = (direction || "NORTH").toUpperCase();
  const command = `${target}_GREEN`;
  DIRECTIONS.forEach((d) => {
    state.signalState[d] = d === target ? "GREEN" : "RED";
  });
  sendToEsp32(command);
  addEvent(`Manual test: ${command}`);
  broadcast();
  res.json({ ok: true, command, signalState: state.signalState });
});

app.post("/api/signal/normal", (_, res) => {
  if (state.emergencyMode) stopEmergencyMode("manual override to normal");
  else {
    sendToEsp32("NORMAL_MODE");
    addEvent("Manual: NORMAL_MODE sent to ESP32");
  }
  broadcast();
  res.json({ ok: true, command: "NORMAL_MODE" });
});

app.get("/api/serial/ports", async (_, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({
      ok: true,
      ports,
      current: state.esp32.port,
      connected: state.esp32.connected,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/serial/connect", async (req, res) => {
  const { port } = req.body || {};
  if (port) {
    SERIAL_PORT_PATH = port;
  }
  await initSerialPort(port || SERIAL_PORT_PATH);
  res.json({
    ok: true,
    port: state.esp32.port,
    status: state.esp32.status,
    connected: state.esp32.connected,
  });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", data: state }));
});

// ─── Camera Inference Loop ────────────────────────────────────────────────────
function startCameraLoops() {
  // Clear any existing intervals
  Object.values(cameraLoops).forEach(clearInterval);
  cameraLoops = {};

  // Regular normal signal rotation check every 2 seconds
  cameraLoops["normal-signal-cycle"] = setInterval(() => {
    if (!state.emergencyMode) {
      runNormalSignalDecision();
      broadcast();
    }
  }, 2000);

  CAMERAS.forEach((camera) => {
    // Health check every 3 seconds
    cameraLoops[`${camera.id}-health`] = setInterval(async () => {
      await checkCameraHealth(camera);
      broadcast();
    }, 3000);

    // Inference every 2.5 seconds (only if healthy)
    cameraLoops[`${camera.id}-inference`] = setInterval(async () => {
      await runCameraInference(camera);
    }, 2500);
  });
}

// ─── Boot Sequence ────────────────────────────────────────────────────────────
async function startServer() {
  addEvent("Smart Traffic Management System starting...");
  addEvent(
    "Inference delegated to Python service (app.py) — ensure it is running on port 8000",
  );

  initSerialPort();
  chooseRoute("Default");

  // Sync current camera URLs to Python service (best-effort; Python may start later)
  try {
    const camConfig = {};
    CAMERAS.forEach((c) => {
      camConfig[c.direction.toUpperCase()] = c.videoUrl;
    });
    await axios.post(`${PYTHON_API}/api/camera/config`, camConfig, {
      timeout: 2000,
    });
    addEvent("Camera URLs synced to Python inference service");
  } catch (_) {
    addEvent(
      "[INFO] Python service not yet available — start app.py separately",
    );
  }

  startCameraLoops();

  server.listen(PORT, () => {
    addEvent(`Server running on port ${PORT}`);
    console.log(`Smart Traffic API on port ${PORT}`);
    console.log(`Inference: Python service expected at ${PYTHON_API}`);
  });
}

startServer();

module.exports = { app, state, sendToEsp32 };
