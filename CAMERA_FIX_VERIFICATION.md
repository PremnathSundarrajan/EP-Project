# Camera Connection Status Logic - Fix Verification

## ✅ Requirements Met

### 1. CAMERA CONFIGURATION

- [x] North camera: `http://10.245.55.176:8080/video` (videoUrl)
- [x] Health URL: `http://10.245.55.176:8080/` (healthUrl)
- [x] South camera configurable separately
- [x] No hardcoded IP addresses in React components (all from config)

### 2. DO NOT USE /video AS HEALTH CHECK

- [x] `/video` (MJPEG) NOT used for health checking
- [x] Using `healthUrl` for connectivity checking
- [x] Timeout: 3 seconds (configurable in code)
- [x] Logic: Camera reachable → CONNECTED, unreachable/timeout → DISCONNECTED

### 3. CAMERA STATUS STATES

- [x] CONNECTED - camera healthy and reachable
- [x] DISCONNECTED - camera unreachable after retries
- [x] CHECKING - initial check or after failure, retrying
- [x] Does not immediately mark disconnected on single failure
- [x] Tracks failure count (3+ failures before marking DISCONNECTED)

### 4. LIVE VIDEO

- [x] videoUrl used only for live video display
- [x] NOT used for health check
- [x] North camera preview displays actual live video (when connected)

### 5. BROWSER NETWORK ISSUE (CORS)

- [x] Frontend cannot directly fetch from IP camera due to CORS
- [x] Backend proxy health check: sends request from server
- [x] Backend has direct network access to IP camera
- [x] If direct browser access fails but backend can reach it → still CONNECTED
- [x] Video preview in HTML `<img>` tag handles CORS differently than fetch

### 6. BACKEND HEALTH ENDPOINT

- [x] Endpoint: `GET /api/cameras/:cameraId/health`
- [x] Reads configured healthUrl from config
- [x] Sends HTTP request to IP camera server with 3s timeout
- [x] Returns proper JSON response with all required fields:
  ```json
  {
    "ok": true,
    "cameraId": "CAM_NORTH",
    "name": "North Camera",
    "direction": "NORTH",
    "status": "CONNECTED",
    "lastChecked": "2024-01-15T10:30:45.123Z",
    "failureCount": 0,
    "message": "Health check passed",
    "videoUrl": "http://10.245.55.176:8080/video",
    "healthUrl": "http://10.245.55.176:8080/"
  }
  ```

### 7. FRONTEND STATUS DISPLAY

- [x] Calls `/api/cameras/CAM_NORTH/health` for status
- [x] Status display:
  - [x] 🟢 CONNECTED (green)
  - [x] 🔴 DISCONNECTED (red)
  - [x] 🟡 CHECKING (yellow)
  - [x] 🟡 RECONNECTING (yellow)
- [x] Updates health status from backend (via WebSocket state broadcast)

### 8. VIDEO ERROR HANDLING

- [x] Video element has `onError` handler
- [x] Single video rendering error does NOT mark camera disconnected
- [x] Primary connectivity indicator is backend health check
- [x] Backend health check is authority on camera status

### 9. AI INFERENCE STATE

- [x] When CONNECTED:
  - Vehicle Count: actual best.onnx result
  - Traffic Density: actual calculated density
  - AI: ACTIVE
- [x] When DISCONNECTED:
  - Vehicle Count: "--" (cleared)
  - Traffic Density: "UNKNOWN" (cleared)
  - AI: "PAUSED"

### 10. NORTH CAMERA DATA FLOW

- [x] Phone IP Webcam → `/video` → Live video display
- [x] Live video → Frame extraction → best.onnx → Vehicle detection
- [x] Vehicle count → Traffic density → Signal decision
- [x] Separate: `/` → Backend health check → CAM_NORTH status

### 11. TEST CAMERA BUTTON

- [x] Button added on camera card: "🔍 TEST CAMERA"
- [x] When clicked:
  1. Check health URL
  2. Check video URL (frame capture)
  3. Report result
- [x] Shows status: CONNECTED / DISCONNECTED / error details
- [x] Also available in config tab

### 12. DO NOT USE STATIC DATA

- [x] Vehicle count not displayed when disconnected
- [x] Density not displayed when disconnected
- [x] Inference data cleared when camera disconnected
- [x] Only shows real ONNX inference results

### 13. KEEP SOUTH CAMERA

- [x] South camera maintains separate:
  - Camera ID
  - Direction
  - Video URL
  - Health URL
  - Connection status
  - Vehicle count
  - Density
  - AI inference status
- [x] North and South completely independent

## Architecture Changes Summary

### Before (Broken)

```
Frontend tries fetch(videoUrl) for health
  ↓
MJPEG stream is continuous
  ↓
Fetch doesn't complete normally
  ↓
Timeout/error → DISCONNECTED
```

### After (Fixed)

```
Backend health check loop (every 3s)
  ↓
axios.get(healthUrl) with 3s timeout
  ↓
Tracks status: CONNECTED/CHECKING/DISCONNECTED
  ↓
Frontend polls /api/cameras/:cameraId/health
  ↓
Displays accurate status
```

## Files Modified

1. **server/config/cameras.json**
   - Changed `streamUrl` → `videoUrl`
   - Added `healthUrl`

2. **server/index.js**
   - Added `state.cameraHealth` object
   - Added `checkCameraHealth(camera)` function
   - Updated `runCameraInference()` to check health first
   - Added `GET /api/cameras/:cameraId/health` endpoint
   - Updated camera loop to run health checks separately
   - Modified POST endpoints to use videoUrl

3. **client/src/App.js**
   - Updated `renderCameraPanel()` to use backend health status
   - Added health status display with icons
   - Shows vehicle count/density only when CONNECTED
   - Added AI state display (ACTIVE/PAUSED)
   - Added test button on camera card
   - Updated config section to use videoUrl
   - Removed direct health checking from frontend

## Expected Behavior

### Scenario 1: Camera Online

```
1. Backend health check succeeds
2. Frontend displays 🟢 CONNECTED
3. Video stream plays in preview
4. Vehicle count shows actual ONNX count
5. Traffic density shows actual calculation
6. AI shows "ACTIVE"
```

### Scenario 2: Camera Offline

```
1. Backend health check fails 3 times
2. Frontend displays 🔴 DISCONNECTED
3. Preview shows "Camera Disconnected"
4. Vehicle count shows "--"
5. Traffic density shows "UNKNOWN"
6. AI shows "PAUSED"
```

### Scenario 3: Checking/Reconnecting

```
1. Backend health check in progress (first 2 failures)
2. Frontend displays 🟡 CHECKING
3. Preview shows "Camera Checking..."
4. Data from last successful check preserved
5. Once 3 failures reached → DISCONNECTED
```

## Testing Instructions

1. Start server:

   ```bash
   npm install
   node server/index.js
   ```

2. Start frontend:

   ```bash
   cd client
   npm start
   ```

3. Open http://localhost:3000

4. Verify North camera shows CONNECTED (if IP camera is online)

5. Click "🔍 TEST CAMERA" to manually trigger health check

6. Disconnect IP camera (turn off phone or stop server)

7. Verify status changes to CHECKING then DISCONNECTED within 10 seconds

8. Verify vehicle count and density are cleared

9. Verify AI shows "PAUSED"

10. Reconnect camera and verify status returns to CONNECTED

## Known Limitations & Notes

- Frontend cannot directly access IP camera due to CORS restrictions in browser
- Backend acts as proxy for health checks (this is the correct solution)
- Health check timeout is 3 seconds (configurable in code)
- Failure threshold is 3 consecutive failures before marking DISCONNECTED
- Video stream may display even if health check fails (browser caches/streams differently)
- Health check frequency: every 3 seconds
- Inference frequency: every 2.5 seconds (when CONNECTED)
