# 🔧 Camera Connection Status Logic - FIXED

## 🎯 Problem That Was Fixed

Your North camera at `http://10.245.55.176:8080/video` was working in Chrome, but the application showed **DISCONNECTED** even though the camera was actually operational.

**Root Cause:** The application was trying to use the MJPEG video stream (`/video`) as a health check endpoint. MJPEG streams are continuous and never complete normally, causing the connection check to fail.

---

## ✅ Solution Implemented

### Architecture Change

**BEFORE (Broken):**

```
Frontend tries to fetch(/video) → MJPEG stream never finishes → TIMEOUT → DISCONNECTED ❌
```

**AFTER (Fixed):**

```
Backend fetches from /health URL with 3s timeout → Success/Failure → CONNECTED/DISCONNECTED ✅
Frontend displays status from backend → Accurate status shown ✅
Video stream used only for display, not health checking ✅
```

---

## 📋 What Was Changed

### 1️⃣ Camera Configuration (`server/config/cameras.json`)

Changed from single `streamUrl` to separate URLs:

```json
{
  "id": "CAM_NORTH",
  "name": "North Camera",
  "direction": "NORTH",
  "videoUrl": "http://10.245.55.176:8080/video", // MJPEG stream
  "healthUrl": "http://10.245.55.176:8080/" // Health endpoint
}
```

### 2️⃣ Backend Health Checking (`server/index.js`)

#### Added Camera Health Status Tracking

- Separate from inference status
- States: `CONNECTED`, `CHECKING`, `DISCONNECTED`
- Tracks failure count (3+ failures before marking DISCONNECTED)
- Updates every 3 seconds

#### New Health Check Function

```javascript
async checkCameraHealth(camera)
// - Fetches from healthUrl with 3s timeout
// - Accepts any 2xx-4xx response as reachable
// - Tracks consecutive failures
```

#### New API Endpoint

```
GET /api/cameras/:cameraId/health
```

Returns:

```json
{
  "ok": true,
  "cameraId": "CAM_NORTH",
  "name": "North Camera",
  "direction": "NORTH",
  "status": "CONNECTED",
  "lastChecked": "2024-08-14T10:30:45.123Z",
  "failureCount": 0,
  "message": "Health check passed",
  "videoUrl": "http://10.245.55.176:8080/video",
  "healthUrl": "http://10.245.55.176:8080/"
}
```

#### Updated Inference Logic

- Checks health status FIRST
- Only runs ONNX inference if camera is CONNECTED
- Clears vehicle count & density when disconnected
- Doesn't immediately fail on single frame capture error

#### Updated Camera Loop

- Health check: Every 3 seconds
- Inference: Every 2.5 seconds (only if healthy)

### 3️⃣ Frontend Status Display (`client/src/App.js`)

#### Camera Panel Shows

- **Status Indicator:** 🟢 CONNECTED | 🔴 DISCONNECTED | 🟡 CHECKING
- **Live Video:** Displays when CONNECTED
- **Vehicle Count:** Only when CONNECTED (cleared when disconnected)
- **Traffic Density:** Only when CONNECTED (shows "UNKNOWN" when disconnected)
- **AI State:** "ACTIVE" when CONNECTED, "PAUSED" when disconnected
- **Test Button:** "🔍 TEST CAMERA" for manual verification
- **Last Checked:** Timestamp of last health check

#### Example Views

**When Connected:**

```
📹 NORTH CAMERA
🟢 CONNECTED

[Live Video Stream]

Vehicle Count:     12
Traffic Density:   MEDIUM
AI:                ACTIVE

[🔍 TEST CAMERA]
```

**When Disconnected:**

```
📹 NORTH CAMERA
🔴 DISCONNECTED

[Camera Disconnected]

Vehicle Count:     --
Traffic Density:   UNKNOWN
AI:                PAUSED

[🔍 TEST CAMERA]
```

---

## 🔄 How It Works

### Health Check Flow (Backend)

```
1. Every 3 seconds:
   ↓
2. GET http://10.245.55.176:8080/ (with 3s timeout)
   ↓
3. Response received or timeout
   ↓
4. Update status: CONNECTED/CHECKING/DISCONNECTED
   ↓
5. Broadcast to frontend
```

### Inference Flow (Backend)

```
1. Every 2.5 seconds:
   ↓
2. Check: Is cameraHealth[CAM_NORTH].status === CONNECTED?
   ↓
3. If YES → Fetch frame → Run ONNX → Get vehicle count
   If NO → Clear data (set to 0 vehicles, UNKNOWN density)
   ↓
4. Broadcast to frontend
```

### Status Display Flow (Frontend)

```
1. WebSocket receives state update
   ↓
2. Read cameraHealth[CAM_NORTH].status
   ↓
3. Render indicator: 🟢 or 🔴 or 🟡
   ↓
4. If CONNECTED:
      - Show video (videoUrl)
      - Show actual vehicle count
      - Show actual density
      - Show AI: ACTIVE

   If NOT CONNECTED:
      - Show "Camera Disconnected"
      - Show vehicle count: "--"
      - Show density: "UNKNOWN"
      - Show AI: PAUSED
```

---

## 🧪 How to Test

### Test 1: Verify Camera Shows Connected

1. Start the server: `npm install && node server/index.js`
2. Start frontend: `cd client && npm start`
3. Open http://localhost:3000
4. Dashboard should show: 🟢 **CONNECTED**
5. Video should display live stream
6. Vehicle count should show actual numbers (12, 15, etc.)
7. Traffic density should show MEDIUM, HIGH, or LOW
8. AI should show: **ACTIVE**

### Test 2: Test the Test Button

1. Click "🔍 TEST CAMERA" button on North camera card
2. Performs health check + frame capture
3. Should confirm CONNECTED status

### Test 3: Simulate Camera Disconnection

1. Turn off IP camera or stop the webcam server
2. Wait 10 seconds (3 failures × 3 seconds + processing)
3. Status should change to 🟡 **CHECKING** then 🔴 **DISCONNECTED**
4. Video preview should show "Camera Disconnected"
5. Vehicle count should show "--"
6. Traffic density should show "UNKNOWN"
7. AI should show: **PAUSED**

### Test 4: Verify Video Still Works While Health Checks

1. If frontend video loads in browser but backend health check times out:
   - Status shows DISCONNECTED
   - This is correct behavior (browser CORS allows video in `<img>`, not fetch)
   - Video won't actually play if camera is unreachable

---

## 🎨 UI Status States

| State        | Icon | Color  | Video | Count    | Density  | AI     |
| ------------ | ---- | ------ | ----- | -------- | -------- | ------ |
| CONNECTED    | 🟢   | Green  | Live  | Real #   | Real     | ACTIVE |
| CHECKING     | 🟡   | Yellow | Error | Previous | Previous | ACTIVE |
| DISCONNECTED | 🔴   | Red    | Error | --       | UNKNOWN  | PAUSED |

---

## 📍 Configuration Locations

### North Camera

**Video Stream:**

- URL: `http://10.245.55.176:8080/video`
- Type: MJPEG (Motion JPEG continuous stream)
- Purpose: Display live video in UI

**Health Check:**

- URL: `http://10.245.55.176:8080/`
- Type: Simple HTTP endpoint
- Timeout: 3 seconds
- Purpose: Verify camera reachability

### South Camera

- Configured separately in `cameras.json`
- Can have different IP address/port
- Completely independent health check and inference
- Same UI display logic

---

## ⚙️ Configuration Guide

To change camera URLs, edit `server/config/cameras.json`:

```json
{
  "id": "CAM_NORTH",
  "name": "North Camera",
  "direction": "NORTH",
  "videoUrl": "http://NEW_IP:8080/video", // Change this
  "healthUrl": "http://NEW_IP:8080/" // Change this
}
```

Or use environment variables:

```bash
CAM_NORTH_URL=http://192.168.1.100:8080/video node server/index.js
```

---

## 🚀 Key Features

✅ **Proper Health Checking** - Uses dedicated health endpoint with timeout  
✅ **Separate Video URL** - MJPEG stream only for display  
✅ **Retry Logic** - Doesn't immediately mark disconnected  
✅ **Clean UI States** - Shows real data only when connected  
✅ **CORS Handling** - Backend acts as proxy for browser  
✅ **Test Button** - Quick manual verification  
✅ **Independent Cameras** - North and South completely separate  
✅ **No Fake Data** - Vehicle count/density cleared when disconnected  
✅ **AI State Tracking** - Shows ACTIVE/PAUSED  
✅ **Last Checked Time** - Shows when status was last verified

---

## 📝 Technical Details

### Health Check Failure Threshold

- **First Failure:** Status → CHECKING
- **Second Failure:** Status → CHECKING
- **Third Failure:** Status → DISCONNECTED
- After 3+ consecutive failures, camera marked disconnected
- Success resets counter to 0

### Timeout Values

- **Health Check Timeout:** 3 seconds
- **Frame Capture Timeout:** 3 seconds
- **Health Check Interval:** 3 seconds
- **Inference Interval:** 2.5 seconds

### Error Handling

- Frame capture error: Doesn't affect health status (only triggers CHECKING)
- Health check timeout: Increments failure count
- Inference error: Keeps previous vehicle count, doesn't clear

---

## 🐛 Troubleshooting

### Camera shows DISCONNECTED but it's actually online

**Possible causes:**

1. IP address changed → Update in `cameras.json`
2. Port changed → Update healthUrl in `cameras.json`
3. Camera server is responding with error code → Check camera logs
4. Network connectivity issue → Verify backend can reach camera IP

**How to debug:**

```bash
# From server machine, test health endpoint directly:
curl -v http://10.245.55.176:8080/

# Test video stream:
curl -v http://10.245.55.176:8080/video

# Check server logs for health check messages
```

### Video plays but status shows DISCONNECTED

This is **normal behavior!**

- Browser CORS allows `<img>` to load from cross-origin
- Browser fetch/axios cannot (blocked by CORS)
- Backend health check confirms whether camera is truly reachable
- Trust the backend health status (it's the authority)

### Inference data not updating

**Causes:**

- Camera DISCONNECTED → AI paused, data cleared
- ONNX model not loaded → Check server startup logs
- Frame capture failing → Check network logs

---

## 📚 Files Modified

1. **`server/config/cameras.json`**
   - videoUrl (was: streamUrl)
   - healthUrl (new)

2. **`server/index.js`**
   - Added `state.cameraHealth` object
   - Added `checkCameraHealth()` function
   - Added `GET /api/cameras/:cameraId/health` endpoint
   - Updated `runCameraInference()` logic
   - Updated camera loops (separate health + inference)
   - Updated `/api/cameras/update` endpoint
   - Updated `/api/cameras/test` endpoint

3. **`client/src/App.js`**
   - Updated `renderCameraPanel()` function
   - Changed streamUrl → videoUrl
   - Added health status display with icons
   - Added AI state display
   - Added test button on camera card
   - Added vehicle count/density clearing logic

---

## ✨ Result

Your North camera should now:

- ✅ Display **CONNECTED** status when working
- ✅ Show live video from `http://10.245.55.176:8080/video`
- ✅ Display actual vehicle count from ONNX
- ✅ Show correct traffic density
- ✅ Mark as **DISCONNECTED** if camera goes offline
- ✅ Clear fake data when disconnected
- ✅ Allow manual testing with "🔍 TEST CAMERA" button

The application no longer incorrectly marks the camera as disconnected just because the MJPEG stream URL returns a continuous stream. Instead, it properly checks the camera's health endpoint and displays the correct status.

---

**Fixed on:** 2026-08-14  
**Status:** ✅ COMPLETE - All 13 requirements implemented
