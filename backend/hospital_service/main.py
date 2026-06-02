from math import dist

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI(title="Hospital Service")


class Hospital(BaseModel):
    id: int
    name: str
    x: float
    y: float
    available_beds: int


class BedUpdateRequest(BaseModel):
    hospital_id: int
    delta: int


INITIAL_HOSPITALS: list[Hospital] = [
    Hospital(id=1, name="City General", x=1, y=1, available_beds=3),
    Hospital(id=2, name="Metro Health", x=9, y=2, available_beds=2),
    Hospital(id=3, name="North Care", x=6, y=9, available_beds=1),
]
HOSPITALS: list[Hospital] = [h.model_copy(deep=True) for h in INITIAL_HOSPITALS]


def _find_hospital(hospital_id: int) -> Hospital:
    for hospital in HOSPITALS:
        if hospital.id == hospital_id:
            return hospital
    raise HTTPException(status_code=404, detail="Hospital not found")


@app.get("/hospitals", response_model=list[Hospital])
def list_hospitals() -> list[Hospital]:
    return HOSPITALS


@app.get("/hospitals/nearest-available", response_model=Hospital)
def nearest_available_hospital(x: float, y: float) -> Hospital:
    available = [h for h in HOSPITALS if h.available_beds > 0]
    if not available:
        raise HTTPException(status_code=404, detail="No hospital beds available")
    return min(available, key=lambda h: dist((h.x, h.y), (x, y)))


@app.post("/hospitals/update-beds", response_model=Hospital)
def update_beds(payload: BedUpdateRequest) -> Hospital:
    hospital = _find_hospital(payload.hospital_id)
    next_count = hospital.available_beds + payload.delta
    if next_count < 0:
        raise HTTPException(status_code=400, detail="Cannot reduce beds below zero")
    hospital.available_beds = next_count
    return hospital


@app.post("/hospitals/reset", response_model=list[Hospital])
def reset_hospitals() -> list[Hospital]:
    HOSPITALS.clear()
    HOSPITALS.extend(h.model_copy(deep=True) for h in INITIAL_HOSPITALS)
    return HOSPITALS

