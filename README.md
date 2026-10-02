# Task Manager API (Backend)

Full-stack Task Manager Express REST API with MongoDB persistence, supporting CRUD operations, category taxonomy, date sorting, and multi-user tenancy.

## Tech Stack
- Node.js (v20+)
- Express.js (v5)
- MongoDB & Mongoose (v9)
- CORS & Dotenv

## API Endpoints
- `GET /tasks`: List tasks (filters: `userId`, `category`, `completed`, `sort=asc|desc`)
- `POST /tasks`: Create task (`title`, `category`, `userId`)
- `PUT /tasks/:id`: Update task (`title`, `completed`, `category`)
- `DELETE /tasks/:id`: Delete task
- `GET /users`: List users
- `POST /users`: Create user (`username`, `email`)
- `GET /api/health`: Uptime and MongoDB status

## Local Setup
```bash
npm install
cp .env.example .env
npm start
```
Default URL: `http://localhost:3001`
Test Suite: `npm test`
