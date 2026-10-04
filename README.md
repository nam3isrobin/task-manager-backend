# Task Manager API (Backend)

Full-stack Task Manager Express REST API with MongoDB persistence, JWT Bearer authentication, bcryptjs password hashing, strict multi-tenant isolation, category taxonomy, and date sorting.

## Tech Stack
- Node.js (v20+)
- Express.js (v5)
- MongoDB & Mongoose (v9)
- JWT (`jsonwebtoken`) & `bcryptjs`
- CORS & Dotenv

## API Endpoints
### Authentication
- `POST /auth/register`: Register new account (`username`, `password`, optional `email`) -> returns JWT token + user profile
- `POST /auth/login`: Authenticate existing user (`username`, `password`) -> returns JWT token + user profile
- `GET /auth/me`: Introspect current user profile (requires `Authorization: Bearer <token>`)

### Protected Tasks (Requires `Authorization: Bearer <token>`)
- `GET /tasks`: List authenticated user's tasks (filters: `category`, `completed`, `sort=asc|desc`)
- `POST /tasks`: Create task bound to authenticated user (`title`, `category`)
- `GET /tasks/:id`: Retrieve single task (strictly isolated to owner)
- `PUT /tasks/:id`: Update task (`title`, `completed`, `category`)
- `DELETE /tasks/:id`: Delete task (strictly isolated to owner)

### Administrator Endpoints (Requires `role: 'admin'`)
- `GET /api/admin/metrics`: Real-time system telemetry (total users, total tasks, completion rates, uptime)
- `GET /api/admin/users`: User directory with individual task count aggregation
- `DELETE /api/admin/users/:id`: Cascading deletion of user and all owned tasks (root admin protected)
- `GET /api/admin/tasks`: Global cross-tenant task explorer with owner details
- `DELETE /api/admin/tasks/:id`: Administrative task deletion

### Legacy & Telemetry
- `GET /users`: List users (sanitized, no password hashes)
- `POST /users`: Legacy user creation
- `GET /api/health`: Uptime and MongoDB status

## Local Setup
```bash
npm install
cp .env.example .env
npm run seed  # Idempotent database seeder (root admin & demo tasks)
npm start
```
Default URL: `http://localhost:3000` (auto-increments on port collision)
Test Suite: `npm test` (61 automated assertions)


