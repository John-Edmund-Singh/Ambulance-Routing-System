# 🚑 Distributed Ambulance Routing System

### Intelligent Emergency Response & Hospital Allocation Platform

The Distributed Ambulance Routing System is a full-stack microservices-based application designed to optimize emergency medical response by intelligently assigning the nearest available ambulance and the most suitable hospital with available beds.

The system simulates real-world emergency dispatch operations through distributed services that coordinate ambulance tracking, hospital capacity management, route assignment, and emergency request handling in real time.

---

## 🌟 Project Overview

In emergency situations, response time can determine patient outcomes. This project addresses that challenge by implementing a distributed architecture that automatically identifies and dispatches the closest available ambulance while simultaneously locating the nearest hospital with available capacity.

The platform demonstrates how modern microservices can work together to improve resource allocation, reduce response times, and streamline emergency coordination.

---

## ✨ Key Features

### 🚑 Smart Ambulance Dispatch

* Tracks ambulance locations in real time
* Maintains ambulance availability status
* Automatically identifies the nearest available ambulance
* Reduces emergency response delays

### 🏥 Intelligent Hospital Allocation

* Monitors hospital bed availability
* Finds the nearest hospital capable of receiving patients
* Optimizes resource utilization across hospitals

### 🔄 Distributed Service Coordination

* Independent microservices communicate through APIs
* Central coordinator manages emergency requests
* Demonstrates real-world distributed system principles

### 📍 Route Simulation

* Simulates ambulance movement toward emergency locations
* Updates ambulance positions dynamically
* Visualizes dispatch and routing operations

### ⚡ Real-Time Emergency Processing

* Handles emergency requests instantly
* Assigns ambulances and hospitals automatically
* Provides coordinated system-wide responses

### 🖥 Interactive Dashboard

* Request ambulance services through a user-friendly interface
* View ambulance locations and hospital availability
* Monitor the current state of the emergency response network

---

## 🏗 System Architecture

The platform consists of four major components:

### 🚑 Ambulance Service (Port 8001)

Responsible for:

* Ambulance management
* Location tracking
* Availability monitoring
* Nearest ambulance calculations

### 🏥 Hospital Service (Port 8002)

Responsible for:

* Hospital information management
* Bed availability tracking
* Hospital allocation decisions

### 🎯 Coordinator Service (Port 8003)

Responsible for:

* Emergency request handling
* Service orchestration
* Ambulance-hospital assignment
* System state aggregation

### 🌐 Frontend Application (Port 5173)

Responsible for:

* User interaction
* Emergency request submission
* Real-time visualization
* System monitoring

---

## 🛠 Technologies Used

### Backend

* Python
* FastAPI
* Uvicorn
* REST APIs

### Frontend

* React
* JavaScript / TypeScript
* Vite

### Concepts Demonstrated

* Distributed Systems
* Microservices Architecture
* Service Coordination
* API Communication
* Resource Allocation Algorithms
* Real-Time Simulation

---

## 🚀 Core Workflow

1. User submits an emergency request.
2. Coordinator Service receives the request.
3. Ambulance Service identifies the nearest available ambulance.
4. Hospital Service finds the nearest hospital with available beds.
5. Coordinator assigns both resources.
6. Ambulance movement is simulated toward the destination.
7. System state updates are reflected on the dashboard in real time.

---

## 📡 Available APIs

### Ambulance Service

* `GET /ambulances`
* `GET /ambulances/nearest`
* `POST /simulate-step`

### Hospital Service

* `GET /hospitals`
* `GET /hospitals/nearest-available`

### Coordinator Service

* `POST /request`
* `GET /state`
* `POST /simulate`

---

## 🎯 Learning Outcomes

This project demonstrates practical experience in:

* Full-Stack Development
* Distributed System Design
* Microservices Architecture
* REST API Development
* System Coordination
* Real-Time Data Processing
* Problem Solving for Emergency Response Systems

---

## 🌍 Real-World Impact

The Distributed Ambulance Routing System showcases how technology can be leveraged to improve emergency healthcare logistics by minimizing response times, optimizing resource allocation, and enhancing coordination between ambulances and hospitals.

The project serves as a simulation of modern smart-city healthcare infrastructure and highlights the potential of distributed computing in critical real-world applications.
