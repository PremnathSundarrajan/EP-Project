// ================================================
// Smart Traffic Management System — ESP32 Sketch
// Emergency Vehicle Priority Control
//
// HARDWARE (current prototype):
//   NORTH GREEN → GPIO 23
//   NORTH RED   → GPIO 22
//   SOUTH GREEN → GPIO 21
//   SOUTH RED   → GPIO 19
//
// Only NORTH and SOUTH directions are wired.
// EAST and WEST commands are safely ignored
// (all red applied as safe default).
//
// Commands from Node.js backend (full strings via USB Serial):
//   NORTH_GREEN      → North green, South red
//   SOUTH_GREEN      → South green, North red
//   EAST_GREEN       → All red (no hardware, safe default)
//   WEST_GREEN       → All red (no hardware, safe default)
//   EMERGENCY_NORTH  → North green (emergency priority)
//   EMERGENCY_SOUTH  → South green (emergency priority)
//   EMERGENCY_EAST   → All red (no hardware, safe default)
//   EMERGENCY_WEST   → All red (no hardware, safe default)
//   YELLOW           → Flash yellow (simulated: both reds ON briefly)
//   ALL_RED          → All red (clearance phase)
//   NORMAL_MODE      → All red + return to normal (backend decides next signal)
//
// ACK format sent back to backend:
//   ACK:COMMAND
//   Example: ACK:EMERGENCY_NORTH
// ================================================

// ─── Pin Definitions ─────────────────────────────
#define NORTH_GREEN 23
#define NORTH_RED   22
#define SOUTH_GREEN 21
#define SOUTH_RED   19

// ─── Signal Functions ─────────────────────────────

void allRed() {
  digitalWrite(NORTH_GREEN, LOW);
  digitalWrite(NORTH_RED,   HIGH);
  digitalWrite(SOUTH_GREEN, LOW);
  digitalWrite(SOUTH_RED,   HIGH);
}

void northGreen() {
  digitalWrite(NORTH_GREEN, HIGH);
  digitalWrite(NORTH_RED,   LOW);
  digitalWrite(SOUTH_GREEN, LOW);
  digitalWrite(SOUTH_RED,   HIGH);
}

void southGreen() {
  digitalWrite(NORTH_GREEN, LOW);
  digitalWrite(NORTH_RED,   HIGH);
  digitalWrite(SOUTH_GREEN, HIGH);
  digitalWrite(SOUTH_RED,   LOW);
}

// Yellow simulation: flash both red LEDs on (no yellow LED in prototype)
void yellowFlash() {
  digitalWrite(NORTH_GREEN, LOW);
  digitalWrite(SOUTH_GREEN, LOW);
  digitalWrite(NORTH_RED,   HIGH);
  digitalWrite(SOUTH_RED,   HIGH);
}

// ─── Command Processor ────────────────────────────
void processCommand(String cmd) {
  cmd.trim();

  if (cmd == "NORTH_GREEN" || cmd == "EMERGENCY_NORTH") {
    northGreen();
    Serial.println("ACK:" + cmd);
  }
  else if (cmd == "SOUTH_GREEN" || cmd == "EMERGENCY_SOUTH") {
    southGreen();
    Serial.println("ACK:" + cmd);
  }
  else if (cmd == "EAST_GREEN" || cmd == "WEST_GREEN" ||
           cmd == "EMERGENCY_EAST" || cmd == "EMERGENCY_WEST") {
    // No East/West hardware in prototype — safe default
    allRed();
    Serial.println("ACK:" + cmd + ":NO_HW_ALLRED");
  }
  else if (cmd == "YELLOW") {
    yellowFlash();
    Serial.println("ACK:YELLOW");
  }
  else if (cmd == "ALL_RED") {
    allRed();
    Serial.println("ACK:ALL_RED");
  }
  else if (cmd == "NORMAL_MODE") {
    allRed();   // Backend will send the correct direction next
    Serial.println("ACK:NORMAL_MODE");
  }
  else {
    // Unknown command — go safe
    allRed();
    Serial.println("ERR:UNKNOWN:" + cmd);
  }
}

// ─── Setup ───────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.setTimeout(100);

  pinMode(NORTH_GREEN, OUTPUT);
  pinMode(NORTH_RED,   OUTPUT);
  pinMode(SOUTH_GREEN, OUTPUT);
  pinMode(SOUTH_RED,   OUTPUT);

  // Safe default on boot
  allRed();

  Serial.println("================================");
  Serial.println(" SMART TRAFFIC MANAGEMENT SYSTEM");
  Serial.println("================================");
  Serial.println("ESP32_READY");
  Serial.println("TRAFFIC_CONTROLLER_V1.0");
  Serial.println("Wired: NORTH(23,22) SOUTH(21,19)");
  Serial.println("================================");
}

// ─── Main Loop ───────────────────────────────────
void loop() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.length() > 0) {
      processCommand(command);
    }
  }

  delay(10);
}
