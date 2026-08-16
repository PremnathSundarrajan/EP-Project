import { useEffect, useState, useRef, useCallback } from "react";

const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"];
const API = "http://localhost:5000";
const WS_URL = "ws://localhost:5000";

const PRESET_DESTINATIONS = [
  { name: "Government Hospital", latitude: 12.9822, longitude: 77.6194 },
  { name: "City Medical Center", latitude: 12.9785, longitude: 77.6124 },
  { name: "Apollo Hospital", latitude: 12.9758, longitude: 77.6193 },
  { name: "Emergency Care Unit", latitude: 12.98, longitude: 77.615 },
];

function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${API}${path}`, opts).then((r) => r.json());
}

function densityColor(density) {
  if (density === "HIGH") return "var(--danger)";
  if (density === "MEDIUM") return "var(--warn)";
  if (density === "LOW") return "var(--success)";
  if (density === "NOT CONFIGURED") return "var(--muted)";
  return "var(--muted)";
}

function signalColor(sig) {
  if (sig === "GREEN") return "var(--success)";
  if (sig === "RED") return "var(--danger)";
  if (sig === "YELLOW") return "var(--warn)";
  return "var(--muted)";
}

function StatusPill({ value, onColor = "success", offColor = "muted", label }) {
  const map = {
    success: "var(--success)",
    danger: "var(--danger)",
    warn: "var(--warn)",
    muted: "var(--muted)",
    accent: "var(--accent)",
  };
  const isOn =
    value === true ||
    value === "ACTIVE" ||
    value === "LIVE" ||
    value === "CONNECTED" ||
    value === "ONLINE";
  const color = map[isOn ? onColor : offColor] || "var(--muted)";
  return (
    <span
      className="status-pill"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label || (isOn ? "●" : "○")} {value}
    </span>
  );
}

function InfoRow({ label, value, valueColor }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong style={valueColor ? { color: valueColor } : {}}>
        {value ?? "--"}
      </strong>
    </div>
  );
}

function SignalLight({ direction, state: sig }) {
  const color = signalColor(sig);
  return (
    <div className="signal-light-box">
      <div className="signal-dir-label">{direction}</div>
      <div className="signal-bulb-stack">
        <div
          className="signal-bulb"
          style={{ background: sig === "RED" ? "#ef4444" : "#ef444433" }}
        />
        <div
          className="signal-bulb"
          style={{ background: sig === "YELLOW" ? "#fbbf24" : "#fbbf2433" }}
        />
        <div
          className="signal-bulb"
          style={{ background: sig === "GREEN" ? "#22c55e" : "#22c55e33" }}
        />
      </div>
      <div className="signal-state-label" style={{ color }}>
        {sig || "OFF"}
      </div>
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState(null);
  const [wsStatus, setWsStatus] = useState("CONNECTING");
  const [screen, setScreen] = useState("PRETRIP");
  const [destination, setDestination] = useState(null);
  const [destSearch, setDestSearch] = useState("");
  const [destDropdown, setDestDropdown] = useState(false);
  const [gpsStatus, setGpsStatus] = useState("OFFLINE");
  const [gpsWatcher, setGpsWatcher] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // overview | cameras | log | manual

  // Local state for camera edits
  const [editCameras, setEditCameras] = useState([]);

  const logRef = useRef(null);
  const wsRef = useRef(null);

  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    const ws = new window.WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus("CONNECTING");

    ws.onopen = () => setWsStatus("CONNECTED");
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "state") {
          setAppState(msg.data);
          if (editCameras.length === 0 && msg.data.cameras) {
            setEditCameras(msg.data.cameras.map((c) => ({ ...c })));
          }
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      setWsStatus("DISCONNECTED");
      setTimeout(connectWs, 3000);
    };
    ws.onerror = () => {
      setWsStatus("ERROR");
      ws.close();
    };
  }, [editCameras.length]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [appState?.eventLog?.length]);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus("DENIED");
      api("/api/emergency/location", "POST", { gpsStatus: "DENIED" });
      return;
    }
    setGpsStatus("WAITING");
    api("/api/emergency/location", "POST", { gpsStatus: "WAITING" });

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus("LIVE");
        api("/api/emergency/location", "POST", {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy,
          gpsStatus: "LIVE",
        });
      },
      (err) => {
        const status = err.code === 1 ? "DENIED" : "ERROR";
        setGpsStatus(status);
        api("/api/emergency/location", "POST", { gpsStatus: status });
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
    setGpsWatcher(watchId);
  }, []);

  const stopGps = useCallback(() => {
    if (gpsWatcher !== null) {
      navigator.geolocation.clearWatch(gpsWatcher);
      setGpsWatcher(null);
    }
    setGpsStatus("OFFLINE");
  }, [gpsWatcher]);

  const handleStartEmergency = async () => {
    if (!destination) return;
    await api("/api/emergency/destination", "POST", destination);
    await api("/api/emergency/start", "POST", {});
    startGps();
    setScreen("DASHBOARD");
  };

  const handleStopEmergency = async () => {
    stopGps();
    await api("/api/emergency/stop", "POST", {});
    setScreen("PRETRIP");
    setDestination(null);
    setDestSearch("");
  };

  const saveCameraUrl = async (id, newUrl) => {
    await api("/api/cameras/update", "POST", { id, videoUrl: newUrl });
  };

  const testCamera = async (id) => {
    try {
      const result = await api("/api/cameras/test", "POST", { id });
      console.log("Camera test result:", result);
    } catch (err) {
      console.error("Camera test error:", err);
    }
  };

  const s = appState || {};
  const vehicle = s.vehicle || {};
  const trafficData = s.trafficData || {};
  const signalState = s.signalState || {
    NORTH: "RED",
    SOUTH: "RED",
    EAST: "RED",
    WEST: "RED",
  };
  const esp32 = s.esp32 || {};
  const route = s.route || {};
  const nextIntersection = s.nextIntersection || null;
  const distanceM = s.distanceToIntersectionM;
  const priorityStatus = s.intersectionPriorityStatus || "INACTIVE";
  const eventLog = s.eventLog || [];

  const filteredDests =
    destSearch.length > 0
      ? PRESET_DESTINATIONS.filter((d) =>
          d.name.toLowerCase().includes(destSearch.toLowerCase()),
        )
      : PRESET_DESTINATIONS;

  // Render a specific camera panel
  const renderCameraPanel = (dir) => {
    const data = trafficData[dir] || {};
    const camConfig = s.cameras?.find((c) => c.id === data.cameraId);
    const camHealth = s.cameraHealth?.[data.cameraId];

    if (!camConfig) {
      return (
        <div className="card camera-card not-configured">
          <div className="card-head">
            <h2>📹 {dir} CAMERA</h2>
            <StatusPill value="NOT CONFIGURED" offColor="muted" />
          </div>
          <div className="camera-feed-empty">
            No camera configured for {dir}
          </div>
          <InfoRow label="Vehicles" value="--" />
          <InfoRow
            label="Density"
            value="NOT CONFIGURED"
            valueColor={densityColor("NOT CONFIGURED")}
          />
        </div>
      );
    }

    // Determine status display
    const healthStatus = camHealth?.status || "UNKNOWN";
    const isConnected = healthStatus === "CONNECTED";
    const statusColor = isConnected
      ? "var(--success)"
      : healthStatus === "CHECKING"
        ? "var(--warn)"
        : "var(--danger)";
    const statusIcon = isConnected
      ? "🟢"
      : healthStatus === "CHECKING"
        ? "🟡"
        : healthStatus === "RECONNECTING"
          ? "🟡"
          : "🔴";

    return (
      <div className="card camera-card">
        <div className="card-head">
          <h2>📹 {dir} CAMERA</h2>
          <StatusPill
            value={healthStatus}
            onColor={isConnected ? "success" : "danger"}
            offColor="danger"
          />
        </div>
        <div className="camera-meta">
          <span>{camConfig.id}</span>
          {camHealth?.lastChecked && (
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              checked {new Date(camHealth.lastChecked).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="camera-feed">
          {isConnected ? (
            <img
              src={camConfig.videoUrl}
              alt={`${dir} Camera Feed`}
              crossOrigin="anonymous"
              onError={() => console.log("Video error")}
            />
          ) : (
            <div className="camera-feed-empty disconnected">
              <div style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
                {statusIcon}
              </div>
              {healthStatus === "CHECKING"
                ? "Camera Checking..."
                : healthStatus === "RECONNECTING"
                  ? "Reconnecting..."
                  : "Camera Disconnected"}
              {camHealth?.message && (
                <div style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
                  ({camHealth.message})
                </div>
              )}
            </div>
          )}
        </div>

        <div className="camera-stats">
          <InfoRow
            label="Vehicle Count"
            value={isConnected ? (data.vehicleCount ?? "--") : "--"}
          />
          <InfoRow
            label="Traffic Density"
            value={isConnected ? data.density || "UNKNOWN" : "UNKNOWN"}
            valueColor={densityColor(
              isConnected ? data.density || "UNKNOWN" : "UNKNOWN",
            )}
          />
          <InfoRow
            label="AI"
            value={isConnected ? "ACTIVE" : "PAUSED"}
            valueColor={isConnected ? "var(--success)" : "var(--muted)"}
          />
        </div>

        <button
          className="test-btn"
          onClick={() => testCamera(camConfig.id)}
          style={{ marginTop: "0.5rem", width: "100%" }}
        >
          🔍 TEST CAMERA
        </button>
      </div>
    );
  };

  if (screen === "PRETRIP") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Smart Traffic Management System</p>
            <h1>Emergency Vehicle Priority</h1>
          </div>
        </header>

        <div className="pretrip-shell">
          <div className="pretrip-card">
            <div className="pretrip-badge">🚑 EMERGENCY VEHICLE</div>
            <h2 className="pretrip-title">Start Emergency Trip</h2>
            <div className="pretrip-vehicle-row">
              <span className="pretrip-label">Vehicle</span>
              <strong className="pretrip-vehicle-name">Ambulance 01</strong>
            </div>

            <div className="pretrip-section">
              <label className="pretrip-label">Destination</label>
              <div className="dest-search-wrap">
                <input
                  className="dest-input"
                  placeholder="Search destination..."
                  value={destSearch}
                  onChange={(e) => {
                    setDestSearch(e.target.value);
                    setDestDropdown(true);
                    setDestination(null);
                  }}
                  onFocus={() => setDestDropdown(true)}
                  autoComplete="off"
                />
                {destination && (
                  <div className="dest-selected-badge">
                    📍 {destination.name}
                  </div>
                )}
                {destDropdown && (
                  <ul className="dest-dropdown">
                    {filteredDests.map((d) => (
                      <li
                        key={d.name}
                        className="dest-option"
                        onClick={() => {
                          setDestination(d);
                          setDestSearch(d.name);
                          setDestDropdown(false);
                        }}
                      >
                        <span className="dest-icon">📍</span>
                        <div>
                          <div className="dest-name">{d.name}</div>
                          <div className="dest-coords">
                            {d.latitude.toFixed(4)}, {d.longitude.toFixed(4)}
                          </div>
                        </div>
                      </li>
                    ))}
                    {filteredDests.length === 0 && (
                      <li className="dest-option dest-noresult">
                        No results found
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>

            <button
              className={`start-emergency-btn ${destination ? "ready" : "disabled"}`}
              onClick={handleStartEmergency}
              disabled={!destination}
            >
              {destination
                ? "🚨 START EMERGENCY"
                : "Select a destination first"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Smart Traffic Management System</p>
          <h1>Emergency Vehicle Priority</h1>
        </div>
        <div className="topbar-right">
          <div
            className="mode-badge"
            style={{
              background: s.emergencyMode
                ? "rgba(239,68,68,0.18)"
                : "rgba(34,197,94,0.12)",
              color: s.emergencyMode ? "var(--danger)" : "var(--success)",
              border: `1px solid ${s.emergencyMode ? "#ef444466" : "#22c55e44"}`,
            }}
          >
            {s.emergencyMode ? "🚨 EMERGENCY MODE" : "✅ NORMAL MODE"}
          </div>
          <div className="ws-badge">
            <span
              className={`ws-dot ${wsStatus === "CONNECTED" ? "ws-ok" : "ws-err"}`}
            />
            {wsStatus}
          </div>
          <button className="stop-btn" onClick={handleStopEmergency}>
            ✕ End Trip
          </button>
        </div>
      </header>

      <div className="tab-bar">
        {[
          ["overview", "📊 Overview"],
          ["cameras", "⚙️ Camera Config"],
          ["log", "📋 Event Log"],
          ["manual", "🔧 Manual Test"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`tab-btn ${activeTab === id ? "tab-active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <>
          <div className="dash-row-top-cameras">
            {renderCameraPanel("NORTH")}

            <div className="card signal-center-card">
              <div className="card-head">
                <h2>🚦 Traffic Signal</h2>
                <span
                  className="mode-chip"
                  style={{
                    color:
                      s.trafficMode === "EMERGENCY"
                        ? "var(--danger)"
                        : "var(--success)",
                  }}
                >
                  {s.trafficMode === "EMERGENCY" ? "EMERGENCY" : "NORMAL"}
                </span>
              </div>
              <div className="signals-row">
                {DIRECTIONS.map((dir) => (
                  <SignalLight
                    key={dir}
                    direction={dir}
                    state={signalState[dir]}
                  />
                ))}
              </div>
            </div>

            {renderCameraPanel("SOUTH")}
          </div>

          <div className="dash-row-bottom">
            <div className="card">
              <div className="card-head">
                <h2>🚑 Emergency Vehicle</h2>
                <StatusPill value={vehicle.status} onColor="danger" label="" />
              </div>
              <InfoRow
                label="GPS"
                value={gpsStatus}
                valueColor={
                  gpsStatus === "LIVE" ? "var(--success)" : "var(--warn)"
                }
              />
              <InfoRow
                label="Location"
                value={
                  vehicle.latitude
                    ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}`
                    : "--"
                }
              />
              <InfoRow
                label="ETA"
                value={
                  vehicle.etaMinutes !== undefined
                    ? `${vehicle.etaMinutes} min`
                    : "--"
                }
              />
            </div>

            <div className="card">
              <div className="card-head">
                <h2>🔀 Upcoming Intersection</h2>
                <span
                  className="priority-badge"
                  style={{ color: "var(--danger)" }}
                >
                  {priorityStatus}
                </span>
              </div>
              {nextIntersection ? (
                <>
                  <InfoRow label="Name" value={nextIntersection.name} />
                  <InfoRow
                    label="Distance"
                    value={distanceM !== null ? `${distanceM} m` : "--"}
                  />
                  <InfoRow
                    label="Direction"
                    value={s.intersectionDirection || "--"}
                  />
                </>
              ) : (
                <div className="no-intersection">
                  Calculating next intersection...
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>⚡ ESP32</h2>
                <StatusPill
                  value={esp32.connected ? "CONNECTED" : "DISCONNECTED"}
                  onColor="success"
                  offColor="danger"
                />
              </div>
              <InfoRow label="Port" value={esp32.port} />
              <InfoRow label="Last Cmd" value={esp32.lastCommand || "NONE"} />
            </div>
          </div>
        </>
      )}

      {activeTab === "cameras" && (
        <div className="card">
          <div className="card-head">
            <h2>⚙️ Camera Configuration</h2>
          </div>
          <p className="manual-desc">
            Configure the IP addresses and MJPEG stream URLs for the two
            smartphones used as CCTV cameras.
          </p>

          <div className="config-grid">
            {editCameras.map((cam, idx) => {
              const currentData = trafficData[cam.direction] || {};
              return (
                <div key={cam.id} className="config-box">
                  <h3>
                    {cam.name} ({cam.id})
                  </h3>
                  <div className="config-status-row">
                    <span>
                      Direction: <strong>{cam.direction}</strong>
                    </span>
                    <StatusPill
                      value={
                        currentData.status === "CONNECTED"
                          ? "CONNECTED"
                          : "DISCONNECTED"
                      }
                      onColor="success"
                      offColor="danger"
                    />
                  </div>

                  <div className="config-input-wrap">
                    <label>Video URL</label>
                    <input
                      type="text"
                      value={cam.videoUrl}
                      onChange={(e) => {
                        const newCams = [...editCameras];
                        newCams[idx].videoUrl = e.target.value;
                        setEditCameras(newCams);
                      }}
                    />
                  </div>

                  <div className="config-actions">
                    <button
                      className="save-btn"
                      onClick={() => saveCameraUrl(cam.id, cam.videoUrl)}
                    >
                      Save Configuration
                    </button>
                    <button
                      className="test-btn"
                      onClick={() => testCamera(cam.id)}
                    >
                      Test Camera
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card-head" style={{ marginTop: "24px" }}>
            <h2>EAST & WEST Cameras</h2>
          </div>
          <p className="manual-desc">
            Not configured in current prototype. The architecture supports
            adding CAM_EAST and CAM_WEST in the future.
          </p>
        </div>
      )}

      {activeTab === "log" && (
        <div className="card log-card">
          <div className="card-head">
            <h2>📋 Live System Event Log</h2>
          </div>
          <div className="event-log-scroll" ref={logRef}>
            {[...eventLog].reverse().map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-ts">{entry.timestamp}</span>
                <span className="log-msg">{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "manual" && (
        <div className="card manual-card">
          <div className="card-head">
            <h2>🔧 Manual Test Mode</h2>
          </div>
          <div className="manual-grid">
            {DIRECTIONS.map((dir) => (
              <button
                key={dir}
                className="manual-signal-btn"
                onClick={() =>
                  api("/api/signal/test", "POST", { direction: dir })
                }
              >
                🟢 {dir} GREEN
              </button>
            ))}
            <button
              className="manual-normal-btn"
              onClick={() => api("/api/signal/normal", "POST", {})}
            >
              ↺ NORMAL MODE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
