# AgriEasy – A Farmer’s Guide

AgriEasy is a unified digital marketplace where farmers can rent or book farm equipment, purchase inputs (fertilizers, pesticides), and book transport; while vendors, suppliers, transporters, consumers, and admins manage their respective services.

- Backend: NestJS (Node.js + TypeScript), TypeORM, PostgreSQL, Redis
- Frontend: Next.js, Tailwind CSS, Framer Motion
- Auth: OTP-based (mock) + JWT, RBAC middleware/guards
- Infra: Docker Compose orchestrating PostgreSQL, Redis, API, and Web

## Quickstart

1. Ensure Docker is installed.
2. From the project root (`agrieasy/`), run:

```bash
docker compose up --build
```

3. Open:
- Web: http://localhost:3000
- API: http://localhost:3001

Default env values are in `.env`. See `.env.example` for reference.

## Features

- OTP login (mock) and JWT issuance
- Roles: Farmer, Equipment Vendor, Input Supplier, Transporter/Driver, Consumer, Admin
- Equipment catalog and booking with overlap prevention
- Input products catalog (fertilizers/pesticides)
- Produce listings for consumers, unified cart and orders
- Transport vehicles and bookings
- Payments (Razorpay-like mock)
- Reviews and notifications
- Admin analytics

## Tech Notes

- Database schema is provisioned via `db/init.sql` (with constraints and seed data)
- Backend uses TypeORM with `synchronize: false` against the prebuilt schema
- OpenAPI spec at `docs/openapi.yaml`

## Environment Variables

- DATABASE_URL
- JWT_SECRET
- REDIS_URL
- NEXT_PUBLIC_API_BASE_URL

## Development

- Use `docker compose up --build` for a full stack.
- For hot-reload dev, you can run API and Web locally outside Docker; ensure Postgres and Redis are reachable.
