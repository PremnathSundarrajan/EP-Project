String inputCommand = "";

const int northRed = 2;
const int northYellow = 3;
const int northGreen = 4;

const int southRed = 5;
const int southYellow = 6;
const int southGreen = 7;

const int eastRed = 8;
const int eastYellow = 9;
const int eastGreen = 10;

const int westRed = 11;
const int westYellow = 12;
const int westGreen = 13;

void setAllRed()
{
    digitalWrite(northRed, HIGH);
    digitalWrite(southRed, HIGH);
    digitalWrite(eastRed, HIGH);
    digitalWrite(westRed, HIGH);

    digitalWrite(northYellow, LOW);
    digitalWrite(southYellow, LOW);
    digitalWrite(eastYellow, LOW);
    digitalWrite(westYellow, LOW);

    digitalWrite(northGreen, LOW);
    digitalWrite(southGreen, LOW);
    digitalWrite(eastGreen, LOW);
    digitalWrite(westGreen, LOW);
}

void allLightsOff()
{
    digitalWrite(northRed, LOW);
    digitalWrite(northYellow, LOW);
    digitalWrite(northGreen, LOW);

    digitalWrite(southRed, LOW);
    digitalWrite(southYellow, LOW);
    digitalWrite(southGreen, LOW);

    digitalWrite(eastRed, LOW);
    digitalWrite(eastYellow, LOW);
    digitalWrite(eastGreen, LOW);

    digitalWrite(westRed, LOW);
    digitalWrite(westYellow, LOW);
    digitalWrite(westGreen, LOW);
}

void setDirectionGreen(String direction)
{
    setAllRed();

    if (direction == "NORTH")
    {
        digitalWrite(northGreen, HIGH);
        digitalWrite(northRed, LOW);
    }
    else if (direction == "SOUTH")
    {
        digitalWrite(southGreen, HIGH);
        digitalWrite(southRed, LOW);
    }
    else if (direction == "EAST")
    {
        digitalWrite(eastGreen, HIGH);
        digitalWrite(eastRed, LOW);
    }
    else if (direction == "WEST")
    {
        digitalWrite(westGreen, HIGH);
        digitalWrite(westRed, LOW);
    }
}

void setEmergencyDirection(String direction)
{
    setAllRed();
    if (direction == "NORTH")
    {
        digitalWrite(northGreen, HIGH);
        digitalWrite(northRed, LOW);
    }
    else if (direction == "SOUTH")
    {
        digitalWrite(southGreen, HIGH);
        digitalWrite(southRed, LOW);
    }
    else if (direction == "EAST")
    {
        digitalWrite(eastGreen, HIGH);
        digitalWrite(eastRed, LOW);
    }
    else if (direction == "WEST")
    {
        digitalWrite(westGreen, HIGH);
        digitalWrite(westRed, LOW);
    }
}

void handleCommand(String command)
{
    command.trim();
    command.replace("\r", "");
    command.replace("\n", "");

    Serial.print("ACK:");
    Serial.println(command);

    if (command == "NORMAL_MODE")
    {
        setAllRed();
        digitalWrite(northGreen, HIGH);
        digitalWrite(northRed, LOW);
        return;
    }

    if (command == "NORTH_GREEN")
    {
        setDirectionGreen("NORTH");
        return;
    }

    if (command == "SOUTH_GREEN")
    {
        setDirectionGreen("SOUTH");
        return;
    }

    if (command == "EAST_GREEN")
    {
        setDirectionGreen("EAST");
        return;
    }

    if (command == "WEST_GREEN")
    {
        setDirectionGreen("WEST");
        return;
    }

    if (command == "EMERGENCY_NORTH")
    {
        setEmergencyDirection("NORTH");
        return;
    }

    if (command == "EMERGENCY_SOUTH")
    {
        setEmergencyDirection("SOUTH");
        return;
    }

    if (command == "EMERGENCY_EAST")
    {
        setEmergencyDirection("EAST");
        return;
    }

    if (command == "EMERGENCY_WEST")
    {
        setEmergencyDirection("WEST");
        return;
    }

    if (command == "YELLOW")
    {
        allLightsOff();
        digitalWrite(northYellow, HIGH);
        digitalWrite(southYellow, HIGH);
        digitalWrite(eastYellow, HIGH);
        digitalWrite(westYellow, HIGH);
        return;
    }

    if (command == "ALL_RED")
    {
        setAllRed();
        return;
    }
}

void setup()
{
    Serial.begin(115200);

    pinMode(northRed, OUTPUT);
    pinMode(northYellow, OUTPUT);
    pinMode(northGreen, OUTPUT);

    pinMode(southRed, OUTPUT);
    pinMode(southYellow, OUTPUT);
    pinMode(southGreen, OUTPUT);

    pinMode(eastRed, OUTPUT);
    pinMode(eastYellow, OUTPUT);
    pinMode(eastGreen, OUTPUT);

    pinMode(westRed, OUTPUT);
    pinMode(westYellow, OUTPUT);
    pinMode(westGreen, OUTPUT);

    allLightsOff();
    setAllRed();
    delay(500);
    allLightsOff();
    delay(500);

    Serial.println("ESP32 READY");
}

void loop()
{
    while (Serial.available() > 0)
    {
        char ch = Serial.read();
        if (ch == '\n' || ch == '\r')
        {
            if (inputCommand.length() > 0)
            {
                handleCommand(inputCommand);
                inputCommand = "";
            }
        }
        else
        {
            inputCommand += ch;
        }
    }
}
