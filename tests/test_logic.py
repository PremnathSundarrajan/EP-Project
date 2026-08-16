from app import compute_route_cost, build_signal_transition, get_signal_priority_action


def test_route_cost_uses_traffic_and_signal_delay():
    route = {
        "distance_km": 6.1,
        "traffic_density": "LOW",
        "estimated_travel_time_min": 11,
        "signal_delay_min": 2,
        "congestion_penalty": 1,
        "intersections": 3,
    }

    cost = compute_route_cost(route)

    assert cost == 11 + 2 + 1 + 2


def test_safe_signal_transition_sequence():
    sequence = build_signal_transition("NORTH")

    assert sequence[0] == "CURRENT_GREEN"
    assert sequence[1] == "YELLOW"
    assert sequence[2] == "ALL_RED"
    assert sequence[3] == "NORTH_GREEN"


def test_priority_action_requires_valid_direction_and_safety_check():
    result = get_signal_priority_action(
        vehicle_heading="NORTH",
        required_direction="NORTH",
        current_signal_state={"NORTH": "RED", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"},
        emergency_mode=True,
        vehicle_valid=True,
        sanity_ok=True,
    )

    assert result["approved"] is True
    assert result["command"] == "NORTH_GREEN"
    assert result["safety_transition"] == [
        "CURRENT_GREEN",
        "YELLOW",
        "ALL_RED",
        "NORTH_GREEN",
    ]
