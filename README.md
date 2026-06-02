# Distributed Ambulance Routing System

Simple full-stack local project with:

- `ambulance_service` (port `8001`)
- `hospital_service` (port `8002`)
- `coordinator_service` (port `8003`)
- React frontend (port `5173`)

## Features

- Store ambulance location (`x`, `y`) and status
- Find nearest available ambulance
- Assign nearest hospital with available beds
- Simulate ambulance movement toward target
- Basic UI to request ambulance and view map state

## Backend Setup

From `backend`:

```bash
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run each service in a separate terminal:

```bash
uvicorn ambulance_service.main:app --reload --port 8001
uvicorn hospital_service.main:app --reload --port 8002
uvicorn coordinator_service.main:app --reload --port 8003
```

## Frontend Setup

From `frontend`:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## API Overview

- `GET /ambulances` - list ambulances
- `GET /ambulances/nearest?x=&y=` - nearest available ambulance
- `POST /simulate-step` - move ambulances toward target
- `GET /hospitals` - list hospitals
- `GET /hospitals/nearest-available?x=&y=` - nearest hospital with beds
- `POST /request` (coordinator) - assign ambulance + hospital
- `GET /state` (coordinator) - combined frontend state
- `POST /simulate` (coordinator) - single simulation tick
