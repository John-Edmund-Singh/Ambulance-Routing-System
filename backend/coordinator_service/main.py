import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


AMBULANCE_SERVICE_URL = os.getenv("AMBULANCE_SERVICE_URL", "http://127.0.0.1:8001")
HOSPITAL_SERVICE_URL = os.getenv("HOSPITAL_SERVICE_URL", "http://127.0.0.1:8002")


app = FastAPI(title="Coordinator Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Position(BaseModel):
    x: float
    y: float


class AmbulanceRequest(BaseModel):
    emergency_x: float
    emergency_y: float
    idempotency_key: str | None = None


MISSIONS: dict[int, dict] = {}
IDEMPOTENCY_STORE: dict[str, dict] = {}


@app.get("/state")
async def full_state() -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        ambulances_resp = await client.get(f"{AMBULANCE_SERVICE_URL}/ambulances")
        hospitals_resp = await client.get(f"{HOSPITAL_SERVICE_URL}/hospitals")
        traffic_resp = await client.get(f"{AMBULANCE_SERVICE_URL}/traffic-zones")
    return {
        "ambulances": ambulances_resp.json(),
        "hospitals": hospitals_resp.json(),
        "traffic_zones": traffic_resp.json(),
        "missions": list(MISSIONS.values()),
    }


@app.post("/request")
async def request_ambulance(payload: AmbulanceRequest) -> dict:
    if payload.idempotency_key:
        cached = IDEMPOTENCY_STORE.get(payload.idempotency_key)
        if cached:
            if (
                cached["request"]["emergency_x"] != payload.emergency_x
                or cached["request"]["emergency_y"] != payload.emergency_y
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Same idempotency key used with different request payload",
                )
            replayed = dict(cached["response"])
            replayed["idempotency_replayed"] = True
            replayed["idempotency_key"] = payload.idempotency_key
            return replayed

    emergency = Position(x=payload.emergency_x, y=payload.emergency_y)
    async with httpx.AsyncClient(timeout=5.0) as client:
        ambulance_resp = await client.get(
            f"{AMBULANCE_SERVICE_URL}/ambulances/nearest",
            params={"x": emergency.x, "y": emergency.y},
        )
        if ambulance_resp.status_code != 200:
            raise HTTPException(status_code=404, detail="No ambulance available")
        ambulance = ambulance_resp.json()

        hospital_resp = await client.get(
            f"{HOSPITAL_SERVICE_URL}/hospitals/nearest-available",
            params={"x": emergency.x, "y": emergency.y},
        )
        if hospital_resp.status_code != 200:
            raise HTTPException(status_code=404, detail="No hospital bed available")
        hospital = hospital_resp.json()

        await client.post(
            f"{AMBULANCE_SERVICE_URL}/ambulances/assign-target",
            json={
                "ambulance_id": ambulance["id"],
                "target": {"x": emergency.x, "y": emergency.y},
                "status": "en_route_to_patient",
            },
        )

        await client.post(
            f"{HOSPITAL_SERVICE_URL}/hospitals/update-beds",
            json={"hospital_id": hospital["id"], "delta": -1},
        )

    MISSIONS[ambulance["id"]] = {
        "ambulance_id": ambulance["id"],
        "stage": "to_patient",
        "emergency": emergency.model_dump(),
        "hospital": {
            "id": hospital["id"],
            "name": hospital["name"],
            "x": hospital["x"],
            "y": hospital["y"],
        },
    }

    response_payload = {
        "message": "Ambulance dispatched",
        "ambulance_id": ambulance["id"],
        "patient_location": emergency.model_dump(),
        "assigned_hospital": hospital,
        "idempotency_replayed": False,
        "idempotency_key": payload.idempotency_key,
    }
    if payload.idempotency_key:
        IDEMPOTENCY_STORE[payload.idempotency_key] = {
            "request": {
                "emergency_x": payload.emergency_x,
                "emergency_y": payload.emergency_y,
            },
            "response": dict(response_payload),
        }
    return response_payload


@app.post("/simulate")
async def simulate(step_size: float = 0.8) -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            f"{AMBULANCE_SERVICE_URL}/simulate-step",
            params={"step_size": step_size},
        )
        ambulances = response.json()

        for ambulance in ambulances:
            mission = MISSIONS.get(ambulance["id"])
            if not mission:
                continue

            if mission["stage"] == "to_patient" and ambulance["status"] == "available":
                hospital = mission["hospital"]
                await client.post(
                    f"{AMBULANCE_SERVICE_URL}/ambulances/assign-target",
                    json={
                        "ambulance_id": ambulance["id"],
                        "target": {"x": hospital["x"], "y": hospital["y"]},
                        "status": "to_hospital",
                    },
                )
                mission["stage"] = "to_hospital"
            elif mission["stage"] == "to_hospital" and ambulance["status"] == "available":
                mission["stage"] = "completed"

        for ambulance_id, mission in list(MISSIONS.items()):
            if mission["stage"] == "completed":
                MISSIONS.pop(ambulance_id, None)

        refreshed = await client.get(f"{AMBULANCE_SERVICE_URL}/ambulances")
    return {"ambulances": refreshed.json(), "missions": list(MISSIONS.values())}


@app.post("/reset-demo")
async def reset_demo() -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        ambulances_resp = await client.post(f"{AMBULANCE_SERVICE_URL}/ambulances/reset")
        hospitals_resp = await client.post(f"{HOSPITAL_SERVICE_URL}/hospitals/reset")
    MISSIONS.clear()
    IDEMPOTENCY_STORE.clear()
    return {
        "message": "Demo state reset",
        "ambulances": ambulances_resp.json(),
        "hospitals": hospitals_resp.json(),
    }


