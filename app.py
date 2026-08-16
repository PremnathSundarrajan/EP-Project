from __future__ import annotations

import asyncio
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent
MODEL_PATH = APP_DIR / "best.onnx"

# ─── Traffic Density Thresholds (configurable) ────────────────────────────────
LOW_THRESHOLD = 8      # 0–7   vehicles → LOW
MEDIUM_THRESHOLD = 16  # 8–15  vehicles → MEDIUM
HIGH_THRESHOLD = 25    # 16–24 vehicles → HIGH
                       # 25+   vehicles → CRITICAL

# ─── Camera Configuration ─────────────────────────────────────────────────────
# Direction → IP Webcam MJPEG URL
# Update via Camera Config tab in the dashboard, or set in .env
CAMERA_URLS: Dict[str, str] = {
    "NORTH": os.environ.get("CAM_NORTH_URL", "http://10.245.55.176:8080/video"),
    "SOUTH": os.environ.get("CAM_SOUTH_URL", "http://192.168.1.102:8080/video"),
}

# ─── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(title="Smart Emergency Vehicle Traffic Management")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")
except Exception:
    pass  # static directory may not exist in all environments

# Thread pool for blocking OpenCV / YOLO calls (keeps FastAPI event loop free)
_executor = ThreadPoolExecutor(max_workers=4)

# ─── YOLO Model ───────────────────────────────────────────────────────────────
_yolo_model = None
_yolo_error: Optional[str] = None


def _load_yolo_model() -> None:
    """Load best.onnx once at startup using Ultralytics YOLO."""
    global _yolo_model, _yolo_error
    try:
        from ultralytics import YOLO  # imported here to avoid startup crash if missing
        print(f"[MODEL] Loading {MODEL_PATH}")
        _yolo_model = YOLO(str(MODEL_PATH))
        print("[MODEL] best.onnx loaded successfully")
    except Exception as exc:
        _yolo_error = str(exc)
        print(f"[MODEL] ERROR: Failed to load best.onnx — {exc}")


_load_yolo_model()


# ─── Traffic Density ──────────────────────────────────────────────────────────
def _compute_density(count: int) -> str:
    if count < LOW_THRESHOLD:
        return "LOW"
    if count < MEDIUM_THRESHOLD:
        return "MEDIUM"
    if count < HIGH_THRESHOLD:
        return "HIGH"
    return "CRITICAL"


# ─── Camera Frame Capture ─────────────────────────────────────────────────────
def _get_frame(direction: str) -> Optional[np.ndarray]:
    """
    Open the IP Webcam MJPEG stream for the given direction using OpenCV,
    capture a frame, and return it. Returns None on failure.
    """
    url = CAMERA_URLS.get(direction.upper())
    if not url:
        print(f"[CAMERA] ERROR: No URL configured for direction '{direction}'")
        return None

    print(f"[CAMERA] {direction} connecting to {url}")
    cap = cv2.VideoCapture(url)

    if not cap.isOpened():
        print(f"[CAMERA] ERROR: Could not open {direction} camera at {url}")
        cap.release()
        return None

    # Grab a few frames to skip any buffered/stale ones and get the latest
    frame = None
    for _ in range(6):
        ret, f = cap.read()
        if ret and f is not None:
            frame = f

    cap.release()

    if frame is None:
        print(f"[CAMERA] ERROR: Could not read frame from {direction} camera")
        return None

    h, w = frame.shape[:2]
    print(f"[CAMERA] {direction} frame captured: {w}x{h}")
    return frame


# ─── YOLO Inference ───────────────────────────────────────────────────────────
def _infer(frame: np.ndarray, direction: str, intersection_id: str = "INT001") -> Dict[str, Any]:
    """
    Run best.onnx on the given OpenCV frame.
    Returns a dict with vehicle_count, traffic_density, and per-detection info.
    Never returns fake counts — returns an error dict on failure.
    """
    if _yolo_model is None:
        return {
            "source": "error",
            "status": "model_not_loaded",
            "vehicle_count": 0,
            "traffic_density": "UNKNOWN",
            "detections": [],
            "direction": direction,
            "intersection_id": intersection_id,
            "error": _yolo_error or "Model failed to load at startup",
        }

    try:
        print(f"[MODEL] Running best.onnx on {direction} frame")
        results = _yolo_model.predict(source=frame, conf=0.25, verbose=False)
        result = results[0]
        vehicle_count = len(result.boxes)

        detections: List[Dict[str, Any]] = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            class_name = _yolo_model.names.get(class_id, str(class_id))
            detections.append({"class": class_name, "confidence": round(confidence, 3)})

        density = _compute_density(vehicle_count)
        print(f"[MODEL] Vehicles detected: {vehicle_count}")
        print(f"[TRAFFIC] {direction} density: {density}")

        return {
            "source": "best.onnx",
            "status": "inference_ok",
            "vehicle_count": vehicle_count,
            "traffic_density": density,
            "detections": detections,
            "direction": direction,
            "intersection_id": intersection_id,
        }

    except Exception as exc:
        print(f"[MODEL] ERROR: YOLO inference failed — {exc}")
        return {
            "source": "error",
            "status": "inference_error",
            "vehicle_count": 0,
            "traffic_density": "UNKNOWN",
            "detections": [],
            "direction": direction,
            "intersection_id": intersection_id,
            "error": str(exc),
        }


# ─── Async helpers (run blocking calls off the event loop) ────────────────────
async def _get_frame_async(direction: str) -> Optional[np.ndarray]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _get_frame, direction)


async def _infer_async(frame: np.ndarray, direction: str, intersection_id: str = "INT001") -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _infer, frame, direction, intersection_id)


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class EmergencyLocation(BaseModel):
    latitude: float
    longitude: float
    speed: float = 0.0
    heading: str = "NORTH"
    timestamp: Optional[str] = None


class DestinationRequest(BaseModel):
    latitude: float
    longitude: float
    name: str = "Hospital"


class SignalPriorityRequest(BaseModel):
    latitude: float
    longitude: float
    heading: str
    required_direction: str
    intersection_id: str = "INT001"


# ─── Shared Constants ─────────────────────────────────────────────────────────
TRAFFIC_DELAY = {
    "LOW": 2,
    "MEDIUM": 5,
    "HIGH": 9,
    "CRITICAL": 14,
}

ROUTE_LIBRARY = [
    {
        "id": "Route A",
        "distance_km": 5.2,
        "traffic_density": "HIGH",
        "estimated_travel_time_min": 18,
        "signal_delay_min": 5,
        "congestion_penalty": 4,
        "intersections": 4,
        "points": [
            {"latitude": 12.9716, "longitude": 77.5946},
            {"latitude": 12.9729, "longitude": 77.6012},
            {"latitude": 12.9748, "longitude": 77.6091},
            {"latitude": 12.9796, "longitude": 77.6168},
        ],
    },
    {
        "id": "Route B",
        "distance_km": 6.1,
        "traffic_density": "LOW",
        "estimated_travel_time_min": 11,
        "signal_delay_min": 2,
        "congestion_penalty": 1,
        "intersections": 3,
        "points": [
            {"latitude": 12.9716, "longitude": 77.5946},
            {"latitude": 12.9734, "longitude": 77.5999},
            {"latitude": 12.9761, "longitude": 77.6066},
            {"latitude": 12.9822, "longitude": 77.6194},
        ],
    },
    {
        "id": "Route C",
        "distance_km": 6.9,
        "traffic_density": "MEDIUM",
        "estimated_travel_time_min": 13,
        "signal_delay_min": 3,
        "congestion_penalty": 2,
        "intersections": 4,
        "points": [
            {"latitude": 12.9716, "longitude": 77.5946},
            {"latitude": 12.9694, "longitude": 77.6071},
            {"latitude": 12.9731, "longitude": 77.6150},
            {"latitude": 12.9801, "longitude": 77.6235},
        ],
    },
]

INTERSECTIONS = [
    {
        "id": "INT001",
        "name": "MG Road Junction",
        "latitude": 12.9735,
        "longitude": 77.6040,
        "direction": "NORTH",
        "lane": "NORTH",
        "signal_state": {"NORTH": "GREEN", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"},
    },
    {
        "id": "INT002",
        "name": "Hospital Signal",
        "latitude": 12.9785,
        "longitude": 77.6124,
        "direction": "NORTH",
        "lane": "NORTH",
        "signal_state": {"NORTH": "GREEN", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"},
    },
    {
        "id": "INT003",
        "name": "City Center Junction",
        "latitude": 12.9758,
        "longitude": 77.6193,
        "direction": "WEST",
        "lane": "WEST",
        "signal_state": {"NORTH": "RED", "SOUTH": "RED", "EAST": "RED", "WEST": "GREEN"},
    },
]

STATE: Dict[str, Any] = {
    "emergency_mode": False,
    "vehicle": {
        "name": "Ambulance 01",
        "status": "STANDBY",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "speed_kmh": 0,
        "heading": "NORTH",
        "timestamp": "2026-08-13T00:00:00Z",
    },
    "destination": {
        "name": "Hospital",
        "latitude": 12.9822,
        "longitude": 77.6194,
    },
    "route_candidates": ROUTE_LIBRARY,
    "selected_route": None,
    "route_recommendation": "Awaiting destination selection",
    "intersections": INTERSECTIONS,
    "traffic": {
        "intersection_id": "INT001",
        "north": {"vehicle_count": 0, "traffic_density": "UNKNOWN"},
        "south": {"vehicle_count": 0, "traffic_density": "UNKNOWN"},
        "east": {"vehicle_count": 0, "traffic_density": "UNKNOWN"},
        "west": {"vehicle_count": 0, "traffic_density": "UNKNOWN"},
        "last_updated": "2026-08-13T00:00:00Z",
    },
    "signal_status": {"NORTH": "GREEN", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"},
    "signal_history": [],
    "priority_action": None,
    "vehicle_log": [],
}


# ─── Route / Signal Logic (unchanged) ────────────────────────────────────────
def compute_route_cost(route: Dict[str, Any]) -> float:
    traffic_delay = TRAFFIC_DELAY.get(route.get("traffic_density", "MEDIUM"), 5)
    travel_time = float(route.get("estimated_travel_time_min", 0))
    signal_delay = float(route.get("signal_delay_min", 0))
    congestion_penalty = float(route.get("congestion_penalty", 0))
    return round(travel_time + traffic_delay + signal_delay + congestion_penalty, 2)


def select_best_route(routes: List[Dict[str, Any]]) -> Dict[str, Any]:
    scored = []
    for route in routes:
        scored.append({**route, "route_cost": compute_route_cost(route)})
    selected = min(scored, key=lambda item: item["route_cost"])
    selected.pop("route_cost", None)
    return selected


def build_signal_transition(direction: str) -> List[str]:
    mapping = {
        "NORTH": "NORTH_GREEN",
        "SOUTH": "SOUTH_GREEN",
        "EAST": "EAST_GREEN",
        "WEST": "WEST_GREEN",
    }
    command = mapping.get(direction.upper(), "NORTH_GREEN")
    return ["CURRENT_GREEN", "YELLOW", "ALL_RED", command]


def get_signal_priority_action(
    *,
    vehicle_heading: str,
    required_direction: str,
    current_signal_state: Dict[str, str],
    emergency_mode: bool,
    vehicle_valid: bool,
    sanity_ok: bool,
) -> Dict[str, Any]:
    direction = required_direction.upper()
    heading = vehicle_heading.upper()
    if not emergency_mode:
        return {"approved": False, "reason": "Emergency mode is off.", "command": None}
    if not vehicle_valid:
        return {"approved": False, "reason": "Vehicle GPS is invalid.", "command": None}
    if not sanity_ok:
        return {"approved": False, "reason": "Safety checks failed before prioritization.", "command": None}
    if heading != direction:
        return {"approved": False, "reason": f"Heading mismatch: expected {direction}, received {heading}.", "command": None}

    command = f"{direction}_GREEN"
    return {
        "approved": True,
        "command": command,
        "reason": f"Authorized emergency priority for {direction} lane.",
        "safety_transition": build_signal_transition(direction),
        "current_signal_state": current_signal_state,
    }


def refresh_route_selection() -> Dict[str, Any]:
    best_route = select_best_route(STATE["route_candidates"])
    STATE["selected_route"] = best_route
    STATE["route_recommendation"] = (
        f"Selected {best_route['id']} because it has the lowest estimated travel cost."
    )
    return best_route


def compute_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def get_next_intersection() -> Optional[Dict[str, Any]]:
    if not STATE["selected_route"]:
        refresh_route_selection()
    vehicle = STATE["vehicle"]
    candidates = sorted(
        STATE["intersections"],
        key=lambda item: compute_distance_km(vehicle["latitude"], vehicle["longitude"], item["latitude"], item["longitude"]),
    )
    return candidates[0] if candidates else None


def build_snapshot() -> Dict[str, Any]:
    vehicle = STATE["vehicle"]
    route = STATE["selected_route"] or refresh_route_selection()
    next_intersection = get_next_intersection()
    distance_m = int(compute_distance_km(vehicle["latitude"], vehicle["longitude"], next_intersection["latitude"], next_intersection["longitude"]) * 1000) if next_intersection else 0
    return {
        "emergency_mode": STATE["emergency_mode"],
        "vehicle": vehicle,
        "destination": STATE["destination"],
        "route": route,
        "traffic": STATE["traffic"],
        "next_intersection": next_intersection,
        "distance_to_next_intersection_m": distance_m,
        "route_recommendation": STATE["route_recommendation"],
        "signal_status": STATE["signal_status"],
        "priority_action": STATE["priority_action"],
        "system_status": "ACTIVE" if STATE["emergency_mode"] else "STANDBY",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Camera Endpoints (NEW)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/camera/detect")
async def camera_detect(direction: str = Query(default="NORTH")):
    """
    Capture a frame from the configured IP Webcam for the given direction,
    run best.onnx via Ultralytics YOLO, and return vehicle count + density.
    Called every ~2.5 s by the Node.js server for each camera direction.
    """
    direction = direction.upper()

    frame = await _get_frame_async(direction)
    if frame is None:
        return JSONResponse(
            status_code=503,
            content={
                "direction": direction,
                "status": "camera_error",
                "vehicle_count": 0,
                "traffic_density": "UNKNOWN",
                "detections": [],
                "error": f"[CAMERA] ERROR: Could not capture frame from {direction} camera",
                "model": {"name": "best.onnx", "status": "not_run"},
            },
        )

    result = await _infer_async(frame, direction)

    # Update shared STATE so /api/emergency/traffic stays in sync
    dir_key = direction.lower()
    STATE["traffic"][dir_key] = {
        "vehicle_count": result["vehicle_count"],
        "traffic_density": result["traffic_density"],
    }

    return {
        "direction": direction,
        "traffic": {
            "vehicle_count": result["vehicle_count"],
            "traffic_density": result["traffic_density"],
            "intersection_id": result.get("intersection_id", "INT001"),
        },
        "detections": result["detections"],
        "model": {
            "name": "best.onnx",
            "source": result["source"],
            "status": result["status"],
        },
    }


@app.get("/api/camera/test")
async def camera_test(direction: str = Query(default="NORTH")):
    """
    Manual test: connect to camera, capture one frame, run YOLO, return full detail.
    Useful for verifying the camera and model independently via:
    GET http://localhost:8000/api/camera/test?direction=NORTH
    """
    direction = direction.upper()
    url = CAMERA_URLS.get(direction, "not configured")

    frame = await _get_frame_async(direction)
    camera_status = "CONNECTED" if frame is not None else "DISCONNECTED"
    print(f"[CAMERA] {direction} test — {camera_status}")

    if frame is None:
        return {
            "direction": direction,
            "camera": {"status": camera_status, "url": url},
            "vehicle_count": "--",
            "traffic_density": "UNKNOWN",
            "detections": [],
            "model": {"name": "best.onnx", "status": "not_tested"},
        }

    h, w = frame.shape[:2]
    result = await _infer_async(frame, direction)
    return {
        "direction": direction,
        "camera": {
            "status": camera_status,
            "url": url,
            "frame_shape": f"{w}x{h}",
        },
        "vehicle_count": result["vehicle_count"],
        "traffic_density": result["traffic_density"],
        "detections": result["detections"],
        "model": {
            "name": "best.onnx",
            "source": result["source"],
            "status": result["status"],
        },
    }


@app.post("/api/camera/config")
async def update_camera_config(body: Dict[str, str]):
    """
    Update camera URLs at runtime without restarting Python.
    Called by Node.js when the user saves a new camera URL in the Camera Config tab.
    Body: { "NORTH": "http://192.168.1.101:8080/video", "SOUTH": "..." }
    """
    updated = {}
    for direction, url in body.items():
        direction = direction.upper()
        if direction in ("NORTH", "SOUTH", "EAST", "WEST"):
            CAMERA_URLS[direction] = url
            updated[direction] = url
            print(f"[CAMERA] Updated {direction} URL → {url}")
    return {"ok": True, "updated": updated, "cameras": CAMERA_URLS}


@app.get("/api/camera/urls")
async def get_camera_urls():
    """Return the current camera URL configuration."""
    return {"cameras": CAMERA_URLS}


# ═══════════════════════════════════════════════════════════════════════════════
# Existing Emergency / Routing Endpoints (UNCHANGED)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def read_index() -> FileResponse:
    return FileResponse(str(APP_DIR / "static" / "index.html"))


@app.get("/api/emergency/route")
async def emergency_route():
    route = STATE["selected_route"] or refresh_route_selection()
    return {
        "selected_route": route,
        "routes": STATE["route_candidates"],
        "recommended_reason": STATE["route_recommendation"],
        "estimated_eta_min": route["estimated_travel_time_min"],
        "current_route_cost": compute_route_cost(route),
    }


@app.get("/api/emergency/traffic")
async def emergency_traffic(direction: str = Query(default="NORTH")):
    """
    Get real-time traffic for the given direction using live YOLO inference.
    Falls back to cached STATE traffic if direction is not configured.
    """
    direction = direction.upper()
    frame = await _get_frame_async(direction)
    if frame is not None:
        result = await _infer_async(frame, direction, STATE["traffic"].get("intersection_id", "INT001"))
        dir_key = direction.lower()
        STATE["traffic"][dir_key] = {
            "vehicle_count": result["vehicle_count"],
            "traffic_density": result["traffic_density"],
        }
        STATE["traffic"]["last_updated"] = "live"
        return {
            "traffic": STATE["traffic"],
            "model": {"name": "best.onnx", "source": result["source"]},
        }
    # Camera unavailable — return cached state
    return {
        "traffic": STATE["traffic"],
        "model": {"name": "best.onnx", "source": "cached"},
    }


@app.post("/api/emergency/start")
async def emergency_start():
    STATE["emergency_mode"] = True
    STATE["vehicle"]["status"] = "ACTIVE"
    STATE["vehicle"]["timestamp"] = "2026-08-13T00:00:00Z"
    STATE["vehicle_log"].append({"event": "emergency_start", "timestamp": STATE["vehicle"]["timestamp"]})
    refresh_route_selection()
    return build_snapshot()


@app.post("/api/emergency/location")
async def emergency_location(location: EmergencyLocation):
    STATE["vehicle"].update(
        {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "speed_kmh": location.speed,
            "heading": location.heading.upper(),
            "timestamp": location.timestamp or "2026-08-13T00:00:00Z",
        }
    )
    STATE["vehicle_log"].append({
        "event": "location_update",
        "timestamp": STATE["vehicle"]["timestamp"],
        "location": {"latitude": location.latitude, "longitude": location.longitude},
    })
    if STATE["emergency_mode"]:
        refresh_route_selection()
    return build_snapshot()


@app.post("/api/emergency/destination")
async def emergency_destination(destination: DestinationRequest):
    STATE["destination"] = {
        "name": destination.name,
        "latitude": destination.latitude,
        "longitude": destination.longitude,
    }
    refresh_route_selection()
    return build_snapshot()


@app.post("/api/emergency/signal-priority")
async def emergency_signal_priority(request: SignalPriorityRequest):
    safety_ok = bool(STATE["emergency_mode"])
    vehicle_valid = bool(STATE["vehicle"].get("latitude") and STATE["vehicle"].get("longitude"))
    action = get_signal_priority_action(
        vehicle_heading=STATE["vehicle"].get("heading", "NORTH"),
        required_direction=request.required_direction,
        current_signal_state=STATE["signal_status"],
        emergency_mode=STATE["emergency_mode"],
        vehicle_valid=vehicle_valid,
        sanity_ok=safety_ok,
    )

    STATE["priority_action"] = action
    if action["approved"]:
        direction = request.required_direction.upper()
        command = f"{direction}_GREEN"
        STATE["signal_status"] = {"NORTH": "RED", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"}
        STATE["signal_status"][direction] = "GREEN"
        STATE["signal_history"].append({
            "timestamp": STATE["vehicle"].get("timestamp"),
            "command": command,
            "intersection_id": request.intersection_id,
            "transition": action["safety_transition"],
        })
    return action


@app.get("/api/intersections")
async def get_intersections():
    return {"intersections": STATE["intersections"]}


@app.get("/api/intersections/{intersection_id}/status")
async def get_intersection_status(intersection_id: str):
    target = next((item for item in STATE["intersections"] if item["id"] == intersection_id), None)
    if target is None:
        return {"detail": "Intersection not found"}
    return {"intersection": target, "signal_state": target["signal_state"]}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(build_snapshot())
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
