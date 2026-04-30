# 🚀 Quick Start - Sharda CRM Backend

## Prerequisites

```bash
Node.js v18+
MongoDB (local or Atlas)
npm or yarn
```

## Installation

```bash
# 1. Navigate to backend folder
cd shardacrm-backend

# 2. Install dependencies
npm install

# 3. Create .env file
cp .env.example .env

# 4. Configure environment variables
MONGO_URI=mongodb://localhost:27017/shardacrm
PORT=5000
JWT_SECRET=your_secret_key
JWT_REFRESH_SECRET=your_refresh_secret
NODE_ENV=development
```

## Running the Server

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm start

# Server will start on http://localhost:5000
```

## Health Check

```bash
curl http://localhost:5000/api/v1/health

# Expected response:
# {
#   "status": "OK",
#   "timestamp": "2024-01-15T10:00:00.000Z"
# }
```

## First Time Setup

### 1. Register

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "admin@sharda.com",
    "password": "admin@123",
    "phone": "9999999999",
    "companyName": "Sharda Corp"
  }'
```

### 2. Copy the accessToken from response

### 3. Create a Lead

```bash
curl -X POST http://localhost:5000/api/v1/leads \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "phone": "9876543210",
    "email": "john@example.com",
    "source": "Direct",
    "dealValue": 100000
  }'
```

## API Endpoints

| Method | Endpoint          | Description         |
| ------ | ----------------- | ------------------- |
| POST   | /auth/register    | Register new user   |
| POST   | /auth/login       | Login user          |
| GET    | /leads            | Get all leads       |
| POST   | /leads            | Create lead         |
| GET    | /leads/:id        | Get lead details    |
| PUT    | /leads/:id        | Update lead         |
| DELETE | /leads/:id        | Delete lead         |
| PATCH  | /leads/:id/status | Update lead status  |
| PATCH  | /leads/:id/assign | Assign lead to user |
| POST   | /activities       | Log activity        |
| GET    | /activities       | Get activities      |
| POST   | /payments         | Record payment      |
| GET    | /payments         | Get payments        |
| POST   | /reminders        | Create reminder     |
| GET    | /reminders        | Get reminders       |
| GET    | /users            | Get team members    |
| POST   | /users            | Create team member  |
| GET    | /notifications    | Get notifications   |

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete reference.

## Project Structure

```
shardacrm-backend/
├── src/
│   ├── config/           # Configuration files
│   ├── models/           # Database models
│   ├── controllers/      # Business logic
│   ├── routes/           # API routes
│   ├── middleware/       # Express middleware
│   ├── validators/       # Joi validation schemas
│   ├── utils/            # Helper functions
│   ├── constants/        # Constants & enums
│   ├── app.js           # Express app
│   └── server.js        # Server entry point
├── .env.example         # Environment template
├── package.json         # Dependencies
├── API_DOCUMENTATION.md # Complete API reference
├── TESTING_GUIDE.md     # Testing procedures
└── PHASE2_COMPLETION.md # Implementation summary
```

## Troubleshooting

### Port already in use

```bash
# Change PORT in .env or kill existing process
lsof -i :5000
kill -9 <PID>
```

### MongoDB connection failed

```bash
# Check MongoDB is running
mongod

# Or use MongoDB Atlas
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/shardacrm
```

### Invalid JWT token

```bash
# The token might be expired, refresh it
curl -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your_refresh_token"}'
```

## Development Commands

```bash
# Run with nodemon (auto-reload)
npm run dev

# Run linting
npm run lint

# Run tests (when added)
npm test

# Start production build
npm start
```

## Testing with Postman

1. Import [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
2. Set collection variable: `{{base_url}}` = `http://localhost:5000/api/v1`
3. Set authorization: `{{accessToken}}` (get from login response)
4. Run requests

## Key Features

✅ 60 API endpoints
✅ JWT authentication with refresh tokens
✅ RBAC (5 roles, 11 permissions)
✅ Request validation with Joi
✅ Error handling middleware
✅ MongoDB with Mongoose
✅ Rate limiting
✅ CORS enabled
✅ Logging with Winston
✅ Security headers with Helmet

## Environment Variables

```
# Server
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/shardacrm

# JWT
JWT_SECRET=your_jwt_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_key_here
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d

# CORS
CORS_ORIGIN=http://localhost:3000

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_password

# AWS/Cloudinary (optional)
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Payment Gateways (optional)
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_SECRET_KEY=your_secret_key
STRIPE_SECRET_KEY=your_stripe_key

# AI Services (optional)
OPENAI_API_KEY=your_openai_key
```

## Monitoring

```bash
# Check logs
tail -f logs/all.log
tail -f logs/error.log

# Monitor with pm2
npm install -g pm2
pm2 start src/server.js --name "shardacrm-backend"
pm2 logs
```

## Production Deployment

```bash
# Build
npm run build (if applicable)

# Deploy
# Option 1: Heroku
heroku create shardacrm-backend
git push heroku main

# Option 2: Railway/Render
# Connect GitHub repo and deploy

# Option 3: Docker
docker build -t shardacrm-backend .
docker run -p 5000:5000 shardacrm-backend
```

## Support

- Check [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for endpoint details
- See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for working examples
- Review [PHASE2_COMPLETION.md](./PHASE2_COMPLETION.md) for implementation details

---

**Status**: ✅ Fully Implemented & Ready to Use
**Version**: 2.0 (Phase 2 Complete)
**Last Updated**: 2024-01-15

For questions or issues, refer to the documentation or contact support.
