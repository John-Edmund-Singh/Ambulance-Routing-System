import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

const COORDINATOR_BASE_URL = "http://127.0.0.1:8003";
const GRID_SIZE = 10;
const MAP_CENTER = { lat: 12.9716, lng: 77.5946 };
const MAP_SPAN = 0.08;
const METERS_PER_GRID = 1000;

function makeIdempotencyKey() {
  return `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) {
    return "--";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatDistance(meters) {
  if (!meters || meters <= 0) {
    return "--";
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

function toLatLng(x, y) {
  return {
    lat: MAP_CENTER.lat + ((y - GRID_SIZE / 2) / GRID_SIZE) * MAP_SPAN,
    lng: MAP_CENTER.lng + ((x - GRID_SIZE / 2) / GRID_SIZE) * MAP_SPAN
  };
}

function toGridPoint(lat, lng) {
  const x = ((lng - MAP_CENTER.lng) / MAP_SPAN) * GRID_SIZE + GRID_SIZE / 2;
  const y = ((lat - MAP_CENTER.lat) / MAP_SPAN) * GRID_SIZE + GRID_SIZE / 2;
  const clamp = (value) => Math.min(GRID_SIZE, Math.max(0, value));
  return {
    x: Number(clamp(x).toFixed(1)),
    y: Number(clamp(y).toFixed(1)),
  };
}

function distSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointAtFraction(route, fraction) {
  if (!route || route.length === 0) {
    return null;
  }
  if (route.length === 1 || fraction <= 0) {
    return route[0];
  }
  if (fraction >= 1) {
    return route[route.length - 1];
  }
  let total = 0;
  const segments = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const len = Math.sqrt(distSq(a, b));
    segments.push({ a, b, len });
    total += len;
  }
  if (total === 0) {
    return route[0];
  }
  const target = total * fraction;
  let walked = 0;
  for (const segment of segments) {
    if (walked + segment.len >= target) {
      const t = (target - walked) / segment.len;
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * t,
        segment.a[1] + (segment.b[1] - segment.a[1]) * t,
      ];
    }
    walked += segment.len;
  }
  return route[route.length - 1];
}

function makeAmbulanceIcon(isAvailable) {
  const color = isAvailable ? "#16a34a" : "#dc2626";
  return L.divIcon({
    className: "marker-shell",
    html: `<div class="ambulance-icon" style="background:${color}">🚑</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

const hospitalIcon = L.divIcon({
  className: "marker-shell",
  html: '<div class="hospital-icon">H</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const emergencyIcon = L.divIcon({
  className: "marker-shell",
  html: '<div class="emergency-icon">!</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

function ResizeMapOnLayout() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 120);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [map]);

  return null;
}

function EmergencyMapPicker({ onPick }) {
  const draggedRef = useRef(false);
  const dragResetTimerRef = useRef(null);

  useMapEvents({
    dragstart() {
      draggedRef.current = true;
      if (dragResetTimerRef.current) {
        clearTimeout(dragResetTimerRef.current);
        dragResetTimerRef.current = null;
      }
    },
    dragend() {
      // Leaflet can still emit a "click" after a drag ends.
      // Keep this flag true briefly to ignore that synthetic click.
      if (dragResetTimerRef.current) {
        clearTimeout(dragResetTimerRef.current);
      }
      dragResetTimerRef.current = setTimeout(() => {
        draggedRef.current = false;
        dragResetTimerRef.current = null;
      }, 250);
    },
    click(event) {
      if (draggedRef.current) {
        return;
      }
      // Only left-click / primary pointer should create an emergency marker.
      if (event?.originalEvent && "button" in event.originalEvent && event.originalEvent.button !== 0) {
        return;
      }
      // Ignore clicks that occur inside popups/controls (e.g., pressing Cancel).
      const target = event?.originalEvent?.target;
      if (target && typeof target.closest === "function") {
        if (target.closest(".leaflet-popup") || target.closest(".leaflet-control")) {
          return;
        }
      }
      onPick(event.latlng);
    },
  });
  return null;
}

function App() {
  const [ambulances, setAmbulances] = useState([]);
  const [displayAmbulances, setDisplayAmbulances] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [trafficZones, setTrafficZones] = useState([]);
  const [missions, setMissions] = useState([]);
  const [requestX, setRequestX] = useState(4);
  const [requestY, setRequestY] = useState(4);
  const [emergencyType, setEmergencyType] = useState("Accident");
  const [idempotencyKey, setIdempotencyKey] = useState(makeIdempotencyKey);
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState(null);
  const [emergencyPoint, setEmergencyPoint] = useState(null);
  const [emergencies, setEmergencies] = useState([]);
  const [roadRoute, setRoadRoute] = useState(null);
  const [routeStats, setRouteStats] = useState({ durationSec: 0, distanceM: 0 });
  const [routeAnchor, setRouteAnchor] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [simulatingNow, setSimulatingNow] = useState(false);
  const [eventLog, setEventLog] = useState([]);
  const [stats, setStats] = useState({
    totalRequests: 0,
    completedMissions: 0,
    failedRequests: 0,
  });
  const animationRef = useRef(null);
  const previousStageRef = useRef({});

  const loadState = async () => {
    const response = await fetch(`${COORDINATOR_BASE_URL}/state`);
    const data = await response.json();
    setAmbulances(data.ambulances || []);
    setHospitals(data.hospitals || []);
    setTrafficZones(data.traffic_zones || []);
    setMissions(data.missions || []);
  };

  const requestAmbulance = async () => {
    setLoading(true);
    setMessage("");
    const point = { x: Number(requestX), y: Number(requestY) };
    setEmergencyPoint(point);
    try {
      const response = await fetch(`${COORDINATOR_BASE_URL}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergency_x: point.x,
          emergency_y: point.y,
          idempotency_key: idempotencyKey,
        })
      });
      const data = await response.json();
      if (!response.ok) {
        setStats((prev) => ({ ...prev, failedRequests: prev.failedRequests + 1 }));
        throw new Error(data.detail || "Dispatch failed");
      }
      if (!data.idempotency_replayed) {
        setStats((prev) => ({ ...prev, totalRequests: prev.totalRequests + 1 }));
      }
      setSelectedAmbulanceId(data.ambulance_id);
      // Link this dispatch to the latest emergency marker at the same point,
      // so we can auto-remove it once the ambulance picks up the patient.
      setEmergencies((prev) => {
        const idx = prev.findIndex(
          (e) => e.ambulanceId == null && e.point.x === point.x && e.point.y === point.y
        );
        if (idx === -1) {
          return prev;
        }
        const next = prev.slice();
        next[idx] = { ...next[idx], ambulanceId: data.ambulance_id };
        return next;
      });
      setEventLog((prev) => [
        {
          id: crypto.randomUUID(),
          text: data.idempotency_replayed
            ? `Idempotency replay: Reused prior dispatch for key ${data.idempotency_key}.`
            : `Request accepted: Ambulance #${data.ambulance_id} assigned for ${emergencyType}.`,
          ts: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 12));
      setMessage(
        data.idempotency_replayed
          ? `Idempotency replay: same response returned for key ${data.idempotency_key}. No duplicate dispatch was created.`
          : `${emergencyType}: Ambulance #${data.ambulance_id} dispatched. It will go to patient first, then ${data.assigned_hospital.name}.`
      );
      await loadState();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const simulateStep = async () => {
    await fetch(`${COORDINATOR_BASE_URL}/simulate`, { method: "POST" });
    await loadState();
  };

  const simulateStepNow = async () => {
    try {
      setSimulatingNow(true);
      await simulateStep();
    } finally {
      setSimulatingNow(false);
    }
  };

  const resetDemo = async () => {
    setLoading(true);
    try {
      await fetch(`${COORDINATOR_BASE_URL}/reset-demo`, { method: "POST" });
      setEmergencyPoint(null);
      setEmergencies([]);
      setSelectedAmbulanceId(null);
      setRoadRoute(null);
      setRouteStats({ durationSec: 0, distanceM: 0 });
      setIdempotencyKey(makeIdempotencyKey());
      previousStageRef.current = {};
      setEventLog((prev) => [
        {
          id: crypto.randomUUID(),
          text: "Demo reset: all ambulances and beds restored.",
          ts: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 12));
      setMessage("Demo reset complete. Hospitals and ambulances restored.");
      await loadState();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    const id = setInterval(async () => {
      await simulateStep();
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ambulances.length) {
      setDisplayAmbulances([]);
      return;
    }
    if (!displayAmbulances.length) {
      setDisplayAmbulances(ambulances);
      return;
    }
    const startMap = new Map(displayAmbulances.map((a) => [a.id, a]));
    const endMap = new Map(ambulances.map((a) => [a.id, a]));
    const startTime = performance.now();
    const duration = 900;

    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t * (2 - t);
      const next = ambulances.map((target) => {
        const start = startMap.get(target.id) || target;
        return {
          ...target,
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased
        };
      });
      setDisplayAmbulances(next);
      if (t < 1) {
        animationRef.current = requestAnimationFrame(tick);
      }
    };

    cancelAnimationFrame(animationRef.current);
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [ambulances]);

  const routeEndpoints = useMemo(() => {
    if (!selectedAmbulanceId || !routeAnchor) {
      return null;
    }
    return {
      source: toLatLng(routeAnchor.origin.x, routeAnchor.origin.y),
      target: toLatLng(routeAnchor.target.x, routeAnchor.target.y),
    };
  }, [routeAnchor, selectedAmbulanceId]);

  useEffect(() => {
    if (!routeEndpoints) {
      setRoadRoute(null);
      setRouteStats({ durationSec: 0, distanceM: 0 });
      return;
    }

    const controller = new AbortController();
    const { source, target } = routeEndpoints;
    // Show at least a straight line immediately while road path is loading.
    setRoadRoute([
      [source.lat, source.lng],
      [target.lat, target.lng],
    ]);

    const osrmUrl =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${source.lng},${source.lat};${target.lng},${target.lat}` +
      `?overview=full&geometries=geojson`;

    const loadRoadRoute = async () => {
      try {
        const response = await fetch(osrmUrl, { signal: controller.signal });
        const data = await response.json();
        const route = data?.routes?.[0];
        const coordinates = route?.geometry?.coordinates;
        if (!coordinates || !Array.isArray(coordinates)) {
          setRoadRoute([
            [source.lat, source.lng],
            [target.lat, target.lng],
          ]);
          return;
        }
        setRouteStats({
          durationSec: route?.duration || 0,
          distanceM: route?.distance || 0,
        });
        setRoadRoute(coordinates.map(([lng, lat]) => [lat, lng]));
      } catch (error) {
        if (error.name !== "AbortError") {
          setRoadRoute([
            [source.lat, source.lng],
            [target.lat, target.lng],
          ]);
          setRouteStats({ durationSec: 0, distanceM: 0 });
        }
      }
    };

    loadRoadRoute();
    return () => controller.abort();
  }, [routeEndpoints]);

  const activeMission = useMemo(
    () => missions.find((m) => m.ambulance_id === selectedAmbulanceId),
    [missions, selectedAmbulanceId]
  );
  const selectedAmbulance = useMemo(
    () => displayAmbulances.find((a) => a.id === selectedAmbulanceId) || null,
    [displayAmbulances, selectedAmbulanceId]
  );
  const activeTrafficZone = useMemo(() => {
    if (!selectedAmbulance) {
      return null;
    }
    return (
      trafficZones.find((z) => {
        const dx = selectedAmbulance.x - z.x;
        const dy = selectedAmbulance.y - z.y;
        return Math.sqrt(dx * dx + dy * dy) <= z.radius;
      }) || null
    );
  }, [selectedAmbulance, trafficZones]);

  const cancelEmergencyMarker = (id) => {
    setEmergencies((prev) => prev.filter((e) => e.id !== id));
    setMessage("Emergency marker cancelled.");
  };

  const activeAmbulanceLines = useMemo(() => {
    return displayAmbulances
      .filter((a) => a.target_x != null && a.target_y != null)
      .map((a) => {
        const src = toLatLng(a.x, a.y);
        const dst = toLatLng(a.target_x, a.target_y);
        return {
          ambulanceId: a.id,
          points: [
            [src.lat, src.lng],
            [dst.lat, dst.lng],
          ],
        };
      });
  }, [displayAmbulances]);

  useEffect(() => {
    if (!activeMission) {
      return;
    }
    if (activeMission.stage !== "to_patient") {
      setEmergencyPoint(null);
    }
  }, [activeMission]);

  useEffect(() => {
    if (!selectedAmbulanceId) {
      setRouteAnchor(null);
      return;
    }
    const ambulance = ambulances.find((a) => a.id === selectedAmbulanceId);
    if (!ambulance) {
      return;
    }
    const mission = missions.find((m) => m.ambulance_id === selectedAmbulanceId);
    const target =
      ambulance.target_x != null && ambulance.target_y != null
        ? { x: ambulance.target_x, y: ambulance.target_y }
        : mission?.stage === "to_patient"
          ? mission.emergency
          : null;
    if (!target) {
      setRouteAnchor(null);
      return;
    }
    const stageKey = mission?.stage || "unknown";
    const targetChanged =
      !routeAnchor ||
      routeAnchor.stage !== stageKey ||
      routeAnchor.target.x !== target.x ||
      routeAnchor.target.y !== target.y;
    if (targetChanged) {
      setRouteAnchor({
        ambulanceId: selectedAmbulanceId,
        stage: stageKey,
        origin: { x: ambulance.x, y: ambulance.y },
        target,
      });
    }
  }, [ambulances, missions, selectedAmbulanceId, routeAnchor]);

  const handleMapPickEmergency = (latlng) => {
    const point = toGridPoint(latlng.lat, latlng.lng);
    setRequestX(point.x);
    setRequestY(point.y);
    setEmergencyPoint(point);
    const id = crypto.randomUUID();
    setEmergencies((prev) => [
      {
        id,
        point,
        type: emergencyType,
        ts: new Date().toLocaleTimeString(),
      },
      ...prev,
    ]);
    setIdempotencyKey(makeIdempotencyKey());
    setMessage(`Emergency point selected: (${point.x}, ${point.y}). Use Cancel in the popup to remove.`);
  };

  useEffect(() => {
    const prev = previousStageRef.current;
    const next = {};
    for (const mission of missions) {
      const oldStage = prev[mission.ambulance_id];
      next[mission.ambulance_id] = mission.stage;
      if (oldStage && oldStage !== mission.stage) {
        const stageText =
          mission.stage === "to_hospital"
            ? "Reached patient and now heading to hospital."
            : `Stage changed to ${mission.stage}.`;
        setEventLog((list) => [
          {
            id: crypto.randomUUID(),
            text: `Ambulance #${mission.ambulance_id}: ${stageText}`,
            ts: new Date().toLocaleTimeString(),
          },
          ...list,
        ].slice(0, 12));
      }
    }
    for (const ambulanceId of Object.keys(prev)) {
      if (!missions.find((m) => String(m.ambulance_id) === String(ambulanceId))) {
        setStats((s) => ({ ...s, completedMissions: s.completedMissions + 1 }));
        setEventLog((list) => [
          {
            id: crypto.randomUUID(),
            text: `Ambulance #${ambulanceId}: Mission completed (patient dropped at hospital).`,
            ts: new Date().toLocaleTimeString(),
          },
          ...list,
        ].slice(0, 12));
      }
    }
    previousStageRef.current = next;
  }, [missions]);

  useEffect(() => {
    // Remove emergency markers once the patient is picked up (mission no longer to_patient)
    // or once the mission is completed (mission disappears).
    if (!emergencies.length) {
      return;
    }
    setEmergencies((prev) =>
      prev.filter((e) => {
        if (e.ambulanceId == null) {
          return true;
        }
        const mission = missions.find((m) => m.ambulance_id === e.ambulanceId);
        if (!mission) {
          return false;
        }
        return mission.stage === "to_patient";
      })
    );
  }, [missions, emergencies.length]);

  return (
    <div className="app-shell">
      <aside className="left-panel card">
        <h1>Distributed Ambulance Routing</h1>
        <p className="subtitle">Dispatch panel with live vehicle and hospital tracking.</p>
        <div className="map-tip">Tip: click on map to pick emergency coordinates.</div>
        <div className="kpi-grid">
          <div className="kpi-card">
            <span>Total Requests</span>
            <strong>{stats.totalRequests}</strong>
          </div>
          <div className="kpi-card">
            <span>Completed Missions</span>
            <strong>{stats.completedMissions}</strong>
          </div>
          <div className="kpi-card">
            <span>ETA</span>
            <strong>{formatDuration(routeStats.durationSec)}</strong>
          </div>
          <div className="kpi-card">
            <span>Distance</span>
            <strong>{formatDistance(routeStats.distanceM)}</strong>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Emergency X
            <input
              type="number"
              min="0"
              max={GRID_SIZE}
              value={requestX}
              onChange={(e) => setRequestX(e.target.value)}
            />
          </label>
          <label>
            Emergency Y
            <input
              type="number"
              min="0"
              max={GRID_SIZE}
              value={requestY}
              onChange={(e) => setRequestY(e.target.value)}
            />
          </label>
          <label className="full">
            Emergency Type
            <select value={emergencyType} onChange={(e) => setEmergencyType(e.target.value)}>
              <option>Accident</option>
              <option>Cardiac</option>
              <option>Trauma</option>
              <option>General Emergency</option>
            </select>
          </label>
          <label className="full">
            Idempotency Key
            <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button className="primary" onClick={requestAmbulance} disabled={loading}>
            {loading ? "Dispatching..." : "Request Ambulance"}
          </button>
          <button className="secondary active" onClick={requestAmbulance} disabled={loading}>
            Retry Same Key
          </button>
          <button className="secondary active" onClick={simulateStepNow} disabled={simulatingNow}>
            {simulatingNow ? "Simulating..." : "Simulate Step"}
          </button>
          <button className="ghost" onClick={resetDemo} disabled={loading}>
            Reset Demo
          </button>
          <button className="ghost" onClick={() => setIdempotencyKey(makeIdempotencyKey())}>
            New Key
          </button>
        </div>
        {message && <div className="message">{message}</div>}
        {activeMission && (
          <div className="message mission-note">
            Ambulance #{activeMission.ambulance_id} phase:{" "}
            <strong>{activeMission.stage === "to_patient" ? "Going to patient" : "Going to hospital"}</strong>
          </div>
        )}
        {activeTrafficZone && (
          <div className="message traffic-note">
            Traffic slowdown: <strong>{activeTrafficZone.name}</strong> (speed {Math.round(activeTrafficZone.speed_multiplier * 100)}%)
          </div>
        )}

        <section className="mini-card">
          <h2>Ambulances</h2>
          {displayAmbulances.map((a) => (
            <div key={a.id} className="row">
              <span>
                #{a.id} ({a.x.toFixed(1)}, {a.y.toFixed(1)})
              </span>
              <span className={`status ${a.status === "available" ? "available" : "busy"}`}>
                {a.status}
              </span>
            </div>
          ))}
        </section>

        <section className="mini-card">
          <h2>Hospitals</h2>
          {hospitals.map((h) => (
            <div key={h.id} className="row">
              <span>{h.name}</span>
              <span className={`status ${h.available_beds > 0 ? "hospital-ok" : "busy"}`}>
                beds {h.available_beds}
              </span>
            </div>
          ))}
        </section>
        <section className="mini-card">
          <h2>Live Event Timeline</h2>
          <div className="event-list">
            {eventLog.length === 0 && <div className="event-empty">No events yet.</div>}
            {eventLog.map((e) => (
              <div key={e.id} className="event-item">
                <span>{e.text}</span>
                <small>{e.ts}</small>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="map-wrap card">
        <MapContainer center={[MAP_CENTER.lat, MAP_CENTER.lng]} zoom={13} className="map">
          <ResizeMapOnLayout />
          <EmergencyMapPicker onPick={handleMapPickEmergency} />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          {trafficZones.map((zone) => {
            const center = toLatLng(zone.x, zone.y);
            return (
              <Circle
                key={`traffic-${zone.id}`}
                center={[center.lat, center.lng]}
                radius={zone.radius * METERS_PER_GRID}
                pathOptions={{
                  color: "#f97316",
                  fillColor: "#fb923c",
                  fillOpacity: 0.14,
                  weight: 2,
                  dashArray: "6,6",
                }}
              >
                <Tooltip direction="top" className="coord-tip traffic-tip">
                  {zone.name}: speed {Math.round(zone.speed_multiplier * 100)}%
                </Tooltip>
              </Circle>
            );
          })}

          {hospitals.map((hospital) => {
            const p = toLatLng(hospital.x, hospital.y);
            return (
              <Marker key={`hospital-${hospital.id}`} position={[p.lat, p.lng]} icon={hospitalIcon}>
                <Tooltip permanent direction="top" offset={[0, -12]} className="coord-tip">
                  {hospital.name} (H{hospital.id}) ({hospital.x.toFixed(1)}, {hospital.y.toFixed(1)})
                </Tooltip>
                <Popup>
                  <strong>{hospital.name}</strong>
                  <br />
                  Beds: {hospital.available_beds}
                </Popup>
              </Marker>
            );
          })}

          {displayAmbulances.map((ambulance) => {
            let p = toLatLng(ambulance.x, ambulance.y);
            if (
              ambulance.id === selectedAmbulanceId &&
              roadRoute &&
              roadRoute.length > 1 &&
              routeAnchor &&
              routeAnchor.ambulanceId === selectedAmbulanceId
            ) {
              const totalDirect = Math.sqrt(
                (routeAnchor.target.x - routeAnchor.origin.x) ** 2 +
                (routeAnchor.target.y - routeAnchor.origin.y) ** 2
              );
              const doneDirect = Math.sqrt(
                (ambulance.x - routeAnchor.origin.x) ** 2 +
                (ambulance.y - routeAnchor.origin.y) ** 2
              );
              const progress = totalDirect > 0 ? Math.min(1, Math.max(0, doneDirect / totalDirect)) : 0;
              const projected = pointAtFraction(roadRoute, progress);
              if (projected) {
                p = { lat: projected[0], lng: projected[1] };
              }
            }
            return (
              <Marker
                key={`ambulance-${ambulance.id}`}
                position={[p.lat, p.lng]}
                icon={makeAmbulanceIcon(ambulance.status === "available")}
                eventHandlers={{
                  click: () => setSelectedAmbulanceId(ambulance.id),
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -14]} className="coord-tip">
                  A{ambulance.id} ({ambulance.x.toFixed(1)}, {ambulance.y.toFixed(1)})
                </Tooltip>
                <Popup>
                  <strong>Ambulance #{ambulance.id}</strong>
                  <br />
                  Status: {ambulance.status}
                </Popup>
              </Marker>
            );
          })}

          {emergencies.map((e) => {
            const p = toLatLng(e.point.x, e.point.y);
            return (
              <Marker key={`emergency-${e.id}`} position={[p.lat, p.lng]} icon={emergencyIcon}>
                <Tooltip permanent direction="top" offset={[0, -12]} className="coord-tip emergency-tip">
                  E ({e.point.x.toFixed(1)}, {e.point.y.toFixed(1)})
                </Tooltip>
                <Popup>
                  <strong>Emergency</strong>
                  <br />
                  Type: {e.type}
                  <br />
                  Time: {e.ts}
                  <br />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="secondary"
                      type="button"
                      onMouseDown={(evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                      }}
                      onClick={(evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        cancelEmergencyMarker(e.id);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {activeAmbulanceLines
            .filter((line) => line.ambulanceId !== selectedAmbulanceId)
            .map((line) => (
              <Polyline
                key={`active-line-${line.ambulanceId}`}
                positions={line.points}
                pathOptions={{ color: "#f59e0b", weight: 4, opacity: 0.9 }}
              />
            ))}
          {roadRoute && <Polyline positions={roadRoute} pathOptions={{ color: "#f59e0b", weight: 5 }} />}
        </MapContainer>

        <div className="map-grid-overlay" />
        <div className="axis x-axis">
          {Array.from({ length: GRID_SIZE + 1 }).map((_, idx) => (
            <span key={`x-${idx}`}>x{idx}</span>
          ))}
        </div>
        <div className="axis y-axis">
          {Array.from({ length: GRID_SIZE + 1 }).map((_, idx) => (
            <span key={`y-${idx}`}>y{GRID_SIZE - idx}</span>
          ))}
        </div>

        <div className="legend">
          <span><i className="dot green" />Available Ambulance</span>
          <span><i className="dot red" />Busy Ambulance</span>
          <span><i className="dot blue" />Hospital (Beds)</span>
          <span><i className="dot amber" />Route to Current Target</span>
          <span><i className="dot slate" />Other Active Ambulance Routes</span>
          <span><i className="dot orange" />Traffic Slow Zone</span>
        </div>
      </main>
    </div>
  );
}

export default App;
