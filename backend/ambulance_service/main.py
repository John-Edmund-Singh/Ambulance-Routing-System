from math import dist

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI(title="Ambulance Service")


class Position(BaseModel):
    x: float
    y: float


class Ambulance(BaseModel):
    id: int
    x: float
    y: float
    status: str = "available"
    target_x: float | None = None
    target_y: float | None = None


class AssignTargetRequest(BaseModel):
    ambulance_id: int
    target: Position
    status: str = "dispatched"


class StatusUpdateRequest(BaseModel):
    ambulance_id: int
    status: str


class TrafficZone(BaseModel):
    id: int
    name: str
    x: float
    y: float
    radius: float
    speed_multiplier: float


INITIAL_AMBULANCES: list[Ambulance] = [
    Ambulance(id=1, x=2, y=2),
    Ambulance(id=2, x=8, y=3),
    Ambulance(id=3, x=5, y=8),
]
AMBULANCES: list[Ambulance] = [a.model_copy(deep=True) for a in INITIAL_AMBULANCES]
TRAFFIC_ZONES: list[TrafficZone] = [
    TrafficZone(id=1, name="City Center Congestion", x=4.8, y=5.2, radius=1.6, speed_multiplier=0.45),
    TrafficZone(id=2, name="Railway Crossing Delay", x=7.4, y=3.8, radius=1.2, speed_multiplier=0.6),
]


def _find_ambulance(ambulance_id: int) -> Ambulance:
    for ambulance in AMBULANCES:
        if ambulance.id == ambulance_id:
            return ambulance
    raise HTTPException(status_code=404, detail="Ambulance not found")


@app.get("/ambulances", response_model=list[Ambulance])
def list_ambulances() -> list[Ambulance]:
    return AMBULANCES


@app.get("/ambulances/nearest", response_model=Ambulance)
def nearest_available_ambulance(x: float, y: float) -> Ambulance:
    available = [a for a in AMBULANCES if a.status == "available"]
    if not available:
        raise HTTPException(status_code=404, detail="No available ambulances")
    return min(available, key=lambda a: dist((a.x, a.y), (x, y)))


@app.post("/ambulances/assign-target", response_model=Ambulance)
def assign_target(payload: AssignTargetRequest) -> Ambulance:
    ambulance = _find_ambulance(payload.ambulance_id)
    ambulance.target_x = payload.target.x
    ambulance.target_y = payload.target.y
    ambulance.status = payload.status
    return ambulance


@app.post("/ambulances/status", response_model=Ambulance)
def update_status(payload: StatusUpdateRequest) -> Ambulance:
    ambulance = _find_ambulance(payload.ambulance_id)
    ambulance.status = payload.status
    return ambulance


@app.post("/simulate-step", response_model=list[Ambulance])
def simulate_step(step_size: float = 0.8) -> list[Ambulance]:
    for ambulance in AMBULANCES:
        if ambulance.target_x is None or ambulance.target_y is None:
            continue
        traffic_factor = _traffic_multiplier(ambulance.x, ambulance.y)
        effective_step = step_size * traffic_factor
        dx = ambulance.target_x - ambulance.x
        dy = ambulance.target_y - ambulance.y
        d = dist((ambulance.x, ambulance.y), (ambulance.target_x, ambulance.target_y))
        if d <= effective_step:
            ambulance.x = ambulance.target_x
            ambulance.y = ambulance.target_y
            ambulance.target_x = None
            ambulance.target_y = None
            ambulance.status = "available"
            continue
        ambulance.x += (dx / d) * effective_step
        ambulance.y += (dy / d) * effective_step
    return AMBULANCES


@app.get("/traffic-zones", response_model=list[TrafficZone])
def list_traffic_zones() -> list[TrafficZone]:
    return TRAFFIC_ZONES


@app.post("/ambulances/reset", response_model=list[Ambulance])
def reset_ambulances() -> list[Ambulance]:
    AMBULANCES.clear()
    AMBULANCES.extend(a.model_copy(deep=True) for a in INITIAL_AMBULANCES)
    return AMBULANCES


def _traffic_multiplier(x: float, y: float) -> float:
    multiplier = 1.0
    for zone in TRAFFIC_ZONES:
        if dist((x, y), (zone.x, zone.y)) <= zone.radius:
            multiplier = min(multiplier, zone.speed_multiplier)
    return multiplier

