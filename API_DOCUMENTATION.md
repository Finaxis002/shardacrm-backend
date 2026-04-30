# Sharda CRM - Complete Backend API Documentation

## Overview

Complete backend API implementation for Sharda CRM with 7 resource controllers, proper validation, error handling, and RBAC middleware.

## Base URL

```
http://localhost:5000/api/v1
```

## Authentication

All endpoints except `/auth/register`, `/auth/login`, and `/auth/refresh` require Bearer token in Authorization header:

```
Authorization: Bearer <accessToken>
```

---

## 1. Authentication Endpoints

### Register

```
POST /auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phone": "9876543210",
  "companyName": "Acme Corp"
}

Response: 201 Created
{
  "success": true,
  "data": {
    "user": {...},
    "accessToken": "...",
    "refreshToken": "..."
  },
  "message": "User registered successfully"
}
```

### Login

```
POST /auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "user": {...},
    "accessToken": "...",
    "refreshToken": "..."
  },
  "message": "Logged in successfully"
}
```

### Get Current User

```
GET /auth/me
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {user},
  "message": "User fetched successfully"
}
```

### Refresh Token

```
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "..."
}

Response: 200 OK
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "..."
  },
  "message": "Token refreshed successfully"
}
```

### Logout

```
POST /auth/logout
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": null,
  "message": "Logged out successfully"
}
```

---

## 2. Lead Endpoints

### Get All Leads

```
GET /leads?page=1&limit=10&status=New&source=Direct&search=john
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number (default: 1)
- limit (number): Items per page (default: 10, max: 100)
- status (string): Filter by status
- source (string): Filter by source
- assignedTo (string): Filter by assigned user ID
- search (string): Search in name, email, phone

Response: 200 OK
{
  "success": true,
  "data": {
    "items": [
      {
        "_id": "...",
        "name": "John Doe",
        "phone": "9876543210",
        "email": "john@example.com",
        "status": "New",
        "dealValue": 50000,
        "assignedTo": {...}
      }
    ],
    "pagination": {
      "total": 100,
      "page": 1,
      "limit": 10,
      "pages": 10,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### Get Single Lead

```
GET /leads/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {lead}
}
```

### Create Lead

```
POST /leads
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "9876543210",
  "email": "john@example.com",
  "city": "Mumbai",
  "source": "Direct",
  "dealValue": 50000,
  "priority": "High",
  "assignedTo": "<userId>"
}

Response: 201 Created
{
  "success": true,
  "data": {lead}
}
```

### Update Lead

```
PUT /leads/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Jane Doe",
  "status": "Interested",
  "dealValue": 75000
}

Response: 200 OK
{
  "success": true,
  "data": {lead}
}
```

### Update Lead Status

```
PATCH /leads/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "Success"
}

Response: 200 OK
```

### Assign Lead

```
PATCH /leads/:id/assign
Authorization: Bearer <token>
Content-Type: application/json

{
  "assignedTo": "<userId>"
}

Response: 200 OK
```

### Add Co-Assignee

```
POST /leads/:id/co-assignees
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "<userId>"
}

Response: 200 OK
```

### Remove Co-Assignee

```
DELETE /leads/:id/co-assignees/:userId
Authorization: Bearer <token>

Response: 200 OK
```

### Delete Lead

```
DELETE /leads/:id
Authorization: Bearer <token>

Response: 200 OK
```

### Get Lead Statistics

```
GET /leads/stats/overview
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "total": 150,
    "totalValue": 5000000,
    "byStatus": [
      {
        "_id": "New",
        "count": 50,
        "totalValue": 1000000
      }
    ]
  }
}
```

---

## 3. Activity Endpoints

### Get All Activities

```
GET /activities?page=1&limit=10&leadId=<id>&type=call
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number
- limit (number): Items per page
- leadId (string): Filter by lead
- type (string): call, note, email, meeting, task, recording

Response: 200 OK
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {...}
  }
}
```

### Get Lead Activities

```
GET /activities/lead/:leadId
Authorization: Bearer <token>

Response: 200 OK
```

### Create Activity

```
POST /activities
Authorization: Bearer <token>
Content-Type: application/json

{
  "leadId": "<leadId>",
  "type": "call",
  "text": "Called, interested in product",
  "callDuration": 300,
  "callDirection": "outbound",
  "callOutcome": "Positive"
}

Response: 201 Created
```

### Update Activity

```
PUT /activities/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "Updated notes",
  "callOutcome": "Need callback"
}

Response: 200 OK
```

### Delete Activity

```
DELETE /activities/:id
Authorization: Bearer <token>

Response: 200 OK
```

---

## 4. Payment Endpoints

### Get All Payments

```
GET /payments?page=1&limit=10&status=Completed
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number
- limit (number): Items per page
- status (string): Pending, Completed, Partial, Overdue, Failed
- leadId (string): Filter by lead

Response: 200 OK
```

### Create Payment

```
POST /payments
Authorization: Bearer <token>
Content-Type: application/json

{
  "leadId": "<leadId>",
  "amount": 50000,
  "currency": "INR",
  "paymentMode": "UPI",
  "status": "Completed",
  "reference": "TXNID123",
  "paymentDate": "2024-01-15T00:00:00Z",
  "description": "Initial payment"
}

Response: 201 Created
```

### Update Payment

```
PUT /payments/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "Completed",
  "reference": "NEWTXNID"
}

Response: 200 OK
```

### Generate Payment Link

```
POST /payments/:id/generate-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Payment for lead"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "paymentLink": "https://payment.example.com/link/...",
    "expiryDate": "2024-01-22T15:30:00Z"
  }
}
```

### Delete Payment

```
DELETE /payments/:id
Authorization: Bearer <token>

Response: 200 OK
```

### Get Payment Statistics

```
GET /payments/stats/overview
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "total": 50,
    "totalAmount": 2500000,
    "byStatus": [...]
  }
}
```

---

## 5. Reminder Endpoints

### Get All Reminders

```
GET /reminders?page=1&limit=10&status=pending
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number
- limit (number): Items per page
- status (string): pending, completed
- leadId (string): Filter by lead

Response: 200 OK
```

### Get Today's Reminders

```
GET /reminders/today/pending
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": [...]
}
```

### Create Reminder

```
POST /reminders
Authorization: Bearer <token>
Content-Type: application/json

{
  "leadId": "<leadId>",
  "type": "follow-up",
  "reminderDate": "2024-01-20",
  "reminderTime": "10:30",
  "note": "Follow up on proposal"
}

Response: 201 Created
```

### Update Reminder

```
PUT /reminders/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "reminderTime": "14:00",
  "note": "Updated reminder"
}

Response: 200 OK
```

### Mark Reminder Done

```
PATCH /reminders/:id/done
Authorization: Bearer <token>
Content-Type: application/json

{
  "isDone": true
}

Response: 200 OK
```

### Delete Reminder

```
DELETE /reminders/:id
Authorization: Bearer <token>

Response: 200 OK
```

---

## 6. User/Team Endpoints

### Get Team Members

```
GET /users?page=1&limit=10&role=exec
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number
- limit (number): Items per page
- role (string): admin, manager, tl, exec, viewer
- search (string): Search in name, email

Response: 200 OK
```

### Get Single User

```
GET /users/:id
Authorization: Bearer <token>

Response: 200 OK
```

### Create Team Member (Admin only)

```
POST /users
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "password123",
  "phone": "9876543211",
  "role": "exec"
}

Response: 201 Created
```

### Update User

```
PUT /users/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Jane Smith Updated",
  "phone": "9876543212"
}

Response: 200 OK
```

### Update User Role (Admin only)

```
PATCH /users/:id/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "role": "manager"
}

Response: 200 OK
```

### Delete User (Admin only)

```
DELETE /users/:id
Authorization: Bearer <token>

Response: 200 OK
```

### Get Team Statistics

```
GET /users/stats/summary
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "total": 5,
    "byRole": [
      {"_id": "admin", "count": 1},
      {"_id": "exec", "count": 3}
    ]
  }
}
```

### Get My Profile

```
GET /users/profile/me
Authorization: Bearer <token>

Response: 200 OK
```

### Update My Profile

```
PUT /users/profile/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Name",
  "phone": "9876543210",
  "avatar": "cloudinary-url"
}

Response: 200 OK
```

---

## 7. Notification Endpoints

### Get Notifications

```
GET /notifications?page=1&limit=10&isRead=false
Authorization: Bearer <token>

Query Parameters:
- page (number): Page number
- limit (number): Items per page
- isRead (boolean): Filter by read status

Response: 200 OK
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {...},
    "unreadCount": 5
  }
}
```

### Get Unread Count

```
GET /notifications/unread/count
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "unreadCount": 5
  }
}
```

### Mark as Read

```
PATCH /notifications/:id/read
Authorization: Bearer <token>

Response: 200 OK
```

### Mark All as Read

```
PATCH /notifications/read-all
Authorization: Bearer <token>

Response: 200 OK
```

### Delete Notification

```
DELETE /notifications/:id
Authorization: Bearer <token>

Response: 200 OK
```

### Delete All Notifications

```
DELETE /notifications/clear-all
Authorization: Bearer <token>

Response: 200 OK
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "statusCode": 400,
  "errors": ["error message"],
  "message": "Request failed"
}
```

Common Status Codes:

- 200: Success
- 201: Created
- 400: Bad Request (validation error)
- 401: Unauthorized (invalid/missing token)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 500: Server Error

---

## Permission Matrix

| Permission         | Admin | Manager | TL  | Exec | Viewer |
| ------------------ | ----- | ------- | --- | ---- | ------ |
| view_all_leads     | ✓     | ✓       | ✓   | ✓    | ✓      |
| add_leads          | ✓     | ✓       | ✓   | ✓    | ✗      |
| edit_any_lead      | ✓     | ✓       | ✓   | ✓    | ✗      |
| delete_leads       | ✓     | ✓       | ✗   | ✗    | ✗      |
| assign_leads       | ✓     | ✓       | ✓   | ✗    | ✗      |
| change_lead_owner  | ✓     | ✓       | ✗   | ✗    | ✗      |
| record_payments    | ✓     | ✓       | ✓   | ✓    | ✗      |
| import_from_sheets | ✓     | ✓       | ✗   | ✗    | ✗      |
| view_team          | ✓     | ✓       | ✓   | ✗    | ✗      |
| manage_users       | ✓     | ✗       | ✗   | ✗    | ✗      |
| admin_panel        | ✓     | ✗       | ✗   | ✗    | ✗      |

---

## Testing with cURL

```bash
# Register
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "companyName": "Test Company"
  }'

# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Get Leads (with token)
curl -X GET http://localhost:5000/api/v1/leads \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Create Lead
curl -X POST http://localhost:5000/api/v1/leads \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Lead",
    "phone": "9876543210",
    "email": "lead@example.com",
    "source": "Direct"
  }'
```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- Phone numbers must be 10+ digits
- Emails must be valid email format
- Pagination defaults: page=1, limit=10
- All organization-related data is filtered by user's organization
- Status codes follow HTTP standards
- Rate limiting: 100 requests per 15 minutes
