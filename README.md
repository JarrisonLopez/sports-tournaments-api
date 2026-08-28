# 🏆 Sports Tournaments API

API RESTful para la gestión de torneos deportivos, desarrollada con Node.js, TypeScript, Fastify, TypeORM y MySQL.

El proyecto permite administrar torneos, canchas y jugadores mediante operaciones CRUD y filtros de consulta. Incluye pruebas automatizadas, cobertura de código, Docker y pipelines independientes de CI/CD para los ambientes de Testing y Production.

## 🛠️ Tecnologías

- Node.js 22
- TypeScript
- Fastify
- TypeORM
- MySQL 8.4
- Docker
- Docker Compose
- Vitest
- GitHub Actions

## 📦 Entidades

La API cuenta con tres entidades principales:

### Torneos

Permite administrar información de los torneos deportivos, incluyendo nombre, deporte, fechas y estado.

### Canchas

Permite administrar los escenarios deportivos, su ubicación, tipo de superficie y disponibilidad.

### Jugadores

Permite registrar y administrar jugadores, incluyendo nombre, documento, fecha de nacimiento y posición.

## 🔗 Endpoints

### Torneos

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/torneos` | Crear torneo |
| GET | `/torneos` | Consultar torneos |
| GET | `/torneos/:id` | Consultar torneo por ID |
| PATCH | `/torneos/:id` | Actualizar torneo |
| DELETE | `/torneos/:id` | Eliminar torneo |

Filtros disponibles:

```http
GET /torneos?deporte=Futbol
GET /torneos?estado=PROGRAMADO
GET /torneos?deporte=Futbol&estado=PROGRAMADO
```

### Canchas

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/canchas` | Crear cancha |
| GET | `/canchas` | Consultar canchas |
| GET | `/canchas/:id` | Consultar cancha por ID |
| PATCH | `/canchas/:id` | Actualizar cancha |
| DELETE | `/canchas/:id` | Eliminar cancha |

Filtros disponibles:

```http
GET /canchas?tipoSuperficie=Sintetica
GET /canchas?disponible=true
GET /canchas?tipoSuperficie=Sintetica&disponible=true
```

### Jugadores

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/jugadores` | Crear jugador |
| GET | `/jugadores` | Consultar jugadores |
| GET | `/jugadores/:id` | Consultar jugador por ID |
| PATCH | `/jugadores/:id` | Actualizar jugador |
| DELETE | `/jugadores/:id` | Eliminar jugador |

Filtros disponibles:

```http
GET /jugadores?nombre=Juan
GET /jugadores?posicion=Delantero
GET /jugadores?nombre=Juan&posicion=Delantero
```

## ⚙️ Configuración local

Instalar las dependencias:

```bash
npm ci
```

Crear un archivo `.env` tomando como referencia `.env.example`.

Variables requeridas:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=sports_user
DB_PASSWORD=sports_password
DB_NAME=sports_db
```

Compilar el proyecto:

```bash
npm run build
```

Ejecutar la aplicación:

```bash
npm start
```

La API utiliza por defecto:

```text
http://localhost:3000
```

## 🐳 Docker

El proyecto incluye un `Dockerfile` para la API y un `docker-compose.yml` que permite ejecutar la API y MySQL conjuntamente.

Construir e iniciar los servicios:

```bash
docker compose up --build
```

Servicios locales:

```text
API:   http://localhost:3000
MySQL: localhost:3306
```

Detener los servicios:

```bash
docker compose down
```

Los datos de MySQL se conservan mediante un volumen de Docker.

## 🧪 Pruebas automatizadas

Ejecutar las pruebas:

```bash
npm test
```

Actualmente el proyecto cuenta con 30 pruebas automatizadas distribuidas entre las rutas de torneos, canchas y jugadores.

Ejecutar cobertura general:

```bash
npm run test:coverage
```

### Quality Gates

Testing:

```bash
npm run test:coverage:testing
```

Cobertura mínima requerida: **60 %**.

Production:

```bash
npm run test:coverage:production
```

Cobertura mínima requerida: **85 %**.

La cobertura obtenida durante la implementación fue:

| Métrica | Cobertura |
|---|---:|
| Statements | 93.2 % |
| Branches | 100 % |
| Functions | 90 % |
| Lines | 93.2 % |

Las rutas REST cuentan con 100 % de cobertura en las métricas evaluadas.

## 🌿 Estrategia de ramas

El proyecto utiliza dos ramas principales:

```text
develop → Testing
main    → Production
```

Los cambios enviados a `develop` ejecutan el pipeline de Testing.

Los cambios enviados a `main` ejecutan el pipeline de Production.

## 🔄 CI/CD

El proyecto utiliza GitHub Actions con dos workflows independientes.

### Testing Pipeline

Archivo:

```text
.github/workflows/testing.yml
```

Proceso:

```text
Push a develop
      ↓
Checkout
      ↓
Node.js 22
      ↓
npm ci
      ↓
Build
      ↓
Pruebas automatizadas
      ↓
Coverage >= 60 %
      ↓
Deploy Testing
```

GitHub Environment:

```text
testing
```

### Production Pipeline

Archivo:

```text
.github/workflows/production.yml
```

Proceso:

```text
Push a main
      ↓
Checkout
      ↓
Node.js 22
      ↓
npm ci
      ↓
Build
      ↓
Pruebas automatizadas
      ↓
Coverage >= 85 %
      ↓
Deploy Production
```

GitHub Environment:

```text
production
```

El despliegue solo debe ejecutarse cuando las etapas anteriores hayan finalizado correctamente.

## ☁️ Ambientes

El proyecto cuenta con dos ambientes independientes desplegados en Railway:

| Característica | Testing | Production |
|---|---|---|
| Rama | `develop` | `main` |
| GitHub Environment | `testing` | `production` |
| Coverage mínimo | 60 % | 85 % |
| API | Independiente | Independiente |
| Base de datos | MySQL Testing | MySQL Production |
| Variables/secrets | Independientes | Independientes |
| URL | https://sports-tournaments-api-testing.up.railway.app | https://sports-tournaments-api-production.up.railway.app |

Cada ambiente cuenta con su propio servicio de API y su propia instancia de MySQL en Railway.

Railway está integrado con GitHub y configurado para esperar la finalización exitosa de los checks de CI antes de realizar el despliegue correspondiente.

## 📂 Estructura principal

```text
sports-tournaments-api/
├── .github/
│   └── workflows/
│       ├── testing.yml
│       └── production.yml
├── src/
│   ├── config/
│   ├── entities/
│   ├── routes/
│   ├── app.ts
│   └── index.ts
├── tests/
│   └── integration/
├── .dockerignore
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.mts
├── vitest.testing.config.mts
└── vitest.production.config.mts
```

## 👨‍💻 Autor

Proyecto académico desarrollado por Jarrison Lopez.