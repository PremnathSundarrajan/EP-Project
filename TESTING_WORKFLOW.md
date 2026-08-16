# 🔍 Complete System Workflow & Testing Guide

## 📊 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SMART TRAFFIC SYSTEM                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│  IP WEBCAM (North)   │
│  10.245.55.176:8080  │
└──────────────────────┘
         │
         ├─ /video (MJPEG stream)
         └─ / (health check)
                │
    ┌───────────┴────────────┐
    │                        │
┌───▼──────────────────┐    │
│  BACKEND (Node.js)   │    │
│  localhost:5000      │    │
├──────────────────────┤    │
│ • Health Check (3s)  │    │
│ • Frame Capture      │    │
│ • ONNX Inference     │    │
│ • Signal Control     │    │
│ • GPS Tracking       │    │
│ • ESP32 Serial       │    │
└──────────────────────┘    │
         │                  │
    WebSocket              Video Display
    (State Updates)             │
         │                      │
         └──────┬───────────────┘
                │
        ┌───────▼──────────────┐
        │  FRONTEND (React)     │
        │  localhost:3000       │
        ├──────────────────────┤
        │ • Dashboard Display  │
        │ • Camera Status      │
        │ • Traffic Density    │
        │ • Signal State       │
        │ • Emergency Control  │
        │ • GPS Location       │
        └──────────────────────┘
                │
    ┌───────────┴─────────────┐
    │                         │
┌───▼────────┐         ┌──────▼──────┐
│   Browser  │         │   ESP32      │
│ (Display)  │         │  (Signals)   │
└────────────┘         └──────────────┘
```

---

## 🔄 Data Flow Diagram

### **1. Camera Health Check Loop (Every 3 seconds)**

```
Backend Timer
     │
     ▼
GET /api/cameras/:cameraId/health
     │
     ├─ Send to: http://10.245.55.176:8080/
     │
     ├─ Timeout: 3 seconds
     │
     ▼
Success? ✓ or ✗
     │
     ├─ ✓ → cameraHealth.status = "CONNECTED"
     │        failureCount = 0
     │
     └─ ✗ → failureCount++
           If failureCount > 3 → "DISCONNECTED"
           Else → "CHECKING"
     │
     ▼
Broadcast to Frontend (WebSocket)
```

### **2. Frame Capture & ONNX Inference (Every 2.5 seconds)**

```
Is cameraHealth.status = "CONNECTED"?
     │
     ├─ NO → Skip inference, clear data
     │       vehicleCount = 0
     │       density = "UNKNOWN"
     │
     └─ YES
          │
          ▼
     Fetch Frame from /shot.jpg
          │
          ├─ Success? ✓ or ✗
          │   ✗ → status = "CHECKING", skip inference
          │
          └─ ✓
               │
               ▼
          Process with best.onnx model
               │
               ├─ Input: 640×640 RGB frame
               │ ├─ Normalize pixels (0-1)
               │ └─ Resize to ONNX input size
               │
               ▼
          Run Inference
               │
               ▼
          Parse Output
               │
               ├─ Count vehicles > 0.25 confidence
               │
               ▼
          Calculate Traffic Density
               │
               ├─ < 8 vehicles   → "LOW"
               ├─ 8-15 vehicles  → "MEDIUM"
               └─ > 16 vehicles  → "HIGH"
               │
               ▼
          Update State
               │
               ├─ trafficData[NORTH].vehicleCount = detected count
               ├─ trafficData[NORTH].density = calculated density
               ├─ trafficData[NORTH].status = "CONNECTED"
               │
               ▼
          Broadcast to Frontend
```

### **3. Frontend Display (Real-time via WebSocket)**

```
WebSocket Message Received
     │
     ▼
Parse cameraHealth[CAM_NORTH]
     │
     ├─ status = "CONNECTED"?
     │
     ├─ YES → Render:
     │        ✅ 🟢 CONNECTED
     │        ✅ Video stream
     │        ✅ Vehicle count: 12
     │        ✅ Density: MEDIUM
     │        ✅ AI: ACTIVE
     │
     └─ NO → Render:
            ✅ 🔴 DISCONNECTED
            ✅ No video
            ✅ Vehicle count: --
            ✅ Density: UNKNOWN
            ✅ AI: PAUSED
```

---

## ✅ Step-by-Step Testing Workflow

### **PHASE 1: System Startup & Initialization**

#### Step 1: Start Backend

```powershell
cd e:\EP - project
npm install
npm run server
```

**Expected Output:**

```
[EVENT] Smart Traffic Management System starting...
[EVENT] Loading best.onnx model...
[EVENT] best.onnx model loaded successfully
[EVENT] Connecting to ESP32 on COM3 @ 115200
[EVENT] Server running on port 5000
Smart Traffic API on port 5000
```

✅ **Check Points:**

- No errors in console
- Port 5000 is listening
- ONNX model loaded
- ESP32 attempting connection (may fail if not connected, that's OK)

---

#### Step 2: Start Frontend

```powershell
# In a new terminal
cd e:\EP - project\client
npm install
npm start
```

**Expected Output:**

```
webpack compiled successfully
You can now view traffic-priority-client in the browser.
  Local:            http://localhost:3000
  On Your Network:  http://192.168.x.x:3000

Compiled successfully!
```

✅ **Check Points:**

- Frontend compiles without errors
- Browser opens to http://localhost:3000

---

### **PHASE 2: WebSocket Connection Check**

#### Step 3: Verify Frontend Connected to Backend

**In Browser:**

1. Open http://localhost:3000
2. Press `F12` to open Developer Tools
3. Go to **Console** tab
4. You should see **NO errors**

**Check WebSocket:**

1. Go to **Network** tab in DevTools
2. Filter by **WS** (WebSocket)
3. You should see a connection to `ws://localhost:5000`
4. Status: **101 Web Socket Protocol Handshake** (green)

✅ **Expected:**

- One WebSocket connection showing "Connected"
- No connection errors

---

### **PHASE 3: Camera Health Check Verification**

#### Step 4: Check North Camera Health

**Method A: Frontend Dashboard**

1. Look at **NORTH CAMERA** card
2. You should see:
   - Camera ID: `CAM_NORTH`
   - Status: **🟢 CONNECTED** or **🔴 DISCONNECTED**

**Method B: Backend API (Direct)**

```powershell
# In PowerShell
curl http://localhost:5000/api/cameras/CAM_NORTH/health | ConvertFrom-Json | Format-Table
```

**Expected Response:**

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

✅ **If Status = CONNECTED:**

- ✅ Camera health check passed
- ✅ Backend can reach camera IP
- ✅ Ready for video streaming

⚠️ **If Status = DISCONNECTED:**

- ⚠️ Backend cannot reach camera
- Check: Is camera IP correct? (configured in `.env`)
- Check: Is camera server running?
- Check: Is network connection active?

---

#### Step 5: Test Camera Manually

**In Browser:**

1. On NORTH CAMERA card, click **🔍 TEST CAMERA** button
2. Wait 3-5 seconds
3. Status should update

**Expected:**

- Status refreshes
- Shows current health check result

---

### **PHASE 4: Video Stream & Frame Capture**

#### Step 6: Verify Video Display

**In Browser Dashboard:**

1. Look at **NORTH CAMERA** video preview area
2. If **Status = CONNECTED**:
   - You should see **live video** from camera
   - Video updates smoothly

**If video doesn't play but status = CONNECTED:**

- This is **normal** in some cases (CORS)
- Backend health check is the authority
- Video may load in a direct `<img>` tag but not in all browsers

---

#### Step 7: Verify Frame Capture

**In Backend Console:**
Look for these logs (appears every 2.5 seconds):

```
[EVENT] [CAM_NORTH] inference: 12 vehicles (MEDIUM)
[EVENT] [CAM_NORTH] inference: 14 vehicles (HIGH)
```

✅ **Expected:**

- Logs appear regularly
- Vehicle counts change (should not be static)
- Density changes (LOW → MEDIUM → HIGH)

⚠️ **If no inference logs:**

- Camera health check may be failing
- Check backend console for health check errors

---

### **PHASE 5: ONNX Inference Verification**

#### Step 8: Check Vehicle Detection

**In Frontend Dashboard:**

- **NORTH CAMERA** card shows:
  - **Vehicle Count:** 8-20 (should not be "--")
  - **Traffic Density:** LOW, MEDIUM, or HIGH
  - **AI:** ACTIVE

**Expected Values by Time:**

```
Morning (8 AM):    Vehicle Count: 15-20, Density: HIGH
Afternoon (2 PM): Vehicle Count: 10-15, Density: MEDIUM
Night (10 PM):     Vehicle Count: 2-5, Density: LOW
```

✅ **If values are showing:**

- ✅ ONNX model is running
- ✅ Frame capture is working
- ✅ Inference is executing
- ✅ Results are being broadcast

⚠️ **If showing "--" or "UNKNOWN":**

- Check if camera is actually CONNECTED
- Check if frames are being captured
- Check backend logs for ONNX errors

---

### **PHASE 6: Signal Control Verification**

#### Step 9: Check Traffic Signal State

**In Frontend Dashboard:**

- **TRAFFIC SIGNALS** section shows 4 boxes:
  - NORTH: GREEN / RED / YELLOW
  - SOUTH: GREEN / RED / YELLOW
  - EAST: GREEN / RED / YELLOW
  - WEST: GREEN / RED / YELLOW

**Expected Behavior (Normal Mode):**

1. One direction shows **GREEN** (highest vehicle count)
2. Other three show **RED**
3. Updates every 2-3 seconds based on traffic density

**Test Signal Change:**

1. Observe which direction currently has GREEN
2. Wait 10 seconds
3. GREEN should switch to direction with most vehicles

✅ **Expected:**

- Signals update based on vehicle counts
- Only one GREEN at a time (except transitions)

---

#### Step 10: Test Signal Manually

**In Frontend - Manual Control Tab:**

1. Click **Manual Tab**
2. Select a direction
3. Click **[TEST SIGNAL]** button

**Expected:**

- Selected direction turns GREEN
- Others turn RED
- Signal state updates in dashboard

---

### **PHASE 7: Emergency Mode Testing**

#### Step 11: Start Emergency Trip

**In Frontend:**

1. Go to **PRETRIP** screen (should be default)
2. Select destination from dropdown
3. Click **[START EMERGENCY]**

**Expected Output:**

```
🚑 EMERGENCY VEHICLE
Emergency mode ACTIVATED
Vehicle status: ACTIVE
GPS status: WAITING
Distance to hospital: --km
ETA: calculating...
```

✅ **Check Points:**

- Emergency mode activates
- GPS starts waiting for location
- Screen changes to DASHBOARD
- Event log shows emergency start

---

#### Step 12: Provide GPS Location

**Browser Permission:**

- Browser asks for location access
- Click "Allow"

**Expected:**

- GPS status changes to **LIVE**
- Location coordinates appear
- Speed shows (if available)
- ETA calculates

---

#### Step 13: Verify Signal Priority

**Observe Signal Behavior:**

1. As you move toward intersection
2. Signals enter **PREPARE** zone (500m away)
3. Signals enter **ACTIVE** zone (300m away)
4. Your direction turns GREEN automatically
5. Console shows: `Emergency priority ACTIVE: NORTH → GREEN`

✅ **Expected Signal Sequence:**

```
When far away (> 500m):
  NORTH: RED, SOUTH: RED (normal traffic)

When in PREPARE zone (500m - 300m):
  Status: PREPARING
  Signals: Still based on traffic

When in ACTIVE zone (< 300m):
  Status: ACTIVE
  NORTH: 1.5s YELLOW
  NORTH: 1s ALL RED (clearance)
  NORTH: GREEN (emergency active)
  SOUTH/EAST/WEST: RED
```

---

#### Step 14: Stop Emergency

**In Frontend:**

1. Click **[STOP EMERGENCY]** button
2. Observe changes

**Expected:**

- Emergency mode deactivates
- GPS turns OFF
- Signals return to normal traffic mode
- Event log: `Emergency mode DEACTIVATED`

---

### **PHASE 8: ESP32 Serial Communication (if available)**

#### Step 15: Check ESP32 Connection

**In Frontend Dashboard:**

- Look for **ESP32 STATUS** section
- Should show:
  - Port: COM3 (or configured port)
  - Baud Rate: 115200
  - Status: **CONNECTED** or **DISCONNECTED**

**In Backend Console:**

```
[EVENT] Connecting to ESP32 on COM3 @ 115200
[EVENT] ESP32 connected on COM3
```

✅ **If CONNECTED:**

- ✅ USB serial cable working
- ✅ ESP32 powered on and running
- ✅ Ready to receive signal commands

⚠️ **If DISCONNECTED:**

- ⚠️ USB cable not connected
- Check COM port (might be COM4, COM5, etc.)
- Update `.env` with correct port

---

#### Step 16: Test ESP32 Commands

**In Console:**

```
[EVENT] Sent to ESP32: NORTH_GREEN
[EVENT] ESP32 response: ACK_NORTH_GREEN
```

**Physical Verification:**

- Signal lights on ESP32 should change
- Relay module should click

---

### **PHASE 9: Event Log Verification**

#### Step 17: Check System Events

**In Frontend:**

1. Go to **LOG** tab
2. Scroll through event history

**Should see events like:**

```
10:30:45 - Server running on port 5000
10:30:46 - best.onnx model loaded successfully
10:30:47 - [CAM_NORTH] inference: 12 vehicles (MEDIUM)
10:30:49 - Normal mode: NORTH has most traffic (12 vehicles) → NORTH_GREEN
10:30:50 - [CAM_SOUTH] inference: 5 vehicles (LOW)
10:30:52 - [CAM_NORTH] inference: 14 vehicles (HIGH)
10:30:54 - Normal mode: NORTH has most traffic (14 vehicles) → NORTH_GREEN
```

✅ **Expected Pattern:**

- Regular inference updates
- Signal decisions based on traffic
- No error messages

---

## 📋 Complete Checklist

| Phase | Component           | Test                              | Status |
| ----- | ------------------- | --------------------------------- | ------ |
| **1** | Backend             | Server starts on port 5000        | ✅     |
| **1** | ONNX Model          | Loads successfully                | ✅     |
| **2** | Frontend            | Compiles and opens                | ✅     |
| **2** | WebSocket           | Connects to backend               | ✅     |
| **3** | North Camera Health | Returns CONNECTED or DISCONNECTED | ✅     |
| **4** | South Camera Health | Returns CONNECTED or DISCONNECTED | ✅     |
| **5** | Frame Capture       | Logs show inference results       | ✅     |
| **5** | ONNX Inference      | Vehicle counts appearing          | ✅     |
| **6** | Signal Control      | Signals update based on traffic   | ✅     |
| **6** | Manual Signal Test  | Can manually control signals      | ✅     |
| **7** | Emergency Start     | Can start emergency trip          | ✅     |
| **7** | GPS Tracking        | Location updates                  | ✅     |
| **7** | Signal Priority     | Emergency direction turns GREEN   | ✅     |
| **8** | ESP32 Status        | Shows connection state            | ✅     |
| **8** | ESP32 Commands      | Receives and responds             | ✅     |
| **9** | Event Log           | Shows system events               | ✅     |

---

## 🐛 Troubleshooting Guide

### Problem: Camera shows DISCONNECTED

**Cause 1: Camera IP incorrect**

```powershell
# Check .env file
cat .env | Select-String CAM_NORTH_URL
```

**Fix:** Update IP address in `.env` or `cameras.json`

**Cause 2: Camera server not running**

```powershell
# Test if camera is reachable
curl http://10.245.55.176:8080/
```

**Fix:** Start camera app on phone, check IP/port

**Cause 3: Network not connected**

```powershell
# Ping camera
ping 10.245.55.176
```

**Fix:** Check WiFi connection

---

### Problem: No vehicle count showing

**Check:**

1. Camera status is CONNECTED
2. Backend logs show inference results
3. ONNX model loaded successfully

**Debug:**

```powershell
# Check backend logs
tail -f server.log | Select-String "inference"
```

---

### Problem: WebSocket not connecting

**Check:**

```powershell
# Verify backend is running
curl http://localhost:5000/api/health
```

**Fix:**

1. Restart backend
2. Check port 5000 not in use
3. Check firewall settings

---

### Problem: Signals not changing

**Check:**

1. Vehicle counts are updating
2. Traffic density is calculating
3. Signal state is NORMAL (not EMERGENCY)

**Debug:**

```powershell
# Check signal state
curl http://localhost:5000/api/state | ConvertFrom-Json | Select -ExpandProperty signalState
```

---

## 🔍 Quick Verification Commands

```powershell
# 1. Check backend health
curl http://localhost:5000/api/health

# 2. Get current state
curl http://localhost:5000/api/state | ConvertFrom-Json

# 3. Check camera health
curl http://localhost:5000/api/cameras/CAM_NORTH/health | ConvertFrom-Json

# 4. Get camera list
curl http://localhost:5000/api/cameras | ConvertFrom-Json

# 5. Check if port 5000 is listening
Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue
```

---

## 📊 Expected System Response Times

| Operation            | Time   | Notes                        |
| -------------------- | ------ | ---------------------------- |
| Health Check         | 3s     | Backend checks camera health |
| Frame Capture        | 1-2s   | Download frame from camera   |
| ONNX Inference       | 1-2s   | Run model on frame           |
| Frontend Update      | <100ms | WebSocket broadcast          |
| Signal Change        | 3-4s   | After traffic detection      |
| GPS Update           | 5-10s  | Depends on device            |
| Emergency Transition | 3.5s   | YELLOW → RED → GREEN         |

---

## ✨ Final Verification

**All Working = GREEN SCREEN** ✅

You should see:

```
┌─────────────────────────────────┐
│  🟢 CONNECTED                   │
│                                 │
│  North Camera:    12 vehicles   │
│  Density:         MEDIUM        │
│  Signal:          NORTH GREEN   │
│                                 │
│  South Camera:    5 vehicles    │
│  Density:         LOW           │
│  Signal:          SOUTH RED     │
│                                 │
│  GPS:             OFFLINE       │
│  Emergency:       STANDBY       │
│                                 │
│  AI:              ACTIVE        │
│  System:          READY         │
└─────────────────────────────────┘
```

**All Checks Complete = PRODUCTION READY** ✅
